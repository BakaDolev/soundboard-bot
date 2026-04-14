import { queries } from '../db/database.js';
import { isOwner } from '../admins.js';
import { storeName, displayName, canonicalize } from '../names.js';
import { logger } from '../logger.js';
import { replyFlags } from './visibility.js';

// Edit/rename. Permission: uploader OR bot owner. Filename on disk is opaque
// (random hex) so renaming only touches DB rows.
export async function handleEdit(interaction) {
  const rawName = interaction.options.getString('name', true);
  const sound = queries.getByMatch.get(canonicalize(rawName));

  if (!sound) {
    return interaction.reply({
      content: `No sound named **${rawName}**.`,
      flags: replyFlags(interaction)
    });
  }

  const actor = interaction.user.id;
  const isUploader = sound.uploader_id === actor;
  if (!isUploader && !isOwner(actor)) {
    return interaction.reply({
      content: `You can only rename sounds you uploaded. **${displayName(sound.name)}** was uploaded by <@${sound.uploader_id}> not you, silly!`,
      flags: replyFlags(interaction),
      allowedMentions: { users: [] }
    });
  }

  const rawNew = interaction.options.getString('new_name', true);
  let newName;
  try {
    newName = storeName(rawNew);
  } catch (err) {
    return interaction.reply({
      content: err.message,
      flags: replyFlags(interaction)
    });
  }

  const newCanonical = canonicalize(newName);
  if (newCanonical === sound.match_name) {
    return interaction.reply({
      content: 'New name matches the existing one — nothing to change. Try a different name, dummy!',
      flags: replyFlags(interaction)
    });
  }

  const collision = queries.getByMatch.get(newCanonical);
  if (collision && collision.id !== sound.id) {
    return interaction.reply({
      content: `A sound named **${displayName(newName)}** already exists.`,
      flags: replyFlags(interaction)
    });
  }

  try {
    queries.rename.run(newName, newCanonical, sound.id);
    logger.ok('sound renamed', {
      id: sound.id,
      from: sound.name,
      to: newName,
      by: actor
    });
    await interaction.reply({
      content: `✏ Renamed **${displayName(sound.name)}** → **${displayName(newName)}**.`,
      flags: replyFlags(interaction)
    });
  } catch (err) {
    logger.error('sound rename failed', { id: sound.id, err: err.message });
    await interaction.reply({
      content: 'Rename failed due to an unexpected error.',
      flags: replyFlags(interaction)
    });
  }
}
