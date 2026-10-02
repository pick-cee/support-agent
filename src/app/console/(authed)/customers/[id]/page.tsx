import Link from "next/link";

import { categoryLabel, CONSOLE } from "@/app/copy";
import { ArrowRightIcon, UserIcon } from "@/app/icons";
import { customerHistory } from "@/lib/console/customers";
import { listTime, money, recordDate, whenWithZone } from "@/lib/console/format";

import styles from "../../../console.module.css";
import { CustomerFacts, recordTone, sentenceCase } from "../../../customer-card";
import { Avatar, Card, channelLabel, Empty, outcomeLabel, outcomeTone, StatusText, statusTone } from "../../../parts";

// One customer and everything support has done with them (DESIGN §14): the
// account, then the conversations, tickets and escalations, newest first,
// then the records the agent could read for them.
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const history = await customerHistory(id);
  const c = CONSOLE.customers;

  if (!history) {
    return (
      <>
        <Link href="/console/customers" className={styles.detailBackAlways}>
          <ArrowRightIcon size={14} /> {c.back}
        </Link>
        <Empty icon={<UserIcon size={20} />}>{c.notFound}</Empty>
      </>
    );
  }

  const { profile, conversations, tickets, escalations, transactions, payouts } = history;
  return (
    <>
      <Link href="/console/customers" className={styles.detailBackAlways}>
        <ArrowRightIcon size={14} /> {c.back}
      </Link>

      <section className={styles.summaryCard} aria-label={profile.company_name}>
        <div className={styles.customerHead}>
          <Avatar name={profile.contact_name} />
          <div className={styles.customerWho}>
            <h1 className={styles.customerTitle}>
              {profile.company_name}
              <span className={styles.muted}>{profile.contact_name}</span>
            </h1>
          </div>
        </div>
        <CustomerFacts customer={profile} />
      </section>

      <div className={styles.twoColumn}>
        <Card title={c.sections.conversations}>
          {conversations.length === 0 ? (
            <Empty>{c.empty.conversations}</Empty>
          ) : (
            <ul className={styles.historyList}>
              {conversations.map((item) => (
                <li key={item.id}>
                  <Link href={`/console/conversations/${item.id}`} className={styles.historyItem}>
                    <span className={styles.historyBody}>
                      <span className={styles.historyTitle}>{item.first_words || CONSOLE.conversations.silent}</span>
                      <span className={styles.historyMeta}>
                        <StatusText tone={outcomeTone(item.final_status)}>{outcomeLabel(item.final_status)}</StatusText>
                        <span>
                          {channelLabel(item.channel)} · {CONSOLE.conversations.turns(item.turn_count)}
                        </span>
                      </span>
                    </span>
                    <time className={styles.historyWhen} dateTime={item.created_at}>
                      {listTime(item.created_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={c.sections.escalations}>
          {escalations.length === 0 ? (
            <Empty>{c.empty.escalations}</Empty>
          ) : (
            <ul className={styles.historyList}>
              {escalations.map((item) => (
                <li key={item.id}>
                  <Link href={`/console/escalations/${item.id}`} className={styles.historyItem}>
                    <span className={styles.historyBody}>
                      <span className={styles.historyTitle}>
                        <span className={styles.ref}>{item.escalation_ref}</span> {categoryLabel(item.category)}
                      </span>
                      <span className={styles.historyMeta}>
                        <StatusText tone={statusTone(item.status)}>{CONSOLE.escalations.statuses[item.status] ?? item.status}</StatusText>
                        <span>{item.appointment_time ? whenWithZone(item.appointment_time, item.timezone) : CONSOLE.escalations.notBooked}</span>
                      </span>
                      {item.matched_by_email && <span className={styles.historyMeta}>{c.matchedByEmail}</span>}
                    </span>
                    <time className={styles.historyWhen} dateTime={item.created_at}>
                      {listTime(item.created_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={c.sections.tickets}>
        {tickets.length === 0 ? (
          <Empty>{c.empty.tickets}</Empty>
        ) : (
          <ul className={styles.historyList}>
            {tickets.map((item) => {
              const body = (
                <>
                  <span className={styles.historyBody}>
                    <span className={styles.historyTitle}>
                      <span className={styles.ref}>{item.ticket_ref}</span> {categoryLabel(item.category)}
                    </span>
                    <span className={styles.historyMeta}>{item.summary}</span>
                    <span className={styles.historyMeta}>
                      <StatusText tone={statusTone(item.status)}>{CONSOLE.escalations.statuses[item.status] ?? item.status}</StatusText>
                      <span>{c.confirmation[item.confirmation_status] ?? item.confirmation_status}</span>
                    </span>
                  </span>
                  <time className={styles.historyWhen} dateTime={item.created_at}>
                    {listTime(item.created_at)}
                  </time>
                </>
              );
              return (
                <li key={item.id}>
                  {item.conversation_id ? (
                    <Link href={`/console/conversations/${item.conversation_id}`} className={styles.historyItem}>
                      {body}
                    </Link>
                  ) : (
                    <div className={styles.historyItem}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className={styles.twoColumn}>
        <Card title={c.sections.transactions}>
          {transactions.length === 0 ? (
            <Empty>{c.empty.transactions}</Empty>
          ) : (
            <ul className={styles.historyList}>
              {transactions.map((item) => (
                <li key={item.transaction_id}>
                  <div className={styles.historyItem}>
                    <span className={styles.historyBody}>
                      <span className={styles.historyTitle}>
                        <span className={styles.ref}>{item.transaction_id}</span> {item.transaction_type}
                      </span>
                      <span className={styles.historyMeta}>
                        <StatusText tone={recordTone(item.status)}>{sentenceCase(item.status)}</StatusText>
                        <span>
                          {c.to(item.destination_country)} · {item.estimated_arrival ? c.eta(recordDate(item.estimated_arrival)) : c.noEta}
                        </span>
                      </span>
                    </span>
                    <span className={styles.historyAmount}>{money(item.amount, item.currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={c.sections.payouts}>
          {payouts.length === 0 ? (
            <Empty>{c.empty.payouts}</Empty>
          ) : (
            <ul className={styles.historyList}>
              {payouts.map((item) => (
                <li key={item.payout_id}>
                  <div className={styles.historyItem}>
                    <span className={styles.historyBody}>
                      <span className={styles.historyTitle}>
                        <span className={styles.ref}>{item.payout_id}</span> {item.recipient_name}
                      </span>
                      <span className={styles.historyMeta}>
                        <StatusText tone={recordTone(item.status)}>{sentenceCase(item.status)}</StatusText>
                        <span>{c.scheduled(recordDate(item.scheduled_for))}</span>
                      </span>
                      {item.failure_reason && <span className={styles.historyMeta}>{c.failureReason(item.failure_reason)}</span>}
                    </span>
                    <span className={styles.historyAmount}>{money(item.amount, item.currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
