import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CHUNK_MAX_CHARS } from "@/lib/constants";

import { chunkId, chunkKnowledgeBase, summarise } from "./chunk";

const markdown = readFileSync(path.join(process.cwd(), "assets", "relaypay-knowledge-base.md"), "utf8");

describe("chunkKnowledgeBase on the client's knowledge base", () => {
  const document = chunkKnowledgeBase(markdown);
  const paths = document.chunks.map((chunk) => chunk.section_path);

  it("makes one chunk per feature, question, policy and release note", () => {
    expect(paths).toContain("Frequently Asked Questions > How Does RelayPay Charge Fees?");
    expect(paths).toContain("Frequently Asked Questions > How Long Do Payments Take To Process?");
    expect(paths).toContain("Product Features Overview > International Payments");
    expect(paths).toContain("Policies And Compliance > Disputes, Refunds, And Cancellations");
    expect(paths).toContain("Release Notes And Known Limitations > Version 2.4");
    expect(paths).toContain("Release Notes And Known Limitations > Ongoing Known Limitations");
    expect(paths).toContain("Release Notes And Known Limitations > Communication Guidance");
    expect(paths.filter((item) => item.startsWith("Frequently Asked Questions >"))).toHaveLength(17);
  });

  it("keeps section intros and skips the file's own preamble", () => {
    expect(paths).toContain("Policies And Compliance > Overview");
    expect(paths.some((item) => item.startsWith("RelayPay Knowledge Base"))).toBe(false);
  });

  it("gives every chunk a unique, stable id and a code-built summary", () => {
    expect(new Set(document.chunks.map((chunk) => chunk.chunk_id)).size).toBe(document.chunks.length);
    const fees = document.chunks.find((chunk) => chunk.section_path.endsWith("How Does RelayPay Charge Fees?"))!;
    expect(fees.chunk_id).toBe(chunkId("Frequently Asked Questions > How Does RelayPay Charge Fees?"));
    expect(fees.text).toBe("Fees vary based on transaction type, corridor, and payment method. RelayPay displays applicable fees before a transaction is confirmed.");
    expect(fees.source_summary).toBe("Fees vary based on transaction type, corridor, and payment method.");
    expect(document.chunks.every((chunk) => chunk.text.length <= CHUNK_MAX_CHARS)).toBe(true);
  });

  it("versions the file by its content", () => {
    expect(document.kb_version).toMatch(/^[0-9a-f]{64}$/);
    expect(chunkKnowledgeBase(`${markdown}\n`).kb_version).not.toBe(document.kb_version);
  });
});

describe("summarise", () => {
  it("cuts a long first sentence at a word", () => {
    const summary = summarise(`${"word ".repeat(60)}end.`);
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary.endsWith("...")).toBe(true);
  });
});
