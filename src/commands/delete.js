import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { queries } from '../db/database.js';
import { isAdmin, isOwner } from '../admins.js';
import { canonicalize, displayName } from '../names.js';
import { logger } from '../logger.js';
import { replyFlags } from './visibility.js';

// Delete permission layers:
//   - bot owner            -> any sound, any guild
//   - admin of source guild -> sounds whose guild_id matches the current guild
//                              (the action must happen IN the source guild,
//                              and "admin" follows that guild's admin_mode)
//   - uploader              -> their own sounds
export async function handleDelete(interaction) {
  const rawName = interaction.options.getString('name', true);
  const sound = queries.getByMatch.get(canonicalize(rawName));

  if (!sound) {
    return interaction.reply({
      content: `No sound named **${rawName}**.`,
      flags: replyFlags(interaction)
    });
  }

  const actor = interaction.user.id;
  const guild = interaction.guild;
  const isUploader = sound.uploader_id === actor;
  const owner = isOwner(actor);
  // Admin of the source guild — only meaningful if the action is happening
  // in that same guild (admin checks need a guild context).
  const adminOfSource =
    sound.guild_id === guild.id && isAdmin(guild, actor);

  const allowed = owner || isUploader || adminOfSource;

  if (!allowed) {
    return interaction.reply({
      content: `You can only delete sounds you uploaded. **${displayName(sound.name)}** was uploaded by <@${sound.uploader_id}>.`,
      flags: replyFlags(interaction),
      allowedMentions: { users: [] }
    });
  }

  try {
    const filePath = path.join(config.soundsDir, sound.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    } else {
      logger.warn('delete: file already missing', { filename: sound.filename });
    }

    queries.deleteById.run(sound.id);

    logger.ok('sound deleted', {
      name: sound.name,
      byUser: actor,
      uploader: sound.uploader_id,
      asOwner: owner,
      asGuildAdmin: adminOfSource && !isUploader && !owner
    });

    let label = '';
    if (owner && !isUploader) label = ' (owner)';
    else if (adminOfSource && !isUploader) label = ' (guild admin)';

    await interaction.reply({
      content: `🗑 Deleted **${displayName(sound.name)}**${label}.`,
      flags: replyFlags(interaction)
    });
  } catch (err) {
    logger.error('delete failed', {
      name: sound.name,
      err: err.message
    });
    await interaction.reply({
      content: 'Delete failed due to an unexpected error.',
      flags: replyFlags(interaction)
    });
  }
}
