import "server-only";

import { CONSOLE_SESSION_HOURS } from "@/lib/constants";
import { ipHash, lockedOut, newSessionValue, recordAttempt, sessionCookie, verifyPassword } from "@/lib/console/auth";
import { sameOrigin } from "@/lib/same-origin";
import { optionalEnv } from "@/lib/env";

export const runtime = "nodejs";

function back(request: Request, path: string, cookie?: string): Response {
  return new Response(null, { status: 303, headers: { Location: new URL(path, request.url).toString(), ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const stored = optionalEnv("CONSOLE_PASSWORD_HASH");
  if (!stored || !optionalEnv("CONSOLE_SESSION_SECRET")) return back(request, "/console/login?error=config");

  const ip = ipHash(request);
  if (await lockedOut(ip)) return back(request, "/console/login?error=locked");

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const ok = password.length > 0 && verifyPassword(password, stored);
  await recordAttempt(ip, ok);
  if (!ok) return back(request, "/console/login?error=wrong");
  return back(request, "/console", sessionCookie(newSessionValue(), CONSOLE_SESSION_HOURS * 3600));
}
