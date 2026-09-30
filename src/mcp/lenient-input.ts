import * as z from "zod";

export type WireField = {
  type: "string" | "boolean" | "object";
  description: string;
  required?: boolean;
  enum?: readonly string[];
};

/**
 * The input schema the MCP SDK advertises and validates. It tells the model
 * the real types and which fields are required, but accepts any value at run
 * time. The SDK answers a failed validation itself, before our handler runs,
 * with a raw zod message and no log row (read in the v2 source,
 * McpServer.validateToolInput). Rule 7 says every call is logged, invalid ones
 * included, so the strict check lives in the handler (execute.ts).
 */
export function lenientInput(fields: Record<string, WireField>) {
  const shape = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      z
        .unknown()
        .optional()
        .meta({ type: field.type, description: field.description, ...(field.enum ? { enum: [...field.enum] } : {}) }),
    ]),
  );
  const required = Object.entries(fields)
    .filter(([, field]) => field.required)
    .map(([name]) => name);
  return z.object(shape).meta(required.length ? { required } : {});
}
