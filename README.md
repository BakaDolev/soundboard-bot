# Soundboard Bot

A Discord soundboard bot with **overlapping playback**. Users upload short audio or video clips, the bot converts them to Opus OGG, and `/sb play` adds sounds to a live PCM mix without stopping whatever is already playing.

Runs as a Docker container on Unraid (or anywhere Docker runs).

---

> Every command below is also available under `/soundboard` as an alias of `/sb`.

## Features

- `/sb upload` — attach any audio/video file, the bot auto-converts to Opus OGG (128kbps, 48kHz stereo). Names accept spaces, hyphens, or underscores; the bot stores them in kebab-case and displays them with spaces.
- `/sb play name [channel]` — plays a sound; multiple sounds overlap in a live mix. Optional `channel:` lets you summon the bot to any voice channel you can see (Discord filters the picker to channels you have view access to). Non-admins get a **30s remote-play cooldown** for sending the bot to a channel they're not currently sitting in — playing into the channel you're already in is always free, and joining the target channel bypasses an active cooldown.
- `/sb edit name new_name` — uploader (or owner) renames a sound
- `/sb cut name start end` — uploader (or owner) trims a sound in place. Times accept `MM:SS`, `HH:MM:SS`, or plain seconds.
- `/sb delete` 🔒 — uploader, admin of the source server, or owner can delete
- `/sb list` — list available sounds (filtered by the per-server `view_scope` setting)
- `/sb stop` 🔒 — admins stop instantly; users start a vote (20% of VC members, 30s)
- `/sb pause` / `/sb resume` — initiator and admins pause/resume instantly; other VC members can vote. Bot disconnects 2 minutes after a pause if not resumed.
- `/sb storage` — storage usage bar, largest sounds, effective per-server limits
- `/sb admin add @user`, `/sb admin remove @user`, `/sb admin list` 🔒 — manage **per-server** bot admins
- `/sb settings view|set|unset` 🔒 — configure per-server limits and toggles
- Autocomplete on every sound-name option, with loose matching across spaces/hyphens/underscores
- Every subcommand takes an optional `visibility:true` flag — replies are private by default, pass `visibility:true` to post the reply publicly in the channel (vote messages for `/sb stop` / `/sb pause` / `/sb resume` are always public since others need to click the vote button)
- `/sb settings set` autocompletes the `value` field based on the chosen `key` — enum settings (`upload_scope`, `view_scope`, `admin_mode`) list each valid value with a description; numeric settings surface the current default
- Channel lock: non-admins can't move the bot while it's playing in another channel
- Admin priority: admin `/sb play` overrides the channel lock
- Auto-disconnect after the last sound finishes
- Storage soft cap (default 1 GB) DMs all bot admins
- Storage hard cap (default 5 GB, max 10 GB) blocks new uploads

## Admin System

Admins are scoped **per-server** and independent of Discord's guild permissions by default.

A user is a bot admin in a server if:
1. Their Discord user ID matches `OWNER_ID` in `.env` (the bot owner — always admin in every server, can't be removed), **or**
2. They've been added via `/sb admin add @user` *in that server* (stored in `bot_admins`).

Each server can switch its admin model with `/sb settings set admin_mode <bot|server>` (owner only):
- `bot` (default) — uses the per-server bot admin list described above
- `server` — anyone with Discord's `ADMINISTRATOR` permission in that server is treated as an admin

Admins can:
- Add/remove other admins in their server (except the owner, who is permanent)
- Stop playback instantly with `/sb stop`
- Pause/resume playback instantly
- Override the channel lock when running `/sb play` from a different voice channel
- Delete any sound uploaded from their server (the owner can delete any sound from anywhere)
- Receive storage warning DMs

## Per-Server Settings

`/sb settings set key:<key> value:<value>` lets bot admins tune the bot's behaviour per server. `/sb settings unset key:<key>` clears the override and falls back to the env default. `/sb settings view` shows the current values.

| Key | Default | Owner only? |
|---|---|---|
| `max_file_size_mb` | `MAX_FILE_SIZE_MB` env (10) | no |
| `max_duration_seconds` | `MAX_DURATION_SECONDS` env (120) | no |
| `max_sounds_per_user` | `MAX_SOUNDS_PER_USER` env (20) | no |
| `upload_scope` (`global`/`private`) | `global` | no |
| `view_scope` (`global`/`guild`) | `global` | no |
| `admin_mode` (`bot`/`server`) | `bot` | **yes** |
| `storage_warn_gb_override` | `STORAGE_WARN_GB` env (1) | **yes** |
| `storage_hard_gb_override` | `STORAGE_HARD_GB` env (5), max 10 | **yes** |

`upload_scope` controls how new uploads from the server are tagged. `view_scope` controls what `/sb list`, autocomplete, and `/sb play` show in that server: `global` shows all public sounds; `guild` shows only sounds uploaded in that server (regardless of how they were tagged at upload time). Sounds keep their original tag when settings change.

---

## Requirements

- Docker + Docker Compose (or the Unraid Docker UI)
- A Discord bot application with:
  - Bot token
  - Invite scopes: `bot` + `applications.commands`
  - Bot permissions: `View Channel`, `Send Messages`, `Connect`, `Speak`, `Use Slash Commands`
  - **No privileged intents required** — everything uses non-privileged intents

---

## Setup

### 1. Create your Discord bot

1. Go to https://discord.com/developers/applications → New Application
2. **Bot** tab → add a bot → copy the **Token**
3. **General Information** tab → copy the **Application ID** (this is `CLIENT_ID`)
4. **OAuth2 → URL Generator** → scopes: `bot` + `applications.commands` → paste the URL in a browser to invite

### 2. Configure the environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
OWNER_ID=your_discord_user_id
```

Leave the optional variables blank to use defaults, or tune them to taste.

### 3. Run

```bash
docker compose up -d --build
```

First build takes a few minutes (native deps compile for `better-sqlite3` and `@discordjs/opus`).

Check logs:
```bash
docker compose logs -f soundboard-bot
```

---

## Unraid Deployment (Pre-Built Image)

The easier path — pull the pre-built image from GitHub Container Registry instead of building locally:

1. On the Unraid server, create the directory `/mnt/user/appdata/soundboard-bot/`
2. Copy `docker-compose.prod.yml` and `.env.example` into that folder
3. Rename `docker-compose.prod.yml` → `docker-compose.yml`
4. Edit `docker-compose.yml` — replace `OWNER/REPO` with your GitHub username and repo name (lowercase), e.g. `ghcr.io/mygithub/soundboard-bot:latest`
5. `cp .env.example .env` and fill in the required values
6. `docker compose pull && docker compose up -d`

The GitHub Action builds a new image on every push to `main` and tags it `:latest`. To upgrade:
```bash
docker compose pull && docker compose up -d
```

## Local Build Deployment

If you prefer to build from source (useful when developing locally):

1. Clone this repo
2. `cp .env.example .env` and fill in the required values
3. `docker compose up -d --build`

---

## How It Works

### Audio format

Every upload is re-encoded to **Opus in an OGG container** at 128kbps, 48kHz, stereo. Opus is what Discord itself uses for voice, so stored files can be decoded and streamed with no codec re-encoding. Average size is roughly 1 MB per minute.

### Overlapping playback

Discord only allows one audio stream per voice connection. To overlap sounds, each active sound spawns its own ffmpeg process that decodes to raw PCM. A custom `Mixer` Readable stream pulls 20ms frames from every active source, sums the samples (clamped to int16), and pushes one combined PCM stream into Discord. When a source drains, it's removed from the mix. When the mix empties, the bot disconnects.

### Channel lock & admin priority

When the bot is playing in channel A:
- **User in A** runs `/sb play` → allowed, overlaps
- **User in B** runs `/sb play` → rejected
- **Admin in B** runs `/sb play` → current session is torn down, bot joins channel B, new sound plays

### Vote-to-stop

Non-admins use `/sb stop` to start a vote. Needed votes = `ceil(humans_in_vc * 0.20)` (minimum 1). The bot posts a button; voters must be in the active voice channel. After 30 seconds the vote expires.

### Storage warnings

After every successful upload, total size is checked against the **effective** caps for the uploading server (per-server override if set, otherwise the env values):
- **≥ warn cap (default 1 GB):** DMs the bot owner + every per-server bot admin recorded in `bot_admins`. A flag prevents re-sending until the total drops back below the threshold.
- **≥ hard cap (default 5 GB):** `/sb upload` is rejected. Existing sounds still play. An admin must delete sounds to free space.

Defaults are configurable via `STORAGE_WARN_GB` / `STORAGE_HARD_GB`. The owner can override either value per server with `/sb settings set storage_warn_gb_override` / `storage_hard_gb_override`. Both env defaults and overrides are clamped to an absolute ceiling of **10 GB**.

---

## File Limits

These env vars are the **defaults** for every server. Each server's bot admins can override most of them at runtime via `/sb settings`.

| Limit | Default | Env var | Per-server override key |
|---|---|---|---|
| Max duration per sound | 120s | `MAX_DURATION_SECONDS` | `max_duration_seconds` |
| Max file size (post-conversion) | 10 MB | `MAX_FILE_SIZE_MB` | `max_file_size_mb` |
| Max sounds per user | 20 | `MAX_SOUNDS_PER_USER` | `max_sounds_per_user` |
| Storage warning threshold | 1 GB | `STORAGE_WARN_GB` | `storage_warn_gb_override` (owner only) |
| Storage hard cap | 5 GB (max 10 GB) | `STORAGE_HARD_GB` | `storage_hard_gb_override` (owner only) |

Float env vars (`STORAGE_WARN_GB`, `STORAGE_HARD_GB`) accept decimals — set them to e.g. `0.5`, `1.25`, `7.5`. The override values do too. Both env values and per-server overrides are clamped to an absolute 10 GB ceiling.

---

## Directory Layout

```
Soundboard Bot/
├── src/                      # Source code
│   ├── index.js              # Entry — registers slash commands, logs in
│   ├── bot.js                # Discord client + interaction dispatch
│   ├── config.js             # Env var loader + validation
│   ├── logger.js             # Diagnostic logger (console + general.log)
│   ├── storage.js            # Size tracking + warning DM broadcaster
│   ├── db/database.js        # SQLite schema and prepared queries
│   ├── audio/
│   │   ├── converter.js      # ffmpeg probe + convert to Opus OGG
│   │   ├── mixer.js          # PCM mixing Readable stream
│   │   └── player.js         # Voice connection / session management
│   └── commands/             # One file per /sb subcommand
├── sounds/                   # Converted .ogg files (volume)
├── data/                     # sounds.db + temp upload dir (volume)
├── logs/                     # general.log (volume)
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── PROJECT_PLAN.md
└── README.md
```

---

## Troubleshooting

**The bot connects but no sound comes out.**
Check `logs/general.log` for `ffmpeg decode` errors. The most likely cause is ffmpeg not being available inside the container — the Dockerfile installs it, but if you're running outside Docker, install ffmpeg on the host.

**Storage warning DMs aren't arriving.**
- Admins with DMs disabled or who don't share a server with the bot can't receive them — it's a Discord limitation.
- Check `logs/general.log` for `storage warning DM failed` entries.

**`better-sqlite3` build fails.**
The Dockerfile handles this via a multi-stage build that installs `python3`, `make`, `g++` for compilation. If you're running outside Docker, install those build tools first.

**Slash commands don't appear.**
Global slash commands can take up to an hour to propagate the first time. Restart your Discord client after registering.

---

## License

MIT
