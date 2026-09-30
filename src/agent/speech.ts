import { BUSINESS_TIMEZONE, SPOKEN_TEXT_MAX_CHARS } from "@/lib/constants";
import { dateInZone, isIsoDate } from "@/lib/time";

// Everything spoken goes through toSpeech() (DESIGN §12.3). It is mechanical:
// it formats what is there and strips what a speech engine would read aloud
// or the house style forbids, and it counts what it stripped. Asking a model
// not to use em dashes does not reliably work; this does.

export type SpeechStripped = { emDashes: number; markdown: number; urls: number; emoji: number };

const CURRENCY_NAMES: Record<string, [string, string]> = {
  USD: ["US dollar", "US dollars"],
  EUR: ["euro", "euros"],
  GBP: ["British pound", "British pounds"],
  NGN: ["naira", "naira"],
  KES: ["Kenyan shilling", "Kenyan shillings"],
  GHS: ["Ghanaian cedi", "Ghanaian cedis"],
  ZAR: ["rand", "rand"],
  RWF: ["Rwandan franc", "Rwandan francs"],
};

function spell(characters: string): string {
  return characters.split("").join(" ");
}

function formatAmount(raw: string, code: string): string {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return `${raw} ${code}`;
  const whole = Number.isInteger(value);
  const number = value.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  const names = CURRENCY_NAMES[code.toUpperCase()];
  return names ? `${number} ${value === 1 ? names[0] : names[1]}` : `${number} ${code}`;
}

/** Past dates as "19 August"; today and later with the weekday, as "Tuesday 6 October". */
export function speakDate(iso: string, now: Date): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const today = dateInZone(now, BUSINESS_TIMEZONE);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) };
  if (iso >= today) options.weekday = "long";
  return new Intl.DateTimeFormat("en-GB", options).format(date).replace(",", "");
}

export function toSpeech(input: string, now: Date): { text: string; stripped: SpeechStripped } {
  return format(input, now, "speech");
}

/**
 * The same cleanup for a typed reply someone reads on the page: markdown,
 * URLs, emoji and em dashes still go, and dates and amounts still read as
 * words, but a reference stays "TXN-9001" and an email stays an address.
 */
export function toText(input: string, now: Date): { text: string; stripped: SpeechStripped } {
  return format(input, now, "text");
}

function format(input: string, now: Date, mode: "speech" | "text"): { text: string; stripped: SpeechStripped } {
  const stripped: SpeechStripped = { emDashes: 0, markdown: 0, urls: 0, emoji: 0 };
  let text = input;

  // Markdown links keep their words; bare URLs go.
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, (_m, words: string) => {
    stripped.markdown += 1;
    return words;
  });
  text = text.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, () => {
    stripped.urls += 1;
    return "";
  });
  text = text.replace(/(\*\*|__|`+|^#{1,6}\s+|^\s*[-*+]\s+|^\s*\d+\.\s+)/gm, () => {
    stripped.markdown += 1;
    return "";
  });
  text = text.replace(/\s*[\u2014]\s*|\s+[\u2013]\s+/g, () => {
    stripped.emDashes += 1;
    return ", ";
  });
  text = text.replace(/\p{Extended_Pictographic}️?/gu, () => {
    stripped.emoji += 1;
    return "";
  });

  if (mode === "speech") {
    // Emails are read out, never spelled as symbols.
    text = text.replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (_m, local: string, domain: string) => `${local} at ${domain.split(".").join(" dot ")}`);

    // References: TXN-9001 becomes "T X N 9 0 0 1"; our own T-4821 and E-2093 become "T 4 8 2 1".
    text = text.replace(/\b(TXN|PAY|CUS)[-\s]?(\d+)\b/gi, (_m, prefix: string, digits: string) => `${spell(prefix.toUpperCase())} ${spell(digits)}`);
    text = text.replace(/\b([TE])-(\d{3,})\b/g, (_m, letter: string, digits: string) => `${letter} ${spell(digits)}`);
  }

  // Amounts with a currency code, either order.
  text = text.replace(/\b(USD|EUR|GBP|NGN|KES|GHS|ZAR|RWF)\s?(\d[\d,]*(?:\.\d+)?)\b/g, (_m, code: string, amount: string) => formatAmount(amount, code));
  text = text.replace(/\b(\d[\d,]*(?:\.\d+)?)\s?(USD|EUR|GBP|NGN|KES|GHS|ZAR|RWF)\b/g, (_m, amount: string, code: string) => formatAmount(amount, code));

  // ISO dates the model copied from a tool.
  text = text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (match: string) => (isIsoDate(match) ? speakDate(match, now) : match));

  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
  return { text, stripped };
}

/** Cuts over-long text at the last sentence end that fits; failing that, at a word. Mechanical, not a repair. */
export function trimToLength(text: string, max: number = SPOKEN_TEXT_MAX_CHARS): { text: string; trimmed: boolean } {
  if (text.length <= max) return { text, trimmed: false };
  const window = text.slice(0, max);
  const end = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
  if (end > max / 3) return { text: window.slice(0, end + 1), trimmed: true };
  const word = window.lastIndexOf(" ");
  return { text: `${window.slice(0, word > 0 ? word : max).replace(/[,;:]$/, "")}.`, trimmed: true };
}

/**
 * Splits only where sentence punctuation is followed by a space, so every
 * character survives. The first version matched sentence by sentence and
 * silently skipped text around a full stop inside a word: a typed read-back of
 * "efua@accrastack.example" came out as "example." (typed test, 2026-09-30), and
 * "2.5 percent" would have lost "2".
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
