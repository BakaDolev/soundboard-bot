import { config } from './config.js';
import { queries } from './db/database.js';
import { getAllAdminIds } from './admins.js';
import { getSetting, isOverridden, STORAGE_ABSOLUTE_CEILING_GB } from './settings.js';
import { logger } from './logger.js';

const BYTES_PER_GB = 1024 ** 3;
const BYTES_PER_MB = 1024 ** 2;
const BYTES_PER_KB = 1024;

export function getTotalBytes() {
  return queries.totalSize.get().total;
}

// --- Effective per-guild caps ---------------------------------------------
// If a guild has set storage_*_gb_override, that value FULLY REPLACES the
// env value for uploads from that guild (clamped to STORAGE_ABSOLUTE_CEILING_GB
// at set-time by the settings layer). Without a guildId, falls back to env.

export function getEffectiveHardLimitGB(guildId) {
  if (guildId && isOverridden(guildId, 'storage_hard_gb_override')) {
    return Math.min(getSetting(guildId, 'storage_hard_gb_override'), STORAGE_ABSOLUTE_CEILING_GB);
  }
  return Math.min(config.storageHardGB, STORAGE_ABSOLUTE_CEILING_GB);
}

export function getEffectiveWarnLimitGB(guildId) {
  if (guildId && isOverridden(guildId, 'storage_warn_gb_override')) {
    return Math.min(getSetting(guildId, 'storage_warn_gb_override'), STORAGE_ABSOLUTE_CEILING_GB);
  }
  return Math.min(config.storageWarnGB, STORAGE_ABSOLUTE_CEILING_GB);
}

export function getEffectiveHardLimitBytes(guildId) {
  return getEffectiveHardLimitGB(guildId) * BYTES_PER_GB;
}

export function getEffectiveWarnLimitBytes(guildId) {
  return getEffectiveWarnLimitGB(guildId) * BYTES_PER_GB;
}

// Bot-wide defaults (used by /sb storage when no guild context applies).
export function getHardLimitBytes() {
  return Math.min(config.storageHardGB, STORAGE_ABSOLUTE_CEILING_GB) * BYTES_PER_GB;
}

export function getWarnLimitBytes() {
  return Math.min(config.storageWarnGB, STORAGE_ABSOLUTE_CEILING_GB) * BYTES_PER_GB;
}

export function isAtHardLimit(additionalBytes = 0, guildId = null) {
  return getTotalBytes() + additionalBytes >= getEffectiveHardLimitBytes(guildId);
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
 * Called after every successful upload. If total size just crossed the
 * effective warn threshold for the uploading guild, DM every admin id.
 * Idempotent — will not re-send until storage drops back below the threshold
 * and rises again.
 */
export async function checkStorageWarning(client, guildId = null) {
  const total = getTotalBytes();
  const warnBytes = getEffectiveWarnLimitBytes(guildId);

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
