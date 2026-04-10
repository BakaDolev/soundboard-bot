import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { queries } from '../db/database.js';
import { probeDuration, convertToOpus } from '../audio/converter.js';
import {
  getTotalBytes,
  getHardLimitBytes,
  checkStorageWarning,
  formatBytes
} from '../storage.js';
import { logger } from '../logger.js';

const NAME_REGEX = /^[\w-]{1,32}$/;
const MAX_INPUT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB raw upload cap

export async function handleUpload(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const attachment = interaction.options.getAttachment('file');
  const name = interaction.options.getString('name').trim();

  // --- Validate name --------------------------------------------------------
  if (!NAME_REGEX.test(name)) {
    return interaction.editReply(
      'Name must be 1-32 characters: letters, numbers, underscores, or hyphens only.'
    );
  }

  if (queries.getByName.get(name)) {
    return interaction.editReply(`A sound named **${name}** already exists. Pick a different name.`);
  }

  // --- Check user's personal upload cap -------------------------------------
  const userCount = queries.countByUploader.get(interaction.user.id).count;
  if (userCount >= config.maxSoundsPerUser) {
    return interaction.editReply(
      `You've reached the max of **${config.maxSoundsPerUser}** uploaded sounds. ` +
        `Use \`/sb delete\` to remove some first.`
    );
  }

  // --- Storage hard lock ----------------------------------------------------
  const totalBytes = getTotalBytes();
  if (totalBytes >= getHardLimitBytes()) {
    logger.warn('upload blocked — storage hard cap reached', {
      userId: interaction.user.id,
      total: totalBytes
    });
    return interaction.editReply(
      `🚫 Storage is full (**${formatBytes(totalBytes)}** / ${config.storageHardGB} GB hard limit). ` +
        `Ask an admin to free space before uploading.`
    );
  }

  // --- Raw attachment sanity ------------------------------------------------
  if (attachment.size > MAX_INPUT_SIZE_BYTES) {
    return interaction.editReply(
      `Input file too large (${formatBytes(attachment.size)}). Max accepted upload is ${formatBytes(
        MAX_INPUT_SIZE_BYTES
      )}.`
    );
  }

  // --- Download to temp -----------------------------------------------------
  const tempDir = path.join(config.dataDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(config.soundsDir, { recursive: true });

  const tempId = crypto.randomBytes(8).toString('hex');
  const inputExt = path.extname(attachment.name || '').toLowerCase() || '.bin';
  const tempInput = path.join(tempDir, `${tempId}${inputExt}`);

  let outPath = null;

  try {
    const res = await fetch(attachment.url);
    if (!res.ok) {
      throw new Error(`download failed: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tempInput, buffer);

    // --- Probe duration -----------------------------------------------------
    let duration;
    try {
      duration = await probeDuration(tempInput);
    } catch (err) {
      safeUnlink(tempInput);
      return interaction.editReply(
        `Could not read that file. Make sure it's a valid audio or video file.`
      );
    }

    if (duration > config.maxDurationSeconds) {
      safeUnlink(tempInput);
      return interaction.editReply(
        `Sound is too long: **${duration.toFixed(1)}s**. Max is **${config.maxDurationSeconds}s**.`
      );
    }

    // --- Convert to Opus OGG -----------------------------------------------
    const outFilename = `${crypto.randomBytes(12).toString('hex')}.ogg`;
    outPath = path.join(config.soundsDir, outFilename);

    try {
      await convertToOpus(tempInput, outPath);
    } catch (err) {
      safeUnlink(tempInput);
      safeUnlink(outPath);
      logger.fail('upload conversion failed', {
        userId: interaction.user.id,
        err: err.message
      });
      return interaction.editReply(`Audio conversion failed. The file may be corrupted.`);
    }

    safeUnlink(tempInput);

    // --- Post-conversion size check ----------------------------------------
    const stats = fs.statSync(outPath);
    const maxBytes = config.maxFileSizeMB * 1024 * 1024;
    if (stats.size > maxBytes) {
      safeUnlink(outPath);
      return interaction.editReply(
        `Converted file is too large: **${formatBytes(stats.size)}**. Max is **${config.maxFileSizeMB} MB**.`
      );
    }

    // --- Persist to DB ------------------------------------------------------
    queries.insert.run(
      name,
      outFilename,
      interaction.user.id,
      interaction.user.tag,
      interaction.guild.id,
      duration,
      stats.size,
      Date.now()
    );

    logger.ok('sound uploaded', {
      name,
      userId: interaction.user.id,
      size: stats.size,
      duration
    });

    await interaction.editReply(
      `✅ Uploaded **${name}** — ${duration.toFixed(1)}s, ${formatBytes(stats.size)}.\n` +
        `Play it with \`/sb play name:${name}\`.`
    );

    // --- Storage warning check (fire and forget) ---------------------------
    checkStorageWarning(interaction.client).catch(err =>
      logger.error('storage warning check failed', { err: err.message })
    );
  } catch (err) {
    logger.error('upload failed', {
      userId: interaction.user.id,
      err: err.message,
      stack: err.stack
    });
    safeUnlink(tempInput);
    if (outPath) safeUnlink(outPath);
    try {
      await interaction.editReply('Upload failed due to an unexpected error. Check the logs.');
    } catch {}
  }
}

function safeUnlink(p) {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    logger.warn('unlink failed', { path: p, err: err.message });
  }
}
