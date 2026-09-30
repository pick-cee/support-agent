"use client";

import Image from "next/image";
import { Fragment } from "react";

import { PAGE } from "../copy";
import styles from "../page.module.css";
import type { Entry } from "./use-text-chat";

// The conversation as a transcript (DESIGN §13), within the brand's "no
// chat-heavy treatment": the assistant speaks as plain text beside its mark,
// the customer's words sit in a light tinted panel. No tails, no colour blocks.

// References the customer can act on stand out; code wrote them, so they are exact.
const REFERENCE = /^([("']*)((?:TXN|PAY)-\d{3,}|[TE]-\d{4})([)"'.,;:!?]*)$/;
// A new reply fades in word by word, so the eye finds where it starts. Capped,
// so a long reply is fully shown within about a second.
const WORD_DELAY_MS = 14;
const WORD_DELAY_CAP = 70;

export function Words({ text, reveal }: { text: string; reveal: boolean }) {
  let word = 0;
  return (
    <>
      {text.split(/(\s+)/).map((token, index) => {
        if (!token) return null;
        if (/^\s+$/.test(token)) return <Fragment key={index}>{token}</Fragment>;
        const match = REFERENCE.exec(token);
        const style = reveal ? ({ "--i": Math.min(word++, WORD_DELAY_CAP) * WORD_DELAY_MS } as React.CSSProperties) : undefined;
        const className = reveal ? styles.word : undefined;
        if (!match) {
          return (
            <span key={index} className={className} style={style}>
              {token}
            </span>
          );
        }
        return (
          <span key={index} className={className} style={style}>
            {match[1]}
            <span className={styles.ref}>{match[2]}</span>
            {match[3]}
          </span>
        );
      })}
    </>
  );
}

function AssistantAvatar() {
  return (
    <span className={styles.avatar} aria-hidden="true">
      <Image src="/icon.png" alt="" width={18} height={18} />
    </span>
  );
}

export function Thread({ entries, pending, revealFrom }: { entries: Entry[]; pending: boolean; revealFrom: number }) {
  return (
    <ol className={styles.thread} aria-label={PAGE.text.logLabel}>
      {entries.map((entry) =>
        entry.role === "assistant" ? (
          <li key={entry.id} className={styles.msgAssistant}>
            <AssistantAvatar />
            <div className={styles.msgBody}>
              <p className={styles.msgName}>{PAGE.text.assistant}</p>
              <p className={styles.msgText}>
                <Words text={entry.text} reveal={entry.id >= revealFrom} />
              </p>
            </div>
          </li>
        ) : (
          <li key={entry.id} className={styles.msgCustomer}>
            <p className="visually-hidden">{PAGE.text.you}</p>
            <p className={styles.msgText}>
              <Words text={entry.text} reveal={false} />
            </p>
          </li>
        ),
      )}
      {pending && (
        <li className={styles.msgAssistant} aria-live="off">
          <AssistantAvatar />
          <div className={styles.msgBody}>
            <p className={styles.msgName}>{PAGE.text.assistant}</p>
            <p className={styles.thinking}>
              <span className={styles.thinkingDots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {PAGE.text.thinking}
            </p>
          </div>
        </li>
      )}
    </ol>
  );
}
