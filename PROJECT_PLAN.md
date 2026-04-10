# Soundboard Bot — Project Plan

A Discord soundboard bot that lets users upload short audio clips, play them back in a voice channel, and overlap multiple sounds without interrupting each other. Runs as a Docker container on Unraid.

---

## Goals

- Users upload audio/video files via `/sb upload`, the bot converts them to a unified format (Opus OGG) and stores them.
- Users play sounds via `/sb play`. Multiple sounds can overlap in the same voice channel without stopping each other.
- Users can delete their own sounds. Admins can delete any sound.
- The bot refuses to leave an active voice channel for non-admin users ("don't steal the bot").
- Admins have priority: their `/sb play` overrides the channel lock.
- Storage is monitored; admins get a DM at 1GB, uploads are blocked at 5GB.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 (ESM) |
| Bot framework | discord.js v14 |
| Voice | @discordjs/voice |
| Audio processing | ffmpeg + ffprobe (spawned as child processes) |
| Database | better-sqlite3 |
| Container | Docker (multi-stage) on Unraid |

---

## Audio Format

All uploads are converted to **Opus in an OGG container** at **128kbps, 48kHz, stereo**.

Why: Discord's voice system uses Opus natively, so stored files can be streamed without re-encoding the codec (only the container changes). Excellent quality at tiny sizes — roughly 1MB/min at 128kbps.

---

## Overlapping Playback — PCM Mixer

Discord only allows one audio stream per voice connection. To play multiple sounds simultaneously without stopping the current one, the bot runs a custom **PCM mixer**:

1. Each active sound spawns its own `ffmpeg` process that decodes the file to raw 48kHz stereo PCM (s16le).
2. A `Mixer` Readable stream pulls 20ms frames from every active source, sums the samples (clamped to int16 range), and outputs a single mixed PCM stream.
3. That stream is wrapped in an `AudioResource` with `StreamType.Raw` and played through a single `AudioPlayer`.
4. When a source drains, it's removed from the mix. When the mixer has no more sources, the session ends and the bot disconnects.

---

## File Limits

| Limit | Value | Env var |
|---|---|---|
| Max duration | 120s (2 min) hard cap | `MAX_DURATION_SECONDS` |
| Max file size (post-conversion) | 10MB | `MAX_FILE_SIZE_MB` |
| Max uploads per user | 20 | `MAX_SOUNDS_PER_USER` |
| Storage soft cap (warn) | 1GB → DM admins | `STORAGE_WARN_GB` |
| Storage hard cap (block) | 5GB → refuse uploads | `STORAGE_HARD_GB` |

---

## Commands

| Command | Description |
|---|---|
| `/sb upload file:<attachment> name:<text>` | Upload an audio/video file, stored as `name`. Case-insensitive, globally unique. |
| `/sb play name:<text>` | Play a sound. Overlaps current playback if same channel. Blocked cross-channel for non-admins. |
| `/sb delete name:<text>` | Delete a sound. Uploaders can delete own sounds; admins can delete any. |
| `/sb list` | List all sounds (name, duration, uploader). |
| `/sb stop` | Admins: stop immediately. Users: start a 20%-vote button with 30s window. |
| `/sb storage` | Show used/total GB, sound count, warn threshold. |
| `/sb admin add user:<@user>` | Promote a user to bot admin (admin-only). |
| `/sb admin remove user:<@user>` | Demote a bot admin. The owner cannot be removed. |
| `/sb admin list` | Show current bot admins (owner + DB entries). |

Autocomplete is enabled on the `name` option for `/sb play` and `/sb delete`.

---

## Admin System

Admin checks are **independent of Discord guild permissions**. The bot maintains its own admin list:

1. **Bot owner** — `OWNER_ID` from `.env`. Always admin, can never be removed.
2. **DB admins** — users added via `/sb admin add`, stored in the `admins` table.

Every admin-gated code path uses `isAdmin(userId)` from `src/admins.js`, which checks the env var first and falls back to a SQLite lookup. No guild-permission checks anywhere in the codebase.

Admin powers:
- Stop playback instantly (`/sb stop`)
- Override the channel lock when using `/sb play` from a different VC
- Delete any sound regardless of uploader
- Add/remove other admins
- Receive storage warning DMs (at 1GB soft cap)

---

## Permission / Channel-Lock Rules

- When the bot is playing in channel A:
  - User in channel A runs `/sb play` → allowed (overlap).
  - User in channel B runs `/sb play` → rejected with "Bot is playing in #A".
  - Admin in channel B runs `/sb play` → **admin priority**: current session is stopped, bot moves to channel B, new sound plays.
- `/sb stop`:
  - Admin → stops instantly.
  - User → starts a vote (button click). Needed votes = `ceil(humans_in_channel * 0.20)` (min 1). 30s expiry. Voters must be in the active VC.
- Auto-disconnect when all sounds finish.

---

## Storage Warning & Hard Lock

- **Warn (1GB):** After any successful upload, total size is checked. If it crosses `STORAGE_WARN_GB`, DMs are sent to:
  - The bot owner (`OWNER_ID` env var)
  - Every member of the current guild with the `ADMINISTRATOR` permission
  - A sent-flag prevents spamming DMs on every upload; it resets if the total drops back below the warn threshold (e.g. after a delete).
- **Hard lock (5GB):** If total size is at or above `STORAGE_HARD_GB`, `/sb upload` is rejected with a message.

---

## Directory Layout

```
Soundboard Bot/
├── src/
│   ├── index.js              # Entry: register slash commands, login
│   ├── bot.js                # Client setup, interaction dispatcher
│   ├── config.js             # Env var loading + validation
│   ├── logger.js             # Diagnostic logger (console + general.log)
│   ├── storage.js            # Size checks, warning DM broadcaster
│   ├── admins.js             # Bot admin helper (isAdmin/addAdmin/…)
│   ├── db/
│   │   └── database.js       # SQLite schema + prepared queries
│   ├── audio/
│   │   ├── converter.js      # ffmpeg probe + convert to Opus OGG
│   │   ├── mixer.js          # PCM mixing Readable stream
│   │   └── player.js         # Voice connection / session management
│   └── commands/
│       ├── index.js          # Slash command definition (/sb with subcommands)
│       ├── upload.js
│       ├── play.js
│       ├── delete.js
│       ├── list.js
│       ├── stop.js
│       ├── storage.js
│       └── admin.js          # /sb admin add|remove|list
├── .github/workflows/
│   └── docker.yml            # Build + publish image to ghcr.io on push
├── sounds/                   # Volume: converted .ogg files
├── data/                     # Volume: sounds.db (+ temp/ for uploads)
├── logs/                     # Volume: general.log
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── PROJECT_PLAN.md
```

---

## Database Schema

```sql
CREATE TABLE sounds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  filename         TEXT NOT NULL,            -- stored filename in /sounds
  uploader_id      TEXT NOT NULL,            -- Discord user ID
  uploader_tag     TEXT NOT NULL,
  guild_id         TEXT NOT NULL,            -- Guild where uploaded (metadata)
  duration_seconds REAL NOT NULL,
  file_size_bytes  INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE TABLE admins (
  user_id   TEXT PRIMARY KEY,
  added_by  TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);
```

Sounds are **global across all guilds** — names are unique everywhere the bot runs.
Admins are also global — the bot is designed for a single deployment where admin status applies everywhere.

---

## Logging

- Console + `/app/logs/general.log`
- Every significant action: `INFO`, `OK`, `FAIL`, `WARN`, `ERROR`, `SKIP`
- Structured as: `[timestamp] [LEVEL] message {json-metadata}`
- Never logs tokens or raw user attachment URLs (only IDs and result codes)

---

## Deployment (Unraid)

1. Clone the repo somewhere on the Unraid server (e.g. `/mnt/user/appdata/soundboard-bot/`).
2. Copy `.env.example` → `.env`, fill in `DISCORD_TOKEN`, `CLIENT_ID`, `OWNER_ID`.
3. `docker compose up -d --build`
4. The `sounds/`, `data/`, and `logs/` directories on the host are bind-mounted into the container, so uploads and the DB persist across restarts and image rebuilds.

---

## Session Notes

### 2026-04-10 — Initial build
- Initial scaffolding, all commands, PCM mixer, Docker setup.
- Refactored admin model: dropped Discord guild `ADMINISTRATOR` permission checks entirely. Introduced `admins` table + `isAdmin()` helper + `/sb admin` subcommand group. Bot owner (`OWNER_ID` env) is always admin and immutable; other admins are stored in SQLite.
- Dropped the privileged `GuildMembers` intent — no longer needed after the admin refactor, simpler bot setup.
- Added `.github/workflows/docker.yml` to auto-build and push to ghcr.io on every push to `main`.
- Added `docker-compose.prod.yml` for pulling pre-built images on Unraid.
- Open questions for next session:
  - Verify mixer timing on real Discord voice (local testing).
  - Consider rate limiting on `/sb play` to prevent spam-overlap abuse.
  - Consider pagination buttons on `/sb list` if sound count grows beyond ~50.
