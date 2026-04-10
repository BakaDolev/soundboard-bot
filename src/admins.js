// Per-guild admin model.
//
// Two layers:
//   - bot admins: stored in `bot_admins` table, scoped per (guild_id, user_id),
//     managed via `/sb admin add|remove`. Owner is implicitly a bot admin in
//     every guild and can never be removed.
//   - server admins: anyone with Discord ADMINISTRATOR permission in that guild.
//
// Each guild has an `admin_mode` setting (default `bot`) that picks which
// layer counts for power-gated actions: `bot` uses bot admins, `server` uses
// Discord ADMINISTRATOR. The owner can always change `admin_mode` and is
// always treated as admin regardless of the setting.

import { PermissionsBitField } from 'discord.js';
import { config } from './config.js';
import { queries } from './db/database.js';
import { getSetting } from './settings.js';

export function isOwner(userId) {
  return !!userId && userId === config.ownerId;
}

/**
 * Bot admin = owner OR a row in bot_admins for this (guild, user).
 * Owner is admin in every guild without needing a row.
 */
export function isBotAdmin(guildId, userId) {
  if (!userId || !guildId) return false;
  if (isOwner(userId)) return true;
  return !!queries.isBotAdmin.get(guildId, userId);
}

/**
 * Server admin = the user has Discord's ADMINISTRATOR permission in this guild.
 * Accepts either a Guild + userId pair or a GuildMember directly.
 */
export function isServerAdmin(guild, userId) {
  if (!guild || !userId) return false;
  if (isOwner(userId)) return true;
  // Try cache first; fall back to nothing (server admin checks should always
  // be made from a context where the member is already cached, e.g. from an
  // interaction).
  const member = guild.members?.cache?.get(userId);
  if (!member) return false;
  return member.permissions?.has(PermissionsBitField.Flags.Administrator) === true;
}

/**
 * Single dispatcher used by every power-gated command. Picks bot or server
 * admin layer based on the guild's `admin_mode` setting. Owner is always true.
 */
export function isAdmin(guild, userId) {
  if (!guild || !userId) return false;
  if (isOwner(userId)) return true;
  const mode = getSetting(guild.id, 'admin_mode');
  if (mode === 'server') return isServerAdmin(guild, userId);
  return isBotAdmin(guild.id, userId);
}

// --- Mutation helpers (used by /sb admin) -----------------------------------

export function addBotAdmin(guildId, userId, addedBy) {
  queries.addBotAdmin.run(guildId, userId, addedBy, Date.now());
}

export function removeBotAdmin(guildId, userId) {
  queries.removeBotAdmin.run(guildId, userId);
}

export function getBotAdminRecords(guildId) {
  return queries.getBotAdminsForGuild.all(guildId);
}

/**
 * All admin user IDs the storage warning DM should target. Owner + every
 * bot admin in every guild (deduped).
 */
export function getAllAdminIds() {
  const rows = queries.getAllBotAdmins.all();
  const ids = new Set([config.ownerId]);
  for (const row of rows) ids.add(row.user_id);
  return Array.from(ids);
}
