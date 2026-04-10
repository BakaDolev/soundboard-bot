import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { getSession, stopSession } from '../audio/player.js';
import { isAdmin } from '../admins.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

// guildId -> { voters: Set<userId>, voteId, messageId, timer }
const activeVotes = new Map();

function calcNeeded(humansInChannel) {
  return Math.max(1, Math.ceil(humansInChannel * config.voteStopThreshold));
}

function buildVoteRow(voteId, current, needed) {
  const button = new ButtonBuilder()
    .setCustomId(voteId)
    .setLabel(`Vote to Stop (${current}/${needed})`)
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(button);
}

export async function handleStop(interaction) {
  const session = getSession(interaction.guild.id);
  if (!session) {
    return interaction.reply({
      content: 'Nothing is playing right now.',
      flags: MessageFlags.Ephemeral
    });
  }

  const admin = isAdmin(interaction.user.id);

  // --- Admin: instant stop --------------------------------------------------
  if (admin) {
    stopSession(interaction.guild.id, 'admin-stop');
    cancelVote(interaction.guild.id);
    logger.ok('stop by admin', {
      guildId: interaction.guild.id,
      userId: interaction.user.id
    });
    return interaction.reply({ content: '🛑 Playback stopped by admin.' });
  }

  // --- User: start or join a vote ------------------------------------------
  const voiceChannel = interaction.guild.channels.cache.get(session.channelId);
  if (!voiceChannel) {
    // Edge case: channel disappeared while playing
    stopSession(interaction.guild.id, 'channel-gone');
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

  const needed = calcNeeded(humans.size);

  if (activeVotes.has(interaction.guild.id)) {
    return interaction.reply({
      content: 'A stop vote is already in progress. Click the button on that message to vote.',
      flags: MessageFlags.Ephemeral
    });
  }

  const voters = new Set([interaction.user.id]);

  // Single voter edge case: if threshold is 1, stop immediately
  if (voters.size >= needed) {
    stopSession(interaction.guild.id, 'vote-passed-instant');
    logger.ok('stop by vote (instant threshold)', {
      guildId: interaction.guild.id,
      userId: interaction.user.id
    });
    return interaction.reply({
      content: `🛑 Playback stopped (only ${needed} vote needed).`
    });
  }

  const voteId = `stop-vote-${interaction.guild.id}-${Date.now()}`;
  const row = buildVoteRow(voteId, voters.size, needed);

  const reply = await interaction.reply({
    content:
      `🛑 <@${interaction.user.id}> wants to stop the soundboard.\n` +
      `**${voters.size}/${needed}** votes needed. Vote expires in ${config.voteStopDurationMs / 1000}s.`,
    components: [row],
    fetchReply: true
  });

  const timer = setTimeout(async () => {
    const vote = activeVotes.get(interaction.guild.id);
    if (!vote || vote.voteId !== voteId) return;
    activeVotes.delete(interaction.guild.id);
    try {
      await reply.edit({ content: '⌛ Stop vote expired.', components: [] });
    } catch {}
    logger.info('stop vote expired', { guildId: interaction.guild.id });
  }, config.voteStopDurationMs);

  activeVotes.set(interaction.guild.id, {
    voters,
    voteId,
    messageId: reply.id,
    timer
  });
}

export async function handleStopVoteButton(interaction) {
  const vote = activeVotes.get(interaction.guild.id);
  if (!vote || interaction.customId !== vote.voteId) {
    return interaction.reply({
      content: 'This vote is no longer active.',
      flags: MessageFlags.Ephemeral
    });
  }

  const session = getSession(interaction.guild.id);
  if (!session) {
    cancelVote(interaction.guild.id);
    try {
      await interaction.update({
        content: 'Nothing is playing anymore.',
        components: []
      });
    } catch {}
    return;
  }

  const voiceChannel = interaction.guild.channels.cache.get(session.channelId);
  const humans = voiceChannel ? voiceChannel.members.filter(m => !m.user.bot) : new Map();

  if (!humans.has(interaction.user.id)) {
    return interaction.reply({
      content: `You need to be in <#${session.channelId}> to vote.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (vote.voters.has(interaction.user.id)) {
    return interaction.reply({
      content: 'You already voted.',
      flags: MessageFlags.Ephemeral
    });
  }

  vote.voters.add(interaction.user.id);
  // Recalculate needed each time — people may have joined/left the channel
  const needed = calcNeeded(humans.size);

  if (vote.voters.size >= needed) {
    cancelVote(interaction.guild.id);
    stopSession(interaction.guild.id, 'vote-passed');
    logger.ok('stop by vote', {
      guildId: interaction.guild.id,
      votes: vote.voters.size,
      needed
    });
    try {
      await interaction.update({
        content: `🛑 Playback stopped — vote passed (${vote.voters.size}/${needed}).`,
        components: []
      });
    } catch {}
    return;
  }

  const row = buildVoteRow(vote.voteId, vote.voters.size, needed);
  try {
    await interaction.update({
      content:
        `🛑 Stop vote in progress — **${vote.voters.size}/${needed}** votes.\n` +
        `Vote expires soon.`,
      components: [row]
    });
  } catch (err) {
    logger.warn('failed to update vote message', { err: err.message });
  }
}

function cancelVote(guildId) {
  const vote = activeVotes.get(guildId);
  if (!vote) return;
  clearTimeout(vote.timer);
  activeVotes.delete(guildId);
}
