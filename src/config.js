import 'dotenv/config';

const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID', 'OWNER_ID'];

for (const key of REQUIRED) {
  if (!process.env[key] || process.env[key].trim() === '') {
    console.error(`[FATAL] Missing required env variable: ${key}`);
    console.error('Copy .env.example to .env and fill in the required values.');
    process.exit(1);
  }
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`[FATAL] Invalid integer env var ${name}: "${raw}"`);
    process.exit(1);
  }
  return n;
}

function floatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) {
    console.error(`[FATAL] Invalid float env var ${name}: "${raw}"`);
    process.exit(1);
  }
  return n;
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerId: process.env.OWNER_ID,

  maxSoundsPerUser: intEnv('MAX_SOUNDS_PER_USER', 20),
  maxDurationSeconds: intEnv('MAX_DURATION_SECONDS', 120),
  maxFileSizeMB: intEnv('MAX_FILE_SIZE_MB', 10),
  storageWarnGB: floatEnv('STORAGE_WARN_GB', 1),
  storageHardGB: floatEnv('STORAGE_HARD_GB', 5),

  soundsDir: process.env.SOUNDS_DIR || '/app/sounds',
  dataDir: process.env.DATA_DIR || '/app/data',
  logsDir: process.env.LOGS_DIR || '/app/logs',

  voteStopThreshold: 0.20,
  voteStopDurationMs: 30_000
};
