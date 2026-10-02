import { EMAIL } from "@/app/copy";
import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { renderEmail, type Attachment } from "@/lib/email/template";
import { zoneSpokenName } from "@/lib/zones";

// The customer's confirmation when a ticket opens (DESIGN §10.5): the reference,
// when it was logged, and that a person will reply. Written by code from the
// ticket row; the agent's summary for the team is not in it, since it can hold
// what the records showed.

export type TicketForEmail = { ticket_ref: string; created_at: string };

export function buildTicketConfirmationEmail(ticket: TicketForEmail): { subject: string; text: string; html: string; attachments: Attachment[] } {
  const copy = EMAIL.ticketConfirmation;
  const logged = `${new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIMEZONE, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ticket.created_at))} ${zoneSpokenName(BUSINESS_TIMEZONE)}`;
  const rendered = renderEmail({
    preheader: copy.preheader(ticket.ticket_ref),
    badge: { text: copy.badge(ticket.ticket_ref), tone: "brand" },
    title: copy.title,
    intro: copy.intro,
    blocks: [
      { kind: "highlight", tone: "brand", label: copy.referenceLabel, value: ticket.ticket_ref, note: copy.referenceNote },
      { kind: "facts", rows: [[copy.logged, logged]] },
      { kind: "lines", heading: copy.nextHeading, lines: [...copy.next] },
    ],
    reason: copy.reason,
    signature: copy.signature,
  });
  return { subject: copy.subject(ticket.ticket_ref), ...rendered };
}
