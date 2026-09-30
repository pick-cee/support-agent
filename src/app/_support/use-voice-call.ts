"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Summary } from "./summary-card";

// The web call (DESIGN §13): Vapi does speech; the turn runner answers through
// /api/vapi/chat/completions. The page shows one live caption, not a transcript.

export type Phase = "idle" | "askingMic" | "connecting" | "listening" | "speaking" | "ending" | "ended" | "micBlocked" | "connectFailed" | "dropped";

const LIVE: Phase[] = ["connecting", "listening", "speaking"];

function isMicError(error: unknown): boolean {
  const text = JSON.stringify(error ?? "").toLowerCase();
  return text.includes("notallowed") || text.includes("permission") || text.includes("microphone");
}

export function useVoiceCall(publicKey: string, assistantId: string) {
  const vapiRef = useRef<Vapi | null>(null);
  const endingRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [caption, setCaption] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // The orb breathes with whoever is talking. Levels arrive many times a
  // second, so they go straight to a CSS variable, eased, not through React.
  // The frame loop runs only while someone can be talking, never on an idle page.
  useEffect(() => {
    const vapi = vapiRef.current;
    const orb = orbRef.current;
    if (!vapi || !orb || (phase !== "listening" && phase !== "speaking") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let target = 0;
    let shown = 0;
    let frame = 0;
    const tick = () => {
      shown += (target - shown) * 0.25;
      orb.style.setProperty("--level", shown.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onLevel = (volume: number) => {
      target = Math.min(1, volume * 2.2);
    };
    vapi.on("volume-level", onLevel);
    vapi.on("local-volume-level", onLevel);
    return () => {
      cancelAnimationFrame(frame);
      vapi.removeListener("volume-level", onLevel);
      vapi.removeListener("local-volume-level", onLevel);
      orb.style.setProperty("--level", "0");
    };
  }, [phase]);

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
    vapi.on("call-start", () => {
      setStartedAt(Date.now());
      setPhase("listening");
    });
    vapi.on("speech-start", () => setPhase("speaking"));
    vapi.on("speech-end", () => setPhase("listening"));
    vapi.on("call-end", () => {
      setPhase(endingRef.current ? "ended" : "dropped");
      setStartedAt(null);
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

  /** Back to idle once the customer has read how the call ended. */
  const dismiss = useCallback(() => {
    setPhase("idle");
    setCaption("");
    setSummary(null);
  }, []);

  const live = LIVE.includes(phase);
  return {
    ready: Boolean(publicKey && assistantId),
    phase,
    caption,
    summary,
    startedAt,
    orbRef,
    live,
    /** Anything but idle: the call view is showing. */
    open: phase !== "idle",
    busy: live || phase === "askingMic" || phase === "ending",
    start,
    stop,
    dismiss,
  };
}
