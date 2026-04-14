import {
  getSession,
  pauseSession,
  resumeSession,
  isPaused,
  isInitiator
} from '../audio/player.js';
import { isAdmin } from '../admins.js';
import { logger } from '../logger.js';
import {
  startVote,
  handleVoteButton,
  cancelVote
} from '../voteHelper.js';
import { replyFlags } from './visibility.js';

// --- /sb pause --------------------------------------------------------------

export async function handlePause(interaction) {
  const guild = interaction.guild;
  const session = getSession(guild.id);
  if (!session) {
    return interaction.reply({
      content: 'Nothing is playing right now.',
      flags: replyFlags(interaction)
    });
  }
  if (isPaused(guild.id)) {
    return interaction.reply({
      content: 'Playback is already paused. Use `/sb resume` to continue. Or if you\'re just trying to be a pain in the ass, you can always `/sb stop` it. Probably, I dunno I never tried to shut meself up but please just resume it ;3',
      flags: replyFlags(interaction)
    });
  }

  const userId = interaction.user.id;
  const admin = isAdmin(guild, userId);
  const initiator = isInitiator(guild.id, userId);

  // --- Initiator or admin: instant ----------------------------------------
  if (admin || initiator) {
    if (pauseSession(guild.id, userId)) {
      cancelVote('pause', guild.id);
      logger.ok('pause instant', {
        guildId: guild.id,
        by: userId,
        asAdmin: admin,
        asInitiator: initiator
      });
      return interaction.reply({
        content: `⏸ Playback paused. The bot will disconnect after 2 minutes if not resumed.`,
        flags: replyFlags(interaction)
      });
    }
    return interaction.reply({
      content: 'Could not pause playback.',
      flags: replyFlags(interaction)
    });
  }

  // --- Other VC members: vote ---------------------------------------------
  const voiceChannel = guild.channels.cache.get(session.channelId);
  if (!voiceChannel) {
    return interaction.reply({
      content: 'Voice channel no longer exists.',
      flags: replyFlags(interaction)
    });
  }
  const humans = voiceChannel.members.filter(m => !m.user.bot);
  if (!humans.has(userId)) {
    return interaction.reply({
      content: `You need to be in <#${voiceChannel.id}> to vote.`,
      flags: replyFlags(interaction)
    });
  }

  await startVote({
    kind: 'pause',
    interaction,
    voiceChannel,
    initialMessage: `⏸ <@${userId}> wants to pause the soundboard.`,
    buttonLabel: 'Vote to Pause',
    expiredMessage: '⌛ Pause vote expired.',
    onPass: async () => {
      pauseSession(guild.id, userId);
      logger.ok('pause by vote', { guildId: guild.id });
    }
  });
}

export async function handlePauseVoteButton(interaction) {
  return handleVoteButton({
    kind: 'pause',
    interaction,
    noLongerActiveMessage: 'Nothing is playing anymore.',
    passedMessageBuilder: (votes, needed) =>
      `⏸ Playback paused — vote passed (${votes}/${needed}).`,
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

// --- /sb resume -------------------------------------------------------------

export async function handleResume(interaction) {
  const guild = interaction.guild;
  const session = getSession(guild.id);
  if (!session) {
    return interaction.reply({
      content: 'Nothing is playing right now.',
      flags: replyFlags(interaction)
    });
  }
  if (!isPaused(guild.id)) {
    return interaction.reply({
      content: 'Playback is not paused.',
      flags: replyFlags(interaction)
    });
  }

  const userId = interaction.user.id;
  const admin = isAdmin(guild, userId);
  const initiator = isInitiator(guild.id, userId);

  if (admin || initiator) {
    if (resumeSession(guild.id)) {
      cancelVote('resume', guild.id);
      logger.ok('resume instant', { guildId: guild.id, by: userId });
      return interaction.reply({
        content: '▶ Playback resumed.',
        flags: replyFlags(interaction)
      });
    }
    return interaction.reply({
      content: 'Could not resume playback.',
      flags: replyFlags(interaction)
    });
  }

  const voiceChannel = guild.channels.cache.get(session.channelId);
  if (!voiceChannel) {
    return interaction.reply({
      content: 'Voice channel no longer exists.',
      flags: replyFlags(interaction)
    });
  }
  const humans = voiceChannel.members.filter(m => !m.user.bot);
  if (!humans.has(userId)) {
    return interaction.reply({
      content: `You need to be in <#${voiceChannel.id}> to vote.`,
      flags: replyFlags(interaction)
    });
  }

  await startVote({
    kind: 'resume',
    interaction,
    voiceChannel,
    initialMessage: `▶ <@${userId}> wants to resume the soundboard.`,
    buttonLabel: 'Vote to Resume',
    expiredMessage: '⌛ Resume vote expired.',
    onPass: async () => {
      resumeSession(guild.id);
      logger.ok('resume by vote', { guildId: guild.id });
    }
  });
}

export async function handleResumeVoteButton(interaction) {
  return handleVoteButton({
    kind: 'resume',
    interaction,
    noLongerActiveMessage: 'Nothing is playing anymore.',
    passedMessageBuilder: (votes, needed) =>
      `▶ Playback resumed — vote passed (${votes}/${needed}).`,
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
