import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'sounds.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sounds (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    filename         TEXT NOT NULL,
    uploader_id      TEXT NOT NULL,
    uploader_tag     TEXT NOT NULL,
    guild_id         TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    file_size_bytes  INTEGER NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sounds_uploader ON sounds(uploader_id);
  CREATE INDEX IF NOT EXISTS idx_sounds_name ON sounds(name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS admins (
    user_id   TEXT PRIMARY KEY,
    added_by  TEXT NOT NULL,
    added_at  INTEGER NOT NULL
  );
`);

logger.info('database initialized', { path: dbPath });

export const queries = {
  getByName: db.prepare('SELECT * FROM sounds WHERE name = ? COLLATE NOCASE'),
  getByUploader: db.prepare('SELECT * FROM sounds WHERE uploader_id = ?'),
  countByUploader: db.prepare('SELECT COUNT(*) AS count FROM sounds WHERE uploader_id = ?'),
  getAll: db.prepare('SELECT * FROM sounds ORDER BY name COLLATE NOCASE ASC'),
  searchByName: db.prepare(`
    SELECT * FROM sounds
    WHERE name LIKE ? COLLATE NOCASE
    ORDER BY name COLLATE NOCASE ASC
    LIMIT 25
  `),
  insert: db.prepare(`
    INSERT INTO sounds
      (name, filename, uploader_id, uploader_tag, guild_id, duration_seconds, file_size_bytes, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deleteById: db.prepare('DELETE FROM sounds WHERE id = ?'),
  totalSize: db.prepare('SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM sounds'),
  count: db.prepare('SELECT COUNT(*) AS count FROM sounds'),
  topBySize: db.prepare('SELECT name, file_size_bytes FROM sounds ORDER BY file_size_bytes DESC LIMIT ?'),

  isAdmin: db.prepare('SELECT 1 FROM admins WHERE user_id = ?'),
  addAdmin: db.prepare('INSERT OR IGNORE INTO admins (user_id, added_by, added_at) VALUES (?, ?, ?)'),
  removeAdmin: db.prepare('DELETE FROM admins WHERE user_id = ?'),
  getAllAdmins: db.prepare('SELECT user_id, added_by, added_at FROM admins ORDER BY added_at ASC')
};

export default db;
