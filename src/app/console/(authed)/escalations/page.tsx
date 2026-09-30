import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { age, whenWithZone } from "@/lib/console/format";
import { escalationsQueue } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, Empty, PageHeader, statusTone, words } from "../../parts";

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === "1";
  const rows = await escalationsQueue(all);
  const back = all ? "/console/escalations?all=1" : "/console/escalations";
  return (
    <>
      <PageHeader title={CONSOLE.escalations.heading} intro={CONSOLE.escalations.intro}>
        <div className={styles.filters}>
          <Link href="/console/escalations" className={styles.filter} aria-current={all ? undefined : "page"}>
            {CONSOLE.escalations.hideClosed}
          </Link>
          <Link href="/console/escalations?all=1" className={styles.filter} aria-current={all ? "page" : undefined}>
            {CONSOLE.escalations.showClosed}
          </Link>
        </div>
      </PageHeader>
      {rows.length === 0 ? (
        <Empty>{CONSOLE.escalations.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {CONSOLE.escalations.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.nowrap}>
                    {row.conversation_id ? <Link href={`/console/conversations/${row.conversation_id}`}>{row.escalation_ref}</Link> : row.escalation_ref}
                    <div className={`${styles.muted} ${styles.small}`}>{row.ticket_ref}</div>
                  </td>
                  <td>{words(row.category)}</td>
                  <td>
                    {row.user_name}
                    {row.company_name && <div className={`${styles.muted} ${styles.small}`}>{row.company_name}</div>}
                  </td>
                  <td className={styles.wide}>{row.reason}</td>
                  <td className={styles.nowrap}>{age(row.created_at)}</td>
                  <td className={styles.nowrap}>{row.appointment_time ? whenWithZone(row.appointment_time, row.timezone) : <span className={styles.muted}>{CONSOLE.escalations.notBooked}</span>}</td>
                  <td>
                    <Badge tone={statusTone(row.booking_status)}>{words(row.booking_status)}</Badge>
                  </td>
                  <td>
                    <Badge tone={statusTone(row.notification_status)}>{words(row.notification_status)}</Badge>
                  </td>
                  <td>
                    <form method="post" action={`/api/console/escalations/${row.id}/status`} className={styles.inlineForm}>
                      <input type="hidden" name="back" value={back} />
                      <select name="status" defaultValue={row.status} className={styles.select} aria-label={`Status of ${row.escalation_ref}`}>
                        <option value="open">open</option>
                        <option value="in progress">in progress</option>
                        <option value="closed">closed</option>
                      </select>
                      <button type="submit" className={styles.button}>
                        {CONSOLE.escalations.change}
                      </button>
                    </form>
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
