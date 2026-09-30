import { PAGE } from "../copy";
import { CheckIcon } from "../icons";
import styles from "../page.module.css";
import { Words } from "./thread";

// What the customer may see once a conversation ends (DESIGN §13): the
// references and a booked time, from the records. Never an account detail.

export type Summary = { ticket_ref: string | null; escalation_ref: string | null; callback: { booked: boolean; when: string | null } | null } | "unavailable";

export function SummaryCard({ summary, children }: { summary: Summary; children?: React.ReactNode }) {
  const lines =
    summary === "unavailable"
      ? [PAGE.summary.unavailable]
      : [
          ...(summary.escalation_ref ? [PAGE.summary.escalation(summary.escalation_ref)] : []),
          ...(summary.callback ? [summary.callback.booked && summary.callback.when ? PAGE.summary.booked(summary.callback.when) : PAGE.summary.byEmail] : []),
          ...(summary.ticket_ref ? [PAGE.summary.ticket(summary.ticket_ref)] : []),
        ];
  return (
    <section className={styles.summary} aria-labelledby="summary-heading">
      <span className={styles.summaryIcon} aria-hidden="true">
        <CheckIcon size={18} />
      </span>
      <div className={styles.summaryBody}>
        <h2 id="summary-heading" className={styles.summaryHeading}>
          {PAGE.summary.heading}
        </h2>
        {(lines.length ? lines : [PAGE.summary.nothing]).map((line) => (
          <p key={line} className={styles.summaryLine}>
            <Words text={line} reveal={false} />
          </p>
        ))}
        {children && <div className={styles.summaryActions}>{children}</div>}
      </div>
    </section>
  );
}
