import { CONSOLE } from "@/app/copy";
import { ms, usd, when } from "@/lib/console/format";
import { evalMatrix, evalRuns } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, Empty, PageHeader } from "../../parts";

export default async function Evals() {
  const [runs, matrix] = await Promise.all([evalRuns(), evalMatrix()]);
  return (
    <>
      <PageHeader title={CONSOLE.evals.heading} intro={CONSOLE.evals.intro} />
      {runs.length === 0 ? (
        <Empty>{CONSOLE.evals.empty}</Empty>
      ) : (
        <>
          <h2 className={styles.sectionHeading}>{CONSOLE.evals.matrix}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {CONSOLE.evals.matrixColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={`${row.scenario_key}-${row.model}`}>
                    <td className={styles.nowrap}>{row.scenario_key}</td>
                    <td>{row.test_case}</td>
                    <td className={styles.nowrap}>{row.model}</td>
                    <td>
                      <Badge tone={row.passes === row.runs ? "good" : row.passes === 0 ? "bad" : "warn"}>
                        {row.passes} / {row.runs}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className={styles.sectionHeading}>{CONSOLE.evals.runs}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {CONSOLE.evals.runColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className={styles.nowrap}>{when(run.created_at)}</td>
                    <td>{run.label ?? ""}</td>
                    <td className={styles.nowrap}>{run.model}</td>
                    <td>{run.side_effects_mode}</td>
                    <td className={styles.nowrap}>
                      {run.total === null ? (
                        <Badge>{run.stopped ? CONSOLE.evals.stopped : CONSOLE.evals.running}</Badge>
                      ) : (
                        <Badge tone={run.passed === run.total ? "good" : "warn"}>
                          {run.passed} / {run.total}
                        </Badge>
                      )}
                    </td>
                    <td className={styles.nowrap}>
                      {ms(run.p50_ttfa_ms)} / {ms(run.p95_ttfa_ms)}
                    </td>
                    <td className={styles.number}>{usd(run.cost_estimate_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
