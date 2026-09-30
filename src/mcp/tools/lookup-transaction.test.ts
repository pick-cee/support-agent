import { beforeEach, describe, expect, it } from "vitest";

import { executeTool } from "../execute";
import { createMemoryRepository, memoryServices, type MemoryRepository } from "../memory-repository";
import type { ToolContext } from "../types";
import { lookupTransaction } from "./lookup-transaction";

const NOW = new Date("2026-09-29T10:00:00Z");

describe("lookup_transaction", () => {
  let repository: MemoryRepository;
  let context: ToolContext;
  const lookup = (args: unknown) => executeTool(lookupTransaction, args, context, repository, memoryServices(repository));

  beforeEach(async () => {
    repository = createMemoryRepository();
    context = { conversationId: await repository.createConversation("eval"), turnId: null, via: "agent", clock: () => NOW };
  });

  it("reports TXN-9001's passed estimate against a fixed today, and withholds the amount from an unverified caller", async () => {
    const result = await lookup({ transaction_id: "T X N nine zero zero one" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      found: true,
      transaction_id: "TXN-9001",
      status: "processing",
      type: "outgoing payout",
      estimated_arrival: "2026-08-19",
      eta_known: true,
      eta_passed: true,
      days_since_eta: 41,
      summary_outdated: true,
      checked_on: "2026-09-29",
      amount: null,
      currency: null,
      customer_id: null,
      withheld: true,
      disclosure: "unverified",
      requires_escalation: false,
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it("says an unknown arrival is unknown, not empty (TXN-9003), and flags review without explaining it", async () => {
    const result = await lookup({ transaction_id: "TXN-9003" });
    expect(result.structuredContent).toMatchObject({
      estimated_arrival: null,
      eta_known: false,
      eta_passed: false,
      days_since_eta: null,
      requires_escalation: true,
      sensitive_terms: ["compliance"],
      do_not_speak: ["customer_id", "support_summary"],
    });
  });

  it("does not call a completed payment's old estimate passed (TXN-9002)", async () => {
    expect((await lookup({ transaction_id: "TXN-9002" })).structuredContent).toMatchObject({ status: "completed", eta_passed: false });
  });

  it("discloses the amount to the verified owner only", async () => {
    await repository.setVerifiedCustomer(context.conversationId!, "CUS-1001");
    expect((await lookup({ transaction_id: "TXN-9001" })).structuredContent).toMatchObject({ amount: "2400.00", currency: "USD", customer_id: "CUS-1001", withheld: false, disclosure: "verified_owner" });
  });

  it("refuses another customer's reference without saying whether it exists", async () => {
    await repository.setVerifiedCustomer(context.conversationId!, "CUS-1001");
    const result = await lookup({ transaction_id: "TXN-9003" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ found: false, reason: "not_on_your_account" });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/review|GBP|5300|CUS-1003/);
    expect(repository.toolCalls[0]).toMatchObject({ status: "refused" });
  });

  it("returns found: false with the reference it searched for when nothing matches", async () => {
    const result = await lookup({ transaction_id: "txn 1234" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ found: false, reason: "not_found", normalised_id: "TXN-1234" });
    expect(repository.toolCalls[0]).toMatchObject({ status: "not_found", resultSummary: "not_found TXN-1234" });
  });

  it("answers bad input with a sentence the agent can act on, and still logs it", async () => {
    for (const args of [{}, { transaction_id: "" }, { transaction_id: { nested: true } }, null]) {
      const result = await lookup(args);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error_code: "invalid_input" });
      expect(String(result.structuredContent.message)).toMatch(/starts with T X N/);
    }
    expect(repository.toolCalls.map((log) => log.status)).toEqual(["invalid_input", "invalid_input", "invalid_input", "invalid_input"]);
  });

  it("names a payout reference given where a transaction was expected", async () => {
    expect((await lookup({ transaction_id: "PAY-7002" })).structuredContent.message).toMatch(/PAY reference, not a transaction. Use lookup_payout/);
  });

  it("turns a database failure into a composed sentence, never the raw error, and logs the raw error for us", async () => {
    repository.findTransaction = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:6543");
    };
    const result = await lookup({ transaction_id: "TXN-9001" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toMatch(/ECONNREFUSED|6543/);
    expect(result.structuredContent).toMatchObject({ error_code: "records_unavailable" });
    expect(repository.toolCalls[0]).toMatchObject({ status: "error", errorMessage: expect.stringMatching(/ECONNREFUSED/) });
  });

  it("logs the conversation from the context, and drops it when the conversation does not exist", async () => {
    await lookup({ transaction_id: "TXN-9001" });
    expect(repository.toolCalls[0]).toMatchObject({ conversationId: context.conversationId, toolName: "lookup_transaction", purpose: "Look up transaction TXN-9001 for the caller.", via: "agent" });
    context = { ...context, conversationId: "33333333-3333-4333-8333-333333333333" };
    await lookup({ transaction_id: "TXN-9001" });
    expect(repository.toolCalls[1]).toMatchObject({ conversationId: null, turnId: null });
  });
});
