import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { CONSOLE, PAGE } from "@/app/copy";
import { InfoIcon } from "@/app/icons";
import { requireConsoleSession } from "@/lib/console/auth";
import { alertsUndelivered } from "@/lib/console/queries";

import styles from "../console.module.css";
import { ConsoleNav } from "../nav";

export const metadata: Metadata = { title: CONSOLE.title, robots: { index: false } };

export default async function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireConsoleSession();
  const undelivered = await alertsUndelivered();
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link href="/console" className={styles.brand}>
            <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={120} height={28} priority />
            <span className={styles.product}>{CONSOLE.product}</span>
          </Link>
          <ConsoleNav />
          <form method="post" action="/api/console/logout" className={styles.logout}>
            <button type="submit" className={styles.linkButton}>
              {CONSOLE.nav.logout}
            </button>
          </form>
        </div>
      </header>
      {undelivered > 0 && (
        <div className={styles.banner} role="alert">
          <div className={styles.bannerInner}>
            <InfoIcon size={18} />
            {CONSOLE.undeliveredBanner(undelivered)}
          </div>
        </div>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
