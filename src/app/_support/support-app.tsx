"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { PAGE } from "../copy";
import { ArrowUpIcon, CloseIcon, EndCallIcon, InfoIcon, MicIcon, MicOffIcon, PlusIcon } from "../icons";
import styles from "../page.module.css";
import { CallView } from "./call-view";
import { Composer, type ComposerHandle } from "./composer";
import { SummaryCard } from "./summary-card";
import { Thread } from "./thread";
import { useTextChat } from "./use-text-chat";
import { useVoiceCall } from "./use-voice-call";
import { Welcome } from "./welcome";

// The customer's page (DESIGN §13), conversation first: the conversation fills
// the page, the composer is docked at the bottom, and a voice call takes over
// the same space while it lasts. Typing and calling are the same product: one
// turn runner, one set of checks, one record.
export function SupportApp({ publicKey, assistantId }: { publicKey: string; assistantId: string }) {
  const chat = useTextChat();
  const call = useVoiceCall(publicKey, assistantId);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [voiceNotice, setVoiceNotice] = useState(false);
  const wasPending = useRef(false);
  // Typing into a live call: a fix for what speech recognition heard (DESIGN §13).
  const [callDraft, setCallDraft] = useState("");
  const callInputRef = useRef<HTMLInputElement>(null);

  const editHeard = useCallback((text: string) => {
    setCallDraft(text);
    requestAnimationFrame(() => {
      callInputRef.current?.focus();
      callInputRef.current?.select();
    });
  }, []);

  const sendTyped = (event: React.FormEvent) => {
    event.preventDefault();
    if (call.sendText(callDraft)) setCallDraft("");
  };

  // New words go to the bottom; the view follows them. The welcome screen is read from the top.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !chat.started) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [chat.started, chat.entries, chat.pending, chat.summary, chat.error]);

  // After a reply, the cursor is back in the box, ready for the next message.
  useEffect(() => {
    if (wasPending.current && !chat.pending) composerRef.current?.focus();
    wasPending.current = chat.pending;
  }, [chat.pending]);

  const startCall = useCallback(() => {
    if (!call.ready) {
      setVoiceNotice(true);
      return;
    }
    setVoiceNotice(false);
    setCallDraft("");
    void call.start();
  }, [call]);

  const backToMessages = useCallback(() => {
    call.dismiss();
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [call]);

  const restart = useCallback(() => {
    chat.restart();
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [chat]);

  const showEnd = Boolean(chat.conversationId) && !chat.ended && !call.open;
  const retryable = call.phase === "micBlocked" || call.phase === "connectFailed";

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Image src="/brand/relaypay-logo.png" alt={PAGE.logoAlt} width={132} height={31} priority />
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.brandLabel}>{PAGE.headerLabel}</span>
        </div>
        <div className={styles.topbarActions}>
          {showEnd && (
            <button type="button" className={styles.ghostButton} onClick={() => void chat.end()} disabled={chat.pending}>
              {PAGE.text.end}
            </button>
          )}
          <p className={styles.available}>
            <span className={styles.availableDot} aria-hidden="true" />
            {PAGE.available}
          </p>
        </div>
      </header>

      <main ref={scrollerRef} className={styles.scroller}>
        <div className={styles.column}>
          {call.open ? (
            <CallView
              phase={call.phase}
              lines={call.lines}
              summary={call.summary}
              startedAt={call.startedAt}
              busy={call.busy}
              muted={call.muted}
              orbRef={call.orbRef}
              onEdit={call.canType ? editHeard : null}
            />
          ) : !chat.started ? (
            <Welcome onPick={(question) => void chat.send(question)} onCall={startCall} disabled={chat.pending} />
          ) : (
            <div className={styles.conversation} role="log" aria-live="polite" aria-relevant="additions" aria-label={PAGE.text.logLabel}>
              <p className={styles.divider}>
                <span>{PAGE.text.today}</span>
              </p>
              <Thread entries={chat.entries} pending={chat.pending} revealFrom={1} />
              {chat.ended && (
                <>
                  <p className={styles.divider}>
                    <span>{PAGE.text.endedDivider}</span>
                  </p>
                  {chat.summary && <SummaryCard summary={chat.summary} />}
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <div className={styles.dock}>
        <div className={styles.dockInner}>
          {call.open ? (
            <div className={styles.callDock}>
              {call.canType && (
                <form className={styles.callType} onSubmit={sendTyped}>
                  <label htmlFor="call-type" className="visually-hidden">
                    {PAGE.voice.typeLabel}
                  </label>
                  <input
                    id="call-type"
                    ref={callInputRef}
                    className={styles.callTypeInput}
                    value={callDraft}
                    onChange={(event) => setCallDraft(event.target.value)}
                    placeholder={PAGE.voice.typePlaceholder}
                    autoComplete="off"
                    enterKeyHint="send"
                    maxLength={500}
                  />
                  <button type="submit" className={styles.sendButton} disabled={!callDraft.trim()} data-ready={callDraft.trim() ? "true" : "false"} aria-label={PAGE.voice.typeSend}>
                    <ArrowUpIcon size={18} />
                  </button>
                </form>
              )}
              <div className={styles.callActions}>
                {call.busy ? (
                  <>
                    <button type="button" className={styles.secondaryButton} onClick={call.toggleMute} aria-pressed={call.muted} disabled={!call.live}>
                      {call.muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
                      {call.muted ? PAGE.voice.unmute : PAGE.voice.mute}
                    </button>
                    <button type="button" className={styles.dangerButton} onClick={() => void call.stop()} disabled={call.phase === "ending" || call.phase === "askingMic"}>
                      <EndCallIcon size={20} />
                      {PAGE.voice.endCall}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className={styles.secondaryButton} onClick={backToMessages}>
                      {PAGE.voice.backToChat}
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={startCall}>
                      <MicIcon size={18} />
                      {retryable ? PAGE.voice.retry : PAGE.voice.callAgain}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : chat.ended ? (
            <div className={styles.callActions}>
              <button type="button" className={styles.primaryButton} onClick={restart}>
                <PlusIcon size={18} />
                {PAGE.text.restart}
              </button>
            </div>
          ) : (
            <>
              {(chat.error || voiceNotice) && (
                <div className={styles.inlineNotice} data-tone={chat.error ? "danger" : "info"} role={chat.error ? "alert" : "status"}>
                  <InfoIcon size={18} className={styles.inlineNoticeIcon} />
                  <p>{chat.error ?? PAGE.voice.notConfigured}</p>
                  <button
                    type="button"
                    className={styles.inlineNoticeClose}
                    aria-label={PAGE.text.dismiss}
                    onClick={() => {
                      chat.setError(null);
                      setVoiceNotice(false);
                    }}
                  >
                    <CloseIcon size={16} />
                  </button>
                </div>
              )}
              <Composer
                ref={composerRef}
                draft={chat.draft}
                onDraft={chat.setDraft}
                onSend={() => void chat.send(chat.draft)}
                onCall={startCall}
                pending={chat.pending}
                callReady={call.ready}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
