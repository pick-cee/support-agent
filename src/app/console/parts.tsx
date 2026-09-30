import { CONSOLE } from "@/app/copy";

import styles from "./console.module.css";

// Small pieces every console view shares. Colour appears only on pills, and a
// pill always carries words, so colour is never the only signal.

export type Tone = "neutral" | "good" | "bad" | "warn" | "info" | "brand";

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

export function PageHeader({ title, intro, children }: { title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.heading}>{title}</h1>
        {intro && <p className={styles.intro}>{intro}</p>}
      </div>
      {children}
    </div>
  );
}

export function Tile({ label, value, note, empty }: { label: string; value: string; note?: string; empty?: boolean }) {
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue} data-empty={empty ? "true" : "false"}>
        {value}
      </p>
      {note && <p className={styles.tileNote}>{note}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export function outcomeTone(status: string | null): Tone {
  if (status === "failed" || status === "abandoned") return "bad";
  if (status === "escalated") return "warn";
  if (status === "ticket_created") return "info";
  if (status === "resolved") return "good";
  return "neutral";
}

export function outcomeLabel(status: string | null): string {
  return CONSOLE.labels.outcome[status ?? "open"] ?? status ?? "";
}

export function channelLabel(channel: string): string {
  return CONSOLE.labels.channel[channel] ?? channel;
}

export function statusTone(value: string): Tone {
  if (["failed", "dead", "critical"].includes(value)) return "bad";
  if (["booked", "sent", "closed"].includes(value)) return "good";
  if (["pending", "warning", "in progress"].includes(value)) return "warn";
  if (["open"].includes(value)) return "brand";
  return "neutral";
}

/** Status words from the records, made readable: "skipped_eval" becomes "skipped eval". */
export function words(value: string): string {
  return value.replace(/_/g, " ");
}
