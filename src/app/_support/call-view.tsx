"use client";

import { useEffect, useState } from "react";

import { PAGE } from "../copy";
import { InfoIcon, MicIcon } from "../icons";
import styles from "../page.module.css";
import { SummaryCard, type Summary } from "./summary-card";
import type { Phase } from "./use-voice-call";

// Plain values and the ref apart: the React Compiler treats an object that holds
// a ref as a ref, and would refuse every other read of it during render.
type Props = {
  phase: Phase;
  caption: string;
  summary: Summary | null;
  startedAt: number | null;
  busy: boolean;
  orbRef: React.RefObject<HTMLDivElement | null>;
};

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Ticks once a second while a call is live, for the timer. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// A voice call takes over the conversation area while it lasts (DESIGN §13).
export function CallView({ phase, caption, summary, startedAt, busy, orbRef }: Props) {
  const now = useNow(startedAt !== null);
  const notice = phase === "micBlocked" ? PAGE.voice.micBlocked : phase === "connectFailed" ? PAGE.voice.connectFailed : phase === "dropped" ? PAGE.voice.dropped : null;
  const statusText = phase === "micBlocked" || phase === "connectFailed" || phase === "dropped" ? null : PAGE.voice.status[phase];
  const orbState = phase === "speaking" ? "speaking" : phase === "listening" ? "listening" : busy ? "busy" : "idle";

  return (
    <section className={styles.call} aria-labelledby="call-heading">
      <div ref={orbRef} className={styles.orb} data-state={orbState}>
        <span className={styles.orbRing} data-ring="3" aria-hidden="true" />
        <span className={styles.orbRing} data-ring="2" aria-hidden="true" />
        <span className={styles.orbRing} data-ring="1" aria-hidden="true" />
        <span className={styles.orbCore}>
          <MicIcon size={30} />
        </span>
      </div>

      <h1 id="call-heading" className={styles.callHeading}>
        {PAGE.voice.heading}
      </h1>

      <div className={styles.callStatusRow} aria-live="polite">
        {statusText && (
          <p className={styles.callStatus} data-state={orbState}>
            <span className={styles.callStatusDot} aria-hidden="true" />
            {statusText}
          </p>
        )}
        {startedAt !== null && (
          <span className={styles.callTimer} aria-hidden="true">
            {clock(now - startedAt)}
          </span>
        )}
      </div>
      {busy && <p className={styles.callHint}>{PAGE.voice.body}</p>}

      {caption && (
        <figure key={caption} className={styles.caption}>
          <figcaption className={styles.captionLabel}>{PAGE.voice.lastSaidLabel}</figcaption>
          <blockquote className={styles.captionText}>{caption}</blockquote>
        </figure>
      )}

      {notice && (
        <div className={styles.notice} data-tone={phase === "dropped" ? "info" : "danger"} role="alert">
          <InfoIcon size={20} className={styles.noticeIcon} />
          <div>
            <p className={styles.noticeHeading}>{notice.heading}</p>
            <p className={styles.noticeBody}>{notice.body}</p>
          </div>
        </div>
      )}

      {summary && (phase === "ended" || phase === "dropped") && <SummaryCard summary={summary} />}
    </section>
  );
}
