import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { ArrowRightIcon, ChatIcon } from "@/app/icons";
import { ms, usd, when } from "@/lib/console/format";
import { conversationDetail } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { describeTools } from "../../describe";
import { channelLabel, endingLabel, outcomeLabel, outcomeTone, StatusText } from "../../parts";
import { Transcript } from "../../transcript";
import { InboxPlaceholder, queryString, type InboxQuery } from "./inbox";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

// One conversation beside the list (DESIGN §14): a short summary first, then
// the conversation itself, read top to bottom.
export async function ConversationArticle({ id, query }: { id: string; query: InboxQuery }) {
  const detail = await conversationDetail(id);
  const c = CONSOLE.conversation;
  if (!detail) return <InboxPlaceholder icon={<ChatIcon size={22} />} title={c.notFound} text={CONSOLE.conversations.select} />;

  const { conversation, turns, tickets, escalations } = detail;
  const actions = describeTools(turns.flatMap((turn) => turn.tools));
  const firstReply = median(turns.map((turn) => turn.ttft_ms).filter((value): value is number => value !== null));
  const facts = [
    { label: c.customer, value: conversation.verified_customer_id ? c.verifiedAs(conversation.verified_customer_id) : c.notVerified },
    { label: c.replies, value: String(conversation.turn_count) },
    { label: c.firstReply, value: ms(firstReply) },
    { label: c.agentSpend, value: usd(conversation.agent_cost_estimate_usd) },
    ...(conversation.vapi_cost_usd ? [{ label: c.vapiCost, value: usd(conversation.vapi_cost_usd) }] : []),
    ...(conversation.ended_reason ? [{ label: c.endedBy, value: endingLabel(conversation.ended_reason) }] : []),
  ];

  return (
    <article className={styles.detail}>
      <Link href={`/console/conversations${queryString(query)}`} className={styles.detailBack}>
        <ArrowRightIcon size={14} /> {c.back}
      </Link>

      <header className={styles.detailHeader}>
        <p className={styles.detailEyebrow}>
          {channelLabel(conversation.channel)} · {when(conversation.created_at)}
        </p>
        <h2 className={styles.detailTitle}>{turns[0]?.user_text || CONSOLE.conversations.silent}</h2>
      </header>

      <section className={styles.summaryCard} aria-label={c.whatHappened}>
        <div className={styles.summaryTop}>
          <StatusText tone={outcomeTone(conversation.final_status)}>{outcomeLabel(conversation.final_status)}</StatusText>
          {actions.length > 0 && (
            <ol className={styles.flow}>
              {actions.map((action, index) => (
                <li key={index} data-tone={action.tone}>
                  {action.label}
                  {action.count > 1 && <span className={styles.flowCount}>{c.times(action.count)}</span>}
                  {action.reference && <span className={styles.ref}>{action.reference}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
        <dl className={styles.summaryFacts}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
        {escalations.map((item) => (
          <Link key={item.id} href={`/console/escalations/${item.id}`} className={styles.summaryLink}>
            {c.openEscalation} <span className={styles.ref}>{item.escalation_ref}</span> <ArrowRightIcon size={14} />
          </Link>
        ))}
        {tickets.map((item) => (
          <p key={item.ticket_ref} className={styles.summaryNote}>
            <span className={styles.ref}>{item.ticket_ref}</span> {item.summary}
          </p>
        ))}
      </section>

      <h3 className={styles.transcriptHeading}>{c.turns}</h3>
      <Transcript turns={turns} />
    </article>
  );
}
