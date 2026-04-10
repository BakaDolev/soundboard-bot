// Reusable vote-button helper shared by stop / pause / resume.
//
// Each "kind" (e.g. 'stop', 'pause', 'resume') has its own per-guild map of
// active votes. Each vote tracks the set of voter IDs, the threshold, the
// timer that expires the vote, and a callback that executes when the vote
// passes. The button customId is `${kind}-vote-${guildId}-${ts}`.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { config } from './config.js';
import { logger } from './logger.js';

// kind -> Map<guildId, voteState>
const ALL_VOTES = new Map();

function bucket(kind) {
  let m = ALL_VOTES.get(kind);
  if (!m) {
    m = new Map();
    ALL_VOTES.set(kind, m);
  }
  return m;
}

export function calcVotesNeeded(humansInChannel) {
  return Math.max(1, Math.ceil(humansInChannel * config.voteStopThreshold));
}

function buildRow(customId, label, current, needed, style = ButtonStyle.Danger) {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(`${label} (${current}/${needed})`)
    .setStyle(style);
  return new ActionRowBuilder().addComponents(button);
}

export function getActiveVote(kind, guildId) {
  return bucket(kind).get(guildId);
}

export function cancelVote(kind, guildId) {
  const m = bucket(kind);
  const vote = m.get(guildId);
  if (!vote) return;
  clearTimeout(vote.timer);
  m.delete(guildId);
}

/**
 * Start a new vote and reply to the interaction with a button row. The
 * onPass callback runs when the threshold is reached. Returns whether the
 * vote was started (false if one already exists for this guild+kind).
 */
export async function startVote({
  kind,
  interaction,
  voiceChannel,
  initialMessage,
  buttonLabel,
  expiredMessage,
  onPass
}) {
  const m = bucket(kind);
  if (m.has(interaction.guild.id)) {
    await interaction.reply({
      content: `A ${kind} vote is already in progress. Click the button on that message to vote.`,
      flags: MessageFlags.Ephemeral
    });
    return false;
  }

  const humans = voiceChannel.members.filter(mm => !mm.user.bot);
  const needed = calcVotesNeeded(humans.size);
  const voters = new Set([interaction.user.id]);

  // Single-voter edge case: instant pass.
  if (voters.size >= needed) {
    try {
      await onPass();
    } catch (err) {
      logger.error(`${kind} vote instant-pass callback threw`, { err: err.message });
    }
    await interaction.reply({
      content: `${initialMessage}\n✅ Passed instantly (only ${needed} vote needed).`
    });
    return true;
  }

  const voteId = `${kind}-vote-${interaction.guild.id}-${Date.now()}`;
  const row = buildRow(voteId, buttonLabel, voters.size, needed);

  const reply = await interaction.reply({
    content:
      `${initialMessage}\n` +
      `**${voters.size}/${needed}** votes needed. Vote expires in ${config.voteStopDurationMs / 1000}s.`,
    components: [row],
    fetchReply: true
  });

  const timer = setTimeout(async () => {
    const v = m.get(interaction.guild.id);
    if (!v || v.voteId !== voteId) return;
    m.delete(interaction.guild.id);
    try {
      await reply.edit({ content: expiredMessage, components: [] });
    } catch {}
    logger.info(`${kind} vote expired`, { guildId: interaction.guild.id });
  }, config.voteStopDurationMs);

  m.set(interaction.guild.id, {
    kind,
    voters,
    voteId,
    messageId: reply.id,
    timer,
    buttonLabel,
    onPass
  });
  return true;
}

/**
 * Generic button handler. Returns nothing — callers should not need to
 * inspect the result. Validates that the customId matches the active vote,
 * the user is in the active VC, hasn't double-voted, etc.
 */
export async function handleVoteButton({
  kind,
  interaction,
  passedMessageBuilder,
  noLongerActiveMessage,
  voteResolver
}) {
  const m = bucket(kind);
  const vote = m.get(interaction.guild.id);
  if (!vote || interaction.customId !== vote.voteId) {
    return interaction.reply({
      content: 'This vote is no longer active.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Caller resolves what voice channel and humans look like, plus any
  // session-still-valid check.
  const ctx = await voteResolver(interaction);
  if (!ctx) {
    cancelVote(kind, interaction.guild.id);
    try {
      await interaction.update({
        content: noLongerActiveMessage,
        components: []
      });
    } catch {}
    return;
  }
  const { humans, voiceChannelId } = ctx;

  if (!humans.has(interaction.user.id)) {
    return interaction.reply({
      content: `You need to be in <#${voiceChannelId}> to vote.`,
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
  const needed = calcVotesNeeded(humans.size);

  if (vote.voters.size >= needed) {
    cancelVote(kind, interaction.guild.id);
    try {
      await vote.onPass();
    } catch (err) {
      logger.error(`${kind} vote pass callback threw`, { err: err.message });
    }
    try {
      await interaction.update({
        content: passedMessageBuilder(vote.voters.size, needed),
        components: []
      });
    } catch {}
    return;
  }

  const row = buildRow(vote.voteId, vote.buttonLabel, vote.voters.size, needed);
  try {
    await interaction.update({
      content:
        `🗳 ${kind} vote in progress — **${vote.voters.size}/${needed}** votes.\n` +
        `Vote expires soon.`,
      components: [row]
    });
  } catch (err) {
    logger.warn(`failed to update ${kind} vote message`, { err: err.message });
  }
}
