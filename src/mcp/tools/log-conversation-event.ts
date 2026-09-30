import * as z from "zod";

import { lenientInput } from "../lenient-input";
import type { ToolDefinition } from "../types";
import { invalid } from "./shared";

export const AGENT_EVENT_TYPES = ["decision", "clarification", "escalation_triggered", "safety_concern", "caller_frustrated", "note"] as const;

type Input = { conversation_id?: string; event_type: string; summary: string; metadata?: Record<string, unknown> };

/**
 * For the agent's own notes. The audit trail never depends on it: the server
 * logs turns, tool calls, retrievals, gates, bookings and notifications itself.
 */
export const logConversationEvent: ToolDefinition<Input> = {
  name: "log_conversation_event",
  title: "Log a note about this conversation",
  description:
    "Record an important decision or observation, for example why you escalated or that the caller is frustrated. Optional: the system already records every tool call and answer.",
  wireInput: lenientInput({
    conversation_id: { type: "string", required: true, description: "This conversation. The system fills it from the call; any value works." },
    event_type: { type: "string", required: true, description: "One of: decision, clarification, escalation_triggered, safety_concern, caller_frustrated, note.", enum: AGENT_EVENT_TYPES },
    summary: { type: "string", required: true, description: "One sentence." },
    metadata: { type: "object", description: "Optional small object of extra facts." },
  }),
  strictInput: z.object({
    conversation_id: z.string().trim().optional(),
    event_type: z.enum(AGENT_EVENT_TYPES),
    summary: z.string().trim().min(1).max(500),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

  purpose: (raw) => `Log a ${String(raw.event_type ?? "note")} event.`,

  invalidInput: () => invalid("event_type must be one of decision, clarification, escalation_triggered, safety_concern, caller_frustrated, note, with a one-sentence summary.", "invalid_input: event fields"),

  async run({ input, context, repository }) {
    const metadata = JSON.stringify(input.metadata ?? {}).length > 2000 ? { truncated: true } : (input.metadata ?? {});
    const mismatch = input.conversation_id && context.conversationId && input.conversation_id !== context.conversationId;
    await repository.logEvent({
      conversationId: context.conversationId,
      turnId: context.turnId,
      eventType: input.event_type,
      summary: input.summary,
      metadata: mismatch ? { ...metadata, conversation_id_given: input.conversation_id!.slice(0, 64) } : metadata,
      source: "agent",
    });
    return { status: "ok", isError: false, payload: { logged: true }, summary: `logged ${input.event_type}` };
  },
};
