// Sound name normalization helpers.
//
// Three forms exist:
//   - input:    whatever the user typed ("My Cool Clip", "my_cool_clip", ...)
//   - stored:   the canonical kebab-case form persisted as `sounds.name`
//               (matches the legacy on-disk uniqueness contract — letters,
//               digits, hyphens only)
//   - display:  what we render back to the user — hyphens and underscores
//               become spaces so names look natural
//   - match:    the lookup key persisted as `sounds.match_name` and used for
//               every WHERE clause. All separator variants collapse to a
//               single hyphen here so users can search loosely.

const STORE_REGEX = /^[a-z0-9-]{1,32}$/;

/**
 * Convert raw user input into the canonical stored form.
 * Throws on anything that can't be represented (empty, too long, illegal chars
 * after normalization). Callers should `try/catch` and surface the message.
 */
export function storeName(input) {
  if (typeof input !== 'string') {
    throw new Error('Name must be a string.');
  }
  // Trim, lowercase, collapse any run of whitespace/underscores/hyphens to a
  // single hyphen, strip everything else.
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!STORE_REGEX.test(normalized)) {
    throw new Error(
      'Name must be 1-32 characters. Allowed: letters, numbers, spaces, underscores, hyphens. ' +
        'It will be stored in kebab-case.'
    );
  }
  return normalized;
}

/**
 * Stored kebab-case form -> human-readable form for replies and lists.
 * Both hyphens and underscores render as spaces so legacy data with
 * underscores still looks right.
 */
export function displayName(stored) {
  if (typeof stored !== 'string') return '';
  return stored.replace(/[-_]+/g, ' ');
}

/**
 * Canonical lookup key. Loose enough to match anything the user might type:
 * "My Cool Clip", "my_cool_clip", "MY-COOL-CLIP" all canonicalize to the
 * same value. Used both for `sounds.match_name` and for query inputs.
 */
export function canonicalize(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Re-export under the name used in the plan for callers that prefer it.
export const matchName = canonicalize;
