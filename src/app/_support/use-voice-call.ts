"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";

import { FIRST_MESSAGE } from "../copy";
import type { Summary } from "./summary-card";

// The web call (DESIGN §13): Vapi does speech; the turn runner answers through
// /api/vapi/chat/completions. The page shows both sides as they speak, and keeps them after the call.

export type Phase = "idle" | "askingMic" | "connecting" | "listening" | "speaking" | "ending" | "ended" | "micBlocked" | "connectFailed" | "dropped";

/** One side of the call, as it builds up: the caller's words live, the assistant's as sent to its voice. */
export type CallLine = { id: number; role: "customer" | "assistant"; text: string; live: boolean };

const LIVE: Phase[] = ["connecting", "listening", "speaking"];

/**
 * The assistant's words are formatted for speech ("T X N 9 0 0 1"); on screen
 * they read as written ("TXN-9001"). Vapi's flush tokens are dropped.
 */
export function readable(text: string): string {
  return text
    .replace(/<flush\s*\/>/g, " ")
    // "T X N 9 0 0 1" (our speech formatting) and "TXN 9 0 0 1" (the caller, as transcribed) both read "TXN-9001".
    .replace(/\b([A-Z](?: ?[A-Z]){0,3}) ((?:\d[?.,]? ){2,}\d)\b/g, (_match, letters: string, digits: string) => `${letters.replace(/ /g, "")}-${digits.replace(/[^\d]/g, "")}`)
    .replace(/\s{2,}/g, " ")
    .trim();
}

type TranscriptMessage = { type?: string; role?: string; transcriptType?: string; transcript?: string; input?: string; status?: string; endedReason?: string };

/** Vapi's reasons for a call ending that are faults, not someone saying goodbye or hanging up. */
function endedByFault(reason: string | null): boolean {
  return reason !== null && /error|fail|timeout-reached|pipeline|transport|provider/i.test(reason);
}

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
  const [lines, setLines] = useState<CallLine[]>([]);
  const [muted, setMuted] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const nextLine = useRef(0);
  // The caller's finished words so far in this turn; a live partial is shown after them.
  const callerSoFar = useRef("");
  // Why Vapi ended the call, from its status update, so a goodbye is not shown as a dropped call.
  const endedReason = useRef<string | null>(null);
  const finishedRef = useRef(false);

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
      // The greeting is our own fixed line: shown exactly, not as Vapi transcribed its audio.
      setLines([{ id: nextLine.current++, role: "assistant", text: readable(FIRST_MESSAGE), live: false }]);
    });
    // After the call, the library still sends an error (its normal "meeting ended"
    // ejection) and a last speech-end; left in, they put the page back on
    // "Listening" after the goodbye (seen in the page's own event log, 2026-09-30).
    vapi.on("speech-start", () => {
      if (!finishedRef.current) setPhase("speaking");
    });
    vapi.on("speech-end", () => {
      if (!finishedRef.current) setPhase("listening");
    });
    // The call is over when the SDK says so or when Vapi's status says so, whichever
    // comes first: in one test the SDK's event never came after the assistant's
    // goodbye, and the page sat on "Listening" (2026-09-30).
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      // Ended on purpose (the End call button, the assistant's goodbye, the caller hanging up) or by a fault.
      setPhase(endingRef.current || (endedReason.current !== null && !endedByFault(endedReason.current)) ? "ended" : "dropped");
      setStartedAt(null);
      endingRef.current = false;
      void loadSummary();
    };
    vapi.on("call-end", finish);
    vapi.on("message", (message: TranscriptMessage) => {
      if (message.type === "status-update" && message.status === "ended") {
        endedReason.current = message.endedReason ?? null;
        finish();
        return;
      }
      // The caller: partial words as they speak, settled when final.
      if (message.type === "transcript" && message.role === "user" && message.transcript) {
        const final = message.transcriptType === "final";
        const text = readable(`${callerSoFar.current} ${message.transcript}`);
        if (final) callerSoFar.current = text;
        setLines((current) => {
          const last = current.at(-1);
          if (last?.role === "customer") return [...current.slice(0, -1), { ...last, text, live: !final }];
          return [...current, { id: nextLine.current++, role: "customer", text, live: !final }];
        });
        return;
      }
      // The assistant: its exact words, as sent to the voice. Vapi's transcription of
      // the assistant's audio is lossy ("An AI assistant" for "I'm an AI assistant"), so it is not used.
      if (message.type !== "voice-input" || !message.input) return;
      const text = readable(message.input);
      // The greeting is already on screen.
      if (!text || text === readable(FIRST_MESSAGE)) return;
      // The assistant has the floor: the caller's turn is over.
      callerSoFar.current = "";
      setLines((current) => {
        const settled = current.map((line) => (line.live ? { ...line, live: false } : line));
        const last = settled.at(-1);
        if (last?.role === "assistant") return [...settled.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
        return [...settled, { id: nextLine.current++, role: "assistant", text, live: false }];
      });
    });
    vapi.on("error", (error: unknown) => {
      if (!finishedRef.current) setPhase(isMicError(error) ? "micBlocked" : "connectFailed");
    });
    return () => {
      void vapi.stop();
      vapiRef.current = null;
    };
  }, [publicKey, loadSummary]);

  const start = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi || !assistantId) return;
    setLines([]);
    setMuted(false);
    callerSoFar.current = "";
    endedReason.current = null;
    finishedRef.current = false;
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
    setLines([]);
    setSummary(null);
  }, []);

  const toggleMute = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    const next = !vapi.isMuted();
    vapi.setMuted(next);
    setMuted(next);
  }, []);

  const live = LIVE.includes(phase);
  return {
    ready: Boolean(publicKey && assistantId),
    phase,
    lines,
    muted,
    toggleMute,
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
