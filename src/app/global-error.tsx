"use client";

import { ERRORS } from "./copy";
import "./globals.css";

// The last resort, when even the root layout failed: it brings its own html
// and body, and stays plain so nothing else can fail with it.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, padding: 16, fontFamily: "system-ui, sans-serif" }}>
        <div role="alert" style={{ maxWidth: 440, textAlign: "center" }}>
          <h1 style={{ color: "#0f347b", fontSize: "1.375rem" }}>{ERRORS.broken.title}</h1>
          <p style={{ color: "#4d596b", lineHeight: 1.6 }}>{ERRORS.broken.body}</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: "10px 18px", border: 0, borderRadius: 10, background: "#0f347b", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
            {ERRORS.broken.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
