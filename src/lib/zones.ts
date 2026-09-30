import { BUSINESS_TIMEZONE } from "@/lib/constants";

// Which time zone a callback time means, and how to say it (DESIGN §7.3).
// The verified customer's region wins, then what the caller said, then Lagos,
// stated out loud. All in code: a model guessing a zone would book the wrong hour.

const REGION_ZONES: Record<string, string> = {
  nigeria: "Africa/Lagos",
  kenya: "Africa/Nairobi",
  ghana: "Africa/Accra",
  "south africa": "Africa/Johannesburg",
  rwanda: "Africa/Kigali",
  uganda: "Africa/Kampala",
  tanzania: "Africa/Dar_es_Salaam",
  egypt: "Africa/Cairo",
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  england: "Europe/London",
  france: "Europe/Paris",
  germany: "Europe/Berlin",
  "united states": "America/New_York",
  usa: "America/New_York",
  canada: "America/Toronto",
};

const CITY_ZONES: Record<string, string> = {
  lagos: "Africa/Lagos",
  abuja: "Africa/Lagos",
  "port harcourt": "Africa/Lagos",
  ibadan: "Africa/Lagos",
  nairobi: "Africa/Nairobi",
  mombasa: "Africa/Nairobi",
  accra: "Africa/Accra",
  kumasi: "Africa/Accra",
  johannesburg: "Africa/Johannesburg",
  "cape town": "Africa/Johannesburg",
  durban: "Africa/Johannesburg",
  kigali: "Africa/Kigali",
  kampala: "Africa/Kampala",
  cairo: "Africa/Cairo",
  london: "Europe/London",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  "new york": "America/New_York",
  toronto: "America/Toronto",
};

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export type ResolvedZone = { zone: string; source: "customer_region" | "caller_hint" | "default"; assumed: boolean };

export function resolveZone(input: { customerRegion?: string | null; hint?: string | null }): ResolvedZone {
  const region = input.customerRegion?.trim().toLowerCase();
  if (region && REGION_ZONES[region]) return { zone: REGION_ZONES[region], source: "customer_region", assumed: false };
  const hint = input.hint?.trim();
  if (hint) {
    if (hint.includes("/") && isValidZone(hint)) return { zone: hint, source: "caller_hint", assumed: false };
    const key = hint.toLowerCase().replace(/\s+time$/, "").trim();
    const zone = CITY_ZONES[key] ?? REGION_ZONES[key];
    if (zone) return { zone, source: "caller_hint", assumed: false };
  }
  return { zone: BUSINESS_TIMEZONE, source: "default", assumed: true };
}

/** "Lagos time", "Cape Town"-style city names from the IANA id. */
export function zoneSpokenName(zone: string): string {
  const city = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
  return `${city} time`;
}

/** The zone's offset from UTC, in minutes, at a given instant. */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** "Tuesday 6 October at 2 PM Lagos time"; minutes only when they are not zero. */
export function speakSlot(startUtc: Date, zone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(startUtc).replace(",", "");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(startUtc);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const period = parts.find((part) => part.type === "dayPeriod")?.value?.toUpperCase();
  const time = minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
  return `${day} at ${time} ${zoneSpokenName(zone)}`;
}
