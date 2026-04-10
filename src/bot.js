import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { logger } from './logger.js';
import { queries } from './db/database.js';
import { getSetting } from './settings.js';
import { canonicalize, displayName } from './names.js';
import { handleUpload } from './commands/upload.js';
import { handlePlay } from './commands/play.js';
import { handleDelete } from './commands/delete.js';
import { handleList } from './commands/list.js';
import { handleStop, handleStopVoteButton } from './commands/stop.js';
import { handleStorage } from './commands/storage.js';
import {
  handleAdminAdd,
  handleAdminRemove,
  handleAdminList
} from './commands/admin.js';
import {
  handleSettingsView,
  handleSettingsSet,
  handleSettingsUnset
} from './commands/settings.js';
import { handleEdit } from './commands/edit.js';
import { handleCut } from './commands/cut.js';
import {
  handlePause,
  handleResume,
  handlePauseVoteButton,
  handleResumeVoteButton
} from './commands/pause.js';

// Both /sb and /soundboard route to the same handlers.
const COMMAND_NAMES = new Set(['sb', 'soundboard']);

export function createBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });

  client.once(Events.ClientReady, c => {
    logger.ok(`logged in as ${c.user.tag}`, {
      id: c.user.id,
      guilds: c.guilds.cache.size
    });
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      // --- Slash command dispatch ------------------------------------------
      if (interaction.isChatInputCommand() && COMMAND_NAMES.has(interaction.commandName)) {
        // All soundboard commands require a guild (voice)
        if (!interaction.inGuild()) {
          return interaction.reply({
            content: 'Soundboard commands only work in a server.',
            flags: MessageFlags.Ephemeral
          });
        }

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        if (group === 'admin') {
          switch (sub) {
            case 'add':
              return handleAdminAdd(interaction);
            case 'remove':
              return handleAdminRemove(interaction);
            case 'list':
              return handleAdminList(interaction);
            default:
              return interaction.reply({
                content: `Unknown admin subcommand: ${sub}`,
                flags: MessageFlags.Ephemeral
              });
          }
        }

        if (group === 'settings') {
          switch (sub) {
            case 'view':
              return handleSettingsView(interaction);
            case 'set':
              return handleSettingsSet(interaction);
            case 'unset':
              return handleSettingsUnset(interaction);
            default:
              return interaction.reply({
                content: `Unknown settings subcommand: ${sub}`,
                flags: MessageFlags.Ephemeral
              });
          }
        }

        switch (sub) {
          case 'upload':
            return handleUpload(interaction);
          case 'play':
            return handlePlay(interaction);
          case 'edit':
            return handleEdit(interaction);
          case 'cut':
            return handleCut(interaction);
          case 'delete':
            return handleDelete(interaction);
          case 'list':
            return handleList(interaction);
          case 'stop':
            return handleStop(interaction);
          case 'pause':
            return handlePause(interaction);
          case 'resume':
            return handleResume(interaction);
          case 'storage':
            return handleStorage(interaction);
          default:
            return interaction.reply({
              content: `Unknown subcommand: ${sub}`,
              flags: MessageFlags.Ephemeral
            });
        }
      }

      // --- Autocomplete for sound name option ------------------------------
      if (interaction.isAutocomplete() && COMMAND_NAMES.has(interaction.commandName)) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'name') {
          return interaction.respond([]);
        }
        const query = focused.value || '';
        // Canonicalize the query so spaces, hyphens, underscores all match.
        // Strip SQL LIKE wildcards from the canonical form.
        const canonical = canonicalize(query).replace(/[%_]/g, '');
        const pattern = `%${canonical}%`;

        const viewScope = getSetting(interaction.guild.id, 'view_scope');
        const rows =
          viewScope === 'guild'
            ? queries.searchForGuild.all(interaction.guild.id, pattern)
            : queries.searchGlobal.all(pattern);

        // Display the user-friendly form, but use the stored kebab-case as
        // the autocomplete value so handlers see a canonical input.
        const choices = rows.slice(0, 25).map(s => ({
          name: displayName(s.name),
          value: s.name
        }));
        return interaction.respond(choices);
      }

      // --- Vote buttons -----------------------------------------------------
      if (interaction.isButton()) {
        if (interaction.customId.startsWith('stop-vote-')) {
          return handleStopVoteButton(interaction);
        }
        if (interaction.customId.startsWith('pause-vote-')) {
          return handlePauseVoteButton(interaction);
        }
        if (interaction.customId.startsWith('resume-vote-')) {
          return handleResumeVoteButton(interaction);
        }
      }
    } catch (err) {
      logger.error('interaction handler threw', {
        type: interaction.type,
        err: err.message,
        stack: err.stack
      });
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'Something went wrong handling that command.',
            flags: MessageFlags.Ephemeral
          });
        } else if (interaction.deferred) {
          await interaction.editReply('Something went wrong handling that command.');
        }
      } catch {}
    }
  });

  client.on(Events.Error, err => {
    logger.error('discord client error', { err: err.message });
  });

  client.on(Events.Warn, msg => {
    logger.warn('discord client warning', { msg });
  });

  return client;
}
