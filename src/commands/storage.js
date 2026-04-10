import { EmbedBuilder } from 'discord.js';
import { queries } from '../db/database.js';
import {
  getTotalBytes,
  getEffectiveHardLimitBytes,
  getEffectiveWarnLimitBytes,
  getEffectiveHardLimitGB,
  getEffectiveWarnLimitGB,
  formatBytes
} from '../storage.js';
import { isOverridden } from '../settings.js';
import { displayName } from '../names.js';

export async function handleStorage(interaction) {
  const guildId = interaction.guild?.id || null;
  const totalBytes = getTotalBytes();
  const hardBytes = getEffectiveHardLimitBytes(guildId);
  const warnBytes = getEffectiveWarnLimitBytes(guildId);
  const hardGB = getEffectiveHardLimitGB(guildId);
  const warnGB = getEffectiveWarnLimitGB(guildId);
  const count = queries.count.get().count;

  const pctOfHard = (totalBytes / hardBytes) * 100;
  const barLength = 20;
  const filled = Math.min(barLength, Math.round((totalBytes / hardBytes) * barLength));
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

  // Color: green < warn, yellow between warn and hard, red at hard
  let color = 0x57f287;
  if (totalBytes >= hardBytes) color = 0xed4245;
  else if (totalBytes >= warnBytes) color = 0xfee75c;

  const top = queries.topBySize.all(5);

  const overrideMark = key => (isOverridden(guildId, key) ? ' *(override)*' : '');

  const embed = new EmbedBuilder()
    .setTitle('🔊 Soundboard Storage')
    .setDescription(
      `\`${bar}\` **${pctOfHard.toFixed(1)}%**\n` +
        `**${formatBytes(totalBytes)}** / ${hardGB} GB used`
    )
    .addFields(
      { name: 'Sounds', value: `${count}`, inline: true },
      {
        name: 'Warn at',
        value: `${warnGB} GB${overrideMark('storage_warn_gb_override')}`,
        inline: true
      },
      {
        name: 'Hard cap',
        value: `${hardGB} GB${overrideMark('storage_hard_gb_override')}`,
        inline: true
      }
    )
    .setColor(color);

  if (top.length > 0) {
    const topLines = top
      .map((s, i) => `${i + 1}. **${displayName(s.name)}** — ${formatBytes(s.file_size_bytes)}`)
      .join('\n');
    embed.addFields({ name: 'Largest sounds', value: topLines });
  }

  if (totalBytes >= hardBytes) {
    embed.addFields({
      name: '🚫 Status',
      value: 'Hard cap reached — uploads are blocked until space is freed.'
    });
  } else if (totalBytes >= warnBytes) {
    embed.addFields({
      name: '⚠ Status',
      value: 'Over soft warning threshold — admins have been notified.'
    });
  }

  await interaction.reply({ embeds: [embed] });
}
