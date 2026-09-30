import "dotenv/config";

import { appendFileSync, readFileSync } from "node:fs";

import { CAL_API_BASE, CAL_API_VERSIONS, CALLBACK_DURATION_MIN, CALLBACK_EVENT_TYPE_SLUG, CALLBACK_EVENT_TYPE_TITLE } from "../src/lib/constants";

// Creates the Cal.com event type callbacks are booked on (DESIGN §10.2), or
// finds it if it exists, and writes CAL_EVENT_TYPE_ID to .env. Idempotent by slug.

async function cal<T>(method: "GET" | "POST", path: string, version: string, body?: unknown): Promise<T> {
  const response = await fetch(`${CAL_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CAL_API_KEY}`, "cal-api-version": version, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Cal.com ${method} ${path} returned ${response.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  if (!process.env.CAL_API_KEY) throw new Error("CAL_API_KEY is missing from .env");
  const existing = await cal<{ data: { id: number; slug: string; lengthInMinutes: number }[] }>("GET", "/v2/event-types", CAL_API_VERSIONS.listEventTypes);
  let eventType = existing.data.find((type) => type.slug === CALLBACK_EVENT_TYPE_SLUG);
  if (eventType) {
    console.log(`Found event type "${CALLBACK_EVENT_TYPE_TITLE}" (${eventType.id}, ${eventType.lengthInMinutes} min).`);
  } else {
    const created = await cal<{ data: { id: number; slug: string; lengthInMinutes: number } }>("POST", "/v2/event-types", CAL_API_VERSIONS.createEventType, {
      title: CALLBACK_EVENT_TYPE_TITLE,
      slug: CALLBACK_EVENT_TYPE_SLUG,
      lengthInMinutes: CALLBACK_DURATION_MIN,
      description: "A RelayPay support specialist calls you back about your case. Booked by the RelayPay AI support assistant.",
      // At least an hour's notice, so a slot offered on a call is still bookable when the caller confirms it.
      minimumBookingNotice: 60,
    });
    eventType = created.data;
    console.log(`Created event type "${CALLBACK_EVENT_TYPE_TITLE}" (${eventType.id}, ${eventType.lengthInMinutes} min).`);
  }
  const env = readFileSync(".env", "utf8");
  if (!/^\s*CAL_EVENT_TYPE_ID=\S/m.test(env)) {
    appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}CAL_EVENT_TYPE_ID=${eventType.id}\n`);
    console.log("Added CAL_EVENT_TYPE_ID to .env. Add the same value in Vercel.");
  }
}

main().catch((error: unknown) => {
  console.error("Cal.com setup failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
