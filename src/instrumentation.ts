// Runs once when a server starts: `next dev`, `next start`, and every new
// Vercel function instance. Next builds this file for the Edge runtime too, so
// everything that needs Node (migrations, the local outbox worker) sits in
// instrumentation-node.ts behind this exact check, which the bundler resolves
// at build time and drops from the Edge build. An early return is not enough:
// the imports after it were still bundled for Edge (FAILURES 44).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
