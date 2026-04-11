import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';
import { queries } from '../db/database.js';
import { getSetting } from '../settings.js';
import { displayName } from '../names.js';
import { replyFlags } from './visibility.js';
import { logger } from '../logger.js';

const PAGE_SIZE = 15;
const EMBED_DESC_LIMIT = 4000;
const COLLECTOR_IDLE_MS = 5 * 60 * 1000;
const MODAL_WAIT_MS = 2 * 60 * 1000;

function fetchAllForScope(guildId) {
  const viewScope = getSetting(guildId, 'view_scope');
  const sounds =
    viewScope === 'guild'
      ? queries.getAllForGuild.all(guildId)
      : queries.getAllGlobal.all();
  return { viewScope, sounds };
}

function filtersActive(filters) {
  return (
    filters.uploaderId != null ||
    filters.minLength != null ||
    filters.maxLength != null
  );
}

function applyFilters(sounds, filters) {
  return sounds.filter(s => {
    if (filters.uploaderId && s.uploader_id !== filters.uploaderId) return false;
    if (filters.minLength != null && s.duration_seconds < filters.minLength) return false;
    if (filters.maxLength != null && s.duration_seconds > filters.maxLength) return false;
    return true;
  });
}

function clampPage(page, pageCount) {
  if (page < 0) return 0;
  if (page >= pageCount) return pageCount - 1;
  return page;
}

function buildEmbed({ allCount, filtered, page, pageCount, viewScope, guild, filters }) {
  const start = page * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);
  const lines = slice.map(
    s => `• **${displayName(s.name)}** (${s.duration_seconds.toFixed(1)}s) — <@${s.uploader_id}>`
  );

  const scopeLabel = viewScope === 'guild' ? ` — ${guild.name}` : '';
  const active = filtersActive(filters);
  const countLabel = active
    ? `${filtered.length} of ${allCount}`
    : `${allCount}`;
  const pluralBase = active ? filtered.length : allCount;
  const title = `🔊 Soundboard${scopeLabel} — ${countLabel} sound${pluralBase === 1 ? '' : 's'}`;

  const filterBits = [];
  if (filters.uploaderId) filterBits.push(`uploader: <@${filters.uploaderId}>`);
  if (filters.minLength != null) filterBits.push(`≥ ${filters.minLength}s`);
  if (filters.maxLength != null) filterBits.push(`≤ ${filters.maxLength}s`);

  const header = filterBits.length ? `*Filters: ${filterBits.join(' · ')}*\n\n` : '';
  const body = lines.length ? lines.join('\n') : '_No sounds match the current filters._';
  let description = header + body;

  if (description.length > EMBED_DESC_LIMIT) {
    description = description.slice(0, EMBED_DESC_LIMIT - 30) + '\n*…truncated*';
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865f2)
    .setFooter({ text: `Page ${page + 1} / ${Math.max(1, pageCount)}` });
}

function buildComponents({ page, pageCount, filters, disabled = false }) {
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('list-first')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atStart),
    new ButtonBuilder()
      .setCustomId('list-prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atStart),
    new ButtonBuilder()
      .setCustomId('list-next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atEnd),
    new ButtonBuilder()
      .setCustomId('list-last')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atEnd)
  );

  const uploaderRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('list-uploader')
      .setPlaceholder('Filter by uploader…')
      .setMinValues(0)
      .setMaxValues(1)
      .setDisabled(disabled)
  );

  const filterRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('list-length')
      .setLabel('Length filter')
      .setEmoji('🎚️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('list-clear')
      .setLabel('Clear filters')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || !filtersActive(filters))
  );

  return [navRow, uploaderRow, filterRow];
}

function parseLengthInput(raw) {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

export async function handleList(interaction) {
  const guild = interaction.guild;
  const { viewScope, sounds: allSounds } = fetchAllForScope(guild.id);

  if (allSounds.length === 0) {
    const hint =
      viewScope === 'guild'
        ? "This server hasn't uploaded any sounds yet. Use `/sb upload` to add one."
        : 'No sounds uploaded yet. Use `/sb upload` to add one.';
    return interaction.reply({
      content: hint,
      flags: replyFlags(interaction)
    });
  }

  const state = {
    page: 0,
    filters: { uploaderId: null, minLength: null, maxLength: null }
  };

  const render = () => {
    const filtered = applyFilters(allSounds, state.filters);
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = clampPage(state.page, pageCount);
    return {
      embeds: [
        buildEmbed({
          allCount: allSounds.length,
          filtered,
          page: state.page,
          pageCount,
          viewScope,
          guild,
          filters: state.filters
        })
      ],
      components: buildComponents({
        page: state.page,
        pageCount,
        filters: state.filters
      })
    };
  };

  await interaction.reply({ ...render(), flags: replyFlags(interaction) });

  let reply;
  try {
    reply = await interaction.fetchReply();
  } catch (err) {
    logger.error('list: fetchReply failed', { err: err.message });
    return;
  }

  const collector = reply.createMessageComponentCollector({
    idle: COLLECTOR_IDLE_MS,
    filter: i => i.user.id === interaction.user.id
  });

  collector.on('collect', async i => {
    try {
      switch (i.customId) {
        case 'list-first':
          state.page = 0;
          await i.update(render());
          return;
        case 'list-prev':
          state.page -= 1;
          await i.update(render());
          return;
        case 'list-next':
          state.page += 1;
          await i.update(render());
          return;
        case 'list-last':
          state.page = Number.MAX_SAFE_INTEGER;
          await i.update(render());
          return;
        case 'list-uploader':
          state.filters.uploaderId = i.values?.[0] ?? null;
          state.page = 0;
          await i.update(render());
          return;
        case 'list-clear':
          state.filters.uploaderId = null;
          state.filters.minLength = null;
          state.filters.maxLength = null;
          state.page = 0;
          await i.update(render());
          return;
        case 'list-length':
          await handleLengthModal(i, state, render, interaction.user.id);
          return;
        default:
          return;
      }
    } catch (err) {
      logger.error('list: collector handler threw', {
        customId: i.customId,
        err: err.message,
        stack: err.stack
      });
      try {
        if (!i.replied && !i.deferred) {
          await i.reply({
            content: 'Something went wrong updating the list.',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch {}
    }
  });

  collector.on('end', async () => {
    try {
      const filtered = applyFilters(allSounds, state.filters);
      const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      await interaction.editReply({
        embeds: [
          buildEmbed({
            allCount: allSounds.length,
            filtered,
            page: state.page,
            pageCount,
            viewScope,
            guild,
            filters: state.filters
          })
        ],
        components: buildComponents({
          page: state.page,
          pageCount,
          filters: state.filters,
          disabled: true
        })
      });
    } catch (err) {
      // Ephemeral reply may be gone — nothing to do.
      logger.debug?.('list: could not disable components on end', { err: err.message });
    }
  });
}

async function handleLengthModal(btn, state, render, userId) {
  const modal = new ModalBuilder()
    .setCustomId(`list-length-modal-${btn.id}`)
    .setTitle('Filter by length')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('min')
          .setLabel('Minimum length (seconds)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('e.g. 2')
          .setValue(state.filters.minLength != null ? String(state.filters.minLength) : '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max')
          .setLabel('Maximum length (seconds)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('e.g. 10')
          .setValue(state.filters.maxLength != null ? String(state.filters.maxLength) : '')
      )
    );

  await btn.showModal(modal);

  let submit;
  try {
    submit = await btn.awaitModalSubmit({
      time: MODAL_WAIT_MS,
      filter: mi => mi.customId === `list-length-modal-${btn.id}` && mi.user.id === userId
    });
  } catch {
    // Timed out or user dismissed — leave the list untouched.
    return;
  }

  const min = parseLengthInput(submit.fields.getTextInputValue('min'));
  const max = parseLengthInput(submit.fields.getTextInputValue('max'));

  if (!min.ok || !max.ok) {
    await submit.reply({
      content: 'Lengths must be non-negative numbers (seconds). Leave blank to clear.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (min.value != null && max.value != null && min.value > max.value) {
    await submit.reply({
      content: 'Minimum length cannot be greater than maximum length.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  state.filters.minLength = min.value;
  state.filters.maxLength = max.value;
  state.page = 0;
  await submit.update(render());
}
