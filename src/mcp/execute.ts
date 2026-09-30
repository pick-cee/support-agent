import { TOOL_RUN_TIMEOUT_MS } from "@/lib/constants";
import { redactInput } from "@/lib/redact";

import type { ConversationState, Repository, ToolContext, ToolDefinition, ToolOutcome, ToolServices } from "./types";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
};

export type ExecuteHooks = {
  /** Told about failures (a tool error, a log that could not be written), for alerts. */
  onProblem?: (problem: { kind: "tool_error" | "log_failed"; tool: string; message: string }) => void;
};

const UNAVAILABLE: ToolOutcome = {
  status: "error",
  isError: true,
  payload: {
    ok: false,
    error_code: "records_unavailable",
    message: "The records system did not respond. Tell the caller you can't do that right now, and offer to have a specialist follow up.",
  },
  summary: "error: records unavailable",
};

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool timed out after ${ms} ms`)), ms);
    timer.unref?.();
  });
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * Every tool runs through here (DESIGN §7.2): strict validation, a deadline,
 * one tool_calls row for every call (refusals, bad input and failures
 * included), and a result that is never a raw error. It never throws: a thrown
 * error reaches the model as a bare string with no context.
 */
export async function executeTool<Input>(
  tool: ToolDefinition<Input>,
  rawArgs: unknown,
  context: ToolContext,
  repository: Repository,
  services: ToolServices,
  hooks: ExecuteHooks = {},
): Promise<ToolResult> {
  const started = performance.now();
  const raw = asRecord(rawArgs);
  let conversationId = context.conversationId;
  let outcome: ToolOutcome;

  try {
    let state: ConversationState | null = null;
    if (conversationId) {
      state = await Promise.race([repository.conversationState(conversationId), timeout(TOOL_RUN_TIMEOUT_MS)]);
      // A conversation header that names no conversation is logged without it,
      // rather than failing the log row on its foreign key.
      if (!state) conversationId = null;
    }
    const parsed = tool.strictInput.safeParse(raw);
    outcome = parsed.success
      ? await Promise.race([
          tool.run({ input: parsed.data, context: { ...context, conversationId, turnId: conversationId ? context.turnId : null }, state, repository, services }),
          timeout(tool.timeoutMs ?? TOOL_RUN_TIMEOUT_MS),
        ])
      : tool.invalidInput(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome = { ...UNAVAILABLE, errorMessage: message.slice(0, 500) };
    hooks.onProblem?.({ kind: "tool_error", tool: tool.name, message });
  }

  const durationMs = Math.max(0, Math.round(performance.now() - started));
  try {
    await repository.logToolCall({
      conversationId,
      turnId: conversationId ? context.turnId : null,
      toolName: tool.name,
      purpose: tool.purpose(raw),
      inputRedacted: redactInput(raw),
      resultSummary: outcome.summary,
      status: outcome.status,
      errorMessage: outcome.errorMessage ?? null,
      durationMs,
      via: context.via,
    });
  } catch (error) {
    // The Vercel log is the record of last resort when the database is down.
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "tool_call_not_logged", tool: tool.name, status: outcome.status, durationMs, error: message }));
    hooks.onProblem?.({ kind: "log_failed", tool: tool.name, message });
  }

  return {
    content: [{ type: "text", text: JSON.stringify(outcome.payload) }],
    structuredContent: outcome.payload,
    isError: outcome.isError,
  };
}
