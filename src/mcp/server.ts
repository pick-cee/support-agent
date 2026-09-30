import { McpServer } from "@modelcontextprotocol/server";

import { executeTool, type ExecuteHooks } from "./execute";
import { createEscalation } from "./tools/create-escalation";
import { createSupportTicket } from "./tools/create-support-ticket";
import { findCallbackSlots } from "./tools/find-callback-slots";
import { logConversationEvent } from "./tools/log-conversation-event";
import { lookupCustomer } from "./tools/lookup-customer";
import { lookupPayout } from "./tools/lookup-payout";
import { lookupTransaction } from "./tools/lookup-transaction";
import { searchKnowledgeBase } from "./tools/search-knowledge-base";
import type { Repository, ToolContext, ToolDefinition, ToolServices } from "./types";

// The six required tools and two more (DESIGN §7.3).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolDefinition<any>[] = [
  searchKnowledgeBase,
  lookupCustomer,
  lookupTransaction,
  lookupPayout,
  findCallbackSlots,
  createSupportTicket,
  createEscalation,
  logConversationEvent,
];

export const SERVER_INFO = { name: "relaypay-support", version: "0.2.0" };

const INSTRUCTIONS =
  "RelayPay support tools. Search approved knowledge before any product or policy answer. Verify a caller with two identifiers before account questions. " +
  "Lookups withhold amounts from unverified callers and are closed once a case is escalated. Every call is logged.";

/** One tool core behind every entry point: HTTP, stdio and memory mode (DESIGN §7.1). */
export function createRelayPayServer(context: ToolContext, repository: Repository, services: ToolServices, hooks: ExecuteHooks = {}): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.wireInput, annotations: tool.annotations },
      async (args) => executeTool(tool, args, context, repository, services, hooks),
    );
  }
  return server;
}
