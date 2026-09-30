import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { CheckCircleIcon } from "@/app/icons";
import { age, whenWithZone } from "@/lib/console/format";
import { escalationsQueue } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Avatar, Badge, Empty, PageHeader, statusTone, words } from "../../parts";
import { StatusSelect } from "../../ui";

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === "1";
  const rows = await escalationsQueue(all);
  const e = CONSOLE.escalations;
  return (
    <>
      <PageHeader title={e.heading} intro={e.intro}>
        <nav className={styles.filters} aria-label="Which escalations">
          <Link href="/console/escalations" className={styles.filter} aria-current={all ? undefined : "page"}>
            {e.showOpen}
          </Link>
          <Link href="/console/escalations?all=1" className={styles.filter} aria-current={all ? "page" : undefined}>
            {e.showAll}
          </Link>
        </nav>
      </PageHeader>
      {rows.length === 0 ? (
        <Empty icon={<CheckCircleIcon size={20} />}>{all ? e.emptyAll : e.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {e.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.nowrap}>
                    {row.conversation_id ? <Link href={`/console/conversations/${row.conversation_id}`}>{row.escalation_ref}</Link> : <span className={styles.cellStrong}>{row.escalation_ref}</span>}
                    <span className={styles.cellSub}>
                      {row.ticket_ref} · {e.age(age(row.created_at))}
                    </span>
                  </td>
                  <td>
                    <div className={styles.person}>
                      <Avatar name={row.user_name} tone="accent" />
                      <div>
                        <span className={styles.cellStrong}>{row.user_name}</span>
                        <span className={styles.cellSub}>{row.company_name ?? words(row.category)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={styles.clamp}>{row.reason}</span>
                    <span className={styles.cellSub}>{words(row.category)}</span>
                  </td>
                  <td className={styles.nowrap}>{row.appointment_time ? whenWithZone(row.appointment_time, row.timezone) : <span className={styles.muted}>{e.notBooked}</span>}</td>
                  <td>
                    <Badge tone={statusTone(row.booking_status)} dot>
                      {words(row.booking_status)}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={statusTone(row.notification_status)} dot>
                      {words(row.notification_status)}
                    </Badge>
                    {row.notification_error && <span className={styles.cellSub}>{row.notification_error}</span>}
                  </td>
                  <td>
                    <StatusSelect id={row.id} reference={row.escalation_ref} initial={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
