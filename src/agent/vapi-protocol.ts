import * as z from "zod";

import type { TranscriptLine } from "./system-prompt";

// Vapi calls our custom LLM with an OpenAI-shaped body plus call metadata
// (metadataSendMode "variable"), and speaks what we stream back as SSE chat
// completion chunks (DESIGN §12.1). Field names checked against
// @vapi-ai/server-sdk's types; Phase 0 logs a real body to confirm them.

const contentSchema = z.union([z.string(), z.null(), z.array(z.looseObject({ type: z.string().optional(), text: z.string().optional() }))]).optional();

export const vapiRequestSchema = z.looseObject({
  messages: z.array(z.looseObject({ role: z.string(), content: contentSchema })),
  call: z.looseObject({ id: z.string().min(1), type: z.string().optional() }),
  customer: z.looseObject({ number: z.string().optional() }).optional(),
  stream: z.boolean().optional(),
});

export type VapiRequest = z.infer<typeof vapiRequestSchema>;

function textOf(content: z.infer<typeof contentSchema>): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join(" ");
  return "";
}

/** What the caller said and heard, oldest first. System and tool messages are not part of it. */
export function transcriptOf(body: VapiRequest): TranscriptLine[] {
  return body.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role === "user" ? ("caller" as const) : ("agent" as const), text: textOf(message.content).trim() }))
    .filter((line) => line.text !== "" || line.role === "caller");
}

export function channelOf(body: VapiRequest): "web" | "phone" {
  return body.call.type === "inboundPhoneCall" || body.call.type === "outboundPhoneCall" ? "phone" : "web";
}

export function callerNumberOf(body: VapiRequest): string | null {
  const nested = (body.call as { customer?: { number?: unknown } }).customer?.number;
  const number = body.customer?.number ?? (typeof nested === "string" ? nested : undefined);
  return number ? number.slice(0, 32) : null;
}

// --- SSE -------------------------------------------------------------------------

export function sseChunk(id: string, content: string | null, finish: "stop" | null = null): string {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "relaypay-support-agent",
    choices: [{ index: 0, delta: content === null ? {} : { role: "assistant", content }, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

// --- the Phase 0 payload sample -------------------------------------------------

const KEEP = new Set(["role", "type", "object", "stream", "model", "provider", "metadataSendMode", "status"]);

/**
 * The shape of a real Vapi body with every value that could be personal
 * replaced by its type and length (DESIGN §12.2). Keys stay; values do not.
 */
export function redactVapiPayload(value: unknown, key = ""): unknown {
  if (typeof value === "string") return KEEP.has(key) ? value : `<string ${value.length}>`;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return KEEP.has(key) ? value : `<${value === null ? "null" : typeof value}>`;
  if (Array.isArray(value)) return value.slice(0, 6).map((item) => redactVapiPayload(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactVapiPayload(item, name)]));
  return `<${typeof value}>`;
}
