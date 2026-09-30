"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TEXT_MESSAGE_MAX_CHARS } from "@/lib/constants";

import { PAGE, TYPED } from "../copy";
import type { Summary } from "./summary-card";

// Typed messages (DESIGN §13). The browser keeps a copy of the conversation to
// show it, but the server rebuilds the transcript from its own records on every
// message and never trusts this copy.

export type Entry = { id: number; role: "customer" | "assistant"; text: string };
type ErrorCode = keyof typeof PAGE.text.errors;

// The server enforces the same limit; the page only warns early.
export const MAX_CHARS = TEXT_MESSAGE_MAX_CHARS;

function errorText(code: ErrorCode): string {
  const message = PAGE.text.errors[code];
  return typeof message === "function" ? message(MAX_CHARS) : message;
}

const GREETING: Entry = { id: 0, role: "assistant", text: TYPED.greeting };

export function useTextChat() {
  const [entries, setEntries] = useState<Entry[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const nextId = useRef(1);

  const end = useCallback(async (id: string) => {
    setEnded(true);
    try {
      const response = await fetch("/api/chat/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id }) });
      setSummary(response.ok ? await response.json() : "unavailable");
    } catch {
      setSummary("unavailable");
    }
  }, []);

  // A tab closed mid-conversation still ends it, so a customer who left mid-escalation gets a follow-up.
  useEffect(() => {
    if (!conversationId || ended) return;
    const onLeave = () => navigator.sendBeacon("/api/chat/end", new Blob([JSON.stringify({ conversationId })], { type: "application/json" }));
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [conversationId, ended]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const message = text.trim();
      if (!message || pending || ended) return;
      if (message.length > MAX_CHARS) {
        setError(errorText("too_long"));
        return;
      }
      setError(null);
      const customerEntry: Entry = { id: nextId.current++, role: "customer", text: message };
      setEntries((current) => [...current, customerEntry]);
      setDraft("");
      setPending(true);
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
        });
        const body = (await response.json().catch(() => ({}))) as { conversationId?: string; reply?: string; answerType?: string | null; error?: ErrorCode };
        if (response.ok && body.reply && body.conversationId) {
          setConversationId(body.conversationId);
          setEntries((current) => [...current, { id: nextId.current++, role: "assistant", text: body.reply! }]);
          // The assistant said goodbye: the conversation ends, as a call does.
          if (body.answerType === "closing") void end(body.conversationId);
          return;
        }
        if (body.error === "unavailable" && body.reply) {
          setEntries((current) => [...current, { id: nextId.current++, role: "assistant", text: body.reply! }]);
          return;
        }
        if (body.error === "ended") setEnded(true);
        // Not sent: the message goes back into the box, so nothing typed is lost.
        setEntries((current) => current.filter((entry) => entry.id !== customerEntry.id));
        setDraft(message);
        setError(errorText(body.error && body.error in PAGE.text.errors ? body.error : "bad_request"));
      } catch {
        setEntries((current) => current.filter((entry) => entry.id !== customerEntry.id));
        setDraft(message);
        setError(errorText("network"));
      } finally {
        setPending(false);
      }
    },
    [conversationId, ended, end, pending],
  );

  const restart = useCallback(() => {
    setEntries([GREETING]);
    setConversationId(null);
    setEnded(false);
    setSummary(null);
    setError(null);
    setDraft("");
  }, []);

  return {
    entries,
    draft,
    setDraft,
    pending,
    error,
    setError,
    conversationId,
    ended,
    summary,
    started: entries.length > 1 || pending,
    send,
    end: () => (conversationId ? end(conversationId) : undefined),
    restart,
  };
}
