import "server-only";

import { SESSION_COOKIE, sessionValid } from "@/lib/console/auth";
import { sameOrigin } from "@/lib/same-origin";

// Every console write checks both: the request came from the console's own
// origin, and it carries a valid signed session (DESIGN §14).

function cookieValue(request: Request): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

export function consoleWriteAllowed(request: Request): boolean {
  return sameOrigin(request) && sessionValid(cookieValue(request));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
