import "server-only";

import { accessSync, chmodSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { requireEnv } from "@/lib/env";

// Ported from Week 5's src/lib/runner/agent-runtime.ts
// (github.com/pick-cee/aat-c3-week-5-lead-agent at 1298747). Two changes: the
// agent's folder holds nothing at all (Week 5 copied skills into it), and
// agentEnv() builds the subprocess environment from nothing instead of
// spreading process.env.

export type AgentRuntime = { cwd: string; configDir: string; home: string; executable: string };

let prepared: AgentRuntime | undefined;

/** False until the first turn in this process has prepared the runtime: that turn is the cold one. */
export function runtimePrepared(): boolean {
  return prepared !== undefined;
}

const SDK_SCOPE = ["@anthropic", "ai"].join("-");
const PLATFORM_PACKAGE = ["claude", "agent", "sdk", ""].join("-");

/**
 * The Claude Code program the Agent SDK runs, for this machine. It ships as a
 * platform package of about 237 MB, found by name at run time, so the build
 * cannot see it being used: Week 5's first Vercel deployment left it out and
 * every stage failed with "Native CLI binary for linux-x64 not found".
 * next.config.ts includes it in the route that runs the agent.
 */
export function agentExecutable(): string | null {
  const binary = process.platform === "win32" ? "claude.exe" : "claude";
  // Joined at run time so the build's file tracer cannot follow it. When it
  // could (Week 5), it copied the program into every function.
  const packages = [process.cwd(), "node_modules", SDK_SCOPE].join(path.sep);
  const candidates = [`${process.platform}-${process.arch}`, `${process.platform}-${process.arch}-musl`].map((target) =>
    [packages, `${PLATFORM_PACKAGE}${target}`, binary].join(path.sep),
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * A deployment may not keep the program's executable bit. Vercel's disk is
 * read-only outside /tmp, so a copy there is made executable instead.
 */
function runnable(executable: string, root: string): string {
  if (process.platform === "win32") return executable;
  try {
    accessSync(executable, fsConstants.X_OK);
    return executable;
  } catch {
    const copy = path.join(root, "claude");
    copyFileSync(executable, copy);
    chmodSync(copy, 0o755);
    return copy;
  }
}

/**
 * The support agent runs in an empty folder with an empty Claude config of
 * its own. Run from the repository with the host's config, Week 5's agent
 * received the coding agent's instructions (this repo's CLAUDE.md would be
 * the same leak), the developer's memory, their claude.ai connectors and
 * unrelated skills. Everything lives under the temp folder, the only writable
 * place on Vercel.
 *
 * Claude Code does not use ANTHROPIC_API_KEY until the key is approved in its
 * config; without that it reports "Not logged in". The approval stores the
 * key's last 20 characters, which is what Claude Code itself records.
 */
export function agentRuntime(): AgentRuntime {
  if (prepared) return prepared;
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const found = agentExecutable();
  if (!found) throw new Error(`This server has no Claude Code program for ${process.platform}-${process.arch}; the route that runs the agent must include it (next.config.ts)`);

  // Per process, so two servers never rebuild the same folder under each other.
  const root = path.join(os.tmpdir(), `relaypay-agent-${process.pid}`);
  const cwd = path.join(root, "workspace");
  const configDir = path.join(root, "config");
  const home = path.join(root, "home");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(configDir, ".claude.json"),
    JSON.stringify({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: [apiKey.slice(-20)], rejected: [] } }),
    { mode: 0o600 },
  );
  prepared = { cwd, configDir, home, executable: runnable(found, root) };
  return prepared;
}

/**
 * The whole environment the agent's process sees. `env` replaces the
 * subprocess environment entirely, so nothing else reaches it: not the
 * database URL, not the Vapi or MCP tokens, not the Resend or Cal.com keys.
 * The agent reaches its tools only through the MCP server, with the token the
 * turn runner puts in that turn's MCP config.
 */
export function agentEnv(runtime: AgentRuntime): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: runtime.home,
    CLAUDE_CONFIG_DIR: runtime.configDir,
    XDG_CONFIG_HOME: runtime.home,
    XDG_CACHE_HOME: runtime.home,
    XDG_DATA_HOME: runtime.home,
    XDG_STATE_HOME: runtime.home,
    ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY"),
  };
  return env;
}
