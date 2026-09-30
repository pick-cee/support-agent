import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { age, ms, usd, whenWithZone } from "@/lib/console/format";
import { escalationsQueue, todayStats } from "@/lib/console/queries";

import styles from "../console.module.css";
import { Badge, Empty, PageHeader, statusTone, Tile, words } from "../parts";

// Scannable first (DESIGN §14): numbers and status lead; detail is one click away.
export default async function Today() {
  const [stats, open] = await Promise.all([todayStats(), escalationsQueue(false)]);
  const share = stats.finished ? `${Math.round((stats.resolvedWithoutHuman / stats.finished) * 100)}%` : CONSOLE.today.none;
  const pair = (a: number | null, b: number | null) => (a === null ? CONSOLE.today.none : `${ms(a)} / ${ms(b)}`);
  return (
    <>
      <PageHeader title={CONSOLE.today.heading} intro={CONSOLE.today.intro} />

      <div className={styles.group}>
        <p className={styles.groupLabel}>{CONSOLE.today.customers}</p>
        <div className={styles.tiles}>
          <Tile label={CONSOLE.today.conversations} value={String(stats.conversations)} />
          <Tile label={CONSOLE.today.resolved} value={share} empty={!stats.finished} note={CONSOLE.today.ofFinished(stats.resolvedWithoutHuman, stats.finished)} />
          <Tile label={CONSOLE.today.openEscalations} value={String(stats.openEscalations)} />
          <Tile label={CONSOLE.today.callsBooked} value={String(stats.callsBooked)} />
          <Tile label={CONSOLE.today.alerts} value={String(stats.alertsToday)} />
        </div>
      </div>

      <div className={styles.group}>
        <p className={styles.groupLabel}>{CONSOLE.today.speedAndCost}</p>
        <div className={styles.tiles}>
          <Tile label={CONSOLE.today.firstText} value={pair(stats.firstTextP50, stats.firstTextP95)} empty={stats.firstTextP50 === null} />
          <Tile label={CONSOLE.today.vapiTurn} value={pair(stats.vapiTurnP50, stats.vapiTurnP95)} empty={stats.vapiTurnP50 === null} />
          <Tile label={CONSOLE.today.agentSpend} value={usd(stats.agentSpendEstimateUsd, 2)} />
          <Tile label={CONSOLE.today.vapiCost} value={usd(stats.vapiCostUsd, 2)} />
        </div>
        <p className={styles.note}>{CONSOLE.today.costNote}</p>
      </div>

      <h2 className={styles.sectionHeading}>
        {CONSOLE.today.openEscalations}
        <Link href="/console/escalations">{CONSOLE.today.viewAll}</Link>
      </h2>
      {open.length === 0 ? (
        <Empty>{CONSOLE.escalations.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{CONSOLE.escalations.columns[0]}</th>
                <th>{CONSOLE.escalations.columns[1]}</th>
                <th>{CONSOLE.escalations.columns[3]}</th>
                <th>{CONSOLE.escalations.columns[4]}</th>
                <th>{CONSOLE.escalations.columns[5]}</th>
                <th>{CONSOLE.escalations.columns[8]}</th>
              </tr>
            </thead>
            <tbody>
              {open.slice(0, 10).map((row) => (
                <tr key={row.id}>
                  <td className={styles.nowrap}>{row.conversation_id ? <Link href={`/console/conversations/${row.conversation_id}`}>{row.escalation_ref}</Link> : row.escalation_ref}</td>
                  <td>{words(row.category)}</td>
                  <td className={styles.wide}>{row.reason}</td>
                  <td className={styles.nowrap}>{age(row.created_at)}</td>
                  <td className={styles.nowrap}>{row.appointment_time ? whenWithZone(row.appointment_time, row.timezone) : <span className={styles.muted}>{CONSOLE.escalations.notBooked}</span>}</td>
                  <td>
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
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
