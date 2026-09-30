import "dotenv/config";

import { appendFileSync, readFileSync } from "node:fs";

import { VapiClient } from "@vapi-ai/server-sdk";

import { ASSISTANT_NAME, assistantConfig } from "../vapi/assistant";

// Creates or updates the Vapi assistant from vapi/assistant.ts and prints its
// id. Usage: npm run vapi:sync -- [--base-url https://your-deployment.example]
// The base URL defaults to APP_BASE_URL and must be reachable from Vapi's
// servers, so localhost is refused.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function main(): Promise<void> {
  const index = process.argv.indexOf("--base-url");
  const baseUrl = (index >= 0 ? process.argv[index + 1] : process.env.APP_BASE_URL)?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("No base URL: pass --base-url or set APP_BASE_URL");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Vapi must reach the app over the internet; ${baseUrl} is not reachable from Vapi. Deploy first, then pass --base-url https://...`);
  }

  const client = new VapiClient({ token: required("VAPI_PRIVATE_KEY") });
  const config = assistantConfig({ baseUrl, llmToken: required("VAPI_LLM_TOKEN"), serverToken: required("VAPI_SERVER_TOKEN") });

  const existing = (await client.assistants.list({ limit: 100 })).filter((assistant) => assistant.name === ASSISTANT_NAME);
  if (existing.length > 1) throw new Error(`${existing.length} assistants are named "${ASSISTANT_NAME}". Delete the extras in the Vapi dashboard so there is one source of truth.`);

  const assistant = existing[0] ? await client.assistants.update({ id: existing[0].id, ...config }) : await client.assistants.create(config);
  console.log(`${existing[0] ? "Updated" : "Created"} assistant "${assistant.name}" (${assistant.id})`);
  console.log(`  custom LLM: ${baseUrl}/api/vapi (Vapi calls /chat/completions under it)`);
  console.log(`  events:     ${baseUrl}/api/vapi/events`);

  const env = readFileSync(".env", "utf8");
  if (!/^\s*NEXT_PUBLIC_VAPI_ASSISTANT_ID=\S/m.test(env)) {
    appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}NEXT_PUBLIC_VAPI_ASSISTANT_ID=${assistant.id}\n`);
    console.log("  Added NEXT_PUBLIC_VAPI_ASSISTANT_ID to .env.");
  }
  console.log(`\nSet NEXT_PUBLIC_VAPI_ASSISTANT_ID=${assistant.id} in Vercel and redeploy, so the page can start calls.`);
  console.log("Then restrict the public key in the Vapi dashboard: allowedOrigins = your domain and localhost, allowedAssistantIds = this assistant.");
}

main().catch((error: unknown) => {
  const body = (error as { body?: unknown }).body;
  console.error("Vapi sync failed:", error instanceof Error ? error.message : String(error), body ? JSON.stringify(body).slice(0, 1000) : "");
  process.exitCode = 1;
});
