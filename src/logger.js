import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.logsDir, { recursive: true });
const logFile = path.join(config.logsDir, 'general.log');

function write(level, message, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  const line = `[${ts}] [${level}] ${message}${metaStr}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (err) {
    console.error('[LOGGER] Failed to write to log file:', err.message);
  }
}

export const logger = {
  info: (msg, meta) => write('INFO', msg, meta),
  warn: (msg, meta) => write('WARN', msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  ok: (msg, meta) => write('OK', msg, meta),
  fail: (msg, meta) => write('FAIL', msg, meta),
  skip: (msg, meta) => write('SKIP', msg, meta)
};
