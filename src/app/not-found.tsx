import Image from "next/image";
import Link from "next/link";

import { ERRORS, PAGE } from "./copy";
import styles from "./status.module.css";

// Any address the app does not serve: the brand, plain words and a way back.
export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={132} height={31} className={styles.logo} />
        <h1 className={styles.title}>{ERRORS.notFound.title}</h1>
        <p className={styles.body}>{ERRORS.notFound.body}</p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primary}>
            {ERRORS.notFound.action}
          </Link>
        </div>
      </div>
    </main>
  );
}
