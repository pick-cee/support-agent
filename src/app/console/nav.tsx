"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CONSOLE } from "@/app/copy";

import styles from "./console.module.css";

const LINKS = [
  { href: "/console", label: CONSOLE.nav.today },
  { href: "/console/escalations", label: CONSOLE.nav.escalations },
  { href: "/console/conversations", label: CONSOLE.nav.conversations },
  { href: "/console/gaps", label: CONSOLE.nav.gaps },
  { href: "/console/alerts", label: CONSOLE.nav.alerts },
  { href: "/console/evals", label: CONSOLE.nav.evals },
];

// The current section is marked for sight and for screen readers (aria-current).
export function ConsoleNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Console">
      {LINKS.map((link) => {
        const current = link.href === "/console" ? pathname === "/console" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
