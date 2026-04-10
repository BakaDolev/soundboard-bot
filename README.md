# Soundboard Bot

A Discord soundboard bot with **overlapping playback**. Users upload short audio or video clips, the bot converts them to Opus OGG, and `/sb play` adds sounds to a live PCM mix without stopping whatever is already playing.

Runs as a Docker container on Unraid (or anywhere Docker runs).

---

## Features

- `/sb upload` — attach any audio/video file, the bot auto-converts to Opus OGG (128kbps, 48kHz stereo)
- `/sb play` — plays a sound; multiple sounds overlap in a live mix
- `/sb delete` — users delete their own sounds, bot admins can delete any
- `/sb list` — list all sounds with uploader and duration
- `/sb stop` — admins stop instantly; users start a vote (20% of VC members, 30s)
- `/sb storage` — storage usage bar, largest sounds, limits
- `/sb admin add @user`, `/sb admin remove @user`, `/sb admin list` — manage bot admins
- Autocomplete on sound names for `/sb play` and `/sb delete`
- Channel lock: non-admins can't move the bot while it's playing in another channel
- Admin priority: admin `/sb play` overrides the channel lock
- Auto-disconnect after the last sound finishes
- Storage soft cap (1GB) DMs all bot admins
- Storage hard cap (5GB) blocks new uploads

## Admin System

The bot has its own admin list — **independent of Discord's guild permissions**. A user is a bot admin if:
1. Their Discord user ID matches `OWNER_ID` in `.env` (the bot owner — always admin, can't be removed), **or**
2. They've been added via `/sb admin add @user` (stored in the bot's SQLite database).

Admins can:
- Add/remove other admins (except the owner, who is permanent)
- Stop playback instantly with `/sb stop`
- Override the channel lock when running `/sb play` from a different voice channel
- Delete any sound (not just their own)
- Receive storage warning DMs

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

After every successful upload, total size is checked:
- **≥ 1 GB (soft):** DMs the bot owner + every member with the `ADMINISTRATOR` permission in the guild where the upload happened. A flag prevents re-sending until the total drops back below the threshold.
- **≥ 5 GB (hard):** `/sb upload` is rejected. Existing sounds still play. An admin must delete sounds to free space.

Both thresholds are configurable via `STORAGE_WARN_GB` / `STORAGE_HARD_GB`.

---

## File Limits

| Limit | Default | Env var |
|---|---|---|
| Max duration per sound | 120s | `MAX_DURATION_SECONDS` |
| Max file size (post-conversion) | 10 MB | `MAX_FILE_SIZE_MB` |
| Max sounds per user | 20 | `MAX_SOUNDS_PER_USER` |
| Storage warning threshold | 1 GB | `STORAGE_WARN_GB` |
| Storage hard cap | 5 GB | `STORAGE_HARD_GB` |

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
