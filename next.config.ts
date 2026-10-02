import type { NextConfig } from "next";

// The Claude Code program the Agent SDK runs is a platform package of about
// 237 MB, found by name at run time, so the build cannot see it being used and
// would leave it out (Week 5's first deployment failed on every stage with
// "Native CLI binary for linux-x64 not found"). Vercel's function limit is
// 250 MB, so it goes only into the routes that run the agent: a call's turns
// and a typed message's. Leaving /api/chat out would pass every local test
// (node_modules is on disk) and fail every typed message on Vercel.
const AGENT_PROGRAM = ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*"];

// Sent with every response (DESIGN §17). No other site may frame a page (the
// console's buttons cannot be clickjacked), the browser never guesses a content
// type, only this site may use the microphone, and HTTPS is remembered. The
// policy stops short of limiting scripts and connections: the voice call loads
// and connects to Vapi's and Daily's servers, and a wrong list there would
// silently break every call.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The console holds customer details: never indexed, never cached by a browser or proxy.
      { source: "/console/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/console", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
  // next dev appends its own agent-rules block to CLAUDE.md when it detects a
  // coding agent. CLAUDE.md is Akin's file, and the block carries an em dash.
  agentRules: false,
  turbopack: {
    root: process.cwd(),
  },
  // The Agent SDK spawns a native program and the pg driver has optional
  // native bindings; neither should be bundled.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pg"],
  outputFileTracingIncludes: {
    "/api/vapi/chat/completions": AGENT_PROGRAM,
    "/api/chat": AGENT_PROGRAM,
    // Every function runs pending migrations when it starts (src/instrumentation.ts),
    // and any of them may send an email with the logo attached: both are read from
    // disk, which the tracer cannot see on its own.
    "/*": ["./supabase/migrations/*.sql", "./public/brand/relaypay-logo-email.png"],
  },
};

export default nextConfig;
