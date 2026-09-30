import type { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_ABORT_GRACE_MS } from "@/lib/constants";

// The runtime prepares the real Claude Code program; this test drives a fake
// stream instead, so it needs neither the program nor an API key.
vi.mock("./runtime", () => ({
  agentRuntime: () => ({ cwd: "/tmp/relaypay-test", configDir: "/tmp/relaypay-test", home: "/tmp/relaypay-test", executable: "claude" }),
  agentEnv: () => ({}),
  runtimePrepared: () => true,
}));

const { runAgent } = await import("./run-agent");

const ESCALATION_RESULT = { escalation_ref: "E-2001", status: "open", call_booked: false, created: true };

/**
 * A stream that delivers these messages, then never yields again: the Claude
 * Code program still shutting down after an abort, as the benchmark saw for
 * 7.5 s after the deadline (2026-09-30).
 */
function stalledQuery(messages: unknown[]): typeof query {
  return (() => {
    let index = 0;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => (index < messages.length ? Promise.resolve({ done: false, value: messages[index++] as SDKMessage }) : new Promise<never>(() => undefined)),
      return: () => Promise.resolve({ done: true, value: undefined }),
    };
  }) as unknown as typeof query;
}

describe("runAgent after an abort", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_AGENT_TOKEN", "test-token");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns within the grace period, keeping the tool calls that already happened", async () => {
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(), 50);
    const run = await runAgent({
      prompt: "x",
      systemPrompt: ["x"],
      model: "claude-sonnet-5-5",
      conversationId: "11111111-1111-4111-8111-111111111111",
      turnId: "22222222-2222-4222-8222-222222222222",
      abortController: controller,
      queryFunction: stalledQuery([
        { type: "system", subtype: "init", mcp_servers: [{ name: "relaypay", status: "connected" }] },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_1", name: "mcp__relaypay__create_escalation", input: { user_name: "Efua" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: JSON.stringify(ESCALATION_RESULT) }] } },
      ]),
    });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(50 + AGENT_ABORT_GRACE_MS + 1_000);
    expect(run.error?.kind).toBe("aborted");
    expect(run.timings.abort_grace_exceeded).toBe(1);
    // The escalation happened, so code can still tell the caller.
    expect(run.toolCalls).toEqual([{ id: "toolu_1", name: "create_escalation", input: { user_name: "Efua" }, isError: false, result: ESCALATION_RESULT }]);
  });
});
