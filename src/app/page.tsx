import Image from "next/image";

import { PAGE } from "./copy";
import { HeadsetIcon, SearchDocIcon, ShieldIcon } from "./icons";
import styles from "./page.module.css";
import { SupportPanel } from "./support-panel";

const POINT_ICONS = [SearchDocIcon, ShieldIcon, HeadsetIcon];

// The customer's page (DESIGN §13), following the brand direction: logo top
// left, deep blue and teal-blue used sparingly, off-white background, Inter at
// two weights, one calm layout. No gradients, emoji or chat bubbles.
export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.siteHeader}>
        <div className={styles.headerInner}>
          <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={150} height={35} priority />
          <span className={styles.headerLabel}>{PAGE.headerLabel}</span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <section className={styles.intro} aria-labelledby="page-heading">
            <p className={styles.eyebrow}>{PAGE.eyebrow}</p>
            <h1 id="page-heading" className={styles.heading}>
              {PAGE.heading}
            </h1>
            <p className={styles.lead}>{PAGE.lead}</p>
          </section>

          <SupportPanel publicKey={process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? ""} assistantId={process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? ""} />

          <ul className={styles.points}>
            {PAGE.points.map((point, index) => {
              const Icon = POINT_ICONS[index] ?? ShieldIcon;
              return (
                <li key={point.title} className={styles.point}>
                  <span className={styles.pointIcon}>
                    <Icon size={20} />
                  </span>
                  <div>
                    <p className={styles.pointTitle}>{point.title}</p>
                    <p className={styles.pointBody}>{point.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </main>

      <footer className={styles.siteFooter}>
        <div className={styles.footerInner}>
          <span>{PAGE.footer}</span>
          <span>{PAGE.englishOnly}</span>
        </div>
      </footer>
    </div>
  );
}
