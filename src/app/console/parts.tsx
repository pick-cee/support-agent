import { CONSOLE } from "@/app/copy";

import styles from "./console.module.css";

// Small pieces every console view shares. Colour appears only on pills, and a
// pill always carries words, so colour is never the only signal.

export type Tone = "neutral" | "good" | "bad" | "warn" | "info" | "brand";

export function Badge({ children, tone = "neutral", dot = false }: { children: React.ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {dot && <span className={styles.badgeDot} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, intro, children }: { eyebrow?: string; title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1 className={styles.heading}>{title}</h1>
        {intro && <p className={styles.intro}>{intro}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, intro, action, children, className }: { title?: string; intro?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`${styles.card} ${className ?? ""}`}>
      {(title || action) && (
        <div className={styles.cardHeader}>
          <div>
            {title && <h2 className={styles.cardTitle}>{title}</h2>}
            {intro && <p className={styles.cardIntro}>{intro}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon, children, action }: { icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      {icon && <span className={styles.emptyIcon}>{icon}</span>}
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Avatar({ name, tone = "brand" }: { name: string; tone?: "brand" | "accent" | "muted" }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span className={styles.avatar} data-tone={tone} aria-hidden="true">
      {initials}
    </span>
  );
}

export function outcomeTone(status: string | null): Tone {
  if (status === "failed" || status === "abandoned") return "bad";
  if (status === "escalated") return "warn";
  if (status === "ticket_created") return "info";
  if (status === "resolved") return "good";
  return "neutral";
}

export function outcomeLabel(status: string | null): string {
  return CONSOLE.outcomes[status ?? "open"] ?? status ?? "";
}

export function channelLabel(channel: string): string {
  return CONSOLE.channels[channel] ?? channel;
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
