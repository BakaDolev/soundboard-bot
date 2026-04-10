import { EmbedBuilder, MessageFlags } from 'discord.js';
import { queries } from '../db/database.js';
import { getSetting } from '../settings.js';
import { displayName } from '../names.js';

const EMBED_DESC_LIMIT = 4000;

export async function handleList(interaction) {
  const guild = interaction.guild;
  const viewScope = getSetting(guild.id, 'view_scope');

  // global → all public sounds (is_private = 0)
  // guild  → every sound uploaded from this guild (regardless of private flag)
  const sounds =
    viewScope === 'guild'
      ? queries.getAllForGuild.all(guild.id)
      : queries.getAllGlobal.all();

  if (sounds.length === 0) {
    const hint =
      viewScope === 'guild'
        ? "This server hasn't uploaded any sounds yet. Use `/sb upload` to add one."
        : 'No sounds uploaded yet. Use `/sb upload` to add one.';
    return interaction.reply({
      content: hint,
      flags: MessageFlags.Ephemeral
    });
  }

  const lines = sounds.map(
    s => `• **${displayName(s.name)}** (${s.duration_seconds.toFixed(1)}s) — <@${s.uploader_id}>`
  );

  let description = lines.join('\n');
  let truncated = false;
  if (description.length > EMBED_DESC_LIMIT) {
    const kept = [];
    let used = 0;
    const suffix = '\n*…and more (list truncated)*';
    for (const line of lines) {
      if (used + line.length + 1 + suffix.length > EMBED_DESC_LIMIT) break;
      kept.push(line);
      used += line.length + 1;
    }
    description = kept.join('\n') + suffix;
    truncated = true;
  }

  const scopeLabel = viewScope === 'guild' ? ` — ${guild.name}` : '';
  const embed = new EmbedBuilder()
    .setTitle(
      `🔊 Soundboard${scopeLabel} — ${sounds.length} sound${sounds.length === 1 ? '' : 's'}`
    )
    .setDescription(description)
    .setColor(0x5865f2);

  if (truncated) {
    embed.setFooter({ text: 'Some sounds omitted — refine with autocomplete when playing.' });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
