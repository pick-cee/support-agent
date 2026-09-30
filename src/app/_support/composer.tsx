"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { TEXT_COUNTER_FROM_CHARS } from "@/lib/constants";

import { PAGE } from "../copy";
import { ArrowUpIcon, MicIcon, ShieldIcon } from "../icons";
import styles from "../page.module.css";
import { MAX_CHARS } from "./use-text-chat";

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onCall: () => void;
  pending: boolean;
  callReady: boolean;
};

export type ComposerHandle = { focus: () => void };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ draft, onDraft, onSend, onCall, pending, callReady }, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const resize = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    // Grows with the text; the stylesheet's max-height caps it and scrolls beyond.
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, []);

  useEffect(resize, [draft, resize]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  };

  const over = draft.length > MAX_CHARS;
  const canSend = Boolean(draft.trim()) && !pending;

  return (
    <div className={styles.composerWrap}>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
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
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby="support-message-hint"
          aria-invalid={over ? "true" : undefined}
        />
        <div className={styles.composerActions}>
          <button type="button" className={styles.callButton} onClick={onCall} aria-label={PAGE.voice.callLabel} data-ready={callReady ? "true" : "false"}>
            <MicIcon size={18} />
            <span className={styles.callButtonText}>{PAGE.voice.call}</span>
          </button>
          <button type="submit" className={styles.sendButton} disabled={!canSend} aria-label={PAGE.text.send} data-ready={canSend ? "true" : "false"}>
            <ArrowUpIcon size={18} />
          </button>
        </div>
      </form>
      <div className={styles.composerMeta}>
        <span className={styles.disclosure}>
          <ShieldIcon size={14} className={styles.disclosureIcon} />
          {PAGE.disclosure}
        </span>
        {draft.length >= TEXT_COUNTER_FROM_CHARS ? (
          <span id="support-message-hint" className={styles.counter} data-over={over ? "true" : "false"}>
            {PAGE.text.counter(draft.length, MAX_CHARS)}
          </span>
        ) : (
          <span id="support-message-hint" className={styles.hint}>
            {PAGE.text.hint}
          </span>
        )}
      </div>
    </div>
  );
});
