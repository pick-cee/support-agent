import "server-only";

import { CAL_API_BASE, CAL_API_VERSIONS, CAL_TIMEOUT_MS, CALLBACK_DURATION_MIN } from "@/lib/constants";

// Cal.com API v2 (DESIGN §10.2). Each call pins its own cal-api-version,
// because a wrong value silently falls back to an older one.

export class CalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** True when the request may have reached Cal.com: a retry must look for the booking first. */
    readonly outcomeUnknown: boolean,
  ) {
    super(message);
  }
}

export type CalConfig = { apiKey: string; eventTypeId: number };

async function call<T>(config: CalConfig, method: "GET" | "POST", path: string, version: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CAL_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, "cal-api-version": version, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(CAL_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or a dropped connection: the booking may or may not exist.
    throw new CalError(`Cal.com did not answer: ${error instanceof Error ? error.message : String(error)}`, null, true);
  }
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      message = (typeof parsed.error === "object" ? parsed.error?.message : parsed.error) ?? parsed.message ?? message;
    } catch {
      // keep the raw text
    }
    throw new CalError(`Cal.com ${method} ${path} returned ${response.status}: ${message}`, response.status, response.status >= 500);
  }
  return JSON.parse(text) as T;
}

export async function calSlots(config: CalConfig, input: { startUtc: Date; endUtc: Date; timeZone: string }): Promise<Date[]> {
  const query = new URLSearchParams({
    eventTypeId: String(config.eventTypeId),
    start: input.startUtc.toISOString(),
    end: input.endUtc.toISOString(),
    timeZone: input.timeZone,
  });
  const result = await call<{ data?: Record<string, { start: string }[]> }>(config, "GET", `/v2/slots?${query}`, CAL_API_VERSIONS.slots);
  return Object.values(result.data ?? {})
    .flat()
    .map((slot) => new Date(slot.start))
    .filter((date) => !Number.isNaN(date.getTime()));
}

export type CalBooking = { uid: string; start: string; status: string };

export async function calCreateBooking(
  config: CalConfig,
  input: { start: Date; name: string; email: string; timeZone: string; metadata: Record<string, string> },
): Promise<CalBooking> {
  const result = await call<{ data?: CalBooking }>(config, "POST", "/v2/bookings", CAL_API_VERSIONS.createBooking, {
    start: input.start.toISOString(),
    eventTypeId: config.eventTypeId,
    attendee: { name: input.name, email: input.email, timeZone: input.timeZone },
    metadata: input.metadata,
  });
  if (!result.data?.uid) throw new CalError("Cal.com returned no booking uid", 201, true);
  return result.data;
}

/** Cal.com documents no idempotency key: before booking again, find one this escalation already made. */
export async function calFindBooking(config: CalConfig, input: { email: string; start: Date; escalationId: string }): Promise<CalBooking | null> {
  const query = new URLSearchParams({
    attendeeEmail: input.email,
    afterStart: new Date(input.start.getTime() - 60_000).toISOString(),
    beforeEnd: new Date(input.start.getTime() + (CALLBACK_DURATION_MIN + 1) * 60_000).toISOString(),
    eventTypeId: String(config.eventTypeId),
  });
  const result = await call<{ data?: (CalBooking & { metadata?: Record<string, string> })[] }>(config, "GET", `/v2/bookings?${query}`, CAL_API_VERSIONS.listBookings);
  const match = (result.data ?? []).find(
    (booking) => booking.metadata?.escalation_id === input.escalationId || new Date(booking.start).getTime() === input.start.getTime(),
  );
  return match && match.status !== "cancelled" ? match : null;
}
