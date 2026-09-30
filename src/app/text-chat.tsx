"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TEXT_COUNTER_FROM_CHARS, TEXT_MESSAGE_MAX_CHARS } from "@/lib/constants";

import { PAGE, TYPED } from "./copy";
import { SendIcon } from "./icons";
import styles from "./page.module.css";
import { SummaryCard, type Summary } from "./summary-card";

// Typed messages (DESIGN §13). The browser keeps a copy of the conversation to
// show it, but the server rebuilds the transcript from its own records on every
// message and never trusts this copy. A transcript, not chat bubbles: the brand
// direction rules out chat-heavy treatment.

type Entry = { id: number; role: "customer" | "assistant"; text: string };
type ErrorCode = keyof typeof PAGE.text.errors;

// The server enforces the same limit; the page only warns early.
const MAX_CHARS = TEXT_MESSAGE_MAX_CHARS;

function errorText(code: ErrorCode): string {
  const message = PAGE.text.errors[code];
  return typeof message === "function" ? message(MAX_CHARS) : message;
}

export function TextChat() {
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, role: "assistant", text: TYPED.greeting }]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries, pending]);

  const resize = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    // Grows with the text; the stylesheet's max-height caps it and scrolls beyond.
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, []);

  useEffect(resize, [draft, resize]);

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
    async (text: string) => {
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
        inputRef.current?.focus();
      }
    },
    [conversationId, ended, end, pending],
  );

  const restart = useCallback(() => {
    setEntries([{ id: 0, role: "assistant", text: TYPED.greeting }]);
    setConversationId(null);
    setEnded(false);
    setSummary(null);
    setError(null);
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };

  const showSuggestions = entries.length === 1 && !pending && !ended;

  return (
    <div className={styles.chat}>
      <div
        ref={logRef}
        className={styles.log}
        data-started={entries.length > 1 || pending ? "true" : "false"}
        role="log"
        aria-label={PAGE.text.logLabel}
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {entries.map((entry) => (
          <div key={entry.id} className={styles.entry} data-role={entry.role}>
            <p className={styles.who}>{entry.role === "customer" ? PAGE.text.you : PAGE.text.assistant}</p>
            <p className={styles.message}>{entry.text}</p>
          </div>
        ))}
        {pending && (
          <div className={styles.entry} data-role="assistant">
            <p className={styles.who}>{PAGE.text.assistant}</p>
            <p className={styles.thinking}>
              <span className={styles.thinkingDots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {PAGE.text.thinking}
            </p>
          </div>
        )}
      </div>

      {showSuggestions && (
        <div className={styles.suggestions}>
          <p className={styles.suggestionsLabel}>{PAGE.text.suggestionsLabel}</p>
          <div className={styles.suggestionList}>
            {PAGE.text.suggestions.map((suggestion) => (
              <button key={suggestion} type="button" className={styles.suggestion} onClick={() => void send(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}

      {ended ? (
        <div className={styles.endedBlock}>
          <p className={styles.endedText}>{PAGE.text.ended}</p>
          {summary && <SummaryCard summary={summary} />}
          <button type="button" className={styles.primaryButton} data-wide="true" onClick={restart}>
            {PAGE.text.restart}
          </button>
        </div>
      ) : (
        <>
          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="support-message" className="visually-hidden">
              {PAGE.text.inputLabel}
            </label>
            <textarea
              id="support-message"
              ref={inputRef}
              className={styles.input}
              rows={1}
              value={draft}
              placeholder={PAGE.text.placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              aria-describedby="support-message-hint"
              aria-invalid={draft.length > MAX_CHARS ? "true" : undefined}
            />
            <button type="submit" className={styles.sendButton} disabled={pending || !draft.trim()}>
              <SendIcon size={18} />
              <span>{PAGE.text.send}</span>
            </button>
          </form>
          <div className={styles.composerMeta}>
            <span id="support-message-hint">{PAGE.text.hint}</span>
            {draft.length >= TEXT_COUNTER_FROM_CHARS && (
              <span className={styles.counter} data-over={draft.length > MAX_CHARS ? "true" : "false"}>
                {PAGE.text.counter(draft.length, MAX_CHARS)}
              </span>
            )}
          </div>
          {conversationId && (
            <button type="button" className={styles.linkButton} onClick={() => void end(conversationId)} disabled={pending}>
              {PAGE.text.end}
            </button>
          )}
        </>
      )}
    </div>
  );
}
