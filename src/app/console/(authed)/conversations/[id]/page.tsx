import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { ms, usd, when } from "@/lib/console/format";
import { conversationDetail } from "@/lib/console/queries";

import styles from "../../../console.module.css";
import { Badge, channelLabel, Empty, outcomeLabel, outcomeTone, statusTone, words } from "../../../parts";

// A timeline of turns (DESIGN §14): what the customer said, what the assistant
// said, the answer type and checks, with tool calls, retrievals, latency and
// cost in line. A reply the checks stopped is shown too, marked as never sent.
export default async function ConversationDetail({ params }: { params: Promise<{ id: string }> }) {
  const detail = await conversationDetail((await params).id);
  if (!detail) {
    return (
      <>
        <Link href="/console/conversations" className={styles.back}>
          {CONSOLE.conversation.back}
        </Link>
        <Empty>{CONSOLE.conversation.notFound}</Empty>
      </>
    );
  }
  const { conversation, turns, events, tickets, escalations } = detail;
  const c = CONSOLE.conversation;
  const m = c.meta;
  return (
    <>
      <Link href="/console/conversations" className={styles.back}>
        {CONSOLE.conversation.back}
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>
            {channelLabel(conversation.channel)}, {when(conversation.created_at)}
          </h1>
        </div>
        <Badge tone={outcomeTone(conversation.final_status)}>{outcomeLabel(conversation.final_status)}</Badge>
      </div>

      <section className={styles.summaryCard}>
        {conversation.summary && <p className={styles.summaryText}>{conversation.summary}</p>}
        <dl className={styles.meta}>
          <div>
            <dt>{m.turns}</dt>
            <dd>{conversation.turn_count}</dd>
          </div>
          <div>
            <dt>{m.verified}</dt>
            <dd>{conversation.verified_customer_id ?? m.notVerified}</dd>
          </div>
          <div>
            <dt>{m.agentSpend}</dt>
            <dd>{usd(conversation.agent_cost_estimate_usd)}</dd>
          </div>
          <div>
            <dt>{m.vapiCost}</dt>
            <dd>{conversation.vapi_cost_usd ? usd(conversation.vapi_cost_usd) : m.notReported}</dd>
          </div>
          <div>
            <dt>{m.ended}</dt>
            <dd>{conversation.ended_reason ? words(conversation.ended_reason) : m.notReported}</dd>
          </div>
        </dl>
      </section>

      {escalations.length > 0 && (
        <>
          <h2 className={styles.sectionHeading}>{CONSOLE.conversation.escalations}</h2>
          <ul className={styles.cases}>
            {escalations.map((item) => (
              <li key={item.escalation_ref} className={styles.case}>
                <p className={styles.caseHead}>
                  {item.escalation_ref}
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  <Badge>{words(item.category)}</Badge>
                </p>
                {c.escalationLine(item.reason, words(item.booking_status), item.appointment_time ? when(item.appointment_time) : null, words(item.notification_status))}
              </li>
            ))}
          </ul>
        </>
      )}
      {tickets.length > 0 && (
        <>
          <h2 className={styles.sectionHeading}>{CONSOLE.conversation.tickets}</h2>
          <ul className={styles.cases}>
            {tickets.map((item) => (
              <li key={item.ticket_ref} className={styles.case}>
                <p className={styles.caseHead}>
                  {item.ticket_ref}
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  <Badge>{words(item.category)}</Badge>
                  <Badge tone={item.priority === "urgent" || item.priority === "high" ? "warn" : "neutral"}>{item.priority}</Badge>
                </p>
                {item.summary}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className={styles.sectionHeading}>{CONSOLE.conversation.turns}</h2>
      <div className={styles.timeline}>
        {turns.map((turn) => {
          const failed = turn.gate_results.filter((gate) => !gate.passed);
          const cleaned = turn.gate_results.filter((gate) => gate.cleanup);
          return (
            <section key={turn.id} className={styles.turn} aria-label={CONSOLE.conversation.turnLabel(turn.turn_index + 1)}>
              <div className={styles.turnHead}>
                <span className={styles.turnTitle}>{CONSOLE.conversation.turnLabel(turn.turn_index + 1)}</span>
                <span>{when(turn.created_at)}</span>
                {turn.answer_type && <Badge tone="brand">{words(turn.answer_type)}</Badge>}
                {turn.reply_source && turn.reply_source !== "agent" && <Badge tone={turn.reply_source === "fallback" ? "bad" : "neutral"}>{words(turn.reply_source)}</Badge>}
                {turn.repaired && <Badge tone="warn">{c.repaired}</Badge>}
                {turn.status !== "ok" && <Badge tone="bad">{turn.status}</Badge>}
                <span>
                  {c.firstText} {ms(turn.ttft_ms)} · {c.final} {ms(turn.total_ms)}
                  {turn.cost_estimate_usd ? ` · ${usd(turn.cost_estimate_usd)} ${c.estimate}` : ""}
                  {turn.model ? ` · ${turn.model}` : ""}
                </span>
              </div>
              <div className={styles.turnBody}>
                <p className={styles.said} data-role="customer">
                  <span className={styles.saidLabel}>{CONSOLE.conversation.caller}</span>
                  {turn.user_text || c.silence}
                </p>
                <p className={styles.said} data-role="assistant">
                  <span className={styles.saidLabel}>{CONSOLE.conversation.agent}</span>
                  {turn.spoken_text}
                </p>
                {turn.confidence_note && <p className={styles.confidence}>{turn.confidence_note}</p>}
                {turn.status !== "ok" && turn.error && <p className={styles.confidence}>{turn.error}</p>}

                {(turn.tools.length > 0 || turn.retrievals.length > 0 || failed.length > 0 || cleaned.length > 0) && (
                  <div className={styles.details}>
                    {turn.tools.length > 0 && (
                      <div>
                        <p className={styles.detailLabel}>{CONSOLE.conversation.tools}</p>
                        <ul className={styles.list}>
                          {turn.tools.map((tool, index) => (
                            <li key={index}>
                              <strong>{tool.tool_name}</strong> <Badge tone={tool.status === "ok" ? "good" : tool.status === "error" ? "bad" : "warn"}>{words(tool.status)}</Badge> {tool.result_summary}{" "}
                              <span className={styles.muted}>({tool.duration_ms} ms)</span>
                              {tool.error_message ? `: ${tool.error_message}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {turn.retrievals.length > 0 && (
                      <div>
                        <p className={styles.detailLabel}>{CONSOLE.conversation.retrieval}</p>
                        <ul className={styles.list}>
                          {turn.retrievals.map((retrieval, index) => (
                            <li key={index}>
                              &quot;{retrieval.query}&quot; <Badge tone={retrieval.found ? "good" : "warn"}>{retrieval.found ? c.found : c.notFoundResult}</Badge>
                              {retrieval.top_score !== null ? c.topScore(retrieval.top_score.toFixed(3)) : ""}
                              {retrieval.degraded ? c.fullTextOnly : ""}
                              {retrieval.chunk_ids_used.length ? c.cited(retrieval.chunk_ids_used.join(", ")) : c.citedNone}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(failed.length > 0 || cleaned.length > 0) && (
                      <div>
                        <p className={styles.detailLabel}>{CONSOLE.conversation.gates}</p>
                        <ul className={styles.list}>
                          {failed.map((gate, index) => (
                            <li key={`f${index}`}>
                              <Badge tone="bad">{words(gate.gate)}</Badge> {gate.detail}
                              {gate.rejected && (
                                <p className={styles.rejected}>
                                  <strong>{CONSOLE.conversation.stopped}:</strong> {gate.rejected}
                                </p>
                              )}
                            </li>
                          ))}
                          {cleaned.map((gate, index) => (
                            <li key={`c${index}`}>
                              <Badge tone="info">{words(gate.gate)}</Badge> {gate.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {events.length > 0 && (
        <>
          <h2 className={styles.sectionHeading}>{CONSOLE.conversation.events}</h2>
          <ul className={styles.list}>
            {events.map((event, index) => (
              <li key={index}>
                <span className={styles.muted}>{when(event.created_at)}</span> · {event.source} · <strong>{words(event.event_type)}</strong>: {event.summary}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
