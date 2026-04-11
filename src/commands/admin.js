import {
  isAdmin,
  isBotAdmin,
  isOwner,
  addBotAdmin,
  removeBotAdmin,
  getBotAdminRecords
} from '../admins.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { replyFlags } from './visibility.js';

// All `/sb admin` operations are scoped to the current guild. Permission to
// add or remove admins requires being an admin in that guild (per the guild's
// admin_mode), so a server admin can promote bot admins in `server` mode just
// as easily as the owner can in `bot` mode.

export async function handleAdminAdd(interaction) {
  const actor = interaction.user.id;
  const guild = interaction.guild;
  if (!isAdmin(guild, actor)) {
    return interaction.reply({
      content: 'Only bot admins can manage admins in this server.',
      flags: replyFlags(interaction)
    });
  }

  const target = interaction.options.getUser('user');
  if (target.bot) {
    return interaction.reply({
      content: 'Bots cannot be admins.',
      flags: replyFlags(interaction)
    });
  }
  if (isBotAdmin(guild.id, target.id)) {
    return interaction.reply({
      content: `<@${target.id}> is already a bot admin in this server.`,
      flags: replyFlags(interaction),
      allowedMentions: { users: [] }
    });
  }

  addBotAdmin(guild.id, target.id, actor);
  logger.ok('admin added', { guildId: guild.id, userId: target.id, by: actor });

  await interaction.reply({
    content: `✅ Added <@${target.id}> as a bot admin in **${guild.name}**.`,
    flags: replyFlags(interaction),
    allowedMentions: { users: [] }
  });
}

export async function handleAdminRemove(interaction) {
  const actor = interaction.user.id;
  const guild = interaction.guild;
  if (!isAdmin(guild, actor)) {
    return interaction.reply({
      content: 'Only bot admins can manage admins in this server.',
      flags: replyFlags(interaction)
    });
  }

  const target = interaction.options.getUser('user');
  if (isOwner(target.id)) {
    return interaction.reply({
      content: 'The bot owner cannot be removed.',
      flags: replyFlags(interaction)
    });
  }
  if (!isBotAdmin(guild.id, target.id)) {
    return interaction.reply({
      content: `<@${target.id}> is not a bot admin in this server.`,
      flags: replyFlags(interaction),
      allowedMentions: { users: [] }
    });
  }

  removeBotAdmin(guild.id, target.id);
  logger.ok('admin removed', { guildId: guild.id, userId: target.id, by: actor });

  await interaction.reply({
    content: `🗑 Removed <@${target.id}> as a bot admin in **${guild.name}**.`,
    flags: replyFlags(interaction),
    allowedMentions: { users: [] }
  });
}

export async function handleAdminList(interaction) {
  const guild = interaction.guild;
  const records = getBotAdminRecords(guild.id);

  const lines = [`👑 <@${config.ownerId}> *(owner)*`];
  for (const row of records) {
    if (row.user_id === config.ownerId) continue;
    lines.push(`• <@${row.user_id}>`);
  }

  await interaction.reply({
    content: `**Bot Admins in ${guild.name} (${lines.length})**\n${lines.join('\n')}`,
    flags: replyFlags(interaction),
    allowedMentions: { users: [] }
  });
}
