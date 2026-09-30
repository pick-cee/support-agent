"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { PAGE } from "../copy";
import { InfoIcon, MicIcon } from "../icons";
import styles from "../page.module.css";
import { SummaryCard, type Summary } from "./summary-card";
import { Words } from "./thread";
import type { CallLine, Phase } from "./use-voice-call";

// Plain values and the ref apart: the React Compiler treats an object that holds
// a ref as a ref, and would refuse every other read of it during render.
type Props = {
  phase: Phase;
  lines: CallLine[];
  summary: Summary | null;
  startedAt: number | null;
  busy: boolean;
  muted: boolean;
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

// A voice call takes over the conversation area while it lasts (DESIGN §13):
// who is talking at the top, and the conversation building up below it, both
// sides, as it happens. It stays on screen after the call.
export function CallView({ phase, lines, summary, startedAt, busy, muted, orbRef }: Props) {
  const now = useNow(startedAt !== null);
  const endRef = useRef<HTMLDivElement>(null);
  const notice = phase === "micBlocked" ? PAGE.voice.micBlocked : phase === "connectFailed" ? PAGE.voice.connectFailed : phase === "dropped" ? PAGE.voice.dropped : null;
  const statusText = muted && busy ? PAGE.voice.mutedStatus : phase === "micBlocked" || phase === "connectFailed" || phase === "dropped" ? null : PAGE.voice.status[phase];
  const orbState = phase === "speaking" ? "speaking" : phase === "listening" ? "listening" : busy ? "busy" : "idle";
  const compact = lines.length > 0;

  // The newest words stay in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [lines, summary]);

  return (
    <section className={styles.call} data-compact={compact ? "true" : "false"} aria-labelledby="call-heading">
      <div className={styles.callHead}>
        <div ref={orbRef} className={styles.orb} data-state={orbState}>
          <span className={styles.orbRing} data-ring="3" aria-hidden="true" />
          <span className={styles.orbRing} data-ring="2" aria-hidden="true" />
          <span className={styles.orbRing} data-ring="1" aria-hidden="true" />
          <span className={styles.orbCore}>
            <MicIcon size={compact ? 20 : 30} />
          </span>
        </div>
        <div className={styles.callHeadText}>
          <h1 id="call-heading" className={styles.callHeading}>
            {PAGE.voice.heading}
          </h1>
          <div className={styles.callStatusRow} aria-live="polite">
            {statusText && (
              <p className={styles.callStatus} data-state={muted && busy ? "muted" : orbState}>
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
        </div>
      </div>
      {busy && !compact && <p className={styles.callHint}>{PAGE.voice.body}</p>}

      {compact && (
        <ol className={styles.callTranscript} aria-label={PAGE.voice.transcriptLabel}>
          {lines.map((line) =>
            line.role === "assistant" ? (
              <li key={line.id} className={styles.msgAssistant}>
                <span className={styles.avatar} aria-hidden="true">
                  <Image src="/icon.png" alt="" width={18} height={18} />
                </span>
                <div className={styles.msgBody}>
                  <p className={styles.msgName}>{PAGE.text.assistant}</p>
                  <p className={styles.msgText}>
                    <Words text={line.text} reveal={false} />
                  </p>
                </div>
              </li>
            ) : (
              <li key={line.id} className={styles.msgCustomer} data-live={line.live ? "true" : "false"}>
                <p className="visually-hidden">{PAGE.text.you}</p>
                <p className={styles.msgText}>
                  <Words text={line.text} reveal={false} />
                  {line.live && <span className={styles.liveCaret} aria-hidden="true" />}
                </p>
              </li>
            ),
          )}
        </ol>
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
      <div ref={endRef} />
    </section>
  );
}
