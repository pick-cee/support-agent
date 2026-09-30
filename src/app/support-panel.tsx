"use client";

import { useCallback, useRef, useState } from "react";

import { PAGE } from "./copy";
import { ChatIcon, MicIcon, ShieldIcon } from "./icons";
import styles from "./page.module.css";
import { TextChat } from "./text-chat";
import { VoiceCall } from "./voice-call";

type Mode = "voice" | "text";

// Voice is the product (PRD); typing is the alternative. Both panels stay
// mounted, so switching tabs never loses a call or a conversation. When this
// deployment has no voice line, the page opens on typing.
export function SupportPanel({ publicKey, assistantId }: { publicKey: string; assistantId: string }) {
  const voiceReady = Boolean(publicKey && assistantId);
  const [mode, setMode] = useState<Mode>(voiceReady ? "voice" : "text");
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ voice: null, text: null });

  const choose = useCallback((next: Mode, focus = false) => {
    setMode(next);
    if (focus) tabs.current[next]?.focus();
  }, []);

  // Arrow keys move between tabs, as the ARIA tabs pattern expects.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      choose(event.key === "Home" ? "voice" : event.key === "End" ? "text" : mode === "voice" ? "text" : "voice", true);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="support-modes">
      <h2 id="support-modes" className="visually-hidden">
        {PAGE.modes.label}
      </h2>
      <div className={styles.tabs} role="tablist" aria-label={PAGE.modes.label} onKeyDown={onKeyDown}>
        {(["voice", "text"] as const).map((item) => (
          <button
            key={item}
            ref={(element) => {
              tabs.current[item] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${item}`}
            aria-selected={mode === item}
            aria-controls={`panel-${item}`}
            tabIndex={mode === item ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(item)}
          >
            {item === "voice" ? <MicIcon size={18} /> : <ChatIcon size={18} />}
            {item === "voice" ? PAGE.modes.voice : PAGE.modes.text}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-voice" aria-labelledby="tab-voice" hidden={mode !== "voice"} className={styles.panel}>
        <VoiceCall publicKey={publicKey} assistantId={assistantId} onUseText={() => choose("text", true)} />
      </div>
      <div role="tabpanel" id="panel-text" aria-labelledby="tab-text" hidden={mode !== "text"} className={styles.panel}>
        <TextChat />
      </div>

      <p className={styles.disclosure}>
        <ShieldIcon size={16} className={styles.disclosureIcon} />
        {PAGE.disclosure}
      </p>
    </section>
  );
}
