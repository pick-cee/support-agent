import type { Metadata } from "next";
import Image from "next/image";

import { CONSOLE, PAGE } from "@/app/copy";
import { CheckIcon, WarningIcon } from "@/app/icons";

import styles from "../console.module.css";

export const metadata: Metadata = { title: CONSOLE.title, robots: { index: false } };

// Sign in: on a wide screen, a deep-blue panel says what the console is for,
// with the customer page's sound arcs as hairlines; the form sits beside it.
export default async function ConsoleLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error === "locked" ? CONSOLE.login.locked : error === "wrong" ? CONSOLE.login.wrong : error === "config" ? CONSOLE.login.notConfigured : null;
  const l = CONSOLE.login;
  return (
    <main className={styles.loginPage}>
      <section className={styles.loginPanel} aria-hidden="true">
        <svg className={styles.loginArcs} viewBox="0 0 420 152" focusable="false">
          <path d="M286.6 11.7A100 100 0 0 1 286.6 140.3M133.4 11.7A100 100 0 0 0 133.4 140.3" />
          <path d="M318.5 8.2A128 128 0 0 1 318.5 143.8M101.5 8.2A128 128 0 0 0 101.5 143.8" />
          <path d="M350.2 7.6A156 156 0 0 1 350.2 144.4M69.8 7.6A156 156 0 0 0 69.8 144.4" />
        </svg>
        <span className={styles.loginMark}>
          <Image src="/icon.png" alt="" width={30} height={30} />
        </span>
        <p className={styles.loginPanelLabel}>{l.panelLabel}</p>
        <p className={styles.loginPanelHeading}>{l.panelHeading}</p>
        <ul className={styles.loginPoints}>
          {l.panelPoints.map((point) => (
            <li key={point}>
              <CheckIcon size={16} />
              {point}
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.loginSide}>
        <form className={styles.login} method="post" action="/api/console/login">
          <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={150} height={35} priority className={styles.loginLogo} />
          <h1 className={styles.loginHeading}>{l.heading}</h1>
          <p className={styles.loginIntro}>{l.intro}</p>
          {message && (
            <p className={styles.error} role="alert">
              <WarningIcon size={18} />
              {message}
            </p>
          )}
          <div className={styles.formStack}>
            <label className={styles.field}>
              <span className={styles.label}>{l.password}</span>
              <input name="password" type="password" className={styles.input} autoComplete="current-password" required autoFocus />
            </label>
            <button type="submit" className={`${styles.button} ${styles.buttonWide}`}>
              {l.submit}
            </button>
          </div>
          <p className={styles.loginFooter}>{l.footer}</p>
        </form>
      </div>
    </main>
  );
}
