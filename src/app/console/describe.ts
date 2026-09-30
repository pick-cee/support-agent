import { CONSOLE } from "@/app/copy";

import type { Tone } from "./parts";

// What a conversation did, in plain words, built from the tool log (DESIGN §14):
// the team reads "Looked up a transaction, found, TXN-9001", not a machine summary.

const REFERENCE = /\b(?:TXN|PAY|CUS)-\d+\b|\b[TE]-\d{4}\b/;

export type Action = { key: string; label: string; result: string; reference: string | null; tone: Tone; count: number };

type ToolCall = { tool_name: string; status: string; result_summary: string | null };

function toneOf(status: string): Tone {
  if (status === "ok") return "good";
  if (status === "error") return "bad";
  return "warn";
}

function resultOf(tool: ToolCall): string {
  const summary = tool.result_summary ?? "";
  // The MCP server's summaries start with what happened: "found TXN-9001: ...",
  // "verified CUS-1001 ...", "created T-4006: ...", "existing E-2002: ...".
  const first = /^([a-z_]+)/.exec(summary)?.[1] ?? "";
  if (tool.status === "ok" && CONSOLE.conversation.results[first]) return CONSOLE.conversation.results[first]!;
  return CONSOLE.conversation.results[tool.status] ?? tool.status.replace(/_/g, " ");
}

export function describeTools(tools: ToolCall[]): Action[] {
  const actions: Action[] = [];
  for (const tool of tools) {
    if (tool.tool_name === "log_conversation_event") continue;
    const label = CONSOLE.conversation.actions[tool.tool_name] ?? tool.tool_name.replace(/_/g, " ");
    const reference = REFERENCE.exec(tool.result_summary ?? "")?.[0] ?? null;
    const result = resultOf(tool);
    const previous = actions.at(-1);
    // Two searches in a row are one step for the reader.
    if (previous && previous.key === tool.tool_name && tool.tool_name === "search_knowledge_base" && previous.result === result) {
      previous.count += 1;
      continue;
    }
    actions.push({ key: tool.tool_name, label, result, reference, tone: result === CONSOLE.conversation.results.not_found ? "warn" : toneOf(tool.status), count: 1 });
  }
  return actions;
}
