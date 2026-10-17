// Prefixed identifiers. Every row in every table is addressed by one, and the
// prefix is part of the value so a stray ID in a log or a URL says what it is.

/** One prefix per entity in the PRD's data model. */
export const ID_PREFIXES = [
  "wsp",
  "usr",
  "tst",
  "bnk",
  "qst",
  "cnd",
  "att",
  "key",
  "whk",
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

/**
 * Crockford base32, lowercase, without `i`, `l`, `o` and `u` — an ID read
 * aloud down a phone line to a candidate who lost their link cannot be
 * misheard as another valid ID.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_LENGTH = 12;

const PREFIXES = new Set<string>(ID_PREFIXES);

/** `<prefix>_<12 characters>`, 60 bits of randomness. */
export function newId(prefix: IdPrefix): string {
  // 32 divides 256 exactly, so masking the low 5 bits of a random byte is
  // already uniform over the alphabet — the usual rejection loop for modulo
  // bias would reject nothing here.
  const bytes = new Uint8Array(ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  let out = `${prefix}_`;
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return out;
}

/**
 * True when `value` is an ID of `prefix`, or of any known prefix when none is
 * given. Checks the whole shape, not just the start: a value that reaches a
 * query must be one this module could have produced.
 */
export function isId(value: string, prefix?: IdPrefix): boolean {
  const separator = value.indexOf("_");
  if (separator === -1) return false;

  const head = value.slice(0, separator);
  if (prefix === undefined ? !PREFIXES.has(head) : head !== prefix) {
    return false;
  }

  const body = value.slice(separator + 1);
  if (body.length !== ID_LENGTH) return false;
  return [...body].every((character) => ALPHABET.includes(character));
}
