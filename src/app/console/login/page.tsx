import type { Metadata } from "next";
import Image from "next/image";

import { CONSOLE, PAGE } from "@/app/copy";

import styles from "../console.module.css";

export const metadata: Metadata = { title: CONSOLE.title, robots: { index: false } };

export default async function ConsoleLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error === "locked" ? CONSOLE.login.locked : error === "wrong" ? CONSOLE.login.wrong : error === "config" ? CONSOLE.login.notConfigured : null;
  return (
    <main className={styles.loginPage}>
      <form className={styles.login} method="post" action="/api/console/login">
        <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={140} height={33} priority className={styles.loginLogo} />
        <h1 className={styles.loginHeading}>{CONSOLE.login.heading}</h1>
        <p className={styles.loginIntro}>{CONSOLE.login.intro}</p>
        {message && (
          <p className={styles.error} role="alert">
            {message}
          </p>
        )}
        <div className={styles.field}>
          <label htmlFor="password">{CONSOLE.login.password}</label>
          <input id="password" name="password" type="password" className={styles.input} autoComplete="current-password" required autoFocus />
        </div>
        <button type="submit" className={`${styles.button} ${styles.buttonWide}`}>
          {CONSOLE.login.submit}
        </button>
        <p className={styles.loginFooter}>{CONSOLE.login.footer}</p>
      </form>
    </main>
  );
}
