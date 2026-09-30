import { CONSOLE } from "@/app/copy";
import { BellIcon, CheckCircleIcon, InfoIcon, WarningIcon } from "@/app/icons";
import { when } from "@/lib/console/format";
import { alertCounts, alertsList } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, Empty, PageHeader, words } from "../../parts";

export default async function Alerts() {
  const [rows, counts] = await Promise.all([alertsList(), alertCounts()]);
  const a = CONSOLE.alerts;
  const cards = [
    { label: a.counts.critical, value: counts.critical, tone: "bad", Icon: WarningIcon },
    { label: a.counts.warning, value: counts.warning, tone: "warn", Icon: BellIcon },
    { label: a.counts.info, value: counts.info, tone: "accent", Icon: InfoIcon },
  ] as const;
  return (
    <>
      <PageHeader title={a.heading} intro={a.intro} />
      <div className={styles.stats} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {cards.map(({ label, value, tone, Icon }) => (
          <div key={label} className={styles.stat}>
            <div className={styles.statTop}>
              <p className={styles.statLabel}>{label}</p>
              <span className={styles.statIcon} data-tone={tone}>
                <Icon size={18} />
              </span>
            </div>
            <p className={styles.statValue}>{value}</p>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty icon={<CheckCircleIcon size={20} />}>{a.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {a.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={styles.cellStrong}>{row.message}</span>
                    <span className={styles.cellSub}>{words(row.type)}</span>
                  </td>
                  <td>
                    <Badge tone={row.severity === "critical" ? "bad" : row.severity === "warning" ? "warn" : "neutral"} dot>
                      {row.severity}
                    </Badge>
                  </td>
                  <td className={styles.number}>{a.times(row.occurrences)}</td>
                  <td className={styles.nowrap}>
                    {when(row.last_seen)}
                    <span className={styles.cellSub}>{when(row.first_seen)}</span>
                  </td>
                  <td className={styles.nowrap}>{row.notified_at ? when(row.notified_at) : row.severity === "info" ? "" : <Badge tone="bad">{a.notEmailed}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
