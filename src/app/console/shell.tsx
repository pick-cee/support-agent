"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { CONSOLE, PAGE } from "@/app/copy";
import { BellIcon, BookIcon, ChatIcon, ClipboardIcon, CloseIcon, FlagIcon, GridIcon, LogoutIcon, MenuIcon, SlidersIcon, UserIcon } from "@/app/icons";

import styles from "./console.module.css";

type Counts = { escalations: number; alerts: number };

const GROUPS = [
  // The Overview stands alone at the top, with no group heading of its own.
  { label: null, links: [{ href: "/console", label: CONSOLE.nav.overview, Icon: GridIcon, count: null }] },
  {
    label: CONSOLE.nav.groups.work,
    links: [
      { href: "/console/escalations", label: CONSOLE.nav.escalations, Icon: FlagIcon, count: "escalations" as const },
      { href: "/console/conversations", label: CONSOLE.nav.conversations, Icon: ChatIcon, count: null },
      { href: "/console/customers", label: CONSOLE.nav.customers, Icon: UserIcon, count: null },
    ],
  },
  { label: CONSOLE.nav.groups.improve, links: [{ href: "/console/knowledge", label: CONSOLE.nav.knowledge, Icon: BookIcon, count: null }] },
  {
    label: CONSOLE.nav.groups.system,
    links: [
      { href: "/console/alerts", label: CONSOLE.nav.alerts, Icon: BellIcon, count: "alerts" as const },
      { href: "/console/evals", label: CONSOLE.nav.evals, Icon: ClipboardIcon, count: null },
      { href: "/console/settings", label: CONSOLE.nav.settings, Icon: SlidersIcon, count: null },
    ],
  },
];

// The console's frame: a sidebar that is always there on a wide screen and a
// drawer on a narrow one, and a top bar with the date and the system's health.
export function ConsoleShell({ counts, today, healthy, alerts, banner, children }: { counts: Counts; today: string; healthy: boolean; alerts: number; banner: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar} data-open={open ? "true" : "false"} aria-label={CONSOLE.product}>
        <Link href="/console" className={styles.sidebarBrand}>
          <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={132} height={31} priority />
          <span className={styles.sidebarProduct}>{CONSOLE.product}</span>
        </Link>
        <nav className={styles.navScroll} aria-label="Console">
          {GROUPS.map((group, index) => (
            <div key={index} className={styles.navGroup}>
              {group.label && <p className={styles.navGroupLabel}>{group.label}</p>}
              {group.links.map(({ href, label, Icon, count }) => {
                const current = href === "/console" ? pathname === "/console" : pathname.startsWith(href);
                const value = count ? counts[count] : 0;
                return (
                  // A link followed on a phone closes the drawer.
                  <Link key={href} href={href} className={styles.navLink} aria-current={current ? "page" : undefined} onClick={() => setOpen(false)}>
                    <Icon size={18} className={styles.navIcon} />
                    {label}
                    {value > 0 && (
                      <span className={styles.navCount} data-tone={count === "alerts" ? "bad" : undefined}>
                        {value}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <form method="post" action="/api/console/logout">
            <button type="submit" className={styles.logoutButton}>
              <LogoutIcon size={18} />
              {CONSOLE.nav.logout}
            </button>
          </form>
        </div>
      </aside>
      <div className={styles.scrim} data-open={open ? "true" : "false"} onClick={() => setOpen(false)} aria-hidden="true" />

      <div className={styles.content}>
        <header className={styles.topbar}>
          <button type="button" className={styles.menuButton} onClick={() => setOpen((value) => !value)} aria-label={open ? CONSOLE.nav.close : CONSOLE.nav.menu} aria-expanded={open}>
            {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          </button>
          {/* On a narrow screen the sidebar's logo is behind the menu, so the bar carries the mark. */}
          <Link href="/console" className={styles.topbarMark} aria-label={CONSOLE.nav.overview}>
            <Image src="/icon.png" alt="" width={26} height={26} />
          </Link>
          <span className={styles.topbarDate}>{today}</span>
          <Link href="/console/alerts" className={styles.health} data-tone={healthy ? "good" : "bad"}>
            <span className={styles.healthDot} aria-hidden="true" />
            <span className={styles.healthLong}>{healthy ? CONSOLE.health.good : CONSOLE.health.attention(alerts)}</span>
            <span className={styles.healthShort}>{healthy ? CONSOLE.health.goodShort : CONSOLE.health.attentionShort(alerts)}</span>
          </Link>
        </header>
        {banner}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
