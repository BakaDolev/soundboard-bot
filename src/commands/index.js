import { SlashCommandBuilder } from 'discord.js';
import { SETTING_KEYS } from '../settings.js';

// 🔒 marker on subcommand descriptions for admin-gated commands. Discord
// can't hide individual subcommands from non-admins, so the lock is the
// visible signal.
const LOCK = '🔒 ';

const SETTING_KEY_CHOICES = SETTING_KEYS.map(k => ({ name: k, value: k }));

function buildSlashCommand(name) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription('Soundboard commands')
    .addSubcommand(s =>
      s
        .setName('upload')
        .setDescription('Upload a new sound (audio or video file)')
        .addAttachmentOption(o =>
          o.setName('file').setDescription('Audio or video file').setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('Sound name (1-32 chars; spaces, hyphens, underscores all OK)')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(64)
        )
    )
    .addSubcommand(s =>
      s
        .setName('play')
        .setDescription('Play a sound')
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('Sound name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(s =>
      s
        .setName('edit')
        .setDescription('Rename a sound you uploaded (owner can rename any)')
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('Existing sound name')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(o =>
          o
            .setName('new_name')
            .setDescription('New name')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(64)
        )
    )
    .addSubcommand(s =>
      s
        .setName('cut')
        .setDescription('Trim a sound you uploaded (owner can trim any). Replaces the original.')
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('Sound to trim')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(o =>
          o
            .setName('start')
            .setDescription('Start time (MM:SS or seconds)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('end').setDescription('End time (MM:SS or seconds)').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s
        .setName('delete')
        .setDescription(
          `${LOCK}Delete a sound (uploader, guild admin for own guild, or owner)`
        )
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('Sound name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(s => s.setName('list').setDescription('List all available sounds'))
    .addSubcommand(s =>
      s.setName('stop').setDescription(`${LOCK}Stop playback (admins: instant, users: vote)`)
    )
    .addSubcommand(s =>
      s.setName('pause').setDescription('Pause playback (initiator/admin: instant, others: vote)')
    )
    .addSubcommand(s =>
      s
        .setName('resume')
        .setDescription('Resume paused playback (initiator/admin: instant, others: vote)')
    )
    .addSubcommand(s => s.setName('storage').setDescription('Show soundboard storage usage'))
    .addSubcommandGroup(g =>
      g
        .setName('admin')
        .setDescription('Manage bot admins for this server')
        .addSubcommand(s =>
          s
            .setName('add')
            .setDescription(`${LOCK}Add a user as a bot admin in this server`)
            .addUserOption(o =>
              o.setName('user').setDescription('User to promote').setRequired(true)
            )
        )
        .addSubcommand(s =>
          s
            .setName('remove')
            .setDescription(`${LOCK}Remove a bot admin from this server`)
            .addUserOption(o =>
              o.setName('user').setDescription('User to demote').setRequired(true)
            )
        )
        .addSubcommand(s =>
          s.setName('list').setDescription("List this server's bot admins")
        )
    )
    .addSubcommandGroup(g =>
      g
        .setName('settings')
        .setDescription(`${LOCK}Per-server soundboard settings`)
        .addSubcommand(s =>
          s.setName('view').setDescription(`${LOCK}Show current settings for this server`)
        )
        .addSubcommand(s =>
          s
            .setName('set')
            .setDescription(`${LOCK}Set a setting (some keys are owner-only)`)
            .addStringOption(o =>
              o
                .setName('key')
                .setDescription('Setting key')
                .setRequired(true)
                .addChoices(...SETTING_KEY_CHOICES)
            )
            .addStringOption(o =>
              o.setName('value').setDescription('New value').setRequired(true)
            )
        )
        .addSubcommand(s =>
          s
            .setName('unset')
            .setDescription(`${LOCK}Clear an override and fall back to the default`)
            .addStringOption(o =>
              o
                .setName('key')
                .setDescription('Setting key')
                .setRequired(true)
                .addChoices(...SETTING_KEY_CHOICES)
            )
        )
    )
    .toJSON();
}

// Register the command tree under both /sb and /soundboard.
export const commandData = [buildSlashCommand('sb'), buildSlashCommand('soundboard')];
