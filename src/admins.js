import { config } from './config.js';
import { queries } from './db/database.js';

/**
 * Centralized admin check. The bot owner (OWNER_ID env var) is always admin
 * and can never be removed. Other admins are stored in the `admins` table
 * and managed via `/sb admin add` / `/sb admin remove`.
 */
export function isAdmin(userId) {
  if (!userId) return false;
  if (userId === config.ownerId) return true;
  return !!queries.isAdmin.get(userId);
}

export function isOwner(userId) {
  return userId === config.ownerId;
}

export function addAdmin(userId, addedBy) {
  queries.addAdmin.run(userId, addedBy, Date.now());
}

export function removeAdmin(userId) {
  queries.removeAdmin.run(userId);
}

export function getAllAdminIds() {
  const rows = queries.getAllAdmins.all();
  const ids = new Set([config.ownerId]);
  for (const row of rows) ids.add(row.user_id);
  return Array.from(ids);
}

export function getAdminRecords() {
  return queries.getAllAdmins.all();
}
