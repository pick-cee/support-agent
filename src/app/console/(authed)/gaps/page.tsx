import { CONSOLE } from "@/app/copy";
import { knowledgeGaps } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Empty, PageHeader } from "../../parts";

// What the agent could not answer is a deliverable (DESIGN §1): the backlog of
// knowledge-base articles worth writing once instead of answering by hand.
export default async function KnowledgeGaps() {
  const groups = await knowledgeGaps();
  return (
    <>
      <PageHeader title={CONSOLE.gaps.heading} intro={CONSOLE.gaps.intro} />
      {groups.length === 0 ? (
        <Empty>{CONSOLE.gaps.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {CONSOLE.gaps.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.section}>
                  <td>{group.section}</td>
                  <td className={styles.number}>{group.count}</td>
                  <td className={styles.wide}>
                    <ul className={styles.list}>
                      {group.examples.map((example) => (
                        <li key={example}>{example || CONSOLE.conversation.silence}</li>
                      ))}
                    </ul>
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
