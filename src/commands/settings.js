import { EmbedBuilder } from 'discord.js';
import {
  SETTING_KEYS,
  getSettingDef,
  listSettings,
  setSetting,
  unsetSetting
} from '../settings.js';
import { isAdmin, isOwner } from '../admins.js';
import { logger } from '../logger.js';
import { replyFlags } from './visibility.js';

function denyOwnerOnly(interaction) {
  return {
    content: '🔒 That setting can only be changed by the bot owner.',
    flags: replyFlags(interaction)
  };
}

function denyNotAdmin(interaction) {
  return {
    content: '🔒 Only bot admins can change settings in this server.',
    flags: replyFlags(interaction)
  };
}

export async function handleSettingsView(interaction) {
  const guild = interaction.guild;
  if (!isAdmin(guild, interaction.user.id)) {
    return interaction.reply(denyNotAdmin(interaction));
  }

  const rows = listSettings(guild.id);
  const lines = rows.map(r => {
    const lock = r.ownerOnly ? '🔒 ' : '';
    const tag = r.overridden ? '' : ' *(default)*';
    let value = r.value;
    if (r.type === 'enum' && r.options) value = `\`${value}\``;
    return `${lock}**${r.key}** = ${value}${tag}\n  *${r.describe}*`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`⚙ Settings — ${guild.name}`)
    .setDescription(lines.join('\n\n'))
    .setColor(0x5865f2)
    .setFooter({
      text: '🔒 = owner only. Use /sb settings set or /sb settings unset to change.'
    });

  await interaction.reply({ embeds: [embed], flags: replyFlags(interaction) });
}

export async function handleSettingsSet(interaction) {
  const guild = interaction.guild;
  const actor = interaction.user.id;
  if (!isAdmin(guild, actor)) {
    return interaction.reply(denyNotAdmin(interaction));
  }

  const key = interaction.options.getString('key', true);
  const rawValue = interaction.options.getString('value', true);

  const def = getSettingDef(key);
  if (!def) {
    return interaction.reply({
      content: `Unknown setting key: \`${key}\`. Valid keys: ${SETTING_KEYS.join(', ')}.`,
      flags: replyFlags(interaction)
    });
  }
  if (def.ownerOnly && !isOwner(actor)) {
    return interaction.reply(denyOwnerOnly(interaction));
  }

  try {
    const parsed = setSetting(guild.id, key, rawValue, actor);
    await interaction.reply({
      content: `✅ Set **${key}** to \`${parsed}\` for **${guild.name}**.`,
      flags: replyFlags(interaction)
    });
  } catch (err) {
    logger.warn('settings set failed', { guildId: guild.id, key, rawValue, err: err.message });
    await interaction.reply({
      content: `❌ ${err.message}`,
      flags: replyFlags(interaction)
    });
  }
}

export async function handleSettingsUnset(interaction) {
  const guild = interaction.guild;
  const actor = interaction.user.id;
  if (!isAdmin(guild, actor)) {
    return interaction.reply(denyNotAdmin(interaction));
  }

  const key = interaction.options.getString('key', true);

  const def = getSettingDef(key);
  if (!def) {
    return interaction.reply({
      content: `Unknown setting key: \`${key}\`.`,
      flags: replyFlags(interaction)
    });
  }
  if (def.ownerOnly && !isOwner(actor)) {
    return interaction.reply(denyOwnerOnly(interaction));
  }

  unsetSetting(guild.id, key, actor);
  await interaction.reply({
    content: `↩ Cleared **${key}** for **${guild.name}** — falling back to default.`,
    flags: replyFlags(interaction)
  });
}
