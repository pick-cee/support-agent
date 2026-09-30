import type { Metadata } from "next";
import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { WarningIcon } from "@/app/icons";
import { requireConsoleSession } from "@/lib/console/auth";
import { lagosToday } from "@/lib/console/format";
import { alertsUndelivered, navCounts } from "@/lib/console/queries";
import { coverage } from "@/lib/notifications";

import styles from "../console.module.css";
import { ConsoleShell } from "../shell";

export const metadata: Metadata = { title: CONSOLE.title, robots: { index: false } };

export default async function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireConsoleSession();
  const [undelivered, counts, reach] = await Promise.all([alertsUndelivered(), navCounts(), coverage()]);
  const nobodyForAlerts = reach.critical_alerts === 0 && reach.warning_alerts === 0;
  // DESIGN §10.4: when the alert channel itself is broken, the console says so in red, and why.
  const banner =
    undelivered > 0 ? (
      <div className={styles.banner} role="alert">
        <WarningIcon size={18} />
        {nobodyForAlerts ? CONSOLE.undelivered.noRecipients : CONSOLE.undelivered.failed(undelivered)}
        {nobodyForAlerts && <Link href="/console/settings">{CONSOLE.undelivered.action}</Link>}
      </div>
    ) : null;
  return (
    <ConsoleShell counts={counts} today={lagosToday()} healthy={counts.alerts === 0} alerts={counts.alerts} banner={banner}>
      {children}
    </ConsoleShell>
  );
}
