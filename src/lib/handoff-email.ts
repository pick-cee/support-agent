import { BUSINESS_TIMEZONE } from "@/lib/constants";
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
};

function shortTime(iso: string, zone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${day} ${time} ${zoneSpokenName(zone)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildHandoffEmail(input: HandoffInput): { subject: string; text: string; html: string } {
  const { escalation, customer } = input;
  const zone = escalation.timezone ?? BUSINESS_TIMEZONE;
  const booked = escalation.call_booked && escalation.appointment_time;
  const subject = [
    `[Escalation ${escalation.escalation_ref}] ${escalation.category}`,
    customer?.company_name ?? "unverified caller",
    booked ? `callback ${shortTime(escalation.appointment_time!, zone)}` : "no callback booked",
  ].join(" · ");

  const sections: [string, string[]][] = [
    [
      "Caller",
      [
        `Name: ${escalation.user_name}`,
        `Email: ${escalation.user_email}`,
        customer ? `Verified as ${customer.customer_id} (${customer.company_name}), ${customer.plan} plan, account ${customer.account_status}, KYC ${customer.kyc_status}` : "Not verified",
        ...(customer?.support_notes ? [`Support note: ${customer.support_notes}`] : []),
      ],
    ],
    ["Why", [escalation.reason, ...(input.callerLines.length ? ["The caller's last words:", ...input.callerLines.slice(-3).map((line) => `  "${line}"`)] : [])]],
    ["What we already told them", input.agentLines.length ? input.agentLines.slice(-2).map((line) => `"${line}"`) : ["Nothing recorded."]],
    ["What we looked up", input.toolCalls.length ? input.toolCalls.map((call) => `${call.tool_name}: ${call.status}${call.result_summary ? `, ${call.result_summary}` : ""}`) : ["No lookups."]],
    [
      "Booking",
      booked
        ? [`Booked for ${speakSlot(new Date(escalation.appointment_time!), zone)}.`, ...(escalation.cal_booking_uid ? [`Cal.com: https://app.cal.com/booking/${escalation.cal_booking_uid}`] : [])]
        : [
            `Not booked: ${escalation.booking_status === "not_requested" ? "no time was chosen on the call" : (escalation.booking_error ?? escalation.booking_status)}.`,
            ...(escalation.preferred_time_text ? [`The caller asked for: ${escalation.preferred_time_text}`] : []),
            "Please email the caller to arrange a time.",
          ],
    ],
    ["Ticket", [escalation.ticket_ref]],
    ["Console", [input.consoleUrl ?? "Not available"]],
  ];

  const text = sections.map(([heading, lines]) => `${heading}\n${lines.join("\n")}`).join("\n\n");
  const html = sections
    .map(([heading, lines]) => `<h3 style="margin:16px 0 4px;font-family:sans-serif">${escapeHtml(heading)}</h3>${lines.map((line) => `<div style="font-family:sans-serif">${escapeHtml(line)}</div>`).join("")}`)
    .join("");
  return { subject, text, html };
}
