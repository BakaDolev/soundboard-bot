import path from 'node:path';
import fs from 'node:fs';
import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { queries } from '../db/database.js';
import { getSetting } from '../settings.js';
import { getSession, playSound, removeSessionSource, stopSession } from '../audio/player.js';
import { isAdmin } from '../admins.js';
import { logger } from '../logger.js';
import { displayName } from '../names.js';
import { replyFlags } from './visibility.js';
import {
  armRemoteCooldown,
  buildRemoteCooldownMessage,
  getRemoteCooldownRemainingMs,
  isRemoteTarget
} from './play.js';

const playlistStates = new Map();

function clearPlaylistState(guildId, state, reason) {
  if (playlistStates.get(guildId) === state) {
    playlistStates.delete(guildId);
  }
  state.active = false;
  state.currentSourceId = null;
  state.currentSoundName = null;
  state.skipRequestedSourceId = null;
  logger.info('tagged playlist state cleared', {
    guildId,
    tag: state.tagName,
    reason,
    started: state.started,
    failed: state.failed,
    total: state.playable.length
  });
}

async function advancePlaylist(guild, state) {
  if (!state.active) return false;
  if (playlistStates.get(guild.id) !== state) return false;
  if (state.advancePromise) return state.advancePromise;

  const promise = (async () => {
    while (state.active && playlistStates.get(guild.id) === state && state.nextIndex < state.playable.length) {
      const sound = state.playable[state.nextIndex++];
      const filePath = path.join(config.soundsDir, sound.filename);
      state.currentSoundName = sound.name;
      state.skipRequestedSourceId = null;

      try {
        const result = await playSound(guild, state.targetChannel, filePath, sound.name, state.startedBy, {
          onComplete: sourceId => {
            if (playlistStates.get(guild.id) !== state) return;
            if (state.currentSourceId === sourceId) {
              state.currentSourceId = null;
              state.currentSoundName = null;
            }
            void advancePlaylist(guild, state);
          },
          onAbort: sourceId => {
            if (playlistStates.get(guild.id) !== state) return;
            if (state.currentSourceId === sourceId) {
              state.currentSourceId = null;
              state.currentSoundName = null;
            }

            const session = getSession(guild.id);
            if (!session) {
              clearPlaylistState(guild.id, state, 'session-ended');
              return;
            }

            if (state.skipRequestedSourceId === sourceId) {
              state.skipRequestedSourceId = null;
              void advancePlaylist(guild, state);
            }
          }
        });

        if (!state.active || playlistStates.get(guild.id) !== state) {
          return true;
        }

        state.currentSourceId = result.sourceId;
        state.currentSoundName = sound.name;
        state.started++;
        return true;
      } catch (err) {
        state.failed++;
        logger.error('playlist playback error', {
          guildId: guild.id,
          tag: state.tagName,
          sound: sound.name,
          err: err.message
        });
      }
    }

    if (playlistStates.get(guild.id) === state && state.active) {
      logger.info('tagged playlist finished', {
        tag: state.tagName,
        guildId: guild.id,
        started: state.started,
        failed: state.failed,
        total: state.playable.length
      });
      clearPlaylistState(guild.id, state, 'finished');
    }

    return false;
  })();

  state.advancePromise = promise;
  try {
    return await promise;
  } finally {
    if (state.advancePromise === promise) {
      state.advancePromise = null;
    }
  }
}

export async function handleTaggedPlaylist(interaction) {
  const tagName = interaction.options.getString('tag').toLowerCase().trim();
  const providedChannel = interaction.options.getChannel('channel');
  const member = interaction.member;
  const userVoice = member.voice?.channel;
  const guild = interaction.guild;

  let targetChannel;
  if (providedChannel) {
    const userPerms = providedChannel.permissionsFor(member);
    if (!userPerms?.has(PermissionFlagsBits.ViewChannel) || !userPerms?.has(PermissionFlagsBits.Connect)) {
      return interaction.reply({ 
        content: `You don't have permission to join <#${providedChannel.id}>. Looking like a slave rn ngl`, 
        flags: replyFlags(interaction) 
      });
    }
    targetChannel = providedChannel;
  } else if (userVoice) {
    targetChannel = userVoice;
  } else {
    return interaction.reply({ 
      content: 'You need to be in a voice channel, or pass `channel:` to pick one.', 
      flags: replyFlags(interaction) 
    });
  }

  const me = await guild.members.fetchMe();
  const perms = targetChannel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
    return interaction.reply({ 
      content: `I don't have permission to connect/speak in <#${targetChannel.id}>.`, 
      flags: replyFlags(interaction) 
    });
  }

  const isRemotePlay = isRemoteTarget(userVoice, targetChannel);
  if (isRemotePlay && !isAdmin(guild, member)) {
    const remaining = getRemoteCooldownRemainingMs(guild.id, member.id);
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      return interaction.reply({
        content: buildRemoteCooldownMessage(targetChannel.id, seconds),
        flags: replyFlags(interaction)
      });
    }
  }

  const viewScope = getSetting(guild.id, 'view_scope');
  const sounds = viewScope === 'guild'
    ? queries.getSoundsForTagInGuild.all(tagName, guild.id)
    : queries.getSoundsForTag.all(tagName);

  if (sounds.length === 0) {
    return interaction.reply({ 
      content: `No sounds tagged with **${tagName}** found.`, 
      flags: replyFlags(interaction) 
    });
  }

  const admin = isAdmin(guild, member);
  const session = getSession(guild.id);
  if (session && session.channelId !== targetChannel.id) {
    if (admin) {
      stopSession(guild.id, 'admin-override');
      await new Promise(resolve => setTimeout(resolve, 300));
    } else {
      return interaction.reply({ 
        content: `🔒 I'm busy in <#${session.channelId}>. Wait your turn you dirty fucking nigger!`, 
        flags: replyFlags(interaction) 
      });
    }
  }

  const playable = sounds.filter(s => {
    const fp = path.join(config.soundsDir, s.filename);
    return fs.existsSync(fp);
  });

  if (playable.length === 0) {
    return interaction.reply({ 
      content: `All sounds tagged **${tagName}** are missing from disk. Rip.`, 
      flags: replyFlags(interaction) 
    });
  }

  await interaction.deferReply({ flags: replyFlags(interaction) });

  const existingPlaylist = playlistStates.get(guild.id);
  if (existingPlaylist) {
    clearPlaylistState(guild.id, existingPlaylist, 'replaced');
  }

  const playlistState = {
    tagName,
    playable,
    nextIndex: 0,
    started: 0,
    failed: 0,
    active: true,
    startedBy: member.id,
    targetChannel,
    currentSourceId: null,
    currentSoundName: null,
    skipRequestedSourceId: null,
    advancePromise: null
  };
  playlistStates.set(guild.id, playlistState);

  const started = await advancePlaylist(guild, playlistState);

  if (!started) {
    clearPlaylistState(guild.id, playlistState, 'start-failed');
    return interaction.editReply({
      content: `Playlist failed — no sounds tagged **${tagName}** could be played.`
    });
  }

  if (isRemotePlay && !admin) {
    armRemoteCooldown(guild.id, member.id);
  }

  const skipped = sounds.length - playable.length;
  const skipNote = skipped > 0 ? ` (${skipped} missing files skipped)` : '';
  await interaction.editReply({
    content: `Playing **${playable.length}** sounds tagged **${tagName}** in <#${targetChannel.id}>.${skipNote}\nUse \`/sb skip\` to skip the current playlist song.`
  });
}

export async function handlePlaylistSkip(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  const state = playlistStates.get(guild.id);

  if (!state || !state.active) {
    return interaction.reply({
      content: 'No tagged playlist is active right now.',
      flags: replyFlags(interaction)
    });
  }

  const admin = isAdmin(guild, member);
  const initiator = state.startedBy === member.id;
  if (!admin && !initiator) {
    return interaction.reply({
      content: 'Only the playlist starter or an admin can skip the current playlist song.',
      flags: replyFlags(interaction)
    });
  }

  if (state.currentSourceId == null) {
    if (state.advancePromise) {
      return interaction.reply({
        content: 'The playlist is already loading the next song.',
        flags: replyFlags(interaction)
      });
    }

    return interaction.reply({
      content: 'There is no current playlist song to skip.',
      flags: replyFlags(interaction)
    });
  }

  const skippedName = displayName(state.currentSoundName || 'current track');
  state.skipRequestedSourceId = state.currentSourceId;
  const removed = removeSessionSource(guild.id, state.currentSourceId);

  if (!removed) {
    state.skipRequestedSourceId = null;
    return interaction.reply({
      content: 'Could not skip that playlist song. It may have already ended.',
      flags: replyFlags(interaction)
    });
  }

  logger.ok('playlist song skipped', {
    guildId: guild.id,
    tag: state.tagName,
    sound: skippedName,
    by: member.id,
    asAdmin: admin,
    asInitiator: initiator
  });

  return interaction.reply({
    content: `⏭ Skipping **${skippedName}** in playlist **${state.tagName}**.`,
    flags: replyFlags(interaction)
  });
}
