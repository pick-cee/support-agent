import styles from "../console.module.css";

// Shown while a console page's data loads: the page's shape, gently pulsing,
// instead of a blank screen.
export default function Loading() {
  return (
    <div aria-busy="true" style={{ display: "grid", gap: 24 }}>
      <div className={styles.skeleton} style={{ height: 64, maxWidth: 420 }} />
      <div className={styles.stats}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={styles.skeleton} style={{ height: 124 }} />
        ))}
      </div>
      <div className={styles.skeleton} style={{ height: 280 }} />
    </div>
  );
}
