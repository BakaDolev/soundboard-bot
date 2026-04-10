import { spawn } from 'node:child_process';
import { logger } from '../logger.js';

/**
 * Probe an input file for its audio duration in seconds.
 * Rejects if ffprobe can't parse the file (e.g. corrupted or not a media file).
 */
export function probeDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ];
    const proc = spawn('ffprobe', args);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', err => {
      logger.error('ffprobe spawn failed', { err: err.message });
      reject(new Error('ffprobe not available'));
    });

    proc.on('close', code => {
      if (code !== 0) {
        logger.fail('ffprobe failed', { code, stderr: stderr.slice(0, 500) });
        return reject(new Error('Could not probe file — is this a valid audio/video file?'));
      }
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration) || duration <= 0) {
        return reject(new Error('Could not determine audio duration'));
      }
      resolve(duration);
    });
  });
}

/**
 * Convert any input file to Opus in an OGG container.
 * 128kbps, 48kHz, stereo — matches Discord voice natively.
 */
export function convertToOpus(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
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
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', err => {
      logger.error('ffmpeg spawn failed', { err: err.message });
      reject(new Error('ffmpeg not available'));
    });

    proc.on('close', code => {
      if (code !== 0) {
        logger.fail('ffmpeg conversion failed', { code, stderr: stderr.slice(-500) });
        return reject(new Error('Audio conversion failed'));
      }
      resolve();
    });
  });
}
