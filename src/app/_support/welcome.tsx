"use client";

import Image from "next/image";

import { PAGE } from "../copy";
import { ArrowRightIcon, HeadsetIcon, ReceiptIcon, SearchDocIcon, SearchIcon, ShieldIcon } from "../icons";
import styles from "../page.module.css";
import { Words } from "./thread";

const SUGGESTION_ICONS = { fees: ReceiptIcon, lookup: SearchIcon, specialist: HeadsetIcon } as const;
const POINT_ICONS = [SearchDocIcon, ShieldIcon, HeadsetIcon];

// Before the first message: what the assistant is for, and three questions from
// the test scenarios to start with. It gives way to the conversation.
export function Welcome({ onPick, disabled }: { onPick: (question: string) => void; disabled: boolean }) {
  return (
    <section className={styles.welcome} aria-labelledby="page-heading">
      <span className={styles.mark} aria-hidden="true">
        <Image src="/icon.png" alt="" width={34} height={34} priority />
      </span>
      <h1 id="page-heading" className={styles.welcomeHeading}>
        {PAGE.heading}
      </h1>
      <p className={styles.welcomeLead}>{PAGE.lead}</p>

      <h2 className="visually-hidden">{PAGE.text.suggestionsLabel}</h2>
      <ul className={styles.suggestions}>
        {PAGE.text.suggestions.map((suggestion) => {
          const Icon = SUGGESTION_ICONS[suggestion.kind];
          return (
            <li key={suggestion.text}>
              <button type="button" className={styles.suggestion} onClick={() => onPick(suggestion.text)} disabled={disabled}>
                <span className={styles.suggestionIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className={styles.suggestionText}>
                  <Words text={suggestion.text} reveal={false} />
                </span>
                <ArrowRightIcon size={16} className={styles.suggestionArrow} />
              </button>
            </li>
          );
        })}
      </ul>

      <ul className={styles.points}>
        {PAGE.points.map((point, index) => {
          const Icon = POINT_ICONS[index] ?? ShieldIcon;
          return (
            <li key={point.title} className={styles.point}>
              <Icon size={18} className={styles.pointIcon} />
              <span>
                <span className={styles.pointTitle}>{point.title}</span>
                <span className={styles.pointBody}>{point.body}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
