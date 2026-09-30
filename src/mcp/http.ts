import { createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames, originValidationResponse } from "@modelcontextprotocol/server";

import { bearerMatches } from "@/lib/auth";
import { uuidOrNull } from "@/lib/ids";
import type { Clock } from "@/lib/time";

import type { ExecuteHooks } from "./execute";
import { createRelayPayServer } from "./server";
import type { Repository, ToolContext, ToolServices } from "./types";

// Streamable HTTP over the one tool core, stateless: the factory runs once per
// request, and 2025-era clients (the Agent SDK negotiates 2025-11-25) are
// served by the handler's default stateless legacy mode. Auth is ours: the
// bearer token and Host and Origin are checked before the handler sees
// anything (DESIGN §7.1, §17).

export type HttpOptions = {
  repository: Repository;
  services: (defer: (work: () => Promise<void>) => void) => ToolServices;
  token: () => string;
  allowedHostnames: () => string[];
  clock: Clock;
  hooks?: ExecuteHooks;
  onUnauthorised?: (request: Request) => void;
  onHandshake?: (message: { method: string; params: Record<string, unknown> }, request: Request, caller: CallerExtra) => void;
};

export type CallerExtra = { conversationId: string | null; turnId: string | null; defer: (work: () => Promise<void>) => void };

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

export function createMcpHttp(options: HttpOptions): (request: Request, defer: (work: () => Promise<void>) => void) => Promise<Response> {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const extra = authInfo?.extra as CallerExtra | undefined;
      const context: ToolContext = {
        conversationId: extra?.conversationId ?? null,
        turnId: extra?.turnId ?? null,
        via: extra?.conversationId ? "agent" : "mcp_direct",
        clock: options.clock,
      };
      return createRelayPayServer(context, options.repository, options.services(extra?.defer ?? ((work) => void work())), options.hooks);
    },
    { legacy: "stateless", onerror: (error) => console.error(JSON.stringify({ event: "mcp_handler_error", error: error.message })) },
  );

  return async (request, defer) => {
    const hostnames = [...new Set([...options.allowedHostnames(), ...localhostAllowedHostnames()])];
    const rejected = hostHeaderValidationResponse(request, hostnames) ?? originValidationResponse(request, hostnames);
    if (rejected) return rejected;

    if (!bearerMatches(request.headers.get("authorization"), options.token())) {
      options.onUnauthorised?.(request);
      return jsonRpcError(401, -32001, "Unauthorized");
    }

    const caller: CallerExtra = {
      conversationId: uuidOrNull(request.headers.get("x-relaypay-conversation")),
      turnId: uuidOrNull(request.headers.get("x-relaypay-turn")),
      defer,
    };
    const authInfo = { token: "relaypay-agent", clientId: "relaypay-agent", scopes: [], extra: caller };
    if (request.method !== "POST") return handler.fetch(request, { authInfo });

    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return jsonRpcError(400, -32700, "Parse error");
    }
    for (const message of Array.isArray(body) ? body : [body]) {
      const method = (message as { method?: unknown })?.method;
      if (typeof method === "string" && ["initialize", "notifications/initialized", "server/discover"].includes(method)) {
        options.onHandshake?.({ method, params: ((message as { params?: Record<string, unknown> }).params ?? {}) }, request, caller);
      }
    }
    return handler.fetch(request, { authInfo, parsedBody: body });
  };
}
