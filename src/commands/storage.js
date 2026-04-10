import { EmbedBuilder } from 'discord.js';
import { queries } from '../db/database.js';
import {
  getTotalBytes,
  getHardLimitBytes,
  getWarnLimitBytes,
  formatBytes
} from '../storage.js';
import { config } from '../config.js';

export async function handleStorage(interaction) {
  const totalBytes = getTotalBytes();
  const hardBytes = getHardLimitBytes();
  const warnBytes = getWarnLimitBytes();
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

  const embed = new EmbedBuilder()
    .setTitle('🔊 Soundboard Storage')
    .setDescription(
      `\`${bar}\` **${pctOfHard.toFixed(1)}%**\n` +
        `**${formatBytes(totalBytes)}** / ${config.storageHardGB} GB used`
    )
    .addFields(
      { name: 'Sounds', value: `${count}`, inline: true },
      {
        name: 'Warn at',
        value: `${config.storageWarnGB} GB`,
        inline: true
      },
      {
        name: 'Hard cap',
        value: `${config.storageHardGB} GB`,
        inline: true
      }
    )
    .setColor(color);

  if (top.length > 0) {
    const topLines = top
      .map((s, i) => `${i + 1}. **${s.name}** — ${formatBytes(s.file_size_bytes)}`)
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
