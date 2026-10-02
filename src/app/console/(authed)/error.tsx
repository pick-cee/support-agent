"use client";

import { useEffect } from "react";

import { ERRORS } from "../../copy";
import { WarningIcon } from "../../icons";
import styles from "../../status.module.css";

// A console page that failed, inside the console's frame: the sidebar stays,
// so the team can move on, and the error stays out of the page.
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className={styles.inline}>
      <div className={styles.card} role="alert">
        <WarningIcon size={28} />
        <h1 className={styles.title}>{ERRORS.console.title}</h1>
        <p className={styles.body}>{ERRORS.console.body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={reset}>
            {ERRORS.console.retry}
          </button>
        </div>
      </div>
    </div>
  );
}
