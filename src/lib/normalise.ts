// Turns what speech-to-text produces into the references the records use
// (DESIGN §7.5). All in code, never the model: a parser's job done by a model
// is money spent on nothing, and it can be wrong in ways a test can't pin.

export type ReferenceKind = "TXN" | "PAY" | "CUS";

export type NormalisedReference =
  | { ok: true; id: string; kind: ReferenceKind }
  | { ok: false; reason: "empty" | "no_digits" | "wrong_kind"; kind?: ReferenceKind };

const PREFIX_WORDS: Record<string, ReferenceKind> = {
  txn: "TXN",
  transaction: "TXN",
  pay: "PAY",
  payout: "PAY",
  cus: "CUS",
  customer: "CUS",
};

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

// "ninety oh one" is how people say 9001; the tens word carries two digits.
const TENS_WORDS: Record<string, string> = {
  ten: "10",
  twenty: "2",
  thirty: "3",
  forty: "4",
  fifty: "5",
  sixty: "6",
  seventy: "7",
  eighty: "8",
  ninety: "9",
};

const REPEATERS: Record<string, number> = { double: 2, triple: 3 };
const SEPARATORS = new Set(["dash", "hyphen", "number", "no", "is"]);

function tokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Reads digits from `list` starting at `start`; stops at the first word that is not part of a number. */
function readDigits(list: string[], start: number): { digits: string; next: number } {
  let digits = "";
  let index = start;
  while (index < list.length) {
    const token = list[index]!;
    if (/^\d+$/.test(token)) {
      digits += token;
    } else if (token in DIGIT_WORDS) {
      digits += DIGIT_WORDS[token];
    } else if (token in TENS_WORDS) {
      const tens = TENS_WORDS[token]!;
      const following = list[index + 1];
      // "ninety one" is 91, "ninety" alone or before "oh" keeps its zero.
      const unit = following && following in DIGIT_WORDS && !["oh", "o", "zero"].includes(following) ? DIGIT_WORDS[following] : undefined;
      if (tens === "10") {
        digits += "10";
      } else if (unit) {
        digits += tens + unit;
        index += 1;
      } else {
        digits += `${tens}0`;
      }
    } else if (token in REPEATERS) {
      const following = list[index + 1];
      const digit = following === undefined ? undefined : /^\d$/.test(following) ? following : DIGIT_WORDS[following];
      if (!digit) break;
      digits += digit.repeat(REPEATERS[token]!);
      index += 1;
    } else if (SEPARATORS.has(token) && digits === "") {
      // "transaction number 9001", "TXN dash 9001"
    } else {
      break;
    }
    index += 1;
  }
  return { digits, next: index };
}

/** Matches a prefix at `index`: a prefix word, or its letters spoken one by one ("t x n"). */
function readPrefix(list: string[], index: number): { kind: ReferenceKind; next: number } | undefined {
  const token = list[index];
  if (token === undefined) return undefined;
  if (token in PREFIX_WORDS) return { kind: PREFIX_WORDS[token]!, next: index + 1 };
  const spelled = list.slice(index, index + 3);
  if (spelled.length === 3 && spelled.every((part) => part.length === 1)) {
    const word = spelled.join("");
    if (word in PREFIX_WORDS) return { kind: PREFIX_WORDS[word]!, next: index + 3 };
  }
  return undefined;
}

// --- emails, companies, names (DESIGN §7.5) ---------------------------------------

const EMAIL_SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * "amara at lagos ledger dot example" becomes amara@lagosledger.example.
 * Speech splits words the caller never meant to split, so spaces inside the
 * domain go; "underscore", "dash" and "hyphen" become their symbols. Returns
 * null for anything that is not an email once normalised. Always read back to
 * the caller before use.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  text = text
    .replace(/\s+(?:at|@)\s+/g, "@")
    .replace(/\s+(?:dot|period)\s+/g, ".")
    .replace(/\s+(?:dot|period)(?=[a-z])/g, ".")
    .replace(/\s*\b(?:underscore)\b\s*/g, "_")
    .replace(/\s*\b(?:dash|hyphen)\b\s*/g, "-")
    .replace(/\s+/g, "")
    .replace(/^mailto:/, "")
    .replace(/[.,;:!?]+$/, "");
  return EMAIL_SHAPE.test(text) ? text : null;
}

/** Case, spaces and punctuation are ignored: "Lagos Ledger" matches LagosLedger. Mirrors customers.company_key. */
export function companyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key || null;
}

/** The first name the caller gave, compared with the first token of contact_name, case-insensitive. */
export function firstNameKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const first = raw.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z'-]/g, "");
  return first || null;
}

/**
 * Every reference in a piece of text, normalised. With `bareAsTransaction`, a
 * bare number of three or more digits also counts as TXN-: that is how the
 * lookup tool reads a caller who gives only the digits (DESIGN §7.5).
 */
export function findReferences(text: string, options: { bareAsTransaction?: boolean } = {}): string[] {
  const list = tokens(text);
  const found = new Set<string>();
  let index = 0;
  while (index < list.length) {
    const prefix = readPrefix(list, index);
    if (prefix) {
      const { digits, next } = readDigits(list, prefix.next);
      if (digits) {
        found.add(`${prefix.kind}-${digits}`);
        index = next;
        continue;
      }
      index = prefix.next;
      continue;
    }
    if (options.bareAsTransaction) {
      const { digits, next } = readDigits(list, index);
      if (digits.length >= 3) {
        found.add(`TXN-${digits}`);
        index = next;
        continue;
      }
      if (next > index) {
        index = next;
        continue;
      }
    }
    index += 1;
  }
  return [...found];
}

/**
 * "T X N 9001", "txn nine zero zero one", "TXN9001" and "transaction 9001"
 * all become TXN-9001; the same for PAY- and CUS-. A bare "9001" becomes
 * TXN-9001 only when a transaction is expected (DESIGN §7.5).
 */
export function normaliseReference(raw: unknown, expected: ReferenceKind): NormalisedReference {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) raw = String(raw);
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "empty" };
  const list = tokens(raw);

  let foundOtherKind: ReferenceKind | undefined;
  for (let index = 0; index < list.length; index += 1) {
    const prefix = readPrefix(list, index);
    if (!prefix) continue;
    const { digits } = readDigits(list, prefix.next);
    if (!digits) continue;
    if (prefix.kind !== expected) {
      foundOtherKind ??= prefix.kind;
      continue;
    }
    return { ok: true, id: `${expected}-${digits}`, kind: expected };
  }
  if (foundOtherKind) return { ok: false, reason: "wrong_kind", kind: foundOtherKind };

  const bare = readDigits(list, 0);
  if (bare.digits && bare.next === list.length) {
    return expected === "TXN" ? { ok: true, id: `TXN-${bare.digits}`, kind: "TXN" } : { ok: false, reason: "no_digits" };
  }
  return { ok: false, reason: "no_digits" };
}
