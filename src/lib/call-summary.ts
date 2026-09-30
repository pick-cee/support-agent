// The end-of-call summary and final status (DESIGN §11, §2.10), written by code
// from what was recorded. No model, no cost, and it cannot invent anything.

export type CallRecord = {
  turns: { answer_type: string | null; status: string; user_text: string; reply_source: string | null }[];
  toolCalls: { tool_name: string; status: string; result_summary: string | null }[];
  answeredSections: string[];
  tickets: { ticket_ref: string; category: string }[];
  escalations: { escalation_ref: string; category: string; call_booked: boolean; booking_status: string }[];
};

export type FinalStatus = "resolved" | "ticket_created" | "escalated" | "abandoned" | "failed";

export function finalStatus(call: CallRecord): FinalStatus {
  if (call.escalations.length) return "escalated";
  // The caller hung up while we were collecting their details for a specialist.
  if (call.turns.at(-1)?.answer_type === "collect_details") return "abandoned";
  if (call.turns.some((turn) => turn.status === "error")) return "failed";
  if (call.tickets.length) return "ticket_created";
  return "resolved";
}

export function summarise(call: CallRecord): string {
  const parts: string[] = [`${call.turns.length} ${call.turns.length === 1 ? "turn" : "turns"}.`];
  const sections = [...new Set(call.answeredSections)];
  if (sections.length) parts.push(`Answered from ${sections.map((section) => section.replace("Frequently Asked Questions > ", "FAQ: ")).join("; ")}`.replace(/([^.?!])$/, "$1."));
  for (const call_ of call.toolCalls.filter((item) => item.tool_name.startsWith("lookup_"))) {
    parts.push(`${call_.tool_name.replace("lookup_", "Looked up ")}: ${call_.status === "ok" ? call_.result_summary : call_.status}.`);
  }
  if (call.turns.some((turn) => turn.answer_type === "clarify")) parts.push(`Asked ${call.turns.filter((turn) => turn.answer_type === "clarify").length} clarifying question(s).`);
  for (const ticket of call.tickets) parts.push(`Opened ${ticket.ticket_ref} (${ticket.category}).`);
  for (const escalation of call.escalations) {
    parts.push(`Escalated ${escalation.escalation_ref} (${escalation.category}), ${escalation.call_booked ? "callback booked" : `callback ${escalation.booking_status.replace("_", " ")}`}.`);
  }
  const fallbacks = call.turns.filter((turn) => turn.reply_source === "fallback").length;
  if (fallbacks) parts.push(`${fallbacks} fallback(s) spoken.`);
  return parts.join(" ");
}

const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\bat\b)\s*[a-z0-9-]+(?:\s*[a-z0-9-]+)*?(?:\s*(?:\.|\bdot\b)\s*[a-z0-9-]+)+/i;

/** Whatever contact detail the caller said before hanging up, for the follow-up ticket. */
export function contactFromTranscript(callerLines: string[]): string | null {
  for (const line of [...callerLines].reverse()) {
    const match = EMAIL.exec(line);
    if (match) return match[0];
  }
  return null;
}
