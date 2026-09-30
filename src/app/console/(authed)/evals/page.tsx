import { CONSOLE } from "@/app/copy";
import { ClipboardIcon } from "@/app/icons";
import { ms, usd, when } from "@/lib/console/format";
import { evalMatrix, evalRuns } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, Card, Empty, PageHeader } from "../../parts";

export default async function Evals() {
  const [runs, matrix] = await Promise.all([evalRuns(), evalMatrix()]);
  const e = CONSOLE.evals;
  return (
    <>
      <PageHeader title={e.heading} intro={e.intro} />
      {runs.length === 0 ? (
        <Empty icon={<ClipboardIcon size={20} />}>{e.empty}</Empty>
      ) : (
        <>
          {matrix.length > 0 && (
            <Card title={e.matrix}>
              <div className={styles.tableWrap} style={{ boxShadow: "none" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {e.matrixColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row) => (
                      <tr key={`${row.scenario_key}-${row.model}`}>
                        <td className={styles.nowrap}>
                          <span className={styles.cellStrong}>{row.scenario_key}</span>
                        </td>
                        <td>{row.test_case}</td>
                        <td className={styles.nowrap}>{row.model}</td>
                        <td>
                          <Badge tone={row.passes === row.runs ? "good" : row.passes === 0 ? "bad" : "warn"} dot>
                            {row.passes} / {row.runs}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <Card title={e.runs}>
            <div className={styles.tableWrap} style={{ boxShadow: "none" }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {e.runColumns.map((column) => (
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
                      <td className={styles.nowrap}>
                        {run.total === null ? (
                          <Badge>{run.stopped ? e.stopped : e.running}</Badge>
                        ) : (
                          <Badge tone={run.passed === run.total ? "good" : "warn"} dot>
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
          </Card>
        </>
      )}
    </>
  );
}
