"use client";

import { useState } from "react";

import { CONSOLE } from "@/app/copy";
import { MailIcon, PlusIcon, TrashIcon, WarningIcon } from "@/app/icons";

import styles from "../../console.module.css";
import { Avatar, Badge, Empty } from "../../parts";
import { Toast, useToast } from "../../ui";

type Kind = "escalations" | "critical_alerts" | "warning_alerts";
type Recipient = { id: string; email: string; name: string | null; active: boolean } & Record<Kind, boolean>;

const KINDS: Kind[] = ["escalations", "critical_alerts", "warning_alerts"];
const n = CONSOLE.settings.notifications;

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={styles.switch}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
      <span className={styles.switchTrack} aria-hidden="true" />
      <span className={styles.kindLabelMobile}>{label}</span>
    </label>
  );
}

// Who gets which emails (DESIGN §10.3). Every change saves at once and says so.
export function RecipientsManager({ initial }: { initial: Recipient[] }) {
  const [recipients, setRecipients] = useState(initial);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, show] = useToast();

  const missing = KINDS.filter((kind) => kind !== "warning_alerts" && !recipients.some((recipient) => recipient.active && recipient[kind]));

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdding(true);
    try {
      const response = await fetch("/api/console/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || null, escalations: true, critical_alerts: true, warning_alerts: false }),
      });
      const body = (await response.json().catch(() => ({}))) as { recipient?: Recipient; error?: string };
      if (response.ok && body.recipient) {
        setRecipients((current) => [...current, body.recipient!]);
        setEmail("");
        setName("");
        show(n.added);
      } else {
        show(body.error === "exists" ? n.exists : n.invalid, "bad");
      }
    } catch {
      show(n.saveFailed, "bad");
    } finally {
      setAdding(false);
    }
  };

  const update = async (recipient: Recipient, changes: Partial<Record<Kind | "active", boolean>>) => {
    setRecipients((current) => current.map((item) => (item.id === recipient.id ? { ...item, ...changes } : item)));
    try {
      const response = await fetch(`/api/console/recipients/${recipient.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      if (!response.ok) throw new Error("not saved");
      show(n.saved);
    } catch {
      setRecipients((current) => current.map((item) => (item.id === recipient.id ? recipient : item)));
      show(n.saveFailed, "bad");
    }
  };

  const remove = async (recipient: Recipient) => {
    if (!window.confirm(n.removeConfirm(recipient.email))) return;
    try {
      const response = await fetch(`/api/console/recipients/${recipient.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("not removed");
      setRecipients((current) => current.filter((item) => item.id !== recipient.id));
      show(n.removed);
    } catch {
      show(n.saveFailed, "bad");
    }
  };

  const test = async (recipient: Recipient) => {
    setTesting(recipient.id);
    try {
      const response = await fetch(`/api/console/recipients/${recipient.id}/test`, { method: "POST" });
      if (!response.ok) throw new Error("not sent");
      show(n.testSent(recipient.email));
    } catch {
      show(n.testFailed, "bad");
    } finally {
      setTesting(null);
    }
  };

  return (
    <>
      <form className={styles.formGrid} onSubmit={(event) => void add(event)}>
        <label className={styles.field}>
          <span className={styles.label}>{n.email}</span>
          <input className={styles.input} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder={n.emailPlaceholder} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{n.name}</span>
          <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="name" />
        </label>
        <button type="submit" className={styles.button} disabled={adding} style={{ minHeight: 42 }}>
          <PlusIcon size={16} />
          {adding ? n.adding : n.add}
        </button>
      </form>

      {missing.length > 0 && recipients.length > 0 && (
        <p className={styles.callout} style={{ marginTop: 20 }}>
          <WarningIcon size={18} />
          {n.missing(missing.map((kind) => n.kinds[kind].label.toLowerCase()).join(" or "))}
        </p>
      )}

      <div style={{ marginTop: 24 }}>
        {recipients.length === 0 ? (
          <Empty icon={<MailIcon size={20} />}>{n.empty}</Empty>
        ) : (
          <>
            <div className={styles.kindHeader} aria-hidden="true">
              <span />
              {KINDS.map((kind) => (
                <span key={kind} title={n.kinds[kind].hint}>
                  {n.kinds[kind].label}
                </span>
              ))}
              <span />
            </div>
            {recipients.map((recipient) => (
              <div key={recipient.id} className={styles.recipient} data-paused={recipient.active ? "false" : "true"}>
                <div className={styles.person}>
                  <Avatar name={recipient.name ?? recipient.email} />
                  {/* The name and its state on one line, the address on its own below: nothing wraps mid-row. */}
                  <div className={styles.personText}>
                    <span className={styles.personName}>
                      <span className={styles.cellStrong}>{recipient.name ?? recipient.email.split("@")[0]}</span>
                      <Badge tone={recipient.active ? "good" : "neutral"} dot>
                        {recipient.active ? n.active : n.paused}
                      </Badge>
                    </span>
                    {/* A long address wraps after the @, never mid-word. */}
                    <span className={styles.personEmail}>
                      {recipient.email.split("@")[0]}
                      {recipient.email.includes("@") && (
                        <>
                          @<wbr />
                          {recipient.email.split("@").slice(1).join("@")}
                        </>
                      )}
                    </span>
                  </div>
                </div>
                {KINDS.map((kind) => (
                  <Switch key={kind} checked={recipient[kind]} disabled={!recipient.active} label={n.kinds[kind].label} onChange={(value) => void update(recipient, { [kind]: value })} />
                ))}
                <div className={styles.recipientActions}>
                  <button type="button" className={styles.buttonGhost} onClick={() => void test(recipient)} disabled={testing === recipient.id || !recipient.active}>
                    <MailIcon size={16} />
                    {testing === recipient.id ? n.testing : n.test}
                  </button>
                  <button type="button" className={styles.buttonGhost} onClick={() => void update(recipient, { active: !recipient.active })}>
                    {recipient.active ? n.pause : n.resume}
                  </button>
                  <button type="button" className={styles.buttonDanger} onClick={() => void remove(recipient)} aria-label={`${n.remove} ${recipient.email}`}>
                    <TrashIcon size={16} />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <Toast toast={toast} />
    </>
  );
}
