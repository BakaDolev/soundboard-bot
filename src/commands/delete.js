import fs from 'node:fs';
import path from 'node:path';
import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { queries } from '../db/database.js';
import { isAdmin } from '../admins.js';
import { logger } from '../logger.js';

export async function handleDelete(interaction) {
  const name = interaction.options.getString('name');
  const sound = queries.getByName.get(name);

  if (!sound) {
    return interaction.reply({
      content: `No sound named **${name}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const admin = isAdmin(interaction.user.id);
  const isUploader = sound.uploader_id === interaction.user.id;

  if (!admin && !isUploader) {
    return interaction.reply({
      content: `You can only delete sounds you uploaded. **${sound.name}** was uploaded by <@${sound.uploader_id}>.`,
      flags: MessageFlags.Ephemeral,
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
      byUser: interaction.user.id,
      uploader: sound.uploader_id,
      asAdmin: admin && !isUploader
    });

    const label = admin && !isUploader ? ' (admin)' : '';
    await interaction.reply({
      content: `🗑 Deleted **${sound.name}**${label}.`,
      flags: MessageFlags.Ephemeral
    });
  } catch (err) {
    logger.error('delete failed', {
      name: sound.name,
      err: err.message
    });
    await interaction.reply({
      content: 'Delete failed due to an unexpected error.',
      flags: MessageFlags.Ephemeral
    });
  }
}
