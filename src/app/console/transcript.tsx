import Image from "next/image";

import { CONSOLE, PAGE } from "@/app/copy";
import { ms } from "@/lib/console/format";
import type { TurnDetail } from "@/lib/console/queries";

import styles from "./console.module.css";
import { describeTools } from "./describe";

// A conversation as the team reads it (DESIGN §14), laid out like the
// customer saw it: their words on the right, the assistant's on the left.
// One quiet line under each reply; what the assistant checked stays folded
// until someone opens it. A reply a safety check held back is shown there,
// marked as never sent.

/** "Frequently Asked Questions > How Does RelayPay Charge Fees?" reads as its question. */
function heading(sectionPath: string): string {
  return sectionPath.split(" > ").at(-1) ?? sectionPath;
}

/** The words a cleanup removed, from the check's record ("removed 1 sentence(s) ...: "The record ..."). */
function removedText(detail: string | undefined): string | null {
  const match = /:\s*(".*")\s*$/.exec(detail ?? "");
  return match ? match[1]! : null;
}

export function Transcript({ turns }: { turns: TurnDetail[] }) {
  const c = CONSOLE.conversation;
  return (
    <ol className={styles.transcript}>
      {turns.map((turn) => {
        const failed = turn.gate_results.filter((gate) => !gate.passed);
        const cleaned = turn.gate_results.filter((gate) => gate.cleanup);
        const actions = describeTools(turn.tools.filter((tool) => tool.tool_name !== "search_knowledge_base"));
        const hasDetails = actions.length > 0 || turn.retrievals.length > 0 || failed.length > 0 || cleaned.length > 0;
        const tags = [
          turn.grounding === "inferred" ? { text: c.inferred, tone: "info", title: c.inferredHint } : null,
          turn.reply_source && turn.reply_source !== "agent" ? { text: c.sources[turn.reply_source] ?? turn.reply_source, tone: turn.reply_source === "fallback" ? "bad" : "neutral", title: undefined } : null,
          turn.repaired ? { text: c.rewritten, tone: "warn", title: undefined } : null,
          turn.status === "error" ? { text: c.failedStatus, tone: "bad", title: undefined } : null,
          turn.status === "interrupted" ? { text: c.interrupted, tone: "neutral", title: undefined } : null,
        ].filter((tag) => tag !== null);
        return (
          <li key={turn.id} className={styles.exchange} aria-label={c.turnLabel(turn.turn_index + 1)}>
            <div className={styles.customerLine}>
              <span className="visually-hidden">{c.caller}: </span>
              <p className={styles.customerWords}>{turn.user_text || c.silence}</p>
            </div>

            <div className={styles.assistantLine}>
              <span className={styles.saidMark} aria-hidden="true">
                <Image src="/icon.png" alt={PAGE.logoAlt} width={16} height={16} />
              </span>
              <div className={styles.assistantBody}>
                <span className="visually-hidden">{c.agent}: </span>
                <p className={styles.assistantWords}>{turn.spoken_text}</p>
                {turn.status === "error" && <p className={styles.turnNote}>{c.failedReply}</p>}
                <p className={styles.turnMeta}>
                  {turn.answer_type && <span>{c.replyTypes[turn.answer_type] ?? turn.answer_type}</span>}
                  {turn.total_ms !== null && <span>{c.took(ms(turn.total_ms))}</span>}
                  {tags.map((tag) => (
                    <span key={tag.text} className={styles.tag} data-tone={tag.tone} title={tag.title}>
                      {tag.text}
                    </span>
                  ))}
                </p>

                {hasDetails && (
                  <details className={styles.checked}>
                    <summary>{c.behind}</summary>
                    <ul className={styles.checkedList}>
                      {actions.map((action, index) => (
                        <li key={`a${index}`}>
                          <span className={styles.checkedKind}>{c.tools}</span>
                          {action.label}, {action.result}
                          {action.reference && <span className={styles.ref}>{action.reference}</span>}
                        </li>
                      ))}
                      {turn.retrievals.map((retrieval, index) => (
                        <li key={`r${index}`}>
                          <span className={styles.checkedKind}>{c.retrieval}</span>
                          &quot;{retrieval.query}&quot;: {retrieval.found ? c.found : retrieval.used_sections.length ? c.related : c.notFoundResult}
                          {retrieval.used_sections.length > 0 && <span className={styles.detailNote}>{c.used(retrieval.used_sections.map(heading).join("; "))}</span>}
                        </li>
                      ))}
                      {failed.map((gate, index) => (
                        <li key={`f${index}`}>
                          <span className={styles.checkedKind}>{c.gates}</span>
                          {c.checks[gate.gate] ?? gate.gate}
                          {gate.rejected && (
                            <p className={styles.rejected}>
                              <strong>{c.stopped}:</strong> {gate.rejected}
                            </p>
                          )}
                        </li>
                      ))}
                      {cleaned.map((gate, index) => {
                        const removed = removedText(gate.detail);
                        return (
                          <li key={`c${index}`}>
                            <span className={styles.checkedKind}>{c.gates}</span>
                            {c.checks[gate.gate] ?? gate.gate}
                            {removed && <span className={styles.detailNote}>{c.removed(removed)}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
