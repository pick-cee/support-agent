# RelayPay support agent

A voice and chat support agent for RelayPay. A customer talks to it on a web
page (or types). It answers from RelayPay's approved help content, looks up
customers, transactions and payouts when that is safe, opens tickets, and hands
a case to a person with a booked callback and a handoff email. Every step is
recorded in Supabase, and a support console shows the team what happened.

- **Live page:** https://support-agent-gamma-two.vercel.app/
- **Support console:** https://support-agent-gamma-two.vercel.app/console
- **The brief:** [`PRD.md`](PRD.md). **The specification:** [`DESIGN.md`](DESIGN.md).
  **Every failure met during the build, with its fix:** [`FAILURES.md`](FAILURES.md).
  **Testing evidence:** [`docs/testing-evidence.md`](docs/testing-evidence.md).

## How it fits together

```
Browser (Vapi web call, or typing)
  -> Vapi (speech to text, text to speech)
  -> /api/vapi/chat/completions (custom LLM, streamed)   /api/chat (typing)
  -> turn runner: cheap checks, then one Claude Agent SDK query() per turn
  -> MCP server /api/mcp (8 tools)  -> Supabase Postgres (records, pgvector)
                                    -> Cal.com (callback booking)
                                    -> Resend (handoff and alert emails)
```

The agent never speaks unchecked: code checks every reply against that turn's
own tool log before it reaches the caller, and code, not the model, writes
reference numbers, booked times and dates (DESIGN §6).

## Run the MCP server in 60 seconds

No accounts, no `.env`. Memory mode seeds itself from `assets/seed-data/` and
keeps writes in memory, so a grader can try every tool locally.

```bash
git clone https://github.com/pick-cee/support-agent.git
cd support-agent
npm install
npm run mcp:inspect
```

This starts the MCP server over stdio in memory mode and opens MCP Inspector in
the browser. Press **Connect**, then **Tools**, then **List Tools**. Try:

| Tool | Try it with |
| --- | --- |
| `search_knowledge_base` | `query`: `international payment fees` |
| `lookup_customer` | `contact_name`: `Amara Okafor`, `company_name`: `LagosLedger` |
| `lookup_transaction` | `transaction_id`: `TXN-9001` |
| `lookup_payout` | `payout_id`: `PAY-7002` |
| `find_callback_slots` | `preferred_time_text`: `tomorrow at 2pm` |
| `create_support_ticket` | `summary`: `Invoice payment failed`, `category`: `payment` |
| `create_escalation` | `user_name`, `user_email`, `category`: `account`, `reason` |
| `log_conversation_event` | `event_type` (from the list), `summary` |

Without the browser, the same server from the command line:

```bash
npx -y @modelcontextprotocol/inspector --cli npx tsx scripts/mcp-stdio-memory.ts --method tools/list
npx -y @modelcontextprotocol/inspector --cli npx tsx scripts/mcp-stdio-memory.ts \
  --method tools/call --tool-name lookup_transaction --tool-arg transaction_id=TXN-9001
```

Memory mode uses keyword search instead of embeddings, and books no real
callbacks. Everything else is the same tool code the live agent uses.

**Other ways in:**

- `npm run mcp:stdio`: stdio against Supabase when `SUPABASE_DB_URL` is set
  (for Claude Desktop or any stdio client).
- `POST /api/mcp` on the deployment: Streamable HTTP, stateless, behind a
  bearer token (`MCP_AGENT_TOKEN`) with `Host` and `Origin` checks. It is the
  endpoint the support agent itself uses.

## The tools

All eight are in [`src/mcp/tools/`](src/mcp/tools/), over one core shared by
HTTP, stdio and memory mode. The six required by
[`assets/mcp-tool-requirements.md`](assets/mcp-tool-requirements.md) keep every
required field; two are added (`find_callback_slots`, `create_escalation`'s
booking).

- **A missing record is `found: false` with a reason**, never an error or an
  empty object.
- **Nothing returns contact details or lists customers**, and nothing the agent
  can reach writes to `customers`, `transactions` or `payouts`.
- **Identity takes two matching identifiers** on the same record; a miss and a
  partial match get the same answer.
- **After an escalation, lookups refuse** for that conversation, enforced in
  the server.
- **Every call is logged by the server** (`tool_calls`), including refusals,
  bad input and errors. Logging never depends on the model.
- **Idempotent writes** (unique keys), because Vapi retries and caller
  interruptions double-fire tools.

## Run the whole app

Needs Node 24, a Supabase project (pgvector, pg_cron, pg_net), and keys for
Anthropic, OpenAI (embeddings), Vapi, Cal.com and Resend. Every variable is
listed and explained in [`.env.example`](.env.example).

```bash
cp .env.example .env            # then fill it in
npm run db:migrate              # schema support_agent, with RLS and grants
npm run db:seed                 # the client's seed CSVs
npm run kb:ingest               # embeds assets/relaypay-knowledge-base.md
npm run cal:setup               # creates the callback event type, writes its id
npm run console:password        # console login; password in .console-password.txt
npm run db:schedule-outbox      # pg_cron drives retries and alert emails
npm run vapi:sync               # creates or updates the Vapi assistant
npm run dev
```

Open http://localhost:3000 for the customer page and /console for the team.

## Checks

| Command | What it does |
| --- | --- |
| `npm test` | Unit and contract tests (Vitest) |
| `npm run typecheck`, `npm run lint`, `npm run build` | The usual |
| `npm run db:check-grants` | Fails if any function is executable by `PUBLIC`, `anon` or `authenticated` |
| `npm run eval` | The test scenarios end to end through the real agent, side effects sandboxed |
| `npm run evidence` | Rebuilds [`docs/testing-evidence.md`](docs/testing-evidence.md) from the eval records |
| `npm run kb:calibrate` | Measures the retrieval threshold ([`evals/retrieval-calibration.md`](evals/retrieval-calibration.md)) |

## Layout

- `src/app/`: the customer page, the console, and the API routes
- `src/agent/`: the turn runner, system prompt, checks (gates) and speech formatting
- `src/mcp/`: the MCP tools and their repositories
- `src/lib/`: database, constants, jobs, alerts, email, time
- `supabase/migrations/`, `scripts/`, `evals/`, `vapi/`
- `assets/`: the client's brief, rules, knowledge base and seed data (unchanged)
