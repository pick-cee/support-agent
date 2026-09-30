import "dotenv/config";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { runAgent } from "../src/agent/run-agent";
import { systemPrompt, turnPrompt } from "../src/agent/system-prompt";
import { DEFAULT_AGENT_MODEL } from "../src/lib/constants";
import { closePool, queryDb } from "../src/lib/db";
import { appBaseUrl, requireEnv } from "../src/lib/env";

// Phase 0 measurements that do not need a phone line (DESIGN §18.1):
//   A. MCP over HTTP: handshake time, the negotiated protocol version, one tool call.
//   B. The real agent, N runs: spawn to init, first tool use, total, and what it said.
// Usage: npm run phase0:probe -- [--runs 3] [--mcp-only] [--base-url https://...]

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function probeMcp(baseUrl: string): Promise<void> {
  console.log(`\nA. MCP over HTTP at ${baseUrl}/api/mcp`);
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${requireEnv("MCP_AGENT_TOKEN")}` } },
  });
  const client = new Client({ name: "relaypay-phase0-probe", version: "0.1.0" });
  const started = performance.now();
  await client.connect(transport);
  const connectMs = Math.round(performance.now() - started);
  const listStarted = performance.now();
  const tools = await client.listTools();
  const listMs = Math.round(performance.now() - listStarted);
  const callStarted = performance.now();
  const call = await client.callTool({ name: "lookup_transaction", arguments: { transaction_id: "T X N nine zero zero one" } });
  const callMs = Math.round(performance.now() - callStarted);
  console.log(`  connect (initialize): ${connectMs} ms`);
  console.log(`  negotiated protocol version: ${transport.protocolVersion ?? "(not reported)"}`);
  console.log(`  server: ${JSON.stringify(client.getServerVersion())}`);
  console.log(`  tools/list: ${listMs} ms -> ${tools.tools.map((tool) => tool.name).join(", ")}`);
  console.log(`  advertised input schema: ${JSON.stringify(tools.tools[0]?.inputSchema)}`);
  console.log(`  tools/call lookup_transaction: ${callMs} ms, isError=${String(call.isError)}`);
  console.log(`  structuredContent: ${JSON.stringify(call.structuredContent)}`);

  const unauthorised = await fetch(`${baseUrl}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  console.log(`  without the token: HTTP ${unauthorised.status}`);
  await client.close();
}

// One line per SDK message, without stream deltas: which model turn did what, and when.
function traceMessage(message: SDKMessage, elapsedMs: number): void {
  const at = String(elapsedMs).padStart(6);
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "message_start") console.log(`    ${at} ms  api message_start`);
    if (event.type === "message_delta") console.log(`    ${at} ms  api message_delta stop_reason=${event.delta.stop_reason} output_tokens=${event.usage.output_tokens}`);
    return;
  }
  if (message.type === "assistant") {
    const blocks = message.message.content.map((block) =>
      block.type === "tool_use" ? `tool_use:${block.name}` : block.type === "text" ? `text(${block.text.length}):${JSON.stringify(block.text.slice(0, 60))}` : block.type,
    );
    console.log(`    ${at} ms  assistant ${blocks.join(" ")}`);
    return;
  }
  if (message.type === "user") {
    const content = message.message.content;
    const blocks = Array.isArray(content) ? content.map((block) => (block.type === "tool_result" ? `tool_result is_error=${String(block.is_error ?? false)}` : block.type)) : ["text"];
    console.log(`    ${at} ms  user ${blocks.join(" ")}`);
    return;
  }
  console.log(`    ${at} ms  ${message.type}${"subtype" in message ? ` ${String(message.subtype)}` : ""}`);
}

async function probeAgent(runs: number): Promise<void> {
  const model = process.env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
  console.log(`\nB. The agent (${model}), ${runs} runs, MCP at ${appBaseUrl()}/api/mcp`);
  const conversation = await queryDb<{ id: string }>(
    "insert into support_agent.conversations (channel, vapi_call_id) values ('eval', $1) returning id",
    [`phase0-probe-${Date.now()}`],
  );
  const conversationId = conversation.rows[0]!.id;
  const transcript = [
    { role: "agent" as const, text: "Hi, this is RelayPay support. I'm an AI assistant. How can I help today?" },
    { role: "caller" as const, text: "Can you check transaction TXN-9001?" },
  ];

  for (let run = 1; run <= runs; run += 1) {
    const turn = await queryDb<{ id: string }>(
      "insert into support_agent.conversation_turns (conversation_id, turn_index, user_text) values ($1, $2, $3) returning id",
      [conversationId, run - 1, transcript[1]!.text],
    );
    const turnId = turn.rows[0]!.id;
    const started = performance.now();
    let fillerAt: number | null = null;
    const result = await runAgent({
      prompt: turnPrompt(transcript),
      systemPrompt: systemPrompt({ now: new Date(), verified: false, escalated: false, clarifyStreak: 0 }),
      model,
      conversationId,
      turnId,
      abortController: new AbortController(),
      onFirstToolUse: () => {
        fillerAt = Math.round(performance.now() - started);
      },
      onMessage: process.argv.includes("--trace") ? traceMessage : undefined,
    });
    const totalMs = Math.round(performance.now() - started);
    await queryDb(
      `update support_agent.conversation_turns
          set status = $2, spoken_text = $3, answer_type = $4, reply_source = 'agent', model = $5, total_ms = $6,
              timings = $7, cost_estimate_usd = $8, input_tokens = $9, output_tokens = $10, cache_read_tokens = $11,
              cache_write_tokens = $12, error = $13, updated_at = now()
        where id = $1`,
      [
        turnId,
        result.error ? "error" : "ok",
        result.answer?.spoken_text ?? null,
        result.answer?.answer_type ?? null,
        model,
        totalMs,
        JSON.stringify({ ...result.timings, probe_filler_cue_ms: fillerAt }),
        result.costEstimateUsd,
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.usage.cacheReadTokens,
        result.usage.cacheWriteTokens,
        result.error ? `${result.error.kind}: ${result.error.message}` : null,
      ],
    );
    console.log(`\n  run ${run}${run === 1 ? " (first in this process)" : ""}`);
    console.log(`    mcp status: ${result.mcpStatus}`);
    console.log(`    timings: ${JSON.stringify({ ...result.timings, total_ms: totalMs, filler_cue_ms: fillerAt })}`);
    console.log(`    tools: ${JSON.stringify(result.toolCalls.map((call) => ({ name: call.name, input: call.input, isError: call.isError, found: call.result?.found })))}`);
    console.log(`    answer: ${JSON.stringify(result.answer)}`);
    console.log(`    error: ${JSON.stringify(result.error)}`);
    console.log(`    usage: ${JSON.stringify(result.usage)}, cost estimate $${result.costEstimateUsd.toFixed(5)} (SDK estimate)`);
  }
  console.log(`\n  conversation ${conversationId} (channel eval) holds these turns and their tool calls.`);
}

async function main(): Promise<void> {
  const baseUrl = (arg("base-url") ?? appBaseUrl()).replace(/\/+$/, "");
  await probeMcp(baseUrl);
  if (!process.argv.includes("--mcp-only")) await probeAgent(Number(arg("runs") ?? 3));
}

main()
  .catch((error: unknown) => {
    console.error("Probe failed:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
