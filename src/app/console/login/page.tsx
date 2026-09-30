import type { Metadata } from "next";
import Image from "next/image";

import { CONSOLE, PAGE } from "@/app/copy";
import { WarningIcon } from "@/app/icons";

import styles from "../console.module.css";

export const metadata: Metadata = { title: CONSOLE.title, robots: { index: false } };

export default async function ConsoleLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error === "locked" ? CONSOLE.login.locked : error === "wrong" ? CONSOLE.login.wrong : error === "config" ? CONSOLE.login.notConfigured : null;
  return (
    <main className={styles.loginPage}>
      <form className={styles.login} method="post" action="/api/console/login">
        <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={150} height={35} priority className={styles.loginLogo} />
        <h1 className={styles.loginHeading}>{CONSOLE.login.heading}</h1>
        <p className={styles.loginIntro}>{CONSOLE.login.intro}</p>
        {message && (
          <p className={styles.error} role="alert">
            <WarningIcon size={18} />
            {message}
          </p>
        )}
        <div className={styles.formStack}>
          <label className={styles.field}>
            <span className={styles.label}>{CONSOLE.login.password}</span>
            <input name="password" type="password" className={styles.input} autoComplete="current-password" required autoFocus />
          </label>
          <button type="submit" className={`${styles.button} ${styles.buttonWide}`}>
            {CONSOLE.login.submit}
          </button>
        </div>
        <p className={styles.loginFooter}>{CONSOLE.login.footer}</p>
      </form>
    </main>
  );
}
