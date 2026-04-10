import { EmbedBuilder, MessageFlags } from 'discord.js';
import { queries } from '../db/database.js';

const EMBED_DESC_LIMIT = 4000;

export async function handleList(interaction) {
  const sounds = queries.getAll.all();

  if (sounds.length === 0) {
    return interaction.reply({
      content: 'No sounds uploaded yet. Use `/sb upload` to add one.',
      flags: MessageFlags.Ephemeral
    });
  }

  const lines = sounds.map(
    s => `• **${s.name}** (${s.duration_seconds.toFixed(1)}s) — <@${s.uploader_id}>`
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

  const embed = new EmbedBuilder()
    .setTitle(`🔊 Soundboard — ${sounds.length} sound${sounds.length === 1 ? '' : 's'}`)
    .setDescription(description)
    .setColor(0x5865f2);

  if (truncated) {
    embed.setFooter({ text: 'Some sounds omitted — refine with autocomplete when playing.' });
  }

  await interaction.reply({ embeds: [embed] });
}
