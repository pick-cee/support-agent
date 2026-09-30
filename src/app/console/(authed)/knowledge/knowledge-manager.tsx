"use client";

import { useRef, useState } from "react";

import { CONSOLE } from "@/app/copy";
import { BellIcon, BookIcon, CheckCircleIcon, PlusIcon } from "@/app/icons";

import styles from "../../console.module.css";
import { Badge, Empty } from "../../parts";
import { Toast, useToast } from "../../ui";

type Gap = { section: string; count: number; examples: string[] };
type Entry = { id: string; kind: "answer" | "notice"; title: string; body: string; source_question: string | null; expires_at: string | null; active: boolean; created_at: string; times_used: number; expired: boolean; expires_label: string | null; created_label: string };
type Tab = "gaps" | "answers" | "notices";

const k = CONSOLE.knowledge;

// Teaching the assistant (DESIGN §8): the questions it could not answer, the
// team's answers to them, and short-lived service notices. Saving embeds the
// entry, so the assistant can use it on the very next question.
export function KnowledgeManager({ gaps, initialEntries }: { gaps: Gap[]; initialEntries: Entry[] }) {
  const [tab, setTab] = useState<Tab>(gaps.length ? "gaps" : "answers");
  const [entries, setEntries] = useState(initialEntries);
  const [draft, setDraft] = useState<{ kind: "answer" | "notice"; title: string; body: string; source: string | null; hours: number }>({ kind: "answer", title: "", body: "", source: null, hours: 72 });
  const [saving, setSaving] = useState(false);
  const [toast, show] = useToast();
  const dialog = useRef<HTMLDialogElement>(null);

  const open = (kind: "answer" | "notice", question?: string) => {
    setDraft({ kind, title: question ?? "", body: "", source: question ?? null, hours: 72 });
    dialog.current?.showModal();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/console/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          source_question: draft.source,
          expires_at: draft.kind === "notice" ? new Date(Date.now() + draft.hours * 3_600_000).toISOString() : null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { entry?: Omit<Entry, "expired" | "expires_label" | "created_label"> };
      if (!response.ok || !body.entry) throw new Error("not saved");
      const saved = body.entry;
      setEntries((current) => [
        { ...saved, expired: false, expires_label: saved.expires_at ? new Date(saved.expires_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null, created_label: k.justNow },
        ...current,
      ]);
      dialog.current?.close();
      setTab(saved.kind === "notice" ? "notices" : "answers");
      show(k.form.saved);
    } catch {
      show(k.form.failed, "bad");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (entry: Entry) => {
    const next = !entry.active;
    setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, active: next } : item)));
    try {
      const response = await fetch(`/api/console/knowledge/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: next }) });
      if (!response.ok) throw new Error("not saved");
      show(next ? k.active : k.inactive);
    } catch {
      setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, active: !next } : item)));
      show(k.form.failed, "bad");
    }
  };

  const answers = entries.filter((entry) => entry.kind === "answer");
  const notices = entries.filter((entry) => entry.kind === "notice");
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "gaps", label: k.tabs.gaps, count: gaps.reduce((sum, gap) => sum + gap.count, 0) },
    { key: "answers", label: k.tabs.answers, count: answers.length },
    { key: "notices", label: k.tabs.notices, count: notices.filter((notice) => notice.active && !notice.expired).length },
  ];

  const list = (items: Entry[], empty: string, icon: React.ReactNode) =>
    items.length === 0 ? (
      <Empty icon={icon}>{empty}</Empty>
    ) : (
      <div>
        {items.map((entry) => (
          <article key={entry.id} className={styles.entry} data-active={entry.active && !entry.expired ? "true" : "false"}>
            <div className={styles.entryHead}>
              <h3 className={styles.entryTitle}>{entry.title}</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {entry.kind === "notice" && entry.expired ? (
                  <Badge>{k.notices.expired}</Badge>
                ) : (
                  <Badge tone={entry.active ? "good" : "neutral"} dot>
                    {entry.active ? k.active : k.inactive}
                  </Badge>
                )}
                {!(entry.kind === "notice" && entry.expired) && (
                  <button type="button" className={styles.buttonGhost} onClick={() => void toggle(entry)}>
                    {entry.active ? k.turnOff : k.turnOn}
                  </button>
                )}
              </div>
            </div>
            <p className={styles.entryBody}>{entry.body}</p>
            <p className={styles.entryMeta}>
              {entry.kind === "answer" && <span>{k.answers.used(entry.times_used)}</span>}
              {entry.kind === "notice" && <span>{entry.expires_label ? (entry.expired ? k.notices.expired : k.notices.until(entry.expires_label)) : k.notices.noExpiry}</span>}
              {entry.source_question && <span>{k.answers.from}</span>}
              <span>{entry.created_label}</span>
            </p>
          </article>
        ))}
      </div>
    );

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="tablist" aria-label={k.heading}>
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={styles.filter} onClick={() => setTab(item.key)}>
              {item.label}
              <span className={styles.filterCount}>{item.count}</span>
            </button>
          ))}
        </div>
        {tab !== "gaps" && (
          <button type="button" className={styles.button} onClick={() => open(tab === "notices" ? "notice" : "answer")}>
            <PlusIcon size={16} />
            {tab === "notices" ? k.notices.add : k.answers.add}
          </button>
        )}
      </div>

      {tab === "gaps" && (
        <div role="tabpanel">
          <p className={styles.intro} style={{ margin: "0 0 16px" }}>
            {k.gaps.intro}
          </p>
          {gaps.length === 0 ? (
            <Empty icon={<CheckCircleIcon size={20} />}>{k.gaps.empty}</Empty>
          ) : (
            gaps.map((gap) => (
              <section key={gap.section} className={styles.gapGroup}>
                <div className={styles.gapHead}>
                  <p className={styles.gapSection}>
                    <span className={styles.muted}>{k.gaps.nearest}: </span>
                    {gap.section === "No match" ? k.gaps.noMatch : gap.section}
                  </p>
                  <Badge tone="warn">{k.gaps.asked(gap.count)}</Badge>
                </div>
                {gap.examples.map((question) => (
                  <div key={question} className={styles.question}>
                    <p className={styles.questionText}>&quot;{question}&quot;</p>
                    <button type="button" className={styles.buttonSecondary} onClick={() => open("answer", question)}>
                      {k.gaps.answer}
                    </button>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      )}
      {tab === "answers" && (
        <div role="tabpanel">
          <p className={styles.intro} style={{ margin: "0 0 16px" }}>
            {k.answers.intro}
          </p>
          {list(answers, k.answers.empty, <BookIcon size={20} />)}
        </div>
      )}
      {tab === "notices" && (
        <div role="tabpanel">
          <p className={styles.intro} style={{ margin: "0 0 16px" }}>
            {k.notices.intro}
          </p>
          {list(notices, k.notices.empty, <BellIcon size={20} />)}
        </div>
      )}

      <dialog ref={dialog} className={styles.dialog} aria-labelledby="knowledge-dialog-title">
        <form className={styles.dialogBody} onSubmit={(event) => void save(event)}>
          <h2 id="knowledge-dialog-title" className={styles.dialogTitle}>
            {draft.kind === "notice" ? k.notices.add : k.answers.add}
          </h2>
          <div className={styles.formStack}>
            <label className={styles.field}>
              <span className={styles.label}>{draft.kind === "notice" ? k.form.headline : k.form.question}</span>
              <input className={styles.input} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required minLength={3} maxLength={200} />
              {draft.kind === "answer" && <span className={styles.hint}>{k.form.questionHint}</span>}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{draft.kind === "notice" ? k.form.notice : k.form.answer}</span>
              <textarea className={styles.textarea} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required minLength={3} maxLength={2000} />
              <span className={styles.hint}>{k.form.answerHint}</span>
            </label>
            {draft.kind === "notice" && (
              <label className={styles.field}>
                <span className={styles.label}>{k.form.expires}</span>
                <select className={styles.select} value={draft.hours} onChange={(event) => setDraft({ ...draft, hours: Number(event.target.value) })}>
                  {k.form.expiresOptions.map((option) => (
                    <option key={option.hours} value={option.hours}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={styles.formActions}>
              <button type="button" className={styles.buttonGhost} onClick={() => dialog.current?.close()}>
                {k.form.cancel}
              </button>
              <button type="submit" className={styles.button} disabled={saving}>
                {saving ? k.form.saving : k.form.save}
              </button>
            </div>
          </div>
        </form>
      </dialog>
      <Toast toast={toast} />
    </>
  );
}
