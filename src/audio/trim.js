import { spawn } from 'node:child_process';
import { logger } from '../logger.js';

/**
 * Trim an OGG/Opus file between start and end seconds, writing the result
 * to outputPath. The output uses the same encoding settings as the original
 * convertToOpus pipeline so playback behaviour is identical.
 */
export function trimOpus(inputPath, outputPath, startSeconds, endSeconds) {
  return new Promise((resolve, reject) => {
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds
    ) {
      return reject(new Error('Invalid trim range'));
    }

    const args = [
      '-y',
      '-ss', String(startSeconds),
      '-to', String(endSeconds),
      '-i', inputPath,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'ogg',
      outputPath
    ];
    const proc = spawn('ffmpeg', args);

    let stderr = '';
    proc.stderr.on('data', d => {
      stderr += d.toString();
    });

    proc.on('error', err => {
      logger.error('ffmpeg trim spawn failed', { err: err.message });
      reject(new Error('ffmpeg not available'));
    });

    proc.on('close', code => {
      if (code !== 0) {
        logger.fail('ffmpeg trim failed', { code, stderr: stderr.slice(-500) });
        return reject(new Error('Trim failed — input may be corrupted'));
      }
      resolve();
    });
  });
}

/**
 * Parse a time string. Accepts:
 *   - "MM:SS"      → minutes + seconds
 *   - "HH:MM:SS"   → hours + minutes + seconds
 *   - "12.5"       → bare seconds (decimal allowed)
 * Returns null if it can't be parsed.
 */
export function parseTimeString(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (!trimmed.includes(':')) {
    const n = parseFloat(trimmed);
    if (Number.isNaN(n) || n < 0) return null;
    return n;
  }

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  const nums = parts.map(p => parseFloat(p));
  if (nums.some(n => Number.isNaN(n) || n < 0)) return null;

  let total = 0;
  for (const n of nums) {
    total = total * 60 + n;
  }
  return total;
}
