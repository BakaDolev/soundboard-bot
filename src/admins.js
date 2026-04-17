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

function resolveUserId(actor) {
  if (!actor) return null;
  if (typeof actor === 'string') return actor;
  if (typeof actor.id === 'string') return actor.id;
  if (typeof actor.user?.id === 'string') return actor.user.id;
  return null;
}

function resolveMember(guild, actor) {
  if (!guild || !actor || typeof actor === 'string') return null;
  if (typeof actor.permissions?.has === 'function') return actor;

  const userId = resolveUserId(actor);
  if (!userId) return null;
  return guild.members?.cache?.get(userId) ?? null;
}

/**
 * Bot admin = owner OR a row in bot_admins for this (guild, user).
 * Owner is admin in every guild without needing a row.
 */
export function isBotAdmin(guildId, actor) {
  const userId = resolveUserId(actor);
  if (!userId || !guildId) return false;
  if (isOwner(userId)) return true;
  return !!queries.isBotAdmin.get(guildId, userId);
}

/**
 * Server admin = the user has Discord's ADMINISTRATOR permission in this guild.
 * Accepts either a Guild + userId pair or a GuildMember directly.
 */
export function isServerAdmin(guild, actor) {
  const userId = resolveUserId(actor);
  if (!guild || !userId) return false;
  if (isOwner(userId)) return true;
  if (guild.ownerId === userId) return true;

  if (actor && typeof actor !== 'string' && actor.permissions != null) {
    const perms =
      typeof actor.permissions?.has === 'function'
        ? actor.permissions
        : new PermissionsBitField(actor.permissions);
    if (perms.has(PermissionsBitField.Flags.Administrator)) {
      return true;
    }
  }

  // Prefer the live GuildMember from the interaction when callers have it,
  // then fall back to the guild cache.
  const member = resolveMember(guild, actor);
  if (!member) return false;
  return member.permissions?.has(PermissionsBitField.Flags.Administrator) === true;
}

/**
 * Single dispatcher used by every power-gated command. Picks bot or server
 * admin layer based on the guild's `admin_mode` setting. Owner is always true.
 */
export function isAdmin(guild, actor) {
  const userId = resolveUserId(actor);
  if (!guild || !userId) return false;
  if (isOwner(userId)) return true;
  const mode = getSetting(guild.id, 'admin_mode');
  if (mode === 'server') return isServerAdmin(guild, actor);
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
