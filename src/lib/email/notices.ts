import { EMAIL } from "@/app/copy";
import { ALERT_RENOTIFY_MINUTES, BUSINESS_TIMEZONE } from "@/lib/constants";
import { renderEmail, type Attachment } from "@/lib/email/template";

// The alert email and the console's test email, in the shared template.

type Rendered = { subject: string; text: string; html: string; attachments: Attachment[] };

export type AlertForEmail = { type: string; severity: string; message: string; context: Record<string, unknown>; occurrences: number; first_seen: string; last_seen: string };

function lagos(iso: string): string {
  const date = new Date(iso.includes("T") || iso.includes("+") ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : `${new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIMEZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} Lagos time`;
}

/** Context values, as short readable lines rather than a JSON dump. */
function details(context: Record<string, unknown>): [string, string][] {
  return Object.entries(context)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 8)
    .map(([key, value]) => [sentenceCase(key.replace(/_/g, " ")), (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 300)]);
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildAlertEmail(alert: AlertForEmail, links: { consoleUrl: string | null; manageUrl: string | null }, direct = false): Rendered {
  const copy = EMAIL.alert;
  const critical = alert.severity === "critical";
  const extra = details(alert.context);
  const rendered = renderEmail({
    preheader: alert.message.slice(0, 140),
    badge: { text: copy.badge(alert.severity), tone: critical ? "danger" : "warning" },
    title: alert.message,
    intro: copy.intro(copy.times(alert.occurrences), lagos(alert.first_seen), ALERT_RENOTIFY_MINUTES),
    blocks: [
      {
        kind: "facts",
        heading: copy.heading,
        rows: [
          [copy.labels.type, sentenceCase(alert.type.replace(/_/g, " "))],
          [copy.labels.severity, alert.severity],
          [copy.labels.seen, copy.times(alert.occurrences)],
          [copy.labels.first, lagos(alert.first_seen)],
          [copy.labels.last, lagos(alert.last_seen)],
        ],
      },
      ...(extra.length ? [{ kind: "facts" as const, heading: copy.labels.details, rows: extra }] : []),
    ],
    action: links.consoleUrl ? { label: copy.action, url: links.consoleUrl } : undefined,
    reason: direct ? EMAIL.reasons.direct : critical ? EMAIL.reasons.critical : EMAIL.reasons.warning,
    manageUrl: links.manageUrl,
  });
  return { subject: copy.subject(alert.severity, alert.type), ...rendered };
}

export function buildTestEmail(recipient: { name: string | null; escalations: boolean; critical_alerts: boolean; warning_alerts: boolean }, links: { consoleUrl: string; manageUrl: string }): Rendered {
  const copy = EMAIL.test;
  const kinds: string[] = [];
  if (recipient.escalations) kinds.push(copy.kinds.escalations);
  if (recipient.critical_alerts) kinds.push(copy.kinds.critical);
  if (recipient.warning_alerts) kinds.push(copy.kinds.warning);
  const rendered = renderEmail({
    preheader: copy.title,
    badge: { text: copy.badge, tone: "info" },
    title: copy.title,
    intro: copy.intro(recipient.name),
    blocks: [{ kind: "lines", heading: copy.heading, lines: kinds.length ? kinds : [copy.none] }],
    action: { label: copy.action, url: links.consoleUrl },
    reason: EMAIL.reasons.test,
    manageUrl: links.manageUrl,
  });
  return { subject: copy.subject, ...rendered };
}
