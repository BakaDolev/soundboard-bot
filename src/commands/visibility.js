// Shared visibility helper.
//
// Every soundboard subcommand carries a `visibility` boolean option. When it's
// true, replies are public; otherwise they're ephemeral (default).
// Vote-driven commands (stop/pause/resume) intentionally ignore this for the
// vote message itself — a vote button has to be public for others to click.

import { MessageFlags } from 'discord.js';

export function isVisible(interaction) {
  return interaction.options?.getBoolean?.('visibility', false) === true;
}

export function replyFlags(interaction) {
  return isVisible(interaction) ? 0 : MessageFlags.Ephemeral;
}

export function addVisibilityOption(sub) {
  return sub.addBooleanOption(o =>
    o
      .setName('visibility')
      .setDescription('Show this reply to everyone (default: only you see it)')
  );
}
