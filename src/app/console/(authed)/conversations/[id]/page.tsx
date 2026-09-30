import Image from "next/image";
import Link from "next/link";

import { CONSOLE, PAGE } from "@/app/copy";
import { ArrowRightIcon, ChatIcon } from "@/app/icons";
import { ms, usd, when } from "@/lib/console/format";
import { conversationDetail } from "@/lib/console/queries";

import styles from "../../../console.module.css";
import { Avatar, Badge, Card, channelLabel, Empty, outcomeLabel, outcomeTone, statusTone, words } from "../../../parts";

// A transcript of turns (DESIGN §14): what the customer said, what the
// assistant said, with the tool calls, knowledge searched and checks folded
// under each reply. A reply the checks stopped is shown too, marked never sent.
export default async function ConversationDetail({ params }: { params: Promise<{ id: string }> }) {
  const detail = await conversationDetail((await params).id);
  const c = CONSOLE.conversation;
  if (!detail) {
    return (
      <>
        <Link href="/console/conversations" className={styles.back}>
          <ArrowRightIcon size={14} /> {c.back}
        </Link>
        <Empty icon={<ChatIcon size={20} />}>{c.notFound}</Empty>
      </>
    );
  }
  const { conversation, turns, events, tickets, escalations } = detail;
  const m = c.meta;
  return (
    <>
      <Link href="/console/conversations" className={styles.back}>
        <ArrowRightIcon size={14} /> {c.back}
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{channelLabel(conversation.channel)}</p>
          <h1 className={styles.heading}>{when(conversation.created_at)}</h1>
        </div>
        <Badge tone={outcomeTone(conversation.final_status)} dot>
          {outcomeLabel(conversation.final_status)}
        </Badge>
      </div>

      <Card>
        {conversation.summary && <p className={styles.summaryText}>{conversation.summary}</p>}
        <dl className={styles.facts}>
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
      </Card>

      {(escalations.length > 0 || tickets.length > 0) && (
        <div className={styles.twoColumn}>
          {escalations.length > 0 && (
            <Card title={c.escalations}>
              <ul className={styles.cases}>
                {escalations.map((item) => (
                  <li key={item.escalation_ref} className={styles.case}>
                    <p className={styles.caseHead}>
                      {item.escalation_ref}
                      <Badge tone={statusTone(item.status)} dot>
                        {CONSOLE.escalations.statuses[item.status] ?? item.status}
                      </Badge>
                      <Badge>{words(item.category)}</Badge>
                    </p>
                    {c.escalationLine(item.reason, words(item.booking_status), item.appointment_time ? when(item.appointment_time) : null, words(item.notification_status))}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {tickets.length > 0 && (
            <Card title={c.tickets}>
              <ul className={styles.cases}>
                {tickets.map((item) => (
                  <li key={item.ticket_ref} className={styles.case}>
                    <p className={styles.caseHead}>
                      {item.ticket_ref}
                      <Badge tone={statusTone(item.status)} dot>
                        {item.status}
                      </Badge>
                      <Badge>{words(item.category)}</Badge>
                      <Badge tone={item.priority === "urgent" || item.priority === "high" ? "warn" : "neutral"}>{item.priority}</Badge>
                    </p>
                    {item.summary}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <section>
        <h2 className={styles.sectionHeading}>{c.turns}</h2>
        <div className={styles.timeline}>
          {turns.map((turn) => {
            const failed = turn.gate_results.filter((gate) => !gate.passed);
            const cleaned = turn.gate_results.filter((gate) => gate.cleanup);
            const hasDetails = turn.tools.length > 0 || turn.retrievals.length > 0 || failed.length > 0 || cleaned.length > 0;
            return (
              <article key={turn.id} className={styles.turn} aria-label={c.turnLabel(turn.turn_index + 1)}>
                <div className={styles.turnHead}>
                  <span className={styles.turnTitle}>{c.turnLabel(turn.turn_index + 1)}</span>
                  {turn.answer_type && <Badge tone="brand">{words(turn.answer_type)}</Badge>}
                  {turn.grounding === "inferred" && <Badge tone="info">{c.inferred}</Badge>}
                  {turn.reply_source && turn.reply_source !== "agent" && <Badge tone={turn.reply_source === "fallback" ? "bad" : "neutral"}>{words(turn.reply_source)}</Badge>}
                  {turn.repaired && <Badge tone="warn">{c.repaired}</Badge>}
                  {turn.status !== "ok" && <Badge tone="bad">{turn.status}</Badge>}
                  <span className={styles.turnTimes}>
                    {c.firstText} {ms(turn.ttft_ms)} · {c.final} {ms(turn.total_ms)}
                    {turn.cost_estimate_usd ? ` · ${usd(turn.cost_estimate_usd)} ${c.estimate}` : ""}
                  </span>
                </div>
                <div className={styles.turnBody}>
                  <div className={styles.said} data-role="customer">
                    <Avatar name={c.caller} tone="muted" />
                    <div className={styles.saidText}>
                      <span className={styles.saidLabel}>{c.caller}</span>
                      <p className={styles.saidWords}>{turn.user_text || c.silence}</p>
                    </div>
                  </div>
                  <div className={styles.said} data-role="assistant">
                    <span className={styles.avatar} data-tone="accent" aria-hidden="true">
                      <Image src="/icon.png" alt={PAGE.logoAlt} width={20} height={20} />
                    </span>
                    <div className={styles.saidText}>
                      <span className={styles.saidLabel}>{c.agent}</span>
                      <p className={styles.saidWords}>{turn.spoken_text}</p>
                      {turn.confidence_note && <p className={styles.confidence}>{turn.confidence_note}</p>}
                      {turn.status !== "ok" && turn.error && <p className={styles.confidence}>{turn.error}</p>}
                    </div>
                  </div>

                  {hasDetails && (
                    <details className={styles.details} open={failed.length > 0}>
                      <summary>{c.behind}</summary>
                      <div className={styles.detailGrid}>
                        {turn.tools.length > 0 && (
                          <div>
                            <p className={styles.detailLabel}>{c.tools}</p>
                            <ul className={styles.detailList}>
                              {turn.tools.map((tool, index) => (
                                <li key={index}>
                                  <strong>{tool.tool_name}</strong>{" "}
                                  <Badge tone={tool.status === "ok" ? "good" : tool.status === "error" ? "bad" : "warn"}>{words(tool.status)}</Badge> {tool.result_summary}{" "}
                                  <span className={styles.muted}>({tool.duration_ms} ms)</span>
                                  {tool.error_message ? `: ${tool.error_message}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {turn.retrievals.length > 0 && (
                          <div>
                            <p className={styles.detailLabel}>{c.retrieval}</p>
                            <ul className={styles.detailList}>
                              {turn.retrievals.map((retrieval, index) => (
                                <li key={index}>
                                  &quot;{retrieval.query}&quot;{" "}
                                  <Badge tone={retrieval.found ? "good" : retrieval.source_titles.length ? "info" : "warn"}>
                                    {retrieval.found ? c.found : retrieval.source_titles.length ? c.related : c.notFoundResult}
                                  </Badge>
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
                            <p className={styles.detailLabel}>{c.gates}</p>
                            <ul className={styles.detailList}>
                              {failed.map((gate, index) => (
                                <li key={`f${index}`}>
                                  <Badge tone="bad">{words(gate.gate)}</Badge> {gate.detail}
                                  {gate.rejected && (
                                    <p className={styles.rejected}>
                                      <strong>{c.stopped}:</strong> {gate.rejected}
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
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {events.length > 0 && (
        <Card title={c.events}>
          <ul className={styles.detailList}>
            {events.map((event, index) => (
              <li key={index}>
                <span className={styles.muted}>{when(event.created_at)}</span> · {event.source} · <strong>{words(event.event_type)}</strong>: {event.summary}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
