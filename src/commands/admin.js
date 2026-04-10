import { MessageFlags } from 'discord.js';
import {
  isAdmin,
  isOwner,
  addAdmin,
  removeAdmin,
  getAdminRecords
} from '../admins.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function handleAdminAdd(interaction) {
  const actor = interaction.user.id;
  if (!isAdmin(actor)) {
    return interaction.reply({
      content: 'Only bot admins can manage admins.',
      flags: MessageFlags.Ephemeral
    });
  }

  const target = interaction.options.getUser('user');
  if (target.bot) {
    return interaction.reply({
      content: 'Bots cannot be admins.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (isAdmin(target.id)) {
    return interaction.reply({
      content: `<@${target.id}> is already a bot admin.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { users: [] }
    });
  }

  addAdmin(target.id, actor);
  logger.ok('admin added', { userId: target.id, by: actor });

  await interaction.reply({
    content: `✅ Added <@${target.id}> as a bot admin.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { users: [] }
  });
}

export async function handleAdminRemove(interaction) {
  const actor = interaction.user.id;
  if (!isAdmin(actor)) {
    return interaction.reply({
      content: 'Only bot admins can manage admins.',
      flags: MessageFlags.Ephemeral
    });
  }

  const target = interaction.options.getUser('user');
  if (isOwner(target.id)) {
    return interaction.reply({
      content: 'The bot owner cannot be removed.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (!isAdmin(target.id)) {
    return interaction.reply({
      content: `<@${target.id}> is not a bot admin.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { users: [] }
    });
  }

  removeAdmin(target.id);
  logger.ok('admin removed', { userId: target.id, by: actor });

  await interaction.reply({
    content: `🗑 Removed <@${target.id}> as a bot admin.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { users: [] }
  });
}

export async function handleAdminList(interaction) {
  const records = getAdminRecords();

  const lines = [`👑 <@${config.ownerId}> *(owner)*`];
  for (const row of records) {
    if (row.user_id === config.ownerId) continue;
    lines.push(`• <@${row.user_id}>`);
  }

  await interaction.reply({
    content: `**Bot Admins (${lines.length})**\n${lines.join('\n')}`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { users: [] }
  });
}
