"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";

import { PAGE } from "./copy";
import { EndCallIcon, InfoIcon, MicIcon } from "./icons";
import styles from "./page.module.css";
import { SummaryCard, type Summary } from "./summary-card";

type Phase = "idle" | "askingMic" | "connecting" | "listening" | "speaking" | "ending" | "ended" | "micBlocked" | "connectFailed" | "dropped";

const ACTIVE: Phase[] = ["connecting", "listening", "speaking"];

function isMicError(error: unknown): boolean {
  const text = JSON.stringify(error ?? "").toLowerCase();
  return text.includes("notallowed") || text.includes("permission") || text.includes("microphone");
}

export function VoiceCall({ publicKey, assistantId, onUseText }: { publicKey: string; assistantId: string; onUseText: () => void }) {
  const vapiRef = useRef<Vapi | null>(null);
  const endingRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [caption, setCaption] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);

  const loadSummary = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(id)}/summary`, { cache: "no-store" });
      setSummary(response.ok ? await response.json() : "unavailable");
    } catch {
      setSummary("unavailable");
    }
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;
    vapi.on("call-start", () => setPhase("listening"));
    vapi.on("speech-start", () => setPhase("speaking"));
    vapi.on("speech-end", () => setPhase("listening"));
    vapi.on("call-end", () => {
      setPhase(endingRef.current ? "ended" : "dropped");
      endingRef.current = false;
      void loadSummary();
    });
    vapi.on("message", (message: { type?: string; role?: string; transcriptType?: string; transcript?: string }) => {
      if (message.type === "transcript" && message.role === "assistant" && message.transcriptType === "final" && message.transcript) {
        setCaption(message.transcript);
      }
    });
    vapi.on("error", (error: unknown) => setPhase(isMicError(error) ? "micBlocked" : "connectFailed"));
    return () => {
      void vapi.stop();
      vapiRef.current = null;
    };
  }, [publicKey, loadSummary]);

  const start = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi || !assistantId) return;
    setCaption("");
    setSummary(null);
    callIdRef.current = null;
    setPhase("askingMic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setPhase("micBlocked");
      return;
    }
    setPhase("connecting");
    try {
      const call = await vapi.start(assistantId);
      if (!call) setPhase("connectFailed");
      else callIdRef.current = call.id ?? null;
    } catch (error) {
      setPhase(isMicError(error) ? "micBlocked" : "connectFailed");
    }
  }, [assistantId]);

  const stop = useCallback(async () => {
    endingRef.current = true;
    setPhase("ending");
    await vapiRef.current?.stop();
  }, []);

  if (!publicKey || !assistantId) {
    return (
      <div className={styles.voice}>
        <div className={styles.notice} data-tone="info">
          <InfoIcon size={20} className={styles.noticeIcon} />
          <div>
            <p className={styles.noticeHeading}>{PAGE.voice.notConfigured.heading}</p>
            <p className={styles.noticeBody}>{PAGE.voice.notConfigured.body}</p>
            <button type="button" className={styles.secondaryButton} onClick={onUseText}>
              {PAGE.voice.notConfigured.action}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const active = ACTIVE.includes(phase);
  const inCall = active || phase === "askingMic" || phase === "ending";
  const statusText = phase === "micBlocked" || phase === "connectFailed" || phase === "dropped" ? null : PAGE.voice.status[phase];
  const notice = phase === "micBlocked" ? PAGE.voice.micBlocked : phase === "connectFailed" ? PAGE.voice.connectFailed : phase === "dropped" ? PAGE.voice.dropped : null;

  return (
    <div className={styles.voice}>
      <div className={styles.voiceStage}>
        <div className={styles.micRing} data-state={phase === "speaking" ? "speaking" : phase === "listening" ? "listening" : inCall ? "busy" : "idle"}>
          <MicIcon size={30} />
        </div>
        <h3 className={styles.voiceHeading}>{PAGE.voice.heading}</h3>
        <p className={styles.voiceBody}>{PAGE.voice.body}</p>
      </div>

      <div className={styles.statusArea} aria-live="polite">
        {statusText && (
          <p className={styles.status}>
            <span className={styles.statusDot} data-active={active ? "true" : "false"} aria-hidden="true" />
            {statusText}
          </p>
        )}
        {notice && (
          <div className={styles.notice} data-tone={phase === "dropped" ? "info" : "danger"} role="alert">
            <InfoIcon size={20} className={styles.noticeIcon} />
            <div>
              <p className={styles.noticeHeading}>{notice.heading}</p>
              <p className={styles.noticeBody}>{notice.body}</p>
            </div>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {inCall ? (
          <button type="button" className={styles.secondaryButton} data-wide="true" onClick={stop} disabled={phase === "ending" || phase === "askingMic"}>
            <EndCallIcon size={20} />
            {PAGE.voice.endCall}
          </button>
        ) : (
          <button type="button" className={styles.primaryButton} data-wide="true" onClick={start}>
            <MicIcon size={20} />
            {notice ? PAGE.voice.retry : PAGE.voice.startCall}
          </button>
        )}
      </div>

      {caption && (
        <figure className={styles.caption}>
          <figcaption className={styles.captionLabel}>{PAGE.voice.lastSaidLabel}</figcaption>
          <blockquote className={styles.captionText}>{caption}</blockquote>
        </figure>
      )}

      {summary && (phase === "ended" || phase === "dropped") && <SummaryCard summary={summary} />}
    </div>
  );
}
