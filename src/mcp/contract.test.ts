import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMcpHttp } from "./http";
import { createMemoryRepository, memoryServices, type MemoryRepository } from "./memory-repository";

// Contract tests (DESIGN §18.2): every tool over real MCP, on the memory
// backend, through the same HTTP handler the route uses and through the stdio
// entry. Happy path, missing record, invalid input, refusal after escalation,
// ownership mismatch and idempotent retry.

const TOKEN = "test-token";
const NOW = new Date("2026-09-29T10:00:00Z");
const BASE = "http://localhost:3000/api/mcp";

type Structured = Record<string, unknown>;

/** A Request as it reaches the route: Node's Request carries no Host header, a real HTTP request always does. */
function withHost(url: string | URL, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("host", new URL(url).host);
  return new Request(url, { ...init, headers });
}

async function httpClient(repository: MemoryRepository, conversationId: string | null, token = TOKEN): Promise<Client> {
  const handle = createMcpHttp({
    repository,
    services: () => memoryServices(repository),
    token: () => TOKEN,
    allowedHostnames: () => ["localhost"],
    clock: () => NOW,
  });
  const transport = new StreamableHTTPClientTransport(new URL(BASE), {
    requestInit: { headers: { Authorization: `Bearer ${token}`, ...(conversationId ? { "X-RelayPay-Conversation": conversationId } : {}) } },
    fetch: (url, init) => handle(withHost(url, init), (work) => void work()),
  });
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: Structured }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, data: (result.structuredContent ?? {}) as Structured };
}

describe("MCP over HTTP, memory backend", () => {
  let repository: MemoryRepository;
  let conversationId: string;
  let client: Client;

  beforeEach(async () => {
    repository = createMemoryRepository();
    conversationId = await repository.createConversation("eval");
    client = await httpClient(repository, conversationId);
  });

  it("lists the eight tools, with readOnlyHint only on search and slot finding", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      ["create_escalation", "create_support_ticket", "find_callback_slots", "log_conversation_event", "lookup_customer", "lookup_payout", "lookup_transaction", "search_knowledge_base"].sort(),
    );
    expect(tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name).sort()).toEqual(["find_callback_slots", "search_knowledge_base"]);
    const escalation = tools.find((tool) => tool.name === "create_escalation")!;
    expect(escalation.inputSchema.required).toEqual(["user_name", "category", "reason"]);
  });

  it("search_knowledge_base finds the fees answer and logs the retrieval", async () => {
    const { data } = await call(client, "search_knowledge_base", { query: "What fees does RelayPay charge for international payments?" });
    expect(data.found).toBe(true);
    expect((data.chunks as { section_path: string }[])[0]!.section_path).toBe("Frequently Asked Questions > How Does RelayPay Charge Fees?");
    expect(data.degraded).toBe(true);
    expect(repository.retrievals).toHaveLength(1);
  });

  it("search_knowledge_base finds nothing for a question the knowledge base does not cover", async () => {
    const { data } = await call(client, "search_knowledge_base", { query: "quantum pizza recipe" });
    expect(data).toMatchObject({ found: false, chunks: [] });
  });

  it("lookup_customer verifies with two agreeing identifiers and marks the conversation", async () => {
    const { data } = await call(client, "lookup_customer", { contact_name: "Amara", company_name: "Lagos Ledger" });
    expect(data).toMatchObject({ found: true, customer_id: "CUS-1001", plan: "Growth", account_status: "active", routing: "normal", speakable_summary: "The account is active on the Growth plan." });
    expect(JSON.stringify(data)).not.toMatch(/amara@|Okafor/);
    expect((await repository.conversationState(conversationId))?.verifiedCustomerId).toBe("CUS-1001");
  });

  it("lookup_customer asks for more with one identifier, and gives a miss and a partial match the same reply", async () => {
    expect((await call(client, "lookup_customer", { company_name: "LagosLedger" })).data).toMatchObject({ found: false, reason: "need_more_identifiers" });
    const partial = await call(client, "lookup_customer", { contact_name: "Amara", company_name: "NairobiOps" });
    const miss = await call(client, "lookup_customer", { contact_name: "Nobody", company_name: "NoSuchCo" });
    expect(partial.isError).toBe(true);
    expect(partial.data).toEqual(miss.data);
  });

  it("lookup_customer routes a restricted account to a specialist", async () => {
    const { data } = await call(client, "lookup_customer", { contact_name: "Efua", email: "efua at accrastack dot example" });
    expect(data).toMatchObject({ customer_id: "CUS-1003", routing: "escalate_account_questions" });
    expect(data.do_not_speak).toEqual(["customer_id", "kyc_status", "support_notes"]);
  });

  it("lookup_payout says PAY-7002 needs review without naming compliance in what may be spoken", async () => {
    const { data } = await call(client, "lookup_payout", { payout_id: "P A Y seven zero zero two" });
    expect(data).toMatchObject({ found: true, payout_id: "PAY-7002", status: "review required", requires_escalation: true, support_summary: "This payout needs review by a specialist.", amount: null, recipient_name: null });
    expect(data.do_not_speak).toEqual(["failure_reason"]);
  });

  it("lookup_payout finds a payout by its transaction, and refuses someone else's", async () => {
    expect((await call(client, "lookup_payout", { transaction_id: "TXN-9004" })).data).toMatchObject({ payout_id: "PAY-7003", support_summary: "This payout failed because beneficiary details need review." });
    await call(client, "lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" });
    expect((await call(client, "lookup_payout", { payout_id: "PAY-7002" })).data).toMatchObject({ found: false, reason: "not_on_your_account" });
  });

  it("lookup_payout reports a missing payout and bad input", async () => {
    expect((await call(client, "lookup_payout", { payout_id: "PAY-9999" })).data).toMatchObject({ found: false, reason: "not_found" });
    expect((await call(client, "lookup_payout", {})).isError).toBe(true);
  });

  it("create_support_ticket raises the priority floor and returns the same ticket on a retry", async () => {
    const args = { category: "payment", priority: "low", summary: "Caller reports TXN-9001 has not arrived.", conversation_id: "made-up", transaction_id: "TXN-9001" };
    const first = await call(client, "create_support_ticket", args);
    const second = await call(client, "create_support_ticket", args);
    expect(first.data).toMatchObject({ ticket_ref: "T-4001", status: "open", priority: "high", created: true, priority_raised: "TXN-9001 is past its estimate" });
    expect(second.data).toMatchObject({ ticket_ref: "T-4001", created: false });
    expect(repository.tickets).toHaveLength(1);
    expect(repository.events.find((event) => event.eventType === "conversation_id_mismatch")).toBeDefined();
  });

  it("create_support_ticket keeps an unknown reference as reported text, never linked", async () => {
    const { data } = await call(client, "create_support_ticket", { category: "invoice", priority: "normal", summary: "Invoice payment failed.", conversation_id: conversationId, transaction_id: "TXN-1234" });
    expect(data.created).toBe(true);
    expect(repository.tickets[0]).toMatchObject({ transactionId: null, reportedReference: "TXN-1234" });
  });

  it("find_callback_slots parses the caller's words in their zone and says when the calendar is unavailable", async () => {
    const { data } = await call(client, "find_callback_slots", { preferred_time_text: "tomorrow at 2pm" });
    expect(data).toMatchObject({ parsed: true, requested_start_utc: "2026-09-30T13:00:00.000Z", requested_speakable: "Wednesday 30 September at 2 PM Lagos time", timezone_assumed: true, calendar_available: false });
    expect((await call(client, "find_callback_slots", { preferred_time_text: "whenever really" })).data).toMatchObject({ parsed: false, reason: "unparseable" });
    expect((await call(client, "find_callback_slots", { preferred_time_text: "in three weeks" })).data).toMatchObject({ parsed: false, reason: "beyond_horizon" });
  });

  it("create_escalation validates the email, is idempotent, and closes lookups afterwards", async () => {
    const base = { user_name: "Efua Mensah", category: "account", reason: "Account restricted; caller frustrated." };
    expect((await call(client, "create_escalation", { ...base, user_email: "efua at accrastack" })).data).toMatchObject({ error_code: "invalid_input" });

    const first = await call(client, "create_escalation", { ...base, user_email: "efua at accrastack dot example" });
    expect(first.data).toMatchObject({ escalation_ref: "E-2001", ticket_ref: "T-4001", status: "open", call_booked: false, booking_status: "not_requested", notification_status: "skipped_eval", created: true });
    const retry = await call(client, "create_escalation", { ...base, user_email: "efua at accrastack dot example" });
    expect(retry.data).toMatchObject({ escalation_ref: "E-2001", created: false });
    expect(repository.escalations).toHaveLength(1);
    expect(repository.escalations[0]!.user_email).toBe("efua@accrastack.example");

    for (const [tool, args] of [
      ["lookup_transaction", { transaction_id: "TXN-9001" }],
      ["lookup_payout", { payout_id: "PAY-7001" }],
      ["lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" }],
    ] as const) {
      const refused = await call(client, tool, args);
      expect(refused.isError).toBe(true);
      expect(refused.data).toMatchObject({ reason: "escalated" });
    }
    expect(repository.toolCalls.filter((log) => log.status === "refused")).toHaveLength(3);
  });

  it("create_escalation uses the email on file only for a verified caller, without returning it", async () => {
    const onFile = { user_name: "Amara", category: "account", reason: "Wants help with account access.", use_email_on_file: true };
    expect((await call(client, "create_escalation", onFile)).data).toMatchObject({ error_code: "invalid_input" });
    await call(client, "lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" });
    const { data } = await call(client, "create_escalation", onFile);
    expect(data.created).toBe(true);
    expect(JSON.stringify(data)).not.toContain("amara@lagosledger.example");
    expect(repository.escalations[0]!.user_email).toBe("amara@lagosledger.example");
  });

  it("create_escalation rejects a slot that is not in the booking window", async () => {
    const { data } = await call(client, "create_escalation", { user_name: "Efua", user_email: "efua@accrastack.example", category: "account", reason: "Restricted.", slot_start_utc: "2020-01-01T10:00:00Z" });
    expect(data).toMatchObject({ error_code: "invalid_input" });
  });

  it("log_conversation_event logs, and rejects an unknown event type", async () => {
    expect((await call(client, "log_conversation_event", { conversation_id: conversationId, event_type: "caller_frustrated", summary: "Caller said nobody is helping." })).data).toEqual({ logged: true });
    expect((await call(client, "log_conversation_event", { conversation_id: conversationId, event_type: "gossip", summary: "x" })).isError).toBe(true);
    expect(repository.events.find((event) => event.source === "agent")).toMatchObject({ eventType: "caller_frustrated", conversationId });
  });

  // assets/mcp-tool-requirements.md: fields may be added, never removed or renamed.
  it("returns every output field the tool requirements name, for every required tool", async () => {
    const required: [string, Record<string, unknown>, string[]][] = [
      ["lookup_customer", { contact_name: "Amara", company_name: "LagosLedger" }, ["found", "customer_id", "company_name", "plan", "account_status", "kyc_status", "support_notes"]],
      // Verified as Amara above, so her own transaction; another customer's is refused.
      ["lookup_transaction", { transaction_id: "TXN-9001" }, ["found", "transaction_id", "customer_id", "type", "status", "amount", "currency", "estimated_arrival", "support_summary"]],
      ["lookup_payout", { payout_id: "PAY-7001" }, ["found", "payout_id", "status", "scheduled_for", "failure_reason", "support_summary"]],
      ["create_support_ticket", { category: "payment", priority: "normal", summary: "Caller reports a failed payment.", conversation_id: conversationId }, ["ticket_id", "status"]],
      ["create_escalation", { user_name: "Amara", user_email: "amara@lagosledger.example", category: "account", reason: "Wants a specialist." }, ["escalation_id", "status", "follow_up_summary"]],
      ["log_conversation_event", { conversation_id: conversationId, event_type: "note", summary: "Contract check." }, ["logged"]],
    ];
    for (const [tool, args, fields] of required) {
      const { isError, data } = await call(client, tool, args);
      expect(isError, tool).toBe(false);
      expect(fields.filter((field) => !(field in data)), tool).toEqual([]);
    }
  });

  it("logs every call, including invalid ones, with the conversation from the header", async () => {
    await call(client, "lookup_transaction", {});
    await call(client, "lookup_transaction", { transaction_id: "TXN-9001" });
    expect(repository.toolCalls.map((log) => [log.status, log.conversationId, log.via])).toEqual([
      ["invalid_input", conversationId, "agent"],
      ["ok", conversationId, "agent"],
    ]);
  });
});

describe("MCP HTTP guards", () => {
  it("refuses a request without the token, and one for another host", async () => {
    const repository = createMemoryRepository();
    const handle = createMcpHttp({ repository, services: () => memoryServices(repository), token: () => TOKEN, allowedHostnames: () => ["localhost"], clock: () => NOW });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const noToken = await handle(withHost(BASE, { method: "POST", headers: { "content-type": "application/json" }, body }), () => undefined);
    expect(noToken.status).toBe(401);
    const otherHost = await handle(
      withHost("http://evil.example/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body }),
      () => undefined,
    );
    expect(otherHost.status).toBe(403);
    const noHost = await handle(new Request(BASE, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body }), () => undefined);
    expect(noHost.status).toBe(403);
  });
});

describe("MCP over stdio, memory backend", () => {
  let client: Client;

  beforeAll(async () => {
    const root = process.cwd();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", path.join(root, "scripts", "mcp-stdio.ts"), "--memory"],
      cwd: root,
      stderr: "pipe",
    });
    client = new Client({ name: "contract-test-stdio", version: "1.0.0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("serves the same eight tools, a lookup, an escalation and the refusal after it", async () => {
    expect((await client.listTools()).tools).toHaveLength(8);
    expect((await call(client, "lookup_transaction", { transaction_id: "TXN-9002" })).data).toMatchObject({ found: true, status: "completed" });
    expect((await call(client, "create_escalation", { user_name: "Daniel", user_email: "daniel@nairobiops.example", category: "dispute", reason: "Wants a refund." })).data).toMatchObject({ escalation_ref: "E-2001" });
    expect((await call(client, "lookup_transaction", { transaction_id: "TXN-9002" })).data).toMatchObject({ reason: "escalated" });
  }, 60_000);
});
