import Link from "next/link";

import { categoryLabel, CONSOLE } from "@/app/copy";
import { ArrowRightIcon, FlagIcon } from "@/app/icons";
import { age, when, whenWithZone } from "@/lib/console/format";
import { conversationDetail, escalationDetail } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Avatar, stateLabel, StatusText, statusTone } from "../../parts";
import { Transcript } from "../../transcript";
import { StatusSelect } from "../../ui";
import { InboxPlaceholder } from "../conversations/inbox";

// One escalation beside the queue (DESIGN §14): who to call, when and why at
// the top, then what was already said, so the customer never has to repeat it.
export async function EscalationArticle({ id, showAll }: { id: string; showAll: boolean }) {
  const escalation = await escalationDetail(id);
  const e = CONSOLE.escalations;
  if (!escalation) return <InboxPlaceholder icon={<FlagIcon size={22} />} title={e.notFound} text={e.select} />;

  const conversation = escalation.conversation_id ? await conversationDetail(escalation.conversation_id) : null;

  return (
    <article className={styles.detail}>
      <Link href={`/console/escalations${showAll ? "?all=1" : ""}`} className={styles.detailBack}>
        <ArrowRightIcon size={14} /> {e.back}
      </Link>

      <header className={styles.detailHeader} data-layout="person">
        <div className={styles.detailPerson}>
          <Avatar name={escalation.user_name} tone="accent" />
          <div>
            <p className={styles.detailEyebrow}>
              {escalation.escalation_ref} · {categoryLabel(escalation.category)} · {e.age(age(escalation.created_at))}
            </p>
            <h2 className={styles.detailTitle}>
              {escalation.user_name}
              {escalation.company_name && <span className={styles.detailTitleSub}>{escalation.company_name}</span>}
            </h2>
          </div>
        </div>
        <label className={styles.detailActions}>
          <span className={styles.detailActionLabel}>{e.status}</span>
          <StatusSelect id={escalation.id} reference={escalation.escalation_ref} initial={escalation.status} />
        </label>
      </header>

      <section className={styles.summaryCard} aria-label={e.why}>
        <p className={styles.summaryLabel}>{e.why}</p>
        <p className={styles.reason}>{escalation.reason}</p>
        <dl className={styles.summaryFacts}>
          <div>
            <dt>{e.callback}</dt>
            <dd>{escalation.appointment_time ? whenWithZone(escalation.appointment_time, escalation.timezone) : e.notBooked}</dd>
            <dd className={styles.summaryFactNote}>
              <StatusText tone={statusTone(escalation.booking_status)}>{stateLabel(escalation.booking_status)}</StatusText>
            </dd>
          </div>
          <div>
            <dt>{e.contact}</dt>
            <dd>
              {/* A long address wraps after the @, never mid-word. */}
              <a href={`mailto:${escalation.user_email}`}>
                {escalation.user_email.split("@")[0]}
                {escalation.user_email.includes("@") && (
                  <>
                    @<wbr />
                    {escalation.user_email.split("@").slice(1).join("@")}
                  </>
                )}
              </a>
            </dd>
            <dd className={styles.summaryFactNote}>
              {escalation.customer_id ? e.verified(escalation.customer_id) : e.unverified}
              {escalation.plan ? ` · ${escalation.plan}` : ""}
            </dd>
          </div>
          <div>
            <dt>{e.handoff}</dt>
            <dd>
              <StatusText tone={statusTone(escalation.notification_status)}>{stateLabel(escalation.notification_status)}</StatusText>
            </dd>
            <dd className={styles.summaryFactNote}>{e.ticket} {escalation.ticket_ref}</dd>
          </div>
        </dl>
        {escalation.preferred_time_text && <p className={styles.summaryNote}>{e.asked(escalation.preferred_time_text)}</p>}
        {escalation.booking_error && <p className={styles.panelError}>{e.bookingFailed(escalation.booking_error)}</p>}
        {escalation.notification_error && <p className={styles.panelError}>{escalation.notification_error}</p>}
      </section>

      {conversation && (
        <>
          <div className={styles.transcriptHeadingRow}>
            <h3 className={styles.transcriptHeading}>{e.transcript}</h3>
            <Link href={`/console/conversations/${conversation.conversation.id}`} className={styles.sectionLink}>
              {e.openConversation} <ArrowRightIcon size={14} />
            </Link>
          </div>
          <Transcript turns={conversation.turns} />
        </>
      )}

      {escalation.history.length > 0 && (
        <section className={styles.history}>
          <h3 className={styles.transcriptHeading}>{e.history}</h3>
          <ul>
            {escalation.history.map((change, index) => (
              <li key={index}>
                <span>{e.historyLine(e.statuses[change.from_status] ?? change.from_status, e.statuses[change.to_status] ?? change.to_status)}</span>
                <time dateTime={change.created_at}>{when(change.created_at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
