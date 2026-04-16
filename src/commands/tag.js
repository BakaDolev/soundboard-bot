import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { queries } from '../db/database.js';
import { isAdmin, isOwner } from '../admins.js';
import { canonicalize, displayName } from '../names.js';
import { getSetting } from '../settings.js';
import { logger } from '../logger.js';
import { replyFlags } from './visibility.js';

// Tags are lowercase, 1-32 chars, letters/numbers/hyphens/underscores.
const TAG_REGEX = /^[\w-]{1,32}$/;
const MAX_TAGS_PER_SOUND = 10;
const BULK_PAGE_SIZE = 15;
const BULK_EMBED_DESC_LIMIT = 4000;
const BULK_COLLECTOR_IDLE_MS = 5 * 60 * 1000;
const BULK_MODAL_WAIT_MS = 2 * 60 * 1000;
const BULK_UPLOADER_SELECT_LIMIT = 25;

function normalizeTag(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

function validateTag(raw) {
  const tag = normalizeTag(raw);
  if (!TAG_REGEX.test(tag)) return null;
  return tag;
}

// Permission: the sound's uploader OR any admin can add/remove tags.
function canManageTag(guild, userId, sound) {
  if (isOwner(userId)) return true;
  if (sound.uploader_id === userId) return true;
  return isAdmin(guild, userId);
}

function isSoundVisibleInGuild(sound, guildId) {
  const viewScope = getSetting(guildId, 'view_scope');
  return viewScope === 'guild' ? sound.guild_id === guildId : sound.is_private === 0;
}

function fetchAllForScope(guildId) {
  const viewScope = getSetting(guildId, 'view_scope');
  const sounds =
    viewScope === 'guild'
      ? queries.getAllForGuild.all(guildId)
      : queries.getAllGlobal.all();
  return { viewScope, sounds };
}

function buildUploaderStats(sounds) {
  const map = new Map();
  for (const s of sounds) {
    const existing = map.get(s.uploader_id);
    if (existing) {
      existing.count++;
      if (s.uploader_tag) existing.tag = s.uploader_tag;
    } else {
      map.set(s.uploader_id, {
        id: s.uploader_id,
        tag: s.uploader_tag || s.uploader_id,
        count: 1
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function findUploaderTag(uploaders, id) {
  if (!id) return null;
  const found = uploaders.find(u => u.id === id);
  return found ? found.tag : id;
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

function buildBulkEmbed({
  allCount,
  filtered,
  page,
  pageCount,
  guild,
  filters,
  uploaders,
  selectedIds,
  mode,
  tag,
  viewScope
}) {
  const start = page * BULK_PAGE_SIZE;
  const slice = filtered.slice(start, start + BULK_PAGE_SIZE);
  const lines = slice.map(sound => {
    const marker = selectedIds.has(String(sound.id)) ? '☑️' : '⬜';
    return (
      `${marker} **${displayName(sound.name)}** ` +
      `(${sound.duration_seconds.toFixed(1)}s) — ${sound.uploader_tag || sound.uploader_id}`
    );
  });

  const scopeLabel = viewScope === 'guild' ? ` — ${guild.name}` : '';
  const active = filtersActive(filters);
  const countLabel = active ? `${filtered.length} of ${allCount}` : `${allCount}`;
  const filterBits = [];
  if (filters.uploaderId) {
    filterBits.push(`uploader: ${findUploaderTag(uploaders, filters.uploaderId)}`);
  }
  if (filters.minLength != null) filterBits.push(`≥ ${filters.minLength}s`);
  if (filters.maxLength != null) filterBits.push(`≤ ${filters.maxLength}s`);

  const headerLines = [
    `*Mode:* ${mode}`,
    `*Tag:* \`${tag}\``,
    `*Selected:* ${selectedIds.size}`
  ];
  if (filterBits.length > 0) {
    headerLines.push(`*Filters:* ${filterBits.join(' · ')}`);
  }

  const body = lines.length ? lines.join('\n') : '_No sounds match the current filters._';
  let description = `${headerLines.join(' · ')}\n\n${body}`;
  if (description.length > BULK_EMBED_DESC_LIMIT) {
    description = description.slice(0, BULK_EMBED_DESC_LIMIT - 30) + '\n*…truncated*';
  }

  return new EmbedBuilder()
    .setTitle(`🏷 Bulk tag${scopeLabel} — ${countLabel} sound${filtered.length === 1 ? '' : 's'}`)
    .setDescription(description)
    .setColor(mode === 'add' ? 0x57f287 : 0xed4245)
    .setFooter({ text: `Page ${page + 1} / ${Math.max(1, pageCount)}` });
}

function buildBulkComponents({
  filtered,
  page,
  pageCount,
  filters,
  uploaders,
  selectedIds,
  mode,
  disabled = false
}) {
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;
  const start = page * BULK_PAGE_SIZE;
  const slice = filtered.slice(start, start + BULK_PAGE_SIZE);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tag-bulk-first')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atStart),
    new ButtonBuilder()
      .setCustomId('tag-bulk-prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atStart),
    new ButtonBuilder()
      .setCustomId('tag-bulk-next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atEnd),
    new ButtonBuilder()
      .setCustomId('tag-bulk-last')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || atEnd)
  );

  const soundOptions = slice.map(sound => {
    const rawLabel = displayName(sound.name);
    const label = rawLabel.length > 100 ? rawLabel.slice(0, 97) + '...' : rawLabel;
    const description = `${sound.duration_seconds.toFixed(1)}s — ${sound.uploader_tag || sound.uploader_id}`.slice(0, 100);
    return {
      label,
      description,
      value: String(sound.id),
      default: selectedIds.has(String(sound.id))
    };
  });

  const soundsRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tag-bulk-sounds')
      .setPlaceholder('Select sounds on this page…')
      .setMinValues(0)
      .setMaxValues(Math.max(1, soundOptions.length))
      .setDisabled(disabled || soundOptions.length === 0)
      .addOptions(
        soundOptions.length > 0
          ? soundOptions
          : [{ label: 'No sounds on this page', value: '__none__', default: false }]
      )
  );

  const visibleUploaders = uploaders.slice(0, BULK_UPLOADER_SELECT_LIMIT);
  if (
    filters.uploaderId &&
    !visibleUploaders.some(u => u.id === filters.uploaderId)
  ) {
    const picked = uploaders.find(u => u.id === filters.uploaderId);
    if (picked) {
      visibleUploaders.pop();
      visibleUploaders.push(picked);
    }
  }

  const uploaderOptions = visibleUploaders.map(u => {
    const rawLabel = `${u.tag} (${u.count})`;
    const label = rawLabel.length > 100 ? rawLabel.slice(0, 97) + '...' : rawLabel;
    return {
      label,
      value: u.id,
      default: u.id === filters.uploaderId
    };
  });

  const uploaderRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('tag-bulk-uploader')
      .setPlaceholder(
        uploaders.length > BULK_UPLOADER_SELECT_LIMIT
          ? `Filter by uploader (top ${BULK_UPLOADER_SELECT_LIMIT} of ${uploaders.length})…`
          : 'Filter by uploader…'
      )
      .setMinValues(0)
      .setMaxValues(1)
      .setDisabled(disabled || uploaderOptions.length === 0)
      .addOptions(
        uploaderOptions.length > 0
          ? uploaderOptions
          : [{ label: 'No uploaders', value: '__none__', default: false }]
      )
  );

  const filterRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tag-bulk-length')
      .setLabel('Length filter')
      .setEmoji('🎚️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('tag-bulk-clear-filters')
      .setLabel('Clear filters')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || !filtersActive(filters))
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tag-bulk-mode')
      .setLabel(`Mode: ${mode}`)
      .setStyle(mode === 'add' ? ButtonStyle.Success : ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('tag-bulk-apply')
      .setLabel('Apply')
      .setEmoji('🏷️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || selectedIds.size === 0),
    new ButtonBuilder()
      .setCustomId('tag-bulk-clear-selection')
      .setLabel('Clear selection')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || selectedIds.size === 0),
    new ButtonBuilder()
      .setCustomId('tag-bulk-cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );

  return [navRow, soundsRow, uploaderRow, filterRow, actionRow];
}

function parseLengthInput(raw) {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

async function handleBulkLengthModal(btn, state, render, userId) {
  const modal = new ModalBuilder()
    .setCustomId(`tag-bulk-length-modal-${btn.id}`)
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
      time: BULK_MODAL_WAIT_MS,
      filter: mi => mi.customId === `tag-bulk-length-modal-${btn.id}` && mi.user.id === userId
    });
  } catch {
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

function applyBulkTagOperation(guild, userId, sounds, selectedIds, tag, mode) {
  let changed = 0;
  let unchanged = 0;
  let denied = 0;

  for (const sound of sounds) {
    if (!selectedIds.has(String(sound.id))) continue;

    if (!canManageTag(guild, userId, sound)) {
      denied++;
      continue;
    }

    if (mode === 'remove') {
      const result = queries.removeTag.run(sound.id, tag);
      if (result.changes > 0) {
        changed++;
      } else {
        unchanged++;
      }
      continue;
    }

    const existing = queries.getTagsForSound.all(sound.id);
    if (existing.length >= MAX_TAGS_PER_SOUND && !existing.some(r => r.tag.toLowerCase() === tag)) {
      unchanged++;
      continue;
    }

    const result = queries.addTag.run(sound.id, tag, userId, Date.now());
    if (result.changes > 0) {
      changed++;
    } else {
      unchanged++;
    }
  }

  return { changed, unchanged, denied };
}

export async function handleTagAdd(interaction) {
  await interaction.deferReply({ flags: replyFlags(interaction) });

  const guild = interaction.guild;
  const rawName = interaction.options.getString('name', true);
  const rawTag = interaction.options.getString('tag', true);

  const sound = queries.getByMatch.get(canonicalize(rawName));
  if (!sound) {
    return interaction.editReply(`No sound named **${rawName}**. You sure you know how to spell?`);
  }

  if (!canManageTag(guild, interaction.user.id, sound)) {
    return interaction.editReply(
      `You can only tag sounds you uploaded. **${displayName(sound.name)}** was uploaded by <@${sound.uploader_id}> ya dingus.`
    );
  }

  const tag = validateTag(rawTag);
  if (!tag) {
    return interaction.editReply(
      'Invalid tag - use letters, numbers, hyphens or underscores, BUT NOT WHATEVER YOU DID (Oh yeah forgot to mention, max length is 32 chars).'
    );
  }

  const existing = queries.getTagsForSound.all(sound.id);
  if (existing.length >= MAX_TAGS_PER_SOUND) {
    return interaction.editReply(
      `**${displayName(sound.name)}** already has ${MAX_TAGS_PER_SOUND} tags (the max). Remove one first. (YAYY WE LOVE HAVING LIMITS!!11!!)`
    );
  }

  queries.addTag.run(sound.id, tag, interaction.user.id, Date.now());
  logger.ok('tag added', { soundId: sound.id, tag, by: interaction.user.id });
  const allTags = queries.getTagsForSound.all(sound.id).map(r => `\`${r.tag}\``).join(', ');
  await interaction.editReply(
    `Tagged **${displayName(sound.name)}** with \`${tag}\`. All tags: ${allTags}\n Sheesh, imagine having hobbies that don't involve tagging sounds smh.`
  );
}

export async function handleTagRemove(interaction) {
  await interaction.deferReply({ flags: replyFlags(interaction) });

  const guild = interaction.guild;
  const rawName = interaction.options.getString('name', true);
  const rawTag = interaction.options.getString('tag', true);

  const sound = queries.getByMatch.get(canonicalize(rawName));
  if (!sound) {
    return interaction.editReply(`No sound named **${rawName}**.`);
  }

  if (!canManageTag(guild, interaction.user.id, sound)) {
    return interaction.editReply(
      `You can only manage tags on sounds you uploaded. **${displayName(sound.name)}** was uploaded by <@${sound.uploader_id}>. not you. Cristopher Colombus.`
    );
  }

  const tag = normalizeTag(rawTag);
  const result = queries.removeTag.run(sound.id, tag);

  if (result.changes === 0) {
    return interaction.editReply(`**${displayName(sound.name)}** doesn't have a \`${tag}\` tag. Guh???`);
  }

  logger.ok('tag removed', { soundId: sound.id, tag, by: interaction.user.id });

  const remaining = queries.getTagsForSound.all(sound.id).map(r => `\`${r.tag}\``);
  const tagLine = remaining.length > 0
    ? `Remaining tags: ${remaining.join(', ')}`
    : 'No tags remaining.';
  await interaction.editReply(
    `Removed tag \`${tag}\` from **${displayName(sound.name)}**. ${tagLine}. Wow, well played.`
  );
}

export async function handleTagList(interaction) {
  await interaction.deferReply({ flags: replyFlags(interaction) });

  const guild = interaction.guild;
  const rawName = interaction.options.getString('name');

  if (rawName) {
    const sound = queries.getByMatch.get(canonicalize(rawName));
    if (!sound) {
      return interaction.editReply(`No sound named **${rawName}**.`);
    }
    if (!isSoundVisibleInGuild(sound, guild.id)) {
      return interaction.editReply(`**${displayName(sound.name)}** isn't available in this server.`);
    }
    const tags = queries.getTagsForSound.all(sound.id);
    if (tags.length === 0) {
      return interaction.editReply(`**${displayName(sound.name)}** has no tags.`);
    }
    return interaction.editReply(
      `🏷 Tags for **${displayName(sound.name)}**: ${tags.map(r => `\`${r.tag}\``).join(', ')}`
    );
  }

  const viewScope = getSetting(guild.id, 'view_scope');
  const tagRows = viewScope === 'guild'
    ? queries.searchTagsForGuild.all(guild.id, '%')
    : queries.searchTagsGlobal.all('%');

  if (tagRows.length === 0) {
    return interaction.editReply('No tags exist yet. Use `/sb tag add` to create one.');
  }

  const tagList = tagRows.map(r => `\`${r.tag}\``).join(', ');
  await interaction.editReply(`Available tags: ${tagList}`);
}

export async function handleTagBulk(interaction) {
  const guild = interaction.guild;
  const rawTag = interaction.options.getString('tag', true);
  const requestedMode = interaction.options.getString('mode', true);
  const tag = validateTag(rawTag);

  if (!tag) {
    return interaction.reply({
      content: 'Invalid tag - use letters, numbers, hyphens or underscores, max 32 chars.',
      flags: replyFlags(interaction)
    });
  }

  const mode = requestedMode === 'remove' ? 'remove' : 'add';
  const { viewScope, sounds: allSounds } = fetchAllForScope(guild.id);
  if (allSounds.length === 0) {
    return interaction.reply({
      content: 'No visible sounds are available for bulk tagging.',
      flags: replyFlags(interaction)
    });
  }

  const uploaders = buildUploaderStats(allSounds);
  const state = {
    page: 0,
    filters: { uploaderId: null, minLength: null, maxLength: null },
    selectedIds: new Set(),
    mode,
    tag
  };

  const render = () => {
    const filtered = applyFilters(allSounds, state.filters);
    const pageCount = Math.max(1, Math.ceil(filtered.length / BULK_PAGE_SIZE));
    state.page = clampPage(state.page, pageCount);
    return {
      embeds: [
        buildBulkEmbed({
          allCount: allSounds.length,
          filtered,
          page: state.page,
          pageCount,
          guild,
          filters: state.filters,
          uploaders,
          selectedIds: state.selectedIds,
          mode: state.mode,
          tag: state.tag,
          viewScope
        })
      ],
      components: buildBulkComponents({
        filtered,
        page: state.page,
        pageCount,
        filters: state.filters,
        uploaders,
        selectedIds: state.selectedIds,
        mode: state.mode
      })
    };
  };

  await interaction.reply({ ...render(), flags: replyFlags(interaction) });

  let reply;
  try {
    reply = await interaction.fetchReply();
  } catch (err) {
    logger.error('tag bulk: fetchReply failed', { err: err.message });
    return;
  }

  const collector = reply.createMessageComponentCollector({
    idle: BULK_COLLECTOR_IDLE_MS,
    filter: i => i.user.id === interaction.user.id
  });

  collector.on('collect', async i => {
    try {
      switch (i.customId) {
        case 'tag-bulk-first':
          state.page = 0;
          await i.update(render());
          return;
        case 'tag-bulk-prev':
          state.page -= 1;
          await i.update(render());
          return;
        case 'tag-bulk-next':
          state.page += 1;
          await i.update(render());
          return;
        case 'tag-bulk-last':
          state.page = Number.MAX_SAFE_INTEGER;
          await i.update(render());
          return;
        case 'tag-bulk-sounds': {
          const filtered = applyFilters(allSounds, state.filters);
          const start = state.page * BULK_PAGE_SIZE;
          const pageIds = filtered
            .slice(start, start + BULK_PAGE_SIZE)
            .map(sound => String(sound.id));

          for (const id of pageIds) {
            state.selectedIds.delete(id);
          }
          for (const id of i.values || []) {
            if (id !== '__none__') state.selectedIds.add(id);
          }
          await i.update(render());
          return;
        }
        case 'tag-bulk-uploader': {
          const picked = i.values?.[0];
          state.filters.uploaderId = picked && picked !== '__none__' ? picked : null;
          state.page = 0;
          await i.update(render());
          return;
        }
        case 'tag-bulk-clear-filters':
          state.filters.uploaderId = null;
          state.filters.minLength = null;
          state.filters.maxLength = null;
          state.page = 0;
          await i.update(render());
          return;
        case 'tag-bulk-length':
          await handleBulkLengthModal(i, state, render, interaction.user.id);
          return;
        case 'tag-bulk-mode':
          state.mode = state.mode === 'add' ? 'remove' : 'add';
          await i.update(render());
          return;
        case 'tag-bulk-clear-selection':
          state.selectedIds.clear();
          await i.update(render());
          return;
        case 'tag-bulk-cancel':
          collector.stop('cancelled');
          await i.update({
            content: 'Bulk tag cancelled.',
            embeds: [],
            components: []
          });
          return;
        case 'tag-bulk-apply': {
          if (state.selectedIds.size === 0) {
            await i.reply({
              content: 'Pick at least one sound before applying the bulk tag.',
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          const result = applyBulkTagOperation(
            guild,
            interaction.user.id,
            allSounds,
            state.selectedIds,
            state.tag,
            state.mode
          );
          logger.ok('bulk tag applied', {
            guildId: guild.id,
            userId: interaction.user.id,
            mode: state.mode,
            tag: state.tag,
            selected: state.selectedIds.size,
            changed: result.changed,
            unchanged: result.unchanged,
            denied: result.denied
          });

          collector.stop('applied');
          const verb = state.mode === 'remove' ? 'removed from' : 'applied to';
          await i.update({
            content:
              `Bulk tag \`${state.tag}\` ${verb} **${result.changed}** sound(s). ` +
              `${result.unchanged} unchanged, ${result.denied} skipped for permission.`,
            embeds: [],
            components: []
          });
          return;
        }
        default:
          return;
      }
    } catch (err) {
      logger.error('tag bulk: collector handler threw', {
        customId: i.customId,
        err: err.message,
        stack: err.stack
      });
      try {
        if (!i.replied && !i.deferred) {
          await i.reply({
            content: 'Something went wrong updating the bulk tag UI.',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch {}
    }
  });

  collector.on('end', async reason => {
    if (reason === 'applied' || reason === 'cancelled') return;
    try {
      await interaction.deleteReply();
    } catch (err) {
      logger.debug?.('tag bulk: could not delete reply on collector end', { err: err.message });
    }
  });
}
