import { EMAIL } from "@/app/copy";
import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { renderEmail, type Attachment } from "@/lib/email/template";
import { speakSlot, zoneSpokenName } from "@/lib/zones";

// The handoff (DESIGN §10.3): everything the specialist needs in one message,
// so the customer never repeats themselves. Written by code from the records.
// Internal, so it may carry the support note; never a key or a token.

export type HandoffInput = {
  escalation: {
    escalation_ref: string;
    ticket_ref: string;
    category: string;
    reason: string;
    user_name: string;
    user_email: string;
    call_booked: boolean;
    appointment_time: string | null;
    booking_status: string;
    booking_error: string | null;
    cal_booking_uid: string | null;
    timezone: string | null;
    preferred_time_text: string | null;
  };
  customer: { customer_id: string; company_name: string; plan: string; account_status: string; kyc_status: string; support_notes: string | null } | null;
  callerLines: string[];
  agentLines: string[];
  toolCalls: { tool_name: string; status: string; result_summary: string | null }[];
  consoleUrl: string | null;
  manageUrl?: string | null;
};

function shortTime(iso: string, zone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${day} ${time} ${zoneSpokenName(zone)}`;
}

export function buildHandoffEmail(input: HandoffInput): { subject: string; text: string; html: string; attachments: Attachment[] } {
  const { escalation, customer } = input;
  const copy = EMAIL.handoff;
  const zone = escalation.timezone ?? BUSINESS_TIMEZONE;
  const bookedAt = escalation.call_booked && escalation.appointment_time ? escalation.appointment_time : null;
  const bookedSpoken = bookedAt ? speakSlot(new Date(bookedAt), zone) : null;

  const subject = copy.subject(escalation.escalation_ref, escalation.category, customer?.company_name ?? copy.unverified, bookedAt ? shortTime(bookedAt, zone) : null);

  const why = escalation.booking_status === "not_requested" ? copy.noTimeChosen : (escalation.booking_error ?? escalation.booking_status);
  const rendered = renderEmail({
    preheader: `${escalation.user_name}: ${escalation.reason}`.slice(0, 140),
    badge: { text: copy.badge(escalation.escalation_ref), tone: "brand" },
    title: copy.title(customer?.company_name ?? null),
    intro: bookedSpoken ? copy.introBooked(bookedSpoken) : copy.introNotBooked,
    blocks: [
      {
        kind: "facts",
        heading: copy.headings.caller,
        rows: [
          [copy.labels.name, escalation.user_name],
          [copy.labels.email, escalation.user_email],
          [copy.labels.account, customer ? copy.verified(customer.customer_id, customer.company_name, customer.plan, customer.account_status, customer.kyc_status) : copy.notVerified],
          ...(customer?.support_notes ? ([[copy.labels.note, customer.support_notes]] as [string, string][]) : []),
        ],
      },
      {
        kind: "facts",
        heading: copy.headings.why,
        rows: [
          [copy.labels.category, escalation.category],
          [copy.labels.reason, escalation.reason],
          [copy.labels.ticket, escalation.ticket_ref],
        ],
      },
      ...(input.callerLines.length ? [{ kind: "quotes" as const, heading: copy.headings.said, lines: input.callerLines.slice(-3) }] : []),
      { kind: "quotes", heading: copy.headings.told, lines: input.agentLines.length ? input.agentLines.slice(-2) : [copy.nothingTold] },
      {
        kind: "lines",
        heading: copy.headings.lookedUp,
        lines: input.toolCalls.length ? input.toolCalls.map((call) => `${call.tool_name}: ${call.status}${call.result_summary ? `, ${call.result_summary}` : ""}`) : [copy.noLookups],
      },
      {
        kind: "facts",
        heading: copy.headings.booking,
        rows: bookedSpoken
          ? [
              [copy.labels.status, copy.booked(bookedSpoken)],
              ...(escalation.cal_booking_uid ? ([[copy.labels.link, `https://app.cal.com/booking/${escalation.cal_booking_uid}`]] as [string, string][]) : []),
            ]
          : [
              [copy.labels.status, copy.notBooked(why)],
              ...(escalation.preferred_time_text ? ([[copy.labels.asked, escalation.preferred_time_text]] as [string, string][]) : []),
            ],
      },
    ],
    action: input.consoleUrl ? { label: copy.action, url: input.consoleUrl } : undefined,
    reason: EMAIL.reasons.escalations,
    manageUrl: input.manageUrl ?? null,
  });
  return { subject, ...rendered };
}
