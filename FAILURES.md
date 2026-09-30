# Failures

Every real failure hit while building, written down as it happened: symptom,
root cause, fix. The testing evidence's "Notes or fix made" column comes from
here, never from memory afterwards.

## Phase 0

### 1. npm crashed while installing the dev dependencies

- **When:** 2026-09-29, installing Vitest 5 and friends.
- **Symptom:** `npm error Cannot read properties of null (reading 'edgesOut')`,
  with nothing installed.
- **Root cause:** a bug in npm 10.9.0's dependency resolver
  (`@npmcli/arborist`, `#loadPeerSet`). It crashes while walking the optional
  peer dependencies of Vite 8, which Vitest 5 depends on. The log's last
  placements before the stack trace were Vite's `rolldown` bindings.
- **Fix:** install with npm 11 through `npx -y npm@11 install ...`, which
  leaves the machine's global npm alone. npm 11 resolved the same tree in one
  pass.
- **Watch for:** npm 11 skips install scripts it hasn't been told to allow.
  `esbuild` and `unrs-resolver` were skipped. `tsx` and ESLint still run,
  because both packages ship their platform binaries as optional dependencies.

### 2. The database test suite reported a pass without running the database test

- **When:** 2026-09-29, adding `npm run test:db`.
- **Symptom:** `Test Files 4 passed, Tests 45 passed`. That is exactly the
  unit suite; the one database test was not among them.
- **Root cause:** `vitest.db.config.mts` used `mergeConfig` with the unit
  config. `mergeConfig` concatenates arrays, so the unit config's
  `exclude: ["**/*.db.test.ts"]` survived and excluded the only file the
  database config was meant to include.
- **Fix:** the database config is standalone. The run now shows
  `Test Files 1 passed, Tests 1 passed`.
- **Lesson:** read the count, not the colour. A green run with the wrong
  number of tests is a failure.

### 3. `next dev` appended its own block to CLAUDE.md

- **When:** 2026-09-29, the first `next dev`.
- **Symptom:** the dev server printed `Generated CLAUDE.md for AI agents`.
  CLAUDE.md had grown from 17,376 to 18,055 bytes. A
  `nextjs-agent-rules` block had been appended, and it contained an em dash.
- **Root cause:** Next.js 16.3 detects a coding agent and writes an
  agent-rules block into `CLAUDE.md` and `AGENTS.md` unless
  `agentRules: false` is set (`next/dist/server/config-shared.d.ts`). It
  appends; it did not overwrite. It re-adds the block on every `next dev`.
- **Fix:** `agentRules: false` in `next.config.ts`, and the block removed.
  CLAUDE.md is back to exactly 17,376 bytes. A restarted `next dev` left it
  alone and created no `AGENTS.md`.
- **Why it matters here:** CLAUDE.md is the coding agent's file and must never
  reach the support agent. It doesn't: the support agent runs with
  `settingSources: []` in an empty folder. But nothing should be editing it
  unannounced.

### 4. The agent called a payment 41 days late "within the normal expected window"

- **When:** 2026-09-29, the first real agent runs (`npm run phase0:probe`).
- **Symptom:** 3 of 3 answers about TXN-9001 said it was "processing within
  the normal expected window". The record's estimate was 19 August, 41 days
  before the run.
- **Root cause:** the seed CSV's `support_summary` was written when the record
  was, and the model repeated it as if it were current. It is the stale-date
  risk from DESIGN §2.6, arriving through the summary instead of the date.
- **Fix:** `lookup_transaction` returns `summary_outdated` when the estimate
  has passed. A gate cleanup removes any sentence sharing four consecutive
  words with that summary. Code speaks the stale-estimate sentence. The prompt
  says not to repeat the summary. The unit test uses the real output.

### 5. Each turn spent 6 to 7 seconds thinking

- **When:** 2026-09-29, tracing the probe (`--trace`).
- **Symptom:** agent API time of 7.4 to 11.9 s for a two-sentence answer.
  The trace showed `thinking_tokens` events for about 6 s in the second model
  call, with about 700 output tokens per turn.
- **Root cause:** Claude Code enables extended thinking by default, and
  DESIGN §6.1 did not set it.
- **Fix:** `thinking` set per model (`AGENT_REASONING`), disabled for Haiku.
  API time fell to 5.5 to 5.9 s, and the SDK estimate from about $0.009 to
  $0.007 per turn (local runs).

### 6. The deadline threw away an answer that had already arrived

- **When:** 2026-09-29, `npm run phase0:simulate`, "My payment is stuck."
- **Symptom:** the caller heard the "trouble reaching our systems" fallback.
  The turn record showed `result_ms` 13,448 and `error: deadline`.
- **Root cause:** after the result message the runner kept reading the
  stream until the Claude Code program exited. The 14 s deadline fired during
  that wait, and the aborted flag outranked the result in hand.
- **Fix:** stop reading at the result, and never let an abort discard a
  result. This also saves about 1.7 s on every turn.

### 7. The filler fired for the SDK's own structured-output call

- **When:** 2026-09-29, same turn as 6.
- **Symptom:** `first_tool_use_ms` was set on a turn that called no MCP tool.
- **Root cause:** the filler cue matched any `tool_use` block, and the SDK
  delivers structured output through a `StructuredOutput` tool call.
- **Fix:** only `mcp__relaypay__*` tool starts cue the filler.

### 8. The amount gate missed "2,400 US dollars"

- **When:** 2026-09-29, writing the gate tests.
- **Symptom:** a test that speaks "It's 2,400 US dollars." to an unverified
  caller passed the amount gate.
- **Root cause:** the pattern expected the currency word straight after the
  number, and "US" sits in between. That is the form `toSpeech` itself
  produces.
- **Fix:** the pattern allows a nationality word before the currency. The
  test now fails the gate as it should.

### 9. The agent invented a review, even with a prompt rule against it

- **When:** 2026-09-29, `npm run phase0:simulate`, three times.
- **Symptom:** "This needs review by a specialist" about TXN-9001, whose
  record has `requires_escalation: false`. It happened once as a
  `lookup_result` and twice as a `decline`, one of them after a prompt rule
  saying not to.
- **Root cause:** a claim without numbers, which the number gate cannot see
  (the limit DESIGN §19 names). The prompt alone did not hold for Haiku.
- **Fix:** the `review_claim` cleanup removes such a sentence unless the
  turn's evidence backs it. The next run asked a clarifying question instead.

## Phases 1 to 8

### 10. Stopping at the result still waited 1.5 seconds

- **When:** 2026-09-29, tracing Sonnet 5.5 turns.
- **Symptom:** `loop_exit_ms` was 1,400 to 1,500 ms after `result_ms` on
  every turn, after the fix in 6.
- **Root cause:** breaking out of `for await` calls the generator's
  `return()` and waits for it, and the SDK's `return()` waits for the Claude
  Code program to shut down.
- **Fix:** iterate by hand and call `return()` without awaiting it. The
  loop now exits in the same millisecond as the result.

### 11. Migration 0003 failed: `type "extensions.vector" does not exist`

- **When:** 2026-09-29, Phase 1.
- **Root cause:** on this Supabase project pgvector is installed in
  `public`, not `extensions`. The migration assumed the Supabase default.
- **Fix:** the migration references `public.vector`. The extension was not
  moved, because other projects may share the database. The whole migration
  had rolled back, so nothing was half applied.

### 12. Every HTTP contract test returned "Missing Host header"

- **When:** 2026-09-29, Phase 2.
- **Root cause:** a `Request` built in Node carries no Host header, and the
  server correctly refuses a request without one. A real HTTP request always
  has it. The harness was wrong, not the server.
- **Fix:** the test fetch adds the Host header a real client sends. A new
  test proves a Host-less request is still refused.

### 13. MCP Inspector's CLI swallowed the server's flags

- **When:** 2026-09-29, the Phase 2 exit check.
- **Symptom:** `tsx` started with no script and read stdin as JavaScript.
- **Root cause:** the Inspector parses `--conditions=react-server` and
  `--memory` in the server command as its own options.
- **Fix:** `scripts/mcp-stdio-memory.ts` selects memory mode itself, and the
  memory path needs no flags. The Inspector CLI then called
  `lookup_transaction` end to end.

### 14. The typecheck failed on a file Next generates

- **When:** 2026-09-29, with `next dev` running.
- **Symptom:** `.next/dev/types/validator.ts(17,62): error TS1434`.
- **Root cause:** the generated file had 13 blank lines where its
  `import type` line should be. It is Next's dev type generation, not our
  code; the production copy under `.next/types` was fine.
- **Fix:** deleting the file; Next regenerates it. If it recurs, delete
  `.next/dev` before `npm run typecheck`.

### 15. Knowledge search dropped the best match from the results

- **When:** 2026-09-29, the first Phase 4 eval.
- **Symptom:** for "Can RelayPay guarantee a payout arrival time?" the top
  four chunks did not include the FAQ "Can RelayPay Guarantee Payment
  Timelines?", though it was the best semantic match.
- **Root cause:** reciprocal-rank fusion let longer chunks with more keyword
  matches outrank the best semantic hit, while the threshold is applied to
  that hit's score.
- **Fix:** migration 0004 always returns the best semantic hit first.
  Recalibration gave the same threshold and the same precision and recall.

### 16. A turn never started, and the caller would have heard the fallback

- **When:** 2026-09-29, the first Phase 4 eval, `customer_lookup`.
- **Symptom:** `init_ms` null and `error: deadline` at 14 s; the abort then
  took 7 s more.
- **Root cause:** the Claude Code program did not finish starting (or
  connecting to MCP) within the deadline on this Windows machine. Two reruns
  took 11 and 13 s in total. Not reproduced.
- **Fix:** none yet beyond the deadline and fallback, which worked as
  designed. Start-up time on Vercel is a Phase 0 measurement still to make.

### 17. My eval checks failed a correct answer

- **When:** 2026-09-29, the first Phase 4 eval, `unsupported`.
- **Symptom:** the agent said "No, I can't promise that. ... If you have a
  payout reference, I can look it up for you." The checks wanted the word
  "guarantee" and the word "specialist".
- **Root cause:** the checks were narrower than the brief, which says
  "escalate if the customer needs account-specific help".
- **Fix:** the checks accept "promise", and a specialist or a check of the
  caller's own payout as account-specific help. Recorded in DESIGN §18.3.

### 18. The email gate read sentence ends as email addresses

- **When:** 2026-09-29, the first full eval, `escalation`.
- **Symptom:** "efua at accrastack dot example. Is that right?" was blocked
  as speaking `efua@accrastack.example.is`, and "2 PM Lagos time. Is that
  okay?" as an email. The collect-details fallback then asked for the
  caller's name again, so the conversation looped and never escalated.
- **Root cause:** the spoken-email pattern allowed a "." with spaces around
  it, which is how sentences end and how addresses never look.
- **Fix:** domain parts join only on the word "dot" or a "." with no space.
  The collect-details fallback asks the caller to repeat instead of starting
  over. Both have tests from these exact strings. The rerun escalated.

### 19. The right console password was refused

- **When:** 2026-09-29, Phase 7.
- **Root cause:** the hash was stored as `scrypt$salt$hash`, and Next loads
  `.env` with variable expansion: `$salt` and `$hash` became empty, so the
  server compared against a mangled hash. No warning anywhere.
- **Fix:** the format is `scrypt:salt:hash`, and a test asserts no `$`.

### 20. The Logging row failed conversations that correctly used no tools

- **When:** 2026-09-29, the first full eval.
- **Root cause:** my check demanded tool-call rows in every conversation.
  `single_identifier` and `clarify_cap` rightly asked a question instead.
- **Fix:** the Logging row now compares, tool by tool, what the SDK saw the
  tools return with what the MCP server logged, plus one turn row per
  scripted line and one retrieval log per search.

## The benchmark

### 21. The Bitcoin check passed a reply that never gave the answer

- **When:** 2026-09-29, the first benchmark (Sonnet run 1 scored 20/20).
- **Symptom:** run 2 failed `bitcoin`, and printing both runs showed the
  same reply shape: "I can't answer that confidently, because I have nothing
  approved on paying in Bitcoin. You can check the support options in the
  RelayPay dashboard." Run 1 had been marked PASS for it.
- **Root cause:** the check `/(not|n't).*(support|accept)/` matched "can't"
  in one clause and "support options" in the next. The earlier full eval's
  PASS on this scenario was the same false pass. The 20/20 was 19/20.
- **Fix:** the check must find the Feature Availability And Limitations chunk
  and say, within one sentence, that crypto or Bitcoin is not supported. The
  guarantee check in `unsupported` was tightened to one sentence for the same
  reason. The first benchmark's runs are superseded, and the evidence table
  and the console count only the latest three benchmark runs per model.
- **Lesson:** a check that can pass without the thing being said is not a
  check. Read one passing transcript per check, not just the failing ones.

### 22. The review cleanup cut the offer the prompt asks for, and left "Would you like that?"

- **When:** 2026-09-29, the same `bitcoin` failure.
- **Symptom:** the caller would have heard "I can't answer that confidently,
  because I don't have approved information on Bitcoin payments. Would you
  like that?" The gate log said "removed 1 sentence(s)" but not which.
- **Root cause:** the prompt tells the agent to "offer a specialist" when it
  declines, and the `review_claim` cleanup removed every sentence mentioning
  a specialist unless a record backed a review. An offer is not a claim. The
  question after it was left pointing at nothing. And cleanups recorded a
  count, though the code's own comment said they recorded what they removed.
- **Fix:** on a decline, a sentence that offers a specialist stays, unless it
  also claims something needs review. A bare follow-up question ("Would you
  like that?") goes with the sentence it pointed at. Each cleanup records the
  sentences it removed, in quotes. Tests use the eval's reply; the removed
  middle sentence is a reconstruction, because it was never recorded.
- **Verified:** the rerun spoke "...or I can arrange a callback from a
  specialist. Would you like a callback?"

### 23. A clarifying question with made-up references became a decline and broke the clarify cap

- **When:** 2026-09-29, Sonnet benchmark run 3, `clarify_cap`.
- **Symptom:** the three replies were clarify, decline ("I can't answer that
  confidently..."), clarify. The caller said "It's just not working" and was
  told the agent couldn't answer; then the cap never applied.
- **Root cause:** the second reply cited "TXN-9001" and "PAY-7002" as example
  references. The prompt's own style line used "like TXN-9001" as an example.
  The reference and number checks rightly blocked them, but the fallback for
  anything but a missing question mark was the decline, which reset the
  streak.
- **Fix:** a clarifying question that fails any check except the streak falls
  back to the fixed clarifying question, so the streak still counts it. The
  prompt's example is gone, and it says never to make up an example
  reference.

### 24. Haiku misread the identity rule and would not open a ticket without a reference

- **When:** 2026-09-29, the first Haiku benchmark run (void, see 26).
- **Symptom:** told "I am Amara from LagosLedger", Haiku asked for "your
  account email or customer ID". Told "I don't have the reference, please
  just log it", it asked for the company name instead of opening the ticket.
  It also searched "payout guarantee arrival time deadline 9am tomorrow" (top
  score 0.370, not found) where Sonnet searched with the question (0.694).
- **Root cause:** prompt wording. "Two identifiers: company name, first name
  or account email" reads as company plus one of the others. "Ask for the
  reference first if the caller has one" never says what to do without one.
  The threshold was calibrated on whole questions, and nothing said to search
  with one.
- **Fix:** "any two of these three... A first name and a company are enough.
  Never ask for a customer id." "Ask once for the reference; if the caller
  doesn't have it, open the ticket without it." Search with "the caller's
  question as a whole sentence, not keywords", in the prompt and in the
  tool's `query` description.

### 25. "Can I pay a supplier in Bitcoin?" is declined, though the knowledge base answers it

- **When:** 2026-09-29, known since calibration, confirmed by the benchmark.
- **Symptom:** the agent's search scored 0.387 against a threshold of 0.39,
  so the agent declines instead of saying cryptocurrency isn't supported.
- **Root cause:** the answer is one bullet ("Cryptocurrency payments") in a
  list under Feature Availability And Limitations, and the word "Bitcoin" is
  nowhere in the knowledge base. Calibration recorded this question as a miss:
  its best semantic hit was the wrong section ("Can I Create Invoices In
  Multiple Currencies?", 0.367).
- **Not fixed, only lucky.** Lowering the threshold would let the agent
  answer from the multi-currency section, which is worse than declining.
  Declining is the designed safe outcome. After the prompt began asking for
  the caller's question as a whole sentence (24), Sonnet searches "Can I pay a
  supplier in Bitcoin or other cryptocurrency?", which scores 0.390 and clears
  the threshold, so the scenario passes. "...Bitcoin or cryptocurrency?" scored
  0.387 and was declined. One word decides it. A lexical rescue (accept when
  full text matches the same chunk) is a change to DESIGN §8's threshold
  rule, so it is proposed, not built.

### 26. Stopping the benchmark left its second half running on mixed code

- **When:** 2026-09-29, stopping the first benchmark to fix 21 to 23.
- **Symptom:** after the stop, `npm run eval -- --model
  claude-haiku-4-5-20251001` was still running. It had started while I was
  editing the gates, so it had loaded some old files and some new.
- **Root cause:** stopping the background shell on Windows did not stop the
  `npm` and `tsx` processes it had started.
- **Fix:** found by listing node processes by command line, and stopped by
  process id. Its run (`a3d6a350`) is void and is not counted anywhere. It
  still surfaced the prompt problems in 24.

### 27. The review cleanup removed a clarifying question and left nothing

- **When:** 2026-09-29, Haiku benchmark run 2, `refund_spelled_email`.
- **Symptom:** the caller said "Friday at 10am." and heard the decline
  fallback. The gate log showed the only sentence removed: "...or are you
  telling me when you'd prefer a specialist to call you back?"
- **Root cause:** the cleanup removed any sentence mentioning a specialist
  unless a record backed a review. A question claims nothing.
- **Fix:** a question stays unless it also claims a review is needed. Tests
  use the real sentence.

### 28. Code's sentence came after the model's closing question

- **When:** same conversation.
- **Symptom:** "...What is your company name? The record showed an estimated
  arrival of 19 August, which has passed, and it's still processing."
- **Root cause:** code's sentences were always appended at the end. On a call
  the caller should hear the question last, to know it is their turn.
- **Fix:** code's sentences go before a closing question (`joinReply`).

### 29. A reply stopped by a check left no trace of what it said

- **When:** 2026-09-29, Sonnet benchmark, `ticket`.
- **Symptom:** the first reply failed the question check and the caller heard
  the fallback. The turn record said which check failed, but not what the
  model had written, so the cause could only be guessed.
- **Fix:** the first failed check of each attempt carries the rejected reply
  (`rejected`), stored with the turn's gate results and shown in the console,
  marked as never sent. It paid off at once: see 33.

### 30. The "promises nothing" check failed a correct refusal

- **When:** Haiku benchmark run 3, `unsupported`.
- **Symptom:** "No, RelayPay cannot guarantee a payout will arrive by a
  specific time like 9am tomorrow." failed "promises nothing".
- **Root cause:** `/will arrive by/` matched inside the refusal.
- **Fix:** the check reads sentence by sentence and ignores a negated one.

### 31. Eval conversations never ended, and their escalations filled the team's queue

- **When:** 2026-09-30, looking at the console before the redesign.
- **Symptom:** 225 eval conversations stuck "in progress", with no final
  status, summary or end time. All 22 "open escalations" on the Today page
  were eval data.
- **Root cause:** only Vapi's end-of-call report ended a conversation, and an
  eval has none. The console's queue and counts did not tell test runs from
  customers.
- **Fix:** one `finishConversation()` for every channel. The eval runner calls
  it at the end of each scenario, without follow-up tickets. The console's
  queue and Today numbers leave eval runs out. The 230 unfinished
  conversations (225 eval, 5 simulated Phase 0 calls) were closed once through
  the same function, with no tickets created.

### 32. Splitting into sentences silently dropped text

- **When:** 2026-09-30, the first typed escalation through the page.
- **Symptom:** "Thanks, Efua. example. What day and time would you like the
  callback?" and later "...2 PM Lagos time. example?"
- **Root cause:** `splitSentences` matched sentence by sentence with
  `[^.!?]+[.!?]+(?=\s|$)`. A full stop inside a word ("efua@accrastack.example")
  cannot match, and a global match skips what it cannot match, so the text
  before it was dropped with no error. On a call, "2.5 percent" would have
  lost the "2". Every cleanup uses this function.
- **Fix:** split only where sentence punctuation is followed by a space, so
  every character survives. Tests assert that joining the pieces gives back
  the input. The rerun read the email back whole.

### 33. The question check rejected a good reply over sentence order

- **When:** the same typed escalation, rerun.
- **Symptom:** "Yes, that's right." got "Sorry, could you type that once more
  for me?" The newly recorded rejected reply (29) showed why: "When would you
  like the specialist to call you? Please include your time zone or city if
  you can." It failed "must end with a question mark", the repair wrote the
  same shape, and the fallback followed: two model calls for nothing.
- **Fix:** a clarifying reply must ask a question, anywhere; code moves the
  last question to the end, and keeps it when a long reply is trimmed. Nothing
  is reworded. DESIGN §6.3 and §20.

### 34. The goodbye was said twice

- **When:** 2026-09-30, the first typed conversation.
- **Symptom:** "You're welcome. Thanks for contacting RelayPay. Thanks for
  contacting RelayPay support."
- **Root cause:** the model signed off, and code appended the fixed goodbye.
- **Fix:** on a closing reply, the model's own sign-off is removed
  (`goodbye_by_code`); code's goodbye is the one that ends a call.

### 35. The Bitcoin check could never match "doesn't"

- **When:** 2026-09-30, the final Sonnet benchmark: 20 of 21, three times.
- **Symptom:** all three `bitcoin` replies were right: "No, RelayPay doesn't
  support cryptocurrency payments, so you can't pay a supplier in Bitcoin."
  Each failed "says cryptocurrency is not supported".
- **Root cause:** the pattern had `\b(not|n't)\b`. There is no word boundary
  before "n't" inside "doesn't", so a contraction could never match. My
  tightening in 21 introduced it.
- **Fix:** `(\bnot\b|n't)`, checked against the three real replies and the
  decline from 21. The benchmark was run again rather than rescored.

### 36. After the deadline, a caller would have waited 7 more seconds in silence

- **When:** 2026-09-30, the benchmark rerun, run 2: `escalation` and
  `record_contradicts`.
- **Symptom:** three turns hit the 14 s deadline. On two, `init_ms` was null:
  the Claude Code program never finished starting. On the third it took
  11.7 s to start. Every one then took another 7 to 7.5 s to return
  (`loop_exit_ms` 21,155 to 21,503), and only then was the fallback spoken.
  On a call: the filler at 1.5 s, then about 20 s of silence.
- **Root cause, two parts:**
  - Starting a Claude Code program per turn sometimes stalls on this Windows
    machine (also FAILURES 16). Not fixed here. Whether Vercel stalls the
    same way is the Phase 0 measurement still owed; if it does, DESIGN §4's
    gate moves the turn runner to an always-on host with `prewarm()`.
  - After the abort, the runner waited for the program's stream to end. That
    part is ours.
- **Fix:** after an abort, `runAgent` waits at most `AGENT_ABORT_GRACE_MS`
  (1 s) for a result already on its way, then returns with the tool calls
  seen so far; the program stops on its own. An escalation that already
  happened is still announced by code. Nothing is lost in cost: an attempt
  aborted before its result has no usage to report. `run-agent.test.ts`
  drives a stream that never ends after the abort. The benchmark rerun was
  already running on the code before this fix; the fix changes only when the
  fallback is spoken, not what. Measured in the final benchmark: a stalled
  turn now ends at 15.0 to 15.1 s instead of 21.5 s.

### 37. The escalation's confirmation turn is the slowest, and it sits near the deadline

- **When:** 2026-09-30, the final benchmark, run 3, `escalation`.
- **Symptom:** "Yes, that works." hit the 14 s deadline and no escalation was
  created. The program took 5.1 s to start; the agent then called
  `find_callback_slots` again (1.5 s) before it could call
  `create_escalation`.
- **Root cause:** each turn is a fresh `query()` that sees the transcript but
  not earlier tool results. `create_escalation` books only with the slot's
  exact `start_utc`, which the agent heard about last turn but no longer has,
  so confirming always costs a second slot check and one more model round
  trip, on top of starting a program.
- **Not fixed; proposed.** Keep the slots offered in the last turn on the
  conversation (written by `find_callback_slots`, which already knows the
  conversation) and put them in the call state, so confirming books at once.
  That touches a migration, a tool and the prompt, so it needs its own
  benchmark. The larger cost, starting a program on every turn (1.9 to 5.1 s
  even when warm, locally), is DESIGN §4's decision, to be made on Vercel's
  numbers.

### 38. Typing would have failed on every message once deployed

- **When:** 2026-09-30, reading the production build's route list.
- **Symptom:** none yet, which is the danger. Every local test of the typed
  channel passed.
- **Root cause:** the Claude Code program is bundled only into routes listed
  in `outputFileTracingIncludes`, and only the Vapi route was listed.
  Locally `node_modules` is on disk, so `/api/chat` found the program; on
  Vercel it would not have, and every typed message would have got the
  fallback (the same failure as Week 5's first deployment).
- **Fix:** `/api/chat` is listed beside the Vapi route. After a rebuild, both
  agent routes trace the same SDK files. The Linux program itself is not
  installed on this Windows machine, so that it lands in the bundle can only
  be confirmed by a Vercel build: check the function size in the deployment,
  or send one typed message.

## Inferred answers and the redesign

### 39. A correct Bitcoin answer was thrown away because the search was not sure

- **When:** 2026-09-30, the eval after adding inferred answers, two runs out
  of two.
- **Symptom:** "Can I pay a supplier in Bitcoin?" got "I can't answer that
  confidently." The knowledge base says cryptocurrency payments are not
  supported.
- **Root cause:** the agent's search scored 0.388, just under the 0.39
  threshold, so the limitations section came back as related, not found.
  Sonnet read "Cryptocurrency payments" in it and, rightly, called its answer
  direct. The evidence gate accepts related sections only for an inferred
  answer, so it failed the reply, the repair did the same, and the decline
  fallback was spoken.
- **Fix:** code decides the grounding from the tool log
  (`effectiveGrounding()` in `gates.ts`): an answer citing a section that
  came back only as related is said as inferred, with the hedge, whatever the
  model called it. The search was not sure, so the caller is told, and the
  answer is not lost. Unit tests in `gates.test.ts` and `turn-runner.test.ts`
  use the real case.

### 40. The hedge was said twice

- **When:** 2026-09-30, typed questions against the dev server.
- **Symptom:** "...I can't say for certain whether an exception exists. I'm
  not completely certain about that, so please confirm it in your RelayPay
  dashboard..."
- **Root cause:** the prompt said "the system adds that you are not
  certain", and the model hedged anyway, in its own words.
- **Fix:** the prompt and the schema description now say not to. The rerun
  of the same question had one hedge. It is a prompt instruction, so it can
  still slip; code does not detect a model-written hedge.

### 41. The hedge came after the closing question

- **When:** 2026-09-30, the Bitcoin eval.
- **Symptom:** "...Would you like help with another way to pay your
  supplier? I'm not completely certain about that..." The caller would not
  know it was their turn.
- **Root cause:** the hedge was appended after `joinReply()`, which is what
  puts code's sentences before a closing question (FAILURES 28).
- **Fix:** the hedge goes through `joinReply()` with the other code
  sentences. `turn-runner.test.ts` has the real reply.

### 42. The voice orb's animation loop ran on an idle page

- **When:** 2026-09-30, writing up the page's motion.
- **Symptom:** none visible: `--level` sat at 0. But a frame loop ran 60
  times a second for as long as the page was open, whether or not a call was
  live.
- **Root cause:** the Vapi client is created when the page loads, and the
  effect started the loop whenever the client existed.
- **Fix:** the loop starts only while the caller or the assistant can be
  talking (`listening` or `speaking`). Not measured; read from the code.

### 43. Two eval scenarios passed while the agent never ran

- **When:** 2026-09-30, the knowledge-scenario reruns.
- **Symptom:** `support_hours` passed in two runs, and `payroll_related` in
  one, with an SDK cost of $0.0000: the agent had hit the 14 s deadline.
- **Root cause:** the system-trouble fallback declines and points to the
  RelayPay dashboard, which is exactly what those two scenarios check for.
  A scenario that tests a decline cannot tell the agent's decline from the
  system's.
- **Fix:** every scenario now also fails if any turn ended in an agent error
  (`noAgentError` in `evals/scenarios.ts`), and `payroll_related` requires
  the agent's own reply. Results stored before the change are not re-graded.
- **Why the deadline was hit:** the machine was running six Claude Code
  sessions besides the dev server, and the agent's program took 5.6 to 10 s
  to start (p50 1.4 s this morning). A question the first search misses now
  costs a second search (DESIGN §8), and with a 1.8 to 1.9 s start those
  turns ended at 10.3 to 11.1 s, inside the deadline; with a 7.6 to 10 s
  start they did not. Local numbers; Vercel's are still owed (DESIGN §4).

### 44. The dev server warned that Node modules were loaded in the Edge runtime

- **When:** 2026-09-30, reported by Akin from `npm run dev`, right after the
  local outbox worker was added.
- **Symptom:** "A Node.js module is loaded ('node:fs' ...) which is not
  supported in the Edge Runtime", with the import trace `Edge Instrumentation:
  template.ts < handoff-email.ts < outbox.ts < outbox-worker.ts <
  instrumentation.ts`, repeated on every compile.
- **Root cause:** Next builds `instrumentation.ts` for Edge as well as Node.
  `register()` returned early when not on Node, which stops the code running
  on Edge but not the bundler following its imports: the dynamic import in
  `startLocalOutbox()` pulled the outbox, the email template and `node:fs`
  into the Edge build.
- **Fix:** the documented pattern. Everything Node-only moved to
  `src/instrumentation-node.ts`, imported only inside
  `if (process.env.NEXT_RUNTIME === "nodejs")`, which the bundler resolves at
  build time. `npm run build` shows no Edge warning, and the Edge
  instrumentation chunk contains none of the outbox, email or migration code.
  A fresh `next dev` then started with no Edge warning, and the local outbox
  worker running.

## Going live

### 45. A configuration check emailed the team a false critical alert

- **When:** 2026-09-30, checking the live site's Vapi token before creating
  the assistant.
- **Symptom:** a "Voice call data not understood" critical alert, emailed to
  the notification list at 16:49 UTC.
- **Root cause:** to tell a wrong token (401) from a right one, I sent the
  live custom-LLM endpoint a body with no messages. The right token got past
  authentication, and the unreadable body raised the critical alert the
  endpoint raises for a misconfigured assistant, exactly as designed.
- **Fix:** the alert was deleted; the check itself was correct. Later checks
  used valid, harmless requests (a status update with no call). Lesson: probe
  a live system only with requests it treats as normal.
