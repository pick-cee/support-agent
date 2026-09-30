import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { CalendarIcon } from "@/app/icons";
import { age, whenWithZone } from "@/lib/console/format";
import { escalationsQueue } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Avatar, StatusText, statusTone } from "../../parts";

// The escalation queue as an inbox (DESIGN §14): soonest callback first on the
// left, the case beside it with everything needed before calling back.
export async function EscalationInbox({ all, activeId, children }: { all: boolean; activeId: string | null; children: React.ReactNode }) {
  const rows = await escalationsQueue(all);
  const e = CONSOLE.escalations;
  const suffix = all ? "?all=1" : "";
  return (
    <div className={styles.inbox} data-has-detail={activeId ? "true" : "false"}>
      <section className={styles.inboxList} aria-labelledby="inbox-heading">
        <div className={styles.inboxHead}>
          <div className={styles.inboxTitleRow}>
            <h1 id="inbox-heading" className={styles.inboxTitle}>
              {e.heading}
            </h1>
            <span className={styles.inboxCount}>{e.count(rows.length)}</span>
          </div>
          <p className={styles.inboxIntro}>{e.intro}</p>
          <nav className={styles.chips} aria-label="Which escalations">
            <Link href="/console/escalations" className={styles.chip} aria-current={all ? undefined : "page"}>
              {e.showOpen}
            </Link>
            <Link href="/console/escalations?all=1" className={styles.chip} aria-current={all ? "page" : undefined}>
              {e.showAll}
            </Link>
          </nav>
        </div>

        {rows.length === 0 ? (
          <p className={styles.inboxNothing}>{all ? e.emptyAll : e.empty}</p>
        ) : (
          <ul className={styles.inboxItems}>
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/console/escalations/${row.id}${suffix}`} className={styles.inboxItem} aria-current={row.id === activeId ? "page" : undefined}>
                  <Avatar name={row.user_name} tone="accent" />
                  <span className={styles.inboxItemBody}>
                    <span className={styles.inboxItemTop}>
                      <span className={styles.inboxItemTitle}>
                        {row.user_name}
                        {row.company_name && <span className={styles.inboxItemCompany}>{row.company_name}</span>}
                      </span>
                      <time className={styles.inboxItemTime} dateTime={row.created_at}>
                        {e.age(age(row.created_at))}
                      </time>
                    </span>
                    <span className={styles.inboxItemText}>{row.reason}</span>
                    <span className={styles.inboxItemMeta}>
                      <StatusText tone={statusTone(row.status)}>{e.statuses[row.status] ?? row.status}</StatusText>
                      <span className={styles.inboxItemSub}>
                        <CalendarIcon size={12} /> {row.appointment_time ? whenWithZone(row.appointment_time, row.timezone) : e.notBooked}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.inboxDetail}>{children}</section>
    </div>
  );
}
