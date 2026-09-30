import * as chrono from "chrono-node";
import * as z from "zod";

import { BOOKING_HORIZON_DAYS, SLOT_ALTERNATIVES } from "@/lib/constants";
import { resolveZone, speakSlot, zoneOffsetMinutes, zoneSpokenName } from "@/lib/zones";

import { lenientInput } from "../lenient-input";
import type { ToolDefinition, ToolOutcome } from "../types";
import { invalid } from "./shared";

const DAY_MS = 86_400_000;

export type ParsedTime = { start: Date; hourGiven: boolean } | null;

/** The caller's words, read in their zone, relative to now. Date maths is code's job, never the model's. */
export function parseCallbackTime(text: string, now: Date, zone: string): ParsedTime {
  const results = chrono.parse(text, { instant: now, timezone: zoneOffsetMinutes(zone, now) }, { forwardDate: true });
  const first = results[0];
  if (!first) return null;
  return { start: first.start.date(), hourGiven: first.start.isCertain("hour") };
}

function notParsed(reason: string, message: string, zone: string, assumed: boolean): ToolOutcome {
  return {
    status: "ok",
    isError: false,
    payload: { parsed: false, reason, message, timezone_used: zone, timezone_assumed: assumed, timezone_spoken: zoneSpokenName(zone) },
    summary: `not parsed: ${reason}`,
  };
}

export const findCallbackSlots: ToolDefinition<{ preferred_time_text: string; timezone_hint?: string }> = {
  name: "find_callback_slots",
  title: "Find callback times",
  description:
    "Turn the caller's preferred callback time, in their own words, into real bookable slots. Code parses the time in the caller's zone and checks the calendar. " +
    "Offer requested_speakable when requested_available is true, otherwise offer the alternatives' speakable strings, and pass the chosen start_utc to create_escalation. " +
    "When timezone_assumed is true, say the time is in timezone_spoken. parsed false: ask again. calendar_available false: say a specialist will email to arrange a time.",
  wireInput: lenientInput({
    preferred_time_text: { type: "string", required: true, description: "The caller's words, for example 'tomorrow at 2pm' or 'Tuesday afternoon'." },
    timezone_hint: { type: "string", description: "A city, country or time zone the caller mentioned, if any." },
  }),
  strictInput: z.object({ preferred_time_text: z.string().trim().min(1).max(200), timezone_hint: z.string().trim().min(1).max(60).optional() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },

  purpose: (raw) => `Find callback slots for: ${String(raw.preferred_time_text ?? "").slice(0, 80)}`,

  invalidInput: () => invalid("preferred_time_text is missing. Ask the caller what day and time suit them.", "invalid_input: no preferred time"),

  async run({ input, context, state, repository, services }) {
    const customer = state?.verifiedCustomerId ? await repository.findCustomer(state.verifiedCustomerId) : null;
    const { zone, assumed } = resolveZone({ customerRegion: customer?.region, hint: input.timezone_hint });
    const now = context.clock();
    const parsed = parseCallbackTime(input.preferred_time_text, now, zone);

    if (!parsed) return notParsed("unparseable", "The time could not be read. Ask the caller for a day and a time.", zone, assumed);
    if (parsed.start.getTime() < now.getTime() && parsed.hourGiven) return notParsed("in_past", "That time has already passed. Ask for a later time.", zone, assumed);
    if (parsed.start.getTime() > now.getTime() + BOOKING_HORIZON_DAYS * DAY_MS) {
      return notParsed("beyond_horizon", `Callbacks can be booked up to ${BOOKING_HORIZON_DAYS} days ahead. Ask for a sooner time.`, zone, assumed);
    }

    const requested = parsed.hourGiven ? parsed.start : null;
    const base = {
      parsed: true,
      requested_start_utc: requested?.toISOString() ?? null,
      requested_speakable: requested ? speakSlot(requested, zone) : null,
      time_given: parsed.hourGiven,
      timezone_used: zone,
      timezone_assumed: assumed,
      timezone_spoken: zoneSpokenName(zone),
    };

    if (!services.calendar) {
      return {
        status: "ok",
        isError: false,
        payload: { ...base, calendar_available: false, requested_available: false, alternatives: [], message: "The booking calendar is not available. Say a specialist will email to arrange a time." },
        summary: "parsed; calendar not configured",
      };
    }

    // From the requested time (or the start of the requested day) up to three days on.
    const dayStart = new Date(Math.max(now.getTime(), parsed.hourGiven ? parsed.start.getTime() - 4 * 3_600_000 : parsed.start.getTime() - 12 * 3_600_000));
    const slots = await services.calendar.slots({ startUtc: dayStart, endUtc: new Date(dayStart.getTime() + 3 * DAY_MS), timeZone: zone });
    const future = slots.filter((slot) => slot.start.getTime() > now.getTime()).sort((a, b) => a.start.getTime() - b.start.getTime());
    const requestedAvailable = requested !== null && future.some((slot) => slot.start.getTime() === requested.getTime());
    const after = requested ? future.filter((slot) => slot.start.getTime() >= requested.getTime()) : future;
    const alternatives = (requestedAvailable ? [] : (after.length ? after : future))
      .slice(0, SLOT_ALTERNATIVES)
      .map((slot) => ({ start_utc: slot.start.toISOString(), speakable: speakSlot(slot.start, zone) }));

    return {
      status: "ok",
      isError: false,
      payload: { ...base, calendar_available: true, requested_available: requestedAvailable, alternatives },
      summary: requestedAvailable ? `requested ${requested!.toISOString()} available` : `${alternatives.length} alternatives offered`,
    };
  },
};
