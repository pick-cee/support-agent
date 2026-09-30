import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { zoneSpokenName } from "@/lib/zones";

/** "29 Sep, 21:04", in Lagos time: the console is read by the team in Lagos. */
export function when(iso: string | null, zone: string = BUSINESS_TIMEZONE): string {
  if (!iso) return "";
  const date = new Date(iso.includes("T") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function whenWithZone(iso: string | null, zone: string | null): string {
  return iso ? `${when(iso, zone ?? BUSINESS_TIMEZONE)} ${zoneSpokenName(zone ?? BUSINESS_TIMEZONE)}` : "";
}

export function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

export function ms(value: number | null): string {
  return value === null ? "no data" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

export function usd(value: number | string | null, digits = 4): string {
  return value === null ? "" : `$${Number(value).toFixed(digits)}`;
}
