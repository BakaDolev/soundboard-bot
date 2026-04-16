import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { logger } from '../logger.js';

// Discord voice native PCM format: 48kHz, stereo, signed 16-bit little-endian.
// Frame = 20ms = 960 samples per channel = 1920 total samples = 3840 bytes.
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_DURATION_MS / 1000) * CHANNELS;
const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE;

/**
 * Mixer is a Readable PCM stream that dynamically mixes multiple audio sources.
 *
 * Each source is an ffmpeg process that decodes an input file to raw s16le PCM
 * at 48kHz stereo. On each pull (_read), the mixer pulls one 20ms frame from
 * every active source, sums the samples (clamped to int16 range), and pushes
 * the result. When a source runs out of data, it's removed. When no sources
 * remain, an 'empty' event is emitted so the caller can tear down the session.
 */
export class Mixer extends Readable {
  constructor() {
    super({ highWaterMark: FRAME_BYTES * 10 });
    this.sources = new Map();
    this.nextId = 1;
    this.destroyed_ = false;
  }

  /**
   * Spawn an ffmpeg process to decode `inputPath` to raw PCM and add it to the mix.
   * `onFinish` fires when this specific sound is done playing (success or error).
   * Returns a numeric source id.
   */
  addSource(inputPath, onFinish, options = {}) {
    if (this.destroyed_) return null;

    const id = this.nextId++;
    const args = ['-i', inputPath, '-vn'];
    if (Number.isFinite(options.maxDurationSeconds) && options.maxDurationSeconds > 0) {
      args.push('-t', String(options.maxDurationSeconds));
    }
    args.push(
      '-f', 's16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-loglevel', 'error',
      '-'
    );
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const source = {
      id,
      proc,
      buffer: Buffer.alloc(0),
      ended: false,
      killed: false,
      onFinish: onFinish || (() => {}),
      onAbort: options.onAbort || (() => {})
    };

    proc.stdout.on('data', chunk => {
      source.buffer = Buffer.concat([source.buffer, chunk]);
    });
    proc.stdout.on('end', () => {
      source.ended = true;
    });
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) logger.warn('ffmpeg decode stderr', { id, msg: msg.slice(0, 200) });
    });
    proc.on('error', err => {
      logger.error('ffmpeg decode spawn error', { id, err: err.message });
      source.ended = true;
    });
    proc.on('close', code => {
      source.ended = true;
      if (code !== 0 && code !== null && !source.killed) {
        logger.warn('ffmpeg decode exited non-zero', { id, code });
      }
    });

    this.sources.set(id, source);
    logger.info('mixer source added', { id, active: this.sources.size });
    return id;
  }

  waitForSourceBuffer(id, minBytes, timeoutMs) {
    return new Promise(resolve => {
      const startedAt = Date.now();

      const poll = () => {
        const src = this.sources.get(id);
        if (!src || this.destroyed_) {
          resolve(false);
          return;
        }
        if (src.buffer.length >= minBytes || src.ended) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(poll, 20);
      };

      poll();
    });
  }

  /**
   * Kill a specific source immediately (used by `/sb stop` variants if we ever
   * need per-source stops — currently the whole session is torn down at once).
   */
  removeSource(id) {
    const src = this.sources.get(id);
    if (!src) return;
    src.killed = true;
    try { src.proc.kill('SIGKILL'); } catch {}
    this.sources.delete(id);
    try { src.onAbort(); } catch (err) {
      logger.error('onAbort callback threw', { err: err.message });
    }
    this.checkEmpty();
  }

  checkEmpty() {
    if (this.sources.size === 0) {
      // Defer so the caller of removeSource can finish its current tick
      // before we emit (avoids re-entrant cleanup).
      setImmediate(() => {
        if (this.sources.size === 0 && !this.destroyed_) {
          this.emit('empty');
        }
      });
    }
  }

  _read() {
    if (this.destroyed_) return;
    this.pushFrame();
  }

  pushFrame() {
    const frame = Buffer.alloc(FRAME_BYTES);
    const mix = new Int32Array(FRAME_SAMPLES);

    // Snapshot ids so we can safely remove while iterating
    const sourceIds = Array.from(this.sources.keys());

    for (const id of sourceIds) {
      const src = this.sources.get(id);
      if (!src) continue;

      if (src.buffer.length >= FRAME_BYTES) {
        for (let i = 0; i < FRAME_SAMPLES; i++) {
          mix[i] += src.buffer.readInt16LE(i * 2);
        }
        src.buffer = src.buffer.subarray(FRAME_BYTES);
      } else if (src.ended) {
        // Flush whatever tail samples are left, then retire this source.
        if (src.buffer.length >= 2) {
          const samples = Math.floor(src.buffer.length / 2);
          const n = Math.min(samples, FRAME_SAMPLES);
          for (let i = 0; i < n; i++) {
            mix[i] += src.buffer.readInt16LE(i * 2);
          }
        }
        this.sources.delete(id);
        try { src.onFinish(); } catch (err) {
          logger.error('onFinish callback threw', { err: err.message });
        }
        logger.info('mixer source drained', { id, active: this.sources.size });
        this.checkEmpty();
      }
      // else: source has data coming but not a full frame yet — skip this tick.
      // The missing samples become silence for this frame, which is imperceptible.
    }

    // Clamp mixed samples to int16 range to prevent wrap-around distortion
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const s = mix[i];
      const clamped = s > 32767 ? 32767 : (s < -32768 ? -32768 : s);
      frame.writeInt16LE(clamped, i * 2);
    }

    this.push(frame);
  }

  cleanup() {
    if (this.destroyed_) return;
    this.destroyed_ = true;
    for (const src of this.sources.values()) {
      src.killed = true;
      try { src.proc.kill('SIGKILL'); } catch {}
      try { src.onAbort(); } catch (err) {
        logger.error('onAbort callback threw', { err: err.message });
      }
    }
    this.sources.clear();
    this.push(null);
  }
}

export const MIXER_CONSTANTS = { FRAME_BYTES, SAMPLE_RATE, CHANNELS, FRAME_DURATION_MS };
