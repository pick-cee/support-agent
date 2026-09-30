import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { ArrowRightIcon, BellIcon, ChatIcon, CheckCircleIcon, ClockIcon, FlagIcon, KeyboardIcon, PhoneIcon } from "@/app/icons";
import { age, lagosDayPart, ms, shortDay, usd, whenWithZone } from "@/lib/console/format";
import { dailyActivity, escalationsQueue, knowledgeCounts, recentConversations, todayStats, type DayActivity } from "@/lib/console/queries";
import { coverage } from "@/lib/notifications";

import styles from "../console.module.css";
import { Avatar, Badge, Card, channelLabel, Empty, outcomeLabel, outcomeTone, PageHeader, statusTone, words } from "../parts";

const SEGMENTS: (keyof Omit<DayActivity, "day">)[] = ["resolved", "ticket_created", "escalated", "other"];
const LEGEND: Record<(typeof SEGMENTS)[number], string> = { resolved: CONSOLE.outcomes.resolved!, ticket_created: CONSOLE.outcomes.ticket_created!, escalated: CONSOLE.outcomes.escalated!, other: CONSOLE.outcomes.open! };
const SWATCH: Record<(typeof SEGMENTS)[number], string> = { resolved: "var(--brand-primary)", ticket_created: "var(--brand-accent)", escalated: "#d9a441", other: "var(--border-strong)" };

function ActivityChart({ days }: { days: DayActivity[] }) {
  const totals = days.map((day) => SEGMENTS.reduce((sum, key) => sum + day[key], 0));
  const max = Math.max(1, ...totals);
  if (totals.every((total) => total === 0)) return <Empty icon={<ChatIcon size={20} />}>{CONSOLE.today.activity.empty}</Empty>;
  return (
    <>
      <div className={styles.chart} role="img" aria-label={days.map((day, index) => `${shortDay(day.day)}: ${totals[index]}`).join(", ")}>
        {days.map((day, index) => (
          <div key={day.day} style={{ height: "100%", display: "flex", alignItems: "flex-end" }}>
            {totals[index] ? (
              <div className={styles.bar} style={{ height: `${(totals[index]! / max) * 100}%`, width: "100%", animationDelay: `${index * 30}ms` }} title={`${shortDay(day.day)}: ${totals[index]}`}>
                {SEGMENTS.map((key) => (day[key] ? <span key={key} className={styles.barSegment} data-kind={key} style={{ flexGrow: day[key] }} /> : null))}
              </div>
            ) : (
              <div className={styles.barEmpty} style={{ width: "100%" }} />
            )}
          </div>
        ))}
      </div>
      <div className={styles.chartDays} aria-hidden="true">
        {days.map((day, index) => (
          <span key={day.day}>{index % 2 === 0 || index === days.length - 1 ? shortDay(day.day) : ""}</span>
        ))}
      </div>
      <ul className={styles.legend}>
        {SEGMENTS.map((key) => (
          <li key={key}>
            <span className={styles.swatch} style={{ background: SWATCH[key] }} aria-hidden="true" />
            {LEGEND[key]}
          </li>
        ))}
      </ul>
    </>
  );
}

// Scannable first (DESIGN §14): numbers and status lead; detail is one click away.
export default async function Today() {
  const [stats, open, days, recent, reach, knowledge] = await Promise.all([todayStats(), escalationsQueue(false), dailyActivity(14), recentConversations(6), coverage(), knowledgeCounts()]);
  const share = stats.finished ? Math.round((stats.resolvedWithoutHuman / stats.finished) * 100) : null;
  const t = CONSOLE.today;
  const setup = [
    { key: "recipients", done: reach.escalations > 0 && reach.critical_alerts > 0, copy: t.setup.recipients, href: "/console/settings" },
    { key: "voice", done: Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY && process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID), copy: t.setup.voice, href: null },
    { key: "knowledge", done: knowledge.document > 0, copy: t.setup.knowledge, href: null },
  ];
  const pair = (a: number | null, b: number | null) => (a === null ? t.none : t.speed.pair(ms(a), ms(b)));

  return (
    <>
      <PageHeader eyebrow={CONSOLE.greeting(lagosDayPart())} title={t.heading} intro={t.intro} />

      {setup.some((item) => !item.done) && (
        <Card title={t.setup.heading} intro={t.setup.intro} className={styles.setup}>
          <ul className={styles.setupList}>
            {setup.map((item) => (
              <li key={item.key} className={styles.setupItem} data-done={item.done ? "true" : "false"}>
                <CheckCircleIcon size={20} className={styles.setupMark} />
                <div>
                  <p className={styles.setupTitle}>{item.copy.title}</p>
                  <p className={styles.setupBody}>{item.done ? t.setup.done : item.copy.body}</p>
                  {!item.done && item.href && (
                    <Link href={item.href} className={styles.setupAction}>
                      {item.copy.action}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statTop}>
            <p className={styles.statLabel}>{t.cards.conversations}</p>
            <span className={styles.statIcon}>
              <ChatIcon size={18} />
            </span>
          </div>
          <p className={styles.statValue}>{stats.conversations}</p>
          <p className={styles.statNote}>{t.cards.byChannel(stats.voice, stats.typed)}</p>
        </div>
        <div className={styles.stat}>
          <div className={styles.statTop}>
            <p className={styles.statLabel}>{t.cards.resolved}</p>
            <span className={styles.statIcon} data-tone="good">
              <CheckCircleIcon size={18} />
            </span>
          </div>
          <p className={styles.statValue} data-empty={share === null ? "true" : "false"}>
            {share === null ? t.none : `${share}%`}
          </p>
          {share !== null && (
            <div className={styles.meter} aria-hidden="true">
              <div className={styles.meterFill} style={{ width: `${share}%` }} />
            </div>
          )}
          <p className={styles.statNote}>{t.cards.ofFinished(stats.resolvedWithoutHuman, stats.finished)}</p>
        </div>
        <div className={styles.stat}>
          <div className={styles.statTop}>
            <p className={styles.statLabel}>{t.cards.escalations}</p>
            <span className={styles.statIcon} data-tone="warn">
              <FlagIcon size={18} />
            </span>
          </div>
          <p className={styles.statValue}>{stats.openEscalations}</p>
          <p className={styles.statNote}>{t.cards.booked(stats.callsBooked)}</p>
        </div>
        <div className={styles.stat}>
          <div className={styles.statTop}>
            <p className={styles.statLabel}>{t.cards.alerts}</p>
            <span className={styles.statIcon} data-tone={stats.criticalToday ? "bad" : "accent"}>
              <BellIcon size={18} />
            </span>
          </div>
          <p className={styles.statValue}>{stats.alertsToday}</p>
          <p className={styles.statNote}>{t.cards.critical(stats.criticalToday)}</p>
        </div>
      </div>

      <Card title={t.activity.heading} intro={t.activity.intro}>
        <ActivityChart days={days} />
      </Card>

      <div className={styles.twoColumn}>
        <Card
          title={t.attention.heading}
          action={
            <Link href="/console/escalations" className={styles.sectionLink}>
              {t.attention.viewAll} <ArrowRightIcon size={14} />
            </Link>
          }
        >
          {open.length === 0 ? (
            <Empty icon={<CheckCircleIcon size={20} />}>{t.attention.empty}</Empty>
          ) : (
            <ul className={styles.list}>
              {open.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <Link href={row.conversation_id ? `/console/conversations/${row.conversation_id}` : "/console/escalations"} className={styles.listItem}>
                    <Avatar name={row.user_name} tone="accent" />
                    <div className={styles.listBody}>
                      <p className={styles.listTitle}>
                        {row.user_name}
                        {row.company_name && <span className={styles.muted}>{row.company_name}</span>}
                        <Badge tone={statusTone(row.status)} dot>
                          {CONSOLE.escalations.statuses[row.status] ?? row.status}
                        </Badge>
                      </p>
                      <p className={styles.listText}>{row.reason}</p>
                      <p className={styles.statNote}>
                        <CalendarLine when={row.appointment_time ? whenWithZone(row.appointment_time, row.timezone) : null} /> {row.escalation_ref} · {words(row.category)}
                      </p>
                    </div>
                    <span className={styles.listMeta}>{CONSOLE.escalations.age(age(row.created_at))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t.recent.heading}
          action={
            <Link href="/console/conversations" className={styles.sectionLink}>
              {t.recent.viewAll} <ArrowRightIcon size={14} />
            </Link>
          }
        >
          {recent.length === 0 ? (
            <Empty icon={<ChatIcon size={20} />}>{t.recent.empty}</Empty>
          ) : (
            <ul className={styles.list}>
              {recent.map((row) => (
                <li key={row.id}>
                  <Link href={`/console/conversations/${row.id}`} className={styles.listItem}>
                    <span className={styles.avatar} data-tone="muted" aria-hidden="true">
                      {row.channel === "text" ? <KeyboardIcon size={16} /> : <PhoneIcon size={16} />}
                    </span>
                    <div className={styles.listBody}>
                      <p className={styles.listTitle}>
                        {channelLabel(row.channel)}
                        <Badge tone={outcomeTone(row.final_status)} dot>
                          {outcomeLabel(row.final_status)}
                        </Badge>
                      </p>
                      <p className={styles.listText}>{row.first_words ? `"${row.first_words}"` : (row.summary ?? "")}</p>
                    </div>
                    <span className={styles.listMeta}>{CONSOLE.escalations.age(age(row.created_at))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t.speed.heading}>
        <div className={styles.stats}>
          {[
            { label: t.speed.firstText, value: pair(stats.firstTextP50, stats.firstTextP95), empty: stats.firstTextP50 === null },
            { label: t.speed.vapiTurn, value: pair(stats.vapiTurnP50, stats.vapiTurnP95), empty: stats.vapiTurnP50 === null },
            { label: t.speed.agentSpend, value: usd(stats.agentSpendEstimateUsd, 2), empty: false },
            { label: t.speed.vapiCost, value: usd(stats.vapiCostUsd, 2), empty: false },
          ].map((item) => (
            <div key={item.label}>
              <p className={styles.statLabel}>{item.label}</p>
              <p className={styles.statValue} data-empty={item.empty ? "true" : "false"} style={{ fontSize: item.empty ? undefined : "1.375rem" }}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
        <p className={styles.note}>{t.speed.costNote}</p>
      </Card>
    </>
  );
}

function CalendarLine({ when }: { when: string | null }) {
  return (
    <>
      <ClockIcon size={12} /> {when ?? CONSOLE.escalations.notBooked} ·
    </>
  );
}
