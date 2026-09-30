import "server-only";

import { queryDb } from "@/lib/db";

// Who receives which emails (DESIGN §10.3), managed in the console's Settings
// page, replacing the SUPPORT_INBOX_EMAIL variable. Three kinds: escalation
// handoffs, critical alerts and warnings, chosen per person.

export type NotificationKind = "escalations" | "critical_alerts" | "warning_alerts";
export const NOTIFICATION_KINDS: NotificationKind[] = ["escalations", "critical_alerts", "warning_alerts"];

export type Recipient = {
  id: string;
  email: string;
  name: string | null;
  escalations: boolean;
  critical_alerts: boolean;
  warning_alerts: boolean;
  active: boolean;
  created_at: string;
};

// The last list read, per server. When the database is down it cannot be read,
// and this is the only way an alert about that can still be addressed.
let lastKnown: Recipient[] = [];

export async function listRecipients(): Promise<Recipient[]> {
  const result = await queryDb<Recipient>(
    `select id, email, name, escalations, critical_alerts, warning_alerts, active, created_at::text
       from support_agent.notification_recipients order by created_at`,
  );
  lastKnown = result.rows;
  return result.rows;
}

export async function recipientsFor(kind: NotificationKind): Promise<string[]> {
  return (await listRecipients()).filter((recipient) => recipient.active && recipient[kind]).map((recipient) => recipient.email);
}

/** For the database-down path only: whoever was on the list the last time it was read. */
export function lastKnownRecipientsFor(kind: NotificationKind): string[] {
  return lastKnown.filter((recipient) => recipient.active && recipient[kind]).map((recipient) => recipient.email);
}

/** How many people receive each kind, for the console's warnings. */
export async function coverage(): Promise<Record<NotificationKind, number>> {
  const recipients = (await listRecipients()).filter((recipient) => recipient.active);
  return {
    escalations: recipients.filter((recipient) => recipient.escalations).length,
    critical_alerts: recipients.filter((recipient) => recipient.critical_alerts).length,
    warning_alerts: recipients.filter((recipient) => recipient.warning_alerts).length,
  };
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function addRecipient(input: { email: string; name: string | null } & Record<NotificationKind, boolean>): Promise<{ ok: true; recipient: Recipient } | { ok: false; reason: "invalid" | "exists" }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { ok: false, reason: "invalid" };
  const result = await queryDb<Recipient>(
    `insert into support_agent.notification_recipients (email, name, escalations, critical_alerts, warning_alerts)
     values ($1, $2, $3, $4, $5)
     on conflict (lower(email)) do nothing
     returning id, email, name, escalations, critical_alerts, warning_alerts, active, created_at::text`,
    [email, input.name?.trim().slice(0, 120) || null, input.escalations, input.critical_alerts, input.warning_alerts],
  );
  const recipient = result.rows[0];
  return recipient ? { ok: true, recipient } : { ok: false, reason: "exists" };
}

export async function updateRecipient(id: string, changes: Partial<Record<NotificationKind | "active", boolean>>): Promise<Recipient | null> {
  const fields = Object.entries(changes).filter(([key, value]) => (NOTIFICATION_KINDS as string[]).concat("active").includes(key) && typeof value === "boolean");
  if (!fields.length) return null;
  const sets = fields.map(([key], index) => `${key} = $${index + 2}`).join(", ");
  const result = await queryDb<Recipient>(
    `update support_agent.notification_recipients set ${sets}, updated_at = now() where id = $1
     returning id, email, name, escalations, critical_alerts, warning_alerts, active, created_at::text`,
    [id, ...fields.map(([, value]) => value)],
  );
  return result.rows[0] ?? null;
}

export async function removeRecipient(id: string): Promise<boolean> {
  const result = await queryDb(`delete from support_agent.notification_recipients where id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function findRecipient(id: string): Promise<Recipient | null> {
  const result = await queryDb<Recipient>(
    `select id, email, name, escalations, critical_alerts, warning_alerts, active, created_at::text from support_agent.notification_recipients where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
