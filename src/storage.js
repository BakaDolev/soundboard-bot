import { config } from './config.js';
import { queries } from './db/database.js';
import { getAllAdminIds } from './admins.js';
import { logger } from './logger.js';

const BYTES_PER_GB = 1024 ** 3;
const BYTES_PER_MB = 1024 ** 2;
const BYTES_PER_KB = 1024;

export function getTotalBytes() {
  return queries.totalSize.get().total;
}

export function getHardLimitBytes() {
  return config.storageHardGB * BYTES_PER_GB;
}

export function getWarnLimitBytes() {
  return config.storageWarnGB * BYTES_PER_GB;
}

export function isAtHardLimit(additionalBytes = 0) {
  return getTotalBytes() + additionalBytes >= getHardLimitBytes();
}

export function formatBytes(bytes) {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  if (bytes < BYTES_PER_GB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;
}

// Tracks whether we've already DM'd admins about the warning threshold.
// Resets when total drops back below the warn line (e.g. after deletes).
let warningDmSent = false;

/**
 * Called after every successful upload. If total size just crossed the warn
 * threshold, DM every bot admin (owner + users in the `admins` table).
 * Idempotent — will not re-send until storage drops back below the threshold
 * and rises again.
 */
export async function checkStorageWarning(client) {
  const total = getTotalBytes();
  const warnBytes = getWarnLimitBytes();

  if (total < warnBytes) {
    if (warningDmSent) {
      warningDmSent = false;
      logger.info('storage warning flag reset (below threshold)', { total });
    }
    return;
  }

  if (warningDmSent) return;
  warningDmSent = true;

  await sendStorageWarningDMs(client, total);
}

async function sendStorageWarningDMs(client, bytesUsed) {
  const gbUsed = (bytesUsed / BYTES_PER_GB).toFixed(2);
  const message =
    `⚠ **Soundboard storage warning**\n` +
    `The sounds folder has reached **${gbUsed} GB** (soft cap: ${config.storageWarnGB} GB, ` +
    `hard cap: ${config.storageHardGB} GB).\n` +
    `Uploads will be blocked once the hard cap is reached. ` +
    `Ask users to delete unused sounds with \`/sb delete\`.`;

  const adminIds = getAllAdminIds();
  let sent = 0;
  let failed = 0;

  for (const id of adminIds) {
    try {
      const user = await client.users.fetch(id);
      await user.send(message);
      sent++;
      logger.ok('storage warning DM sent', { userId: id });
    } catch (err) {
      failed++;
      logger.fail('storage warning DM failed', { userId: id, err: err.message });
    }
  }

  logger.info('storage warning broadcast complete', {
    bytesUsed,
    sent,
    failed,
    recipients: adminIds.length
  });
}
