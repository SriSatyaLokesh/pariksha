// Prefixed identifiers. Every row in every table is addressed by one, and the
// prefix is part of the value so a stray ID in a log or a URL says what it is.

/**
 * One prefix per table.
 *
 * The first nine are the PRD's own list, for the entities an organiser or a
 * candidate ever sees. The rest address the child tables — the PRD describes
 * those by their natural key, but every table here carries a surrogate `id`
 * so one repository shape fits all of them, and each needs a prefix of its
 * own: an ID that reads `qst_` for a row in `response` is worse than an
 * unprefixed one, because it is confidently wrong to whoever is reading a log
 * to find a candidate's lost answer.
 */
export const ID_PREFIXES = [
  // The PRD's list.
  "wsp",
  "usr",
  "tst",
  "bnk",
  "qst",
  "cnd",
  "att",
  "key",
  "whk",
  // The child tables.
  "mbr", // membership
  "ver", // test_version
  "set", // set
  "rsp", // response
  "evt", // event
  "snp", // snapshot
  "rev", // review
  "aud", // audit_log
  "cuq", // candidate_unique
  "whd", // webhook_delivery (Phase 8d Task 3)
  "byk", // byok_credential (Phase 12)
  "byu", // byok_usage (Phase 12)
  "team", // team (Phase 13)
  "tgr", // team_grant (Phase 13)
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

const SHORT_CODE_LENGTH = 6;

/**
 * T-02's short link code: six characters from the same Crockford alphabet
 * and the same masking `newId` uses, with no prefix and no separator — it is
 * typed or read aloud by a candidate, not logged as a row reference. 30 bits
 * of randomness is plenty for a code that is also checked unique at write
 * time (`createTest` retries once on collision); it is not meant to be
 * globally unguessable the way a session token is.
 */
export function newShortCode(): string {
  const bytes = new Uint8Array(SHORT_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  let out = "";
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
