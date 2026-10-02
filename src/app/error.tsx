"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";

import { ERRORS, PAGE } from "./copy";
import styles from "./status.module.css";

// A page that failed to render: never Next's raw "Application error". The
// error itself goes to the console for us, never onto the page.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className={styles.page}>
      <div className={styles.card} role="alert">
        <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={132} height={31} className={styles.logo} />
        <h1 className={styles.title}>{ERRORS.broken.title}</h1>
        <p className={styles.body}>{ERRORS.broken.body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={reset}>
            {ERRORS.broken.retry}
          </button>
          <Link href="/" className={styles.secondary}>
            {ERRORS.broken.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
