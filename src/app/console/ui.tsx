"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CONSOLE } from "@/app/copy";
import { CheckCircleIcon, WarningIcon } from "@/app/icons";

import styles from "./console.module.css";

// Interactive pieces of the console.

export type ToastState = { text: string; tone: "good" | "bad" } | null;

/** A short confirmation that slides in and leaves by itself. Announced to screen readers. */
export function useToast(): [ToastState, (text: string, tone?: "good" | "bad") => void] {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((text: string, tone: "good" | "bad" = "good") => {
    clearTimeout(timer.current);
    setToast({ text, tone });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

export function Toast({ toast }: { toast: ToastState }) {
  return (
    <div role="status" aria-live="polite">
      {toast && (
        <div className={styles.toast} data-tone={toast.tone}>
          {toast.tone === "good" ? <CheckCircleIcon size={18} /> : <WarningIcon size={18} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** An escalation's status, saved the moment it changes; the audit row is written by the server. */
export function StatusSelect({ id, reference, initial }: { id: string; reference: string; initial: string }) {
  const [status, setStatus] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [toast, show] = useToast();
  const router = useRouter();
  const change = async (next: string) => {
    const previous = status;
    setStatus(next);
    setSaving(true);
    try {
      const response = await fetch(`/api/console/escalations/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
      if (!response.ok || body.ok === false) throw new Error("not saved");
      show(`${reference}: ${CONSOLE.escalations.saved}`);
      // The queue's badge and the status history are server-rendered; they catch up here.
      router.refresh();
    } catch {
      setStatus(previous);
      show(CONSOLE.escalations.saveFailed, "bad");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <select className={styles.select} value={status} disabled={saving} onChange={(event) => void change(event.target.value)} aria-label={`Status of ${reference}`}>
        {Object.entries(CONSOLE.escalations.statuses).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Toast toast={toast} />
    </>
  );
}
