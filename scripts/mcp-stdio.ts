import dotenv from "dotenv";

// stdout is the protocol channel: nothing else may print to it.
dotenv.config({ quiet: true });

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { systemClock } from "../src/lib/time";
import { createMemoryRepository, memoryServices } from "../src/mcp/memory-repository";
import { createRelayPayServer } from "../src/mcp/server";
import type { Repository, ToolServices } from "../src/mcp/types";

// The MCP server over stdio, for MCP Inspector and Claude Desktop (DESIGN §7.1).
// Memory mode (--memory, or no SUPABASE_DB_URL) needs no accounts at all: it
// is seeded from assets/ and keeps writes in memory. One stdio session is one
// conversation, so verification and the refusal after escalation work as on a call.

async function main(): Promise<void> {
  const memory = process.argv.includes("--memory") || process.env.MCP_BACKEND === "memory" || !process.env.SUPABASE_DB_URL;
  let repository: Repository;
  let services: ToolServices;
  if (memory) {
    const repo = createMemoryRepository();
    repository = repo;
    services = memoryServices(repo);
  } else {
    const [{ supabaseRepository }, { supabaseServices, sideEffectsMode }] = await Promise.all([import("../src/mcp/supabase-repository"), import("../src/mcp/services")]);
    repository = supabaseRepository;
    services = supabaseServices(sideEffectsMode(), (work) => void work().catch((error: unknown) => console.error(String(error))));
  }
  const conversationId = await repository.createConversation("mcp_direct");
  console.error(`RelayPay MCP server on stdio, ${repository.backend} backend, conversation ${conversationId}`);
  serveStdio(() => createRelayPayServer({ conversationId, turnId: null, via: "mcp_direct", clock: systemClock }, repository, services));
}

main().catch((error: unknown) => {
  console.error("MCP stdio server failed to start:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
