import "dotenv/config";

import { randomUUID } from "node:crypto";

import { FIRST_MESSAGE } from "../src/app/copy";

// Sends Vapi-shaped custom-LLM requests to the app and prints each streamed
// chunk with its arrival time: the server's share of time to first audio,
// measured without a phone. Works against localhost or the deployment.
// Usage: npm run phase0:simulate -- [--base-url https://...] [--say "..."]... [--calls 1]

function args(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]!);
  });
  return values;
}

type Message = { role: "assistant" | "user"; content: string };

async function turn(baseUrl: string, callId: string, messages: Message[]): Promise<{ text: string; firstMs: number | null; totalMs: number; status: number }> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/vapi/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.VAPI_LLM_TOKEN}` },
    body: JSON.stringify({ model: "relaypay-support-agent", stream: true, messages, call: { id: callId, type: "webCall" }, customer: {} }),
  });
  if (!response.body) return { text: "", firstMs: null, totalMs: Math.round(performance.now() - started), status: response.status };
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let firstMs: number | null = null;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const event = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf("\n\n");
      if (!event.startsWith("data: ")) continue;
      const data = event.slice(6);
      const at = Math.round(performance.now() - started);
      if (data === "[DONE]") {
        console.log(`      ${String(at).padStart(6)} ms  [DONE]`);
        continue;
      }
      const content = JSON.parse(data).choices?.[0]?.delta?.content as string | undefined;
      if (content) {
        firstMs ??= at;
        text += content;
        console.log(`      ${String(at).padStart(6)} ms  ${JSON.stringify(content)}`);
      }
    }
  }
  return { text, firstMs, totalMs: Math.round(performance.now() - started), status: response.status };
}

async function main(): Promise<void> {
  const baseUrl = (args("base-url")[0] ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const says = args("say").length ? args("say") : ["Can you check transaction TXN-9001?"];
  const calls = Number(args("calls")[0] ?? 1);

  for (let call = 1; call <= calls; call += 1) {
    const callId = `simulated-${randomUUID()}`;
    console.log(`\ncall ${call} (${callId}) at ${baseUrl}`);
    const messages: Message[] = [{ role: "assistant", content: FIRST_MESSAGE }];
    for (const said of says) {
      messages.push({ role: "user", content: said });
      console.log(`  caller: ${said}`);
      const result = await turn(baseUrl, callId, messages);
      console.log(`  agent (HTTP ${result.status}, first chunk ${result.firstMs ?? "none"} ms, done ${result.totalMs} ms): ${result.text}`);
      messages.push({ role: "assistant", content: result.text });
    }
  }
}

main().catch((error: unknown) => {
  console.error("Simulation failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
