import path from 'node:path';
import fs from 'node:fs';
import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { queries } from '../db/database.js';
import { getSession, playSound, stopSession } from '../audio/player.js';
import { isAdmin } from '../admins.js';
import { getSetting } from '../settings.js';
import { canonicalize, displayName } from '../names.js';
import { logger } from '../logger.js';

export async function handlePlay(interaction) {
  const rawName = interaction.options.getString('name');
  const sound = queries.getByMatch.get(canonicalize(rawName));

  if (!sound) {
    return interaction.reply({
      content: `No sound named **${rawName}**. Use \`/sb list\` to see available sounds.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // --- Visibility check ----------------------------------------------------
  // view_scope=guild → can only play sounds uploaded in this guild.
  // view_scope=global → can only play public sounds (is_private = 0).
  const viewScope = getSetting(interaction.guild.id, 'view_scope');
  const visible =
    viewScope === 'guild'
      ? sound.guild_id === interaction.guild.id
      : sound.is_private === 0;
  if (!visible) {
    return interaction.reply({
      content: `**${displayName(sound.name)}** isn't available in this server.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const member = interaction.member;
  const userVoice = member.voice?.channel;

  if (!userVoice) {
    return interaction.reply({
      content: 'You need to be in a voice channel to play sounds.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Bot needs permission to speak in the target channel
  const me = await interaction.guild.members.fetchMe();
  const perms = userVoice.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
    return interaction.reply({
      content: `I don't have permission to connect or speak in <#${userVoice.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const admin = isAdmin(interaction.guild, member.id);
  const session = getSession(interaction.guild.id);

  // --- Channel lock rules ---------------------------------------------------
  if (session && session.channelId !== userVoice.id) {
    if (admin) {
      logger.info('admin overriding channel lock', {
        guildId: interaction.guild.id,
        from: session.channelId,
        to: userVoice.id,
        userId: member.id
      });
      stopSession(interaction.guild.id, 'admin-override');
      // Small delay to let the old connection fully tear down before the new one opens
      await new Promise(resolve => setTimeout(resolve, 300));
    } else {
      return interaction.reply({
        content: `🔒 I'm currently playing in <#${session.channelId}>. Wait for it to finish or ask an admin.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  // --- Verify file still exists on disk ------------------------------------
  const filePath = path.join(config.soundsDir, sound.filename);
  if (!fs.existsSync(filePath)) {
    logger.error('sound file missing from disk', {
      name: sound.name,
      filename: sound.filename
    });
    return interaction.reply({
      content: `The file for **${sound.name}** is missing from disk. It may have been deleted manually.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // --- Play -----------------------------------------------------------------
  // Defer here — voice connection can take >3s, which would expire the interaction token.
  // Quick pre-play validation above stays as non-deferred ephemeral replies.
  await interaction.deferReply();

  try {
    const result = await playSound(
      interaction.guild,
      userVoice,
      filePath,
      sound.name,
      member.id
    );

    const display = displayName(sound.name);
    const suffix = result.overlapping > 1 ? ` (${result.overlapping} sounds overlapping)` : '';
    await interaction.editReply({
      content: `▶ Playing **${display}**${suffix}`,
      flags: MessageFlags.Ephemeral
    });
  } catch (err) {
    logger.error('play failed', {
      guildId: interaction.guild.id,
      sound: sound.name,
      err: err.message
    });
    await interaction.editReply({
      content: `Failed to play **${displayName(sound.name)}**: ${err.message}`,
      flags: MessageFlags.Ephemeral
    });
  }
}
