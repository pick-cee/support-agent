// The stdio server in memory mode, with no flags: MCP Inspector's CLI parses
// flags in the server command as its own, so the memory choice lives here.
process.env.MCP_BACKEND = "memory";
void import("./mcp-stdio");
