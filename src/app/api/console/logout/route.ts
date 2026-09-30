import "server-only";

import { sessionCookie } from "@/lib/console/auth";
import { sameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  return new Response(null, { status: 303, headers: { Location: new URL("/console/login", request.url).toString(), "Set-Cookie": sessionCookie("", 0) } });
}
