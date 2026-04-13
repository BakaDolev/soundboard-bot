// Per-guild runtime settings layer.
//
// Backed by the `guild_settings` table. Reads go through an in-memory cache
// hydrated at startup; writes are write-through.
//
// Each setting has a definition: type, default (often from env), validator,
// and an `ownerOnly` flag for owner-restricted keys. Callers fetch values via
// `getSetting(guildId, key)` which always returns a parsed value (using the
// default when no override is set).

import { config } from './config.js';
import { queries } from './db/database.js';
import { logger } from './logger.js';

// Hard ceiling for any storage cap value (env or per-guild override).
// Lives here so the settings command can validate against it.
export const STORAGE_ABSOLUTE_CEILING_GB = 10;

const SETTING_DEFS = {
  max_file_size_mb: {
    type: 'int',
    default: () => config.maxFileSizeMB,
    validate: v => Number.isInteger(v) && v > 0,
    describe: 'Post-conversion file-size cap for non-admin uploads (MB).'
  },
  max_duration_seconds: {
    type: 'int',
    default: () => config.maxDurationSeconds,
    validate: v => Number.isInteger(v) && v > 0,
    describe: 'Hard cap on non-admin upload duration (seconds).'
  },
  max_sounds_per_user: {
    type: 'int',
    default: () => config.maxSoundsPerUser,
    validate: v => Number.isInteger(v) && v > 0,
    describe: 'Per-user upload quota for non-admins.'
  },
  spam_pool_size: {
    type: 'int',
    default: () => 15,
    validate: v => Number.isInteger(v) && v > 0 && v <= 100,
    describe: 'How many random sounds `/sb spam` picks from this server\'s visible pool (max 100).'
  },
  upload_scope: {
    type: 'enum',
    options: [
      { value: 'global', describe: 'New uploads are visible to every guild (default).' },
      { value: 'private', describe: 'New uploads are only visible in this guild.' }
    ],
    default: () => 'global',
    validate: v => v === 'global' || v === 'private',
    describe: '`global` = new uploads visible to every guild. `private` = only this guild can see them.'
  },
  view_scope: {
    type: 'enum',
    options: [
      { value: 'global', describe: 'list/play sees all public sounds across guilds (default).' },
      { value: 'guild', describe: 'list/play only sees sounds uploaded from this guild.' }
    ],
    default: () => 'global',
    validate: v => v === 'global' || v === 'guild',
    describe: '`global` = list/play sees all public sounds. `guild` = only sounds uploaded from this guild.'
  },
  admin_mode: {
    type: 'enum',
    options: [
      { value: 'bot', describe: 'Admins managed via /sb admin add (default).' },
      { value: 'server', describe: 'Anyone with Discord ADMINISTRATOR perm is a bot admin.' }
    ],
    default: () => 'bot',
    ownerOnly: true,
    validate: v => v === 'bot' || v === 'server',
    describe: '`bot` = admins managed via /sb admin add. `server` = anyone with Discord ADMINISTRATOR perm.'
  },
  storage_warn_gb_override: {
    type: 'float',
    default: () => config.storageWarnGB,
    ownerOnly: true,
    validate: v => typeof v === 'number' && v > 0 && v <= STORAGE_ABSOLUTE_CEILING_GB,
    describe: `Soft-cap override (GB). Replaces STORAGE_WARN_GB for uploads from this guild. Max ${STORAGE_ABSOLUTE_CEILING_GB} GB.`
  },
  storage_hard_gb_override: {
    type: 'float',
    default: () => config.storageHardGB,
    ownerOnly: true,
    validate: v => typeof v === 'number' && v > 0 && v <= STORAGE_ABSOLUTE_CEILING_GB,
    describe: `Hard-cap override (GB). Replaces STORAGE_HARD_GB for uploads from this guild. Max ${STORAGE_ABSOLUTE_CEILING_GB} GB.`
  }
};

export const SETTING_KEYS = Object.keys(SETTING_DEFS);

// guildId -> { key -> parsedValue }
const cache = new Map();

function parseValue(def, raw) {
  if (def.type === 'int') {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) throw new Error(`Invalid integer: "${raw}"`);
    return n;
  }
  if (def.type === 'float') {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number: "${raw}"`);
    return n;
  }
  if (def.type === 'enum') {
    const v = String(raw).trim().toLowerCase();
    const values = def.options.map(o => o.value);
    if (!values.includes(v)) {
      throw new Error(`Invalid value: "${raw}". Allowed: ${values.join(', ')}.`);
    }
    return v;
  }
  return raw;
}

function serializeValue(def, parsed) {
  return String(parsed);
}

// --- Cache hydration --------------------------------------------------------
// Called once at startup. Walks every row in guild_settings, parses, drops
// any rows that no longer validate (logged but not hard-fail).
export function hydrateSettingsCache() {
  cache.clear();
  const rows = queries.getAllSettings.all();
  let kept = 0;
  let dropped = 0;
  for (const row of rows) {
    const def = SETTING_DEFS[row.key];
    if (!def) {
      logger.warn('unknown setting key in DB, ignoring', { guildId: row.guild_id, key: row.key });
      dropped++;
      continue;
    }
    try {
      const parsed = parseValue(def, row.value);
      if (!def.validate(parsed)) throw new Error('failed validation');
      let bucket = cache.get(row.guild_id);
      if (!bucket) {
        bucket = {};
        cache.set(row.guild_id, bucket);
      }
      bucket[row.key] = parsed;
      kept++;
    } catch (err) {
      logger.warn('settings row failed parse, ignoring', {
        guildId: row.guild_id,
        key: row.key,
        value: row.value,
        err: err.message
      });
      dropped++;
    }
  }
  logger.info('settings cache hydrated', { kept, dropped, guilds: cache.size });
}

// --- Public API -------------------------------------------------------------

export function getSettingDef(key) {
  return SETTING_DEFS[key] || null;
}

export function getSetting(guildId, key) {
  const def = SETTING_DEFS[key];
  if (!def) throw new Error(`Unknown setting key: ${key}`);
  const bucket = guildId ? cache.get(guildId) : null;
  if (bucket && Object.prototype.hasOwnProperty.call(bucket, key)) {
    return bucket[key];
  }
  return def.default();
}

export function isOverridden(guildId, key) {
  const bucket = guildId ? cache.get(guildId) : null;
  return !!(bucket && Object.prototype.hasOwnProperty.call(bucket, key));
}

/**
 * Set a setting. Throws on validation errors with a user-friendly message.
 * Caller is responsible for permission checks (owner-only keys etc).
 */
export function setSetting(guildId, key, rawValue, updatedBy) {
  const def = SETTING_DEFS[key];
  if (!def) throw new Error(`Unknown setting key: ${key}`);

  const parsed = parseValue(def, rawValue);
  if (!def.validate(parsed)) {
    throw new Error(`Value out of range or invalid for ${key}.`);
  }

  queries.upsertSetting.run(guildId, key, serializeValue(def, parsed), updatedBy, Date.now());

  let bucket = cache.get(guildId);
  if (!bucket) {
    bucket = {};
    cache.set(guildId, bucket);
  }
  bucket[key] = parsed;
  logger.ok('setting updated', { guildId, key, value: parsed, by: updatedBy });
  return parsed;
}

export function unsetSetting(guildId, key, by) {
  const def = SETTING_DEFS[key];
  if (!def) throw new Error(`Unknown setting key: ${key}`);
  queries.deleteSetting.run(guildId, key);
  const bucket = cache.get(guildId);
  if (bucket) {
    delete bucket[key];
    if (Object.keys(bucket).length === 0) cache.delete(guildId);
  }
  logger.ok('setting cleared', { guildId, key, by });
}

export function listSettings(guildId) {
  const out = [];
  for (const key of SETTING_KEYS) {
    const def = SETTING_DEFS[key];
    out.push({
      key,
      value: getSetting(guildId, key),
      overridden: isOverridden(guildId, key),
      ownerOnly: !!def.ownerOnly,
      type: def.type,
      describe: def.describe,
      options: def.options || null
    });
  }
  return out;
}
