import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { logger } from './logger.js';
import { queries } from './db/database.js';
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
      if (interaction.isChatInputCommand() && interaction.commandName === 'sb') {
        // All /sb subcommands require a guild (voice)
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

        switch (sub) {
          case 'upload':
            return handleUpload(interaction);
          case 'play':
            return handlePlay(interaction);
          case 'delete':
            return handleDelete(interaction);
          case 'list':
            return handleList(interaction);
          case 'stop':
            return handleStop(interaction);
          case 'storage':
            return handleStorage(interaction);
          default:
            return interaction.reply({
              content: `Unknown subcommand: ${sub}`,
              flags: MessageFlags.Ephemeral
            });
        }
      }

      // --- Autocomplete for play/delete name option ------------------------
      if (interaction.isAutocomplete() && interaction.commandName === 'sb') {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'name') {
          return interaction.respond([]);
        }
        const query = focused.value || '';
        const pattern = `%${query.replace(/[%_]/g, '')}%`;
        const rows = queries.searchByName.all(pattern);
        const choices = rows.slice(0, 25).map(s => ({ name: s.name, value: s.name }));
        return interaction.respond(choices);
      }

      // --- Stop vote button -------------------------------------------------
      if (interaction.isButton() && interaction.customId.startsWith('stop-vote-')) {
        return handleStopVoteButton(interaction);
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
