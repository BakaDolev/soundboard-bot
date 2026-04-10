import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { queries } from '../db/database.js';
import { isOwner } from '../admins.js';
import { canonicalize, displayName } from '../names.js';
import { trimOpus, parseTimeString } from '../audio/trim.js';
import { probeDuration } from '../audio/converter.js';
import { formatBytes } from '../storage.js';
import { logger } from '../logger.js';

// Trim. Permission: uploader OR bot owner. Replaces the original file in
// place; on any failure the original is left intact.
export async function handleCut(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawName = interaction.options.getString('name', true);
  const sound = queries.getByMatch.get(canonicalize(rawName));
  if (!sound) {
    return interaction.editReply(`No sound named **${rawName}**.`);
  }

  const actor = interaction.user.id;
  if (sound.uploader_id !== actor && !isOwner(actor)) {
    return interaction.editReply(
      `You can only cut sounds you uploaded. **${displayName(sound.name)}** was uploaded by <@${sound.uploader_id}>.`
    );
  }

  const start = parseTimeString(interaction.options.getString('start', true));
  const end = parseTimeString(interaction.options.getString('end', true));
  if (start === null || end === null) {
    return interaction.editReply(
      'Invalid time format. Use `MM:SS`, `HH:MM:SS`, or plain seconds (e.g. `12.5`).'
    );
  }
  if (start < 0 || end <= start) {
    return interaction.editReply('`start` must be ≥ 0 and `end` must be greater than `start`.');
  }
  if (end > sound.duration_seconds + 0.05) {
    return interaction.editReply(
      `\`end\` (${end.toFixed(2)}s) is past the sound's length (${sound.duration_seconds.toFixed(2)}s).`
    );
  }

  const sourcePath = path.join(config.soundsDir, sound.filename);
  if (!fs.existsSync(sourcePath)) {
    logger.error('cut: source file missing', { filename: sound.filename });
    return interaction.editReply(`The file for **${displayName(sound.name)}** is missing from disk.`);
  }

  const tempDir = path.join(config.dataDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempOut = path.join(tempDir, `${crypto.randomBytes(8).toString('hex')}-cut.ogg`);

  try {
    await trimOpus(sourcePath, tempOut, start, end);

    // Re-probe duration from the trimmed file rather than trusting the
    // requested range — ffmpeg may snap to keyframes for tiny inputs.
    const newDuration = await probeDuration(tempOut);
    const newStats = fs.statSync(tempOut);

    // Atomic replace. On Windows, fs.renameSync replaces existing files since
    // Node 10.x; if it ever breaks we'd need to unlink first.
    fs.renameSync(tempOut, sourcePath);
    queries.updateAfterTrim.run(newDuration, newStats.size, sound.id);

    logger.ok('sound trimmed', {
      id: sound.id,
      name: sound.name,
      start,
      end,
      newDuration,
      newSize: newStats.size,
      by: actor
    });

    await interaction.editReply(
      `✂ Trimmed **${displayName(sound.name)}** to ${start.toFixed(2)}s–${end.toFixed(2)}s ` +
        `(now ${newDuration.toFixed(1)}s, ${formatBytes(newStats.size)}).`
    );
  } catch (err) {
    logger.error('cut failed', { id: sound.id, err: err.message });
    safeUnlink(tempOut);
    await interaction.editReply(`Trim failed: ${err.message}`);
  }
}

function safeUnlink(p) {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    logger.warn('cut: temp unlink failed', { path: p, err: err.message });
  }
}
