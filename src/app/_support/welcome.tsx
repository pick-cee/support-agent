"use client";

import { PAGE } from "../copy";
import { CheckIcon, HeadsetIcon, MicIcon, ReceiptIcon, SearchIcon } from "../icons";
import styles from "../page.module.css";
import { Words } from "./thread";

const SUGGESTION_ICONS = { fees: ReceiptIcon, lookup: SearchIcon, specialist: HeadsetIcon } as const;

// Before the first message (DESIGN §13). Voice first: the assistant is a voice
// you can talk to, so the page leads with one large button to start a call, in
// the same orb the call itself uses. Typing stays one step away, in the dock,
// with three common questions from the test scenarios as a start.
export function Welcome({ onPick, onCall, disabled }: { onPick: (question: string) => void; onCall: () => void; disabled: boolean }) {
  return (
    <section className={styles.welcome} aria-labelledby="page-heading">
      <p className={styles.eyebrow}>{PAGE.eyebrow}</p>
      <h1 id="page-heading" className={styles.welcomeHeading}>
        {PAGE.heading}
      </h1>
      <p className={styles.welcomeLead}>{PAGE.lead}</p>

      <div className={styles.hero}>
        {/* Sound arcs either side of the orb, centred on it (210, 76): decoration only. */}
        <svg className={styles.waves} viewBox="0 0 420 152" aria-hidden="true" focusable="false">
          <path data-step="1" d="M286.6 11.7A100 100 0 0 1 286.6 140.3M133.4 11.7A100 100 0 0 0 133.4 140.3" />
          <path data-step="2" d="M318.5 8.2A128 128 0 0 1 318.5 143.8M101.5 8.2A128 128 0 0 0 101.5 143.8" />
          <path data-step="3" d="M350.2 7.6A156 156 0 0 1 350.2 144.4M69.8 7.6A156 156 0 0 0 69.8 144.4" />
        </svg>
        <button type="button" className={styles.talk} onClick={onCall} aria-describedby="talk-hint">
          <span className={styles.talkOrb} aria-hidden="true">
            <span className={styles.talkCore}>
              <MicIcon size={34} />
            </span>
          </span>
          <span className={styles.talkLabel}>{PAGE.talk}</span>
        </button>
        <p id="talk-hint" className={styles.talkHint}>
          <Words text={PAGE.talkHint} reveal={false} />
        </p>
      </div>

      <h2 className={styles.chipsLabel}>{PAGE.text.suggestionsLabel}</h2>
      <ul className={styles.chips}>
        {PAGE.text.suggestions.map((suggestion) => {
          const Icon = SUGGESTION_ICONS[suggestion.kind];
          return (
            <li key={suggestion.text}>
              <button type="button" className={styles.chip} onClick={() => onPick(suggestion.text)} disabled={disabled}>
                <Icon size={16} className={styles.chipIcon} />
                {suggestion.label}
              </button>
            </li>
          );
        })}
      </ul>

      <ul className={styles.points}>
        {PAGE.points.map((point) => (
          <li key={point} className={styles.point}>
            <CheckIcon size={14} className={styles.pointIcon} />
            {point}
          </li>
        ))}
      </ul>
    </section>
  );
}
