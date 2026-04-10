import { MessageFlags } from 'discord.js';
import { getSession, stopSession } from '../audio/player.js';
import { isAdmin } from '../admins.js';
import { logger } from '../logger.js';
import {
  startVote,
  handleVoteButton,
  cancelVote
} from '../voteHelper.js';

export async function handleStop(interaction) {
  const guild = interaction.guild;
  const session = getSession(guild.id);
  if (!session) {
    return interaction.reply({
      content: 'Nothing is playing right now.',
      flags: MessageFlags.Ephemeral
    });
  }

  // --- Admin: instant stop --------------------------------------------------
  if (isAdmin(guild, interaction.user.id)) {
    stopSession(guild.id, 'admin-stop');
    cancelVote('stop', guild.id);
    logger.ok('stop by admin', { guildId: guild.id, userId: interaction.user.id });
    return interaction.reply({ content: '🛑 Playback stopped by admin.' });
  }

  // --- User: vote -----------------------------------------------------------
  const voiceChannel = guild.channels.cache.get(session.channelId);
  if (!voiceChannel) {
    stopSession(guild.id, 'channel-gone');
    return interaction.reply({
      content: 'Voice channel no longer exists. Playback stopped.',
      flags: MessageFlags.Ephemeral
    });
  }

  const humans = voiceChannel.members.filter(m => !m.user.bot);
  if (!humans.has(interaction.user.id)) {
    return interaction.reply({
      content: `You need to be in <#${voiceChannel.id}> to vote-stop.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await startVote({
    kind: 'stop',
    interaction,
    voiceChannel,
    initialMessage: `🛑 <@${interaction.user.id}> wants to stop the soundboard.`,
    buttonLabel: 'Vote to Stop',
    expiredMessage: '⌛ Stop vote expired.',
    onPass: async () => {
      stopSession(guild.id, 'vote-passed');
      logger.ok('stop by vote', { guildId: guild.id });
    }
  });
}

export async function handleStopVoteButton(interaction) {
  return handleVoteButton({
    kind: 'stop',
    interaction,
    noLongerActiveMessage: 'Nothing is playing anymore.',
    passedMessageBuilder: (votes, needed) =>
      `🛑 Playback stopped — vote passed (${votes}/${needed}).`,
    voteResolver: async () => {
      const session = getSession(interaction.guild.id);
      if (!session) return null;
      const voiceChannel = interaction.guild.channels.cache.get(session.channelId);
      if (!voiceChannel) return null;
      const humans = voiceChannel.members.filter(m => !m.user.bot);
      return { humans, voiceChannelId: session.channelId };
    }
  });
}
