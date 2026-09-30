import "server-only";

import { after } from "next/server";

import { raiseAlert } from "@/lib/alerts";

// Phase 0 confirms the path Vapi calls under model.url (DESIGN §12.2). If it
// is not /chat/completions, the call lands here instead of in silence: the
// alert names the path Vapi actually used.
export const runtime = "nodejs";

async function unexpected(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  after(() =>
    raiseAlert({
      type: "bad_vapi_payload",
      severity: "critical",
      fingerprint: `vapi_unknown_path:${request.method}:${path}`,
      message: `Vapi called ${request.method} ${path}, which this app does not serve. Check model.url in vapi/assistant.ts.`,
      context: { path, method: request.method },
    }),
  );
  return Response.json({ error: "Not found" }, { status: 404 });
}

export { unexpected as GET, unexpected as POST };
