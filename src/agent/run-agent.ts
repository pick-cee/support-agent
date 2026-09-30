import "server-only";

import { query, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { AGENT_ABORT_GRACE_MS, AGENT_MAX_BUDGET_USD_PER_TURN, AGENT_MAX_TURNS, AGENT_REASONING, MCP_TOOL_TIMEOUT_MS } from "@/lib/constants";
import { appBaseUrl, requireEnv } from "@/lib/env";
import { TOOLS } from "@/mcp/server";

import { answerJsonSchema, answerSchema, type Answer } from "./answer";
import { agentEnv, agentRuntime, runtimePrepared } from "./runtime";

export const MCP_SERVER_NAME = "relaypay";
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

export type ToolCallRecord = {
  id: string;
  /** Without the mcp__relaypay__ prefix. */
  name: string;
  input: unknown;
  /** null until the SDK returns the result. */
  isError: boolean | null;
  result: Record<string, unknown> | null;
};

export type AgentErrorKind = "aborted" | "limit" | "structured_output" | "api" | "sdk";

export type AgentRun = {
  answer: Answer | null;
  error: { kind: AgentErrorKind; message: string } | null;
  resultSubtype: string | null;
  /** The turn's own tool-call log: what each tool actually returned, from the SDK's stream, never the model's account. */
  toolCalls: ToolCallRecord[];
  mcpStatus: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  /** The SDK's client-side estimate. Labelled as one wherever it appears. */
  costEstimateUsd: number;
  timings: Record<string, number | null>;
};

export type RunAgentOptions = {
  prompt: string;
  systemPrompt: string[];
  model: string;
  conversationId: string;
  turnId: string;
  abortController: AbortController;
  /** The first tool_use starting is the cue to speak the filler phrase. */
  onFirstToolUse?: () => void;
  /** Every SDK message with its time since query() started. For the Phase 0 probe's trace; not used in a call. */
  onMessage?: (message: SDKMessage, elapsedMs: number) => void;
  queryFunction?: typeof query;
};

function parseToolResult(content: unknown): Record<string, unknown> | null {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("") : "";
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRun> {
  const runQuery = options.queryFunction ?? query;
  const started = performance.now();
  const since = () => Math.round(performance.now() - started);
  const timings: Record<string, number | null> = { init_ms: null, first_stream_event_ms: null, first_tool_use_ms: null, result_ms: null };
  const toolCalls = new Map<string, ToolCallRecord>();
  let mcpStatus: string | null = null;
  let result: SDKResultMessage | undefined;
  let thrown: unknown;

  // The first turn in a process pays for preparing the runtime (and, on
  // Vercel, usually a cold function); Phase 0 reports cold and warm apart.
  timings.process_first_turn = runtimePrepared() ? 0 : 1;
  const runtime = agentRuntime();
  const allowedTools = TOOLS.map((tool) => `${TOOL_PREFIX}${tool.name}`);

  try {
    const stream = runQuery({
      prompt: options.prompt,
      options: {
        model: options.model,
        // Explicit per model: Claude Code otherwise thinks for seconds on a two-sentence reply.
        ...(AGENT_REASONING[options.model] ?? {}),
        systemPrompt: options.systemPrompt,
        cwd: runtime.cwd,
        pathToClaudeCodeExecutable: runtime.executable,
        env: agentEnv(runtime),
        // No built-in tools: the support agent never reads a file or runs a command.
        tools: [],
        allowedTools,
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: "http",
            url: `${appBaseUrl()}/api/mcp`,
            headers: {
              Authorization: `Bearer ${requireEnv("MCP_AGENT_TOKEN")}`,
              "X-RelayPay-Conversation": options.conversationId,
              "X-RelayPay-Turn": options.turnId,
            },
            // Without it the tools hide behind tool search: one more model round trip, audible on a call.
            alwaysLoad: true,
            timeout: MCP_TOOL_TIMEOUT_MS,
          },
        },
        // Without it the host's MCP servers and claude.ai connectors attach (Week 5).
        strictMcpConfig: true,
        // No settings files, so no CLAUDE.md from anywhere reaches the support agent.
        settingSources: [],
        // The prompt carries the caller's transcript: no @file expansion, no slash commands.
        verbatimPrompts: true,
        permissionMode: "dontAsk",
        maxTurns: AGENT_MAX_TURNS,
        maxBudgetUsd: AGENT_MAX_BUDGET_USD_PER_TURN,
        persistSession: false,
        includePartialMessages: true,
        outputFormat: { type: "json_schema", schema: answerJsonSchema },
        abortController: options.abortController,
      },
    });

    // Iterated by hand rather than with for await: breaking out of for await
    // calls return() and waits for the Claude Code program to shut down,
    // which Phase 0 measured at 1.4 to 1.5 s after the result had arrived.
    const iterator = (stream as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]();
    // After an abort the program can take seconds to stop (7.5 s in the
    // benchmark, after the 14 s deadline), and a caller would hear nothing all
    // that time. A result already on its way gets a short grace; then the turn
    // moves on with the tool calls seen so far, and the program stops on its own.
    const abortGraceOver = new Promise<"abort_grace_over">((resolve) => {
      const signal = options.abortController.signal;
      const start = () => setTimeout(() => resolve("abort_grace_over"), AGENT_ABORT_GRACE_MS);
      if (signal.aborted) start();
      else signal.addEventListener("abort", start, { once: true });
    });
    for (;;) {
      const pending = iterator.next();
      pending.catch(() => undefined);
      const next = await Promise.race([pending, abortGraceOver]);
      if (next === "abort_grace_over") {
        timings.abort_grace_exceeded = 1;
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
        break;
      }
      if (next.done) break;
      const message = next.value;
      options.onMessage?.(message, since());
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            timings.init_ms = since();
            mcpStatus = message.mcp_servers.find((server) => server.name === MCP_SERVER_NAME)?.status ?? "missing";
          }
          break;
        case "stream_event": {
          timings.first_stream_event_ms ??= since();
          const event = message.event;
          // Only our tools cue the filler. The SDK's own StructuredOutput call
          // is a tool_use too, and Phase 0 saw it trigger the filler.
          if (event.type === "content_block_start" && event.content_block.type === "tool_use" && event.content_block.name.startsWith(TOOL_PREFIX) && timings.first_tool_use_ms === null) {
            timings.first_tool_use_ms = since();
            options.onFirstToolUse?.();
          }
          break;
        }
        case "assistant":
          for (const block of message.message.content) {
            if (block.type === "tool_use" && block.name.startsWith(TOOL_PREFIX)) {
              toolCalls.set(block.id, { id: block.id, name: block.name.slice(TOOL_PREFIX.length), input: block.input, isError: null, result: null });
            }
          }
          break;
        case "user": {
          const content = message.message.content;
          if (!Array.isArray(content)) break;
          for (const block of content) {
            if (block.type !== "tool_result") continue;
            const record = toolCalls.get(block.tool_use_id);
            if (!record) continue;
            record.isError = block.is_error === true;
            record.result = parseToolResult(block.content);
          }
          break;
        }
        case "result":
          // Kept before anything else happens: the SDK yields the result and
          // then throws on budget or turn limits (Week 5 lost usage this way).
          result = message;
          timings.result_ms = since();
          break;
        default:
          break;
      }
      // The turn is decided once the result is in. Waiting for the program to
      // exit cost 1.7 s a turn in Phase 0, and once let the deadline discard
      // an answer that had already arrived. The shutdown finishes on its own.
      if (result) {
        void Promise.resolve(iterator.return?.())
          .catch(() => undefined);
        break;
      }
    }
  } catch (error) {
    thrown = error;
  }
  timings.loop_exit_ms = since();

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const model of Object.values(result?.modelUsage ?? {})) {
    usage.inputTokens += model.inputTokens;
    usage.outputTokens += model.outputTokens;
    usage.cacheReadTokens += model.cacheReadInputTokens;
    usage.cacheWriteTokens += model.cacheCreationInputTokens;
  }
  if (result) {
    timings.sdk_duration_ms = result.duration_ms;
    timings.sdk_duration_api_ms = result.duration_api_ms;
    timings.sdk_num_turns = result.num_turns;
    if (result.subtype === "success") {
      timings.sdk_ttft_ms = result.ttft_ms ?? null;
      timings.sdk_time_to_request_from_spawn_ms = result.time_to_request_from_spawn_ms ?? null;
    }
  }

  const base = {
    toolCalls: [...toolCalls.values()],
    mcpStatus,
    model: options.model,
    usage,
    costEstimateUsd: result?.total_cost_usd ?? 0,
    timings,
    resultSubtype: result?.subtype ?? null,
  };

  // A result in hand is the answer, even if an abort fired while the program shut down.
  if (!result && options.abortController.signal.aborted) return { ...base, answer: null, error: { kind: "aborted", message: "The turn was aborted" } };
  if (!result) return { ...base, answer: null, error: { kind: "sdk", message: thrown instanceof Error ? thrown.message : "The agent returned no result" } };
  if (result.subtype === "error_max_turns" || result.subtype === "error_max_budget_usd") return { ...base, answer: null, error: { kind: "limit", message: result.subtype } };
  if (result.subtype === "error_max_structured_output_retries") return { ...base, answer: null, error: { kind: "structured_output", message: result.subtype } };
  if (result.subtype !== "success") return { ...base, answer: null, error: { kind: "sdk", message: result.errors.join("; ").slice(0, 500) || result.subtype } };
  if (result.is_error) return { ...base, answer: null, error: { kind: "api", message: `API error${result.api_error_status ? ` ${result.api_error_status}` : ""}: ${result.result.slice(0, 300)}` } };

  const parsed = answerSchema.safeParse(result.structured_output);
  if (!parsed.success) return { ...base, answer: null, error: { kind: "structured_output", message: "structured_output did not match the answer schema" } };
  return { ...base, answer: parsed.data, error: null };
}
