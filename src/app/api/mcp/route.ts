import "server-only";

import { after } from "next/server";

import { raiseAlert } from "@/lib/alerts";
import { queryDb } from "@/lib/db";
import { appBaseUrl, requireEnv } from "@/lib/env";
import { systemClock } from "@/lib/time";
import { createMcpHttp } from "@/mcp/http";
import { sideEffectsMode, supabaseServices } from "@/mcp/services";
import { supabaseRepository } from "@/mcp/supabase-repository";

export const runtime = "nodejs";
export const maxDuration = 30;

const handle = createMcpHttp({
  repository: supabaseRepository,
  services: (defer) => supabaseServices(sideEffectsMode(), defer),
  token: () => requireEnv("MCP_AGENT_TOKEN"),
  allowedHostnames: () => [new URL(appBaseUrl()).hostname],
  clock: systemClock,
  hooks: {
    onProblem: (problem) =>
      void raiseAlert({
        type: "tool_error",
        severity: "warning",
        fingerprint: `${problem.kind}:${problem.tool}`,
        message: problem.kind === "log_failed" ? `A ${problem.tool} call could not be logged.` : `${problem.tool} failed and returned the unavailable sentence.`,
        context: { error: problem.message.slice(0, 300) },
      }),
  },
  onUnauthorised: (request) =>
    after(() =>
      raiseAlert({
        type: "auth_failure",
        severity: "warning",
        fingerprint: "auth_failure:mcp",
        message: "A request reached /api/mcp without the agent's token.",
        context: { user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null },
      }),
    ),
  // Phase 0: which protocol revision the Agent SDK's client asks for, and when each connection opens.
  onHandshake: (message, request, caller) => {
    const metadata = {
      method: message.method,
      at: new Date().toISOString(),
      requested_protocol_version: message.params.protocolVersion ?? null,
      protocol_version_header: request.headers.get("mcp-protocol-version"),
      client_info: message.params.clientInfo ?? null,
    };
    console.log(JSON.stringify({ event: "mcp_handshake", ...metadata, conversation_id: caller.conversationId }));
    if (!caller.conversationId) return;
    after(() =>
      queryDb(
        `insert into support_agent.conversation_events (conversation_id, turn_id, event_type, summary, metadata, source)
         select $1, $2, 'mcp_handshake', $3, $4, 'system' where exists (select 1 from support_agent.conversations where id = $1)`,
        [caller.conversationId, caller.turnId, `MCP ${message.method}`, JSON.stringify(metadata)],
      ).catch((error: unknown) => console.error(JSON.stringify({ event: "mcp_handshake_not_recorded", error: String(error) }))),
    );
  },
});

async function route(request: Request): Promise<Response> {
  return handle(request, (work) => after(work));
}

export { route as DELETE, route as GET, route as POST };
