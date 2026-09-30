import { CONSOLE } from "@/app/copy";
import { when } from "@/lib/console/format";
import { alertsList } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, Empty, PageHeader, words } from "../../parts";

export default async function Alerts() {
  const rows = await alertsList();
  return (
    <>
      <PageHeader title={CONSOLE.alerts.heading} intro={CONSOLE.alerts.intro} />
      {rows.length === 0 ? (
        <Empty>{CONSOLE.alerts.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {CONSOLE.alerts.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.nowrap}>{when(row.last_seen)}</td>
                  <td>
                    <Badge tone={row.severity === "critical" ? "bad" : row.severity === "warning" ? "warn" : "neutral"}>{row.severity}</Badge>
                  </td>
                  <td className={styles.nowrap}>{words(row.type)}</td>
                  <td className={styles.wide}>{row.message}</td>
                  <td className={styles.number}>{row.occurrences}</td>
                  <td className={styles.nowrap}>{when(row.first_seen)}</td>
                  <td className={styles.nowrap}>{row.notified_at ? when(row.notified_at) : row.severity === "info" ? "" : <Badge tone="bad">{CONSOLE.alerts.notEmailed}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
