import Link from "next/link";

import { categoryLabel, CONSOLE } from "@/app/copy";
import { ArrowRightIcon, BellIcon, ChatIcon, CheckCircleIcon, ClockIcon, FlagIcon, KeyboardIcon, PhoneIcon } from "@/app/icons";
import { CONSOLE_CHART_MIN_SCALE, CONSOLE_OVERVIEW_DAYS } from "@/lib/constants";
import { age, lagosDayPart, ms, shortDay, usd, whenWithZone } from "@/lib/console/format";
import { dailyActivity, escalationsQueue, knowledgeCounts, overviewStats, recentConversations, type DayActivity } from "@/lib/console/queries";
import { coverage } from "@/lib/notifications";

import styles from "../console.module.css";
import { Avatar, Card, channelLabel, Empty, outcomeLabel, outcomeTone, PageHeader, StatusText, statusTone } from "../parts";

const SEGMENTS: (keyof Omit<DayActivity, "day">)[] = ["resolved", "ticket_created", "escalated", "other"];
const LEGEND: Record<(typeof SEGMENTS)[number], string> = { resolved: CONSOLE.outcomes.resolved!, ticket_created: CONSOLE.outcomes.ticket_created!, escalated: CONSOLE.outcomes.escalated!, other: CONSOLE.outcomes.open! };
const SWATCH: Record<(typeof SEGMENTS)[number], string> = { resolved: "var(--brand-primary)", ticket_created: "var(--brand-accent)", escalated: "#d9a441", other: "var(--border-strong)" };

// The scale starts at a few conversations, so one conversation is a short bar
// on a quiet day, not a full-height block that looks like a spike.
function scaleTop(max: number): number {
  if (max <= CONSOLE_CHART_MIN_SCALE) return CONSOLE_CHART_MIN_SCALE;
  const step = max <= 20 ? 2 : max <= 50 ? 10 : 20;
  return Math.ceil(max / step) * step;
}

function ActivityChart({ days }: { days: DayActivity[] }) {
  const totals = days.map((day) => SEGMENTS.reduce((sum, key) => sum + day[key], 0));
  const top = scaleTop(Math.max(...totals));
  return (
    <div className={styles.chartBlock} style={{ "--days": days.length } as React.CSSProperties}>
      <div className={styles.chartFrame}>
        <div className={styles.chartGrid} aria-hidden="true">
          {[top, top / 2, 0].map((value) => (
            <span key={value} className={styles.chartLine}>
              <span className={styles.chartTick}>{Number.isInteger(value) ? value : value.toFixed(1)}</span>
            </span>
          ))}
        </div>
        <div className={styles.chart} role="img" aria-label={days.map((day, index) => `${shortDay(day.day)}: ${totals[index]}`).join(", ")}>
          {days.map((day, index) => (
            <div key={day.day} className={styles.barSlot}>
              {totals[index] ? (
                <div className={styles.bar} style={{ height: `${(totals[index]! / top) * 100}%`, animationDelay: `${index * 40}ms` }} title={`${shortDay(day.day)}: ${totals[index]}`}>
                  {SEGMENTS.map((key) => (day[key] ? <span key={key} className={styles.barSegment} data-kind={key} style={{ flexGrow: day[key] }} /> : null))}
                </div>
              ) : (
                // A day with none still has its place: a quiet week reads as quiet, not broken.
                <div className={styles.barNone} title={`${shortDay(day.day)}: 0`} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.chartDays} aria-hidden="true">
        {days.map((day, index) => (
          <span key={day.day}>{days.length <= 7 || index % 2 === 1 || index === days.length - 1 ? shortDay(day.day) : ""}</span>
        ))}
      </div>
    </div>
  );
}

/** How the window's conversations ended: one bar split by outcome, with counts. Reads as clearly with three conversations as with three hundred. */
function Outcomes({ days }: { days: DayActivity[] }) {
  const counts = SEGMENTS.map((key) => ({ key, count: days.reduce((sum, day) => sum + day[key], 0) }));
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const a = CONSOLE.today.activity;
  return (
    <div className={styles.outcomes}>
      <p className={styles.outcomesLabel}>{a.outcomes}</p>
      <div className={styles.outcomeBar} role="img" aria-label={counts.map((item) => `${LEGEND[item.key]}: ${item.count}`).join(", ")}>
        {counts.map((item) => (item.count ? <span key={item.key} data-kind={item.key} style={{ flexGrow: item.count }} /> : null))}
      </div>
      <ul className={styles.outcomeList}>
        {counts.map((item) => (
          <li key={item.key} data-zero={item.count ? "false" : "true"}>
            <span className={styles.swatch} style={{ background: SWATCH[item.key] }} aria-hidden="true" />
            <span className={styles.outcomeName}>{LEGEND[item.key]}</span>
            <span className={styles.outcomeCount}>{a.share(item.count, Math.round((item.count / total) * 100))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Scannable first (DESIGN §14): numbers and status lead; detail is one click away.
export default async function Overview() {
  const [stats, open, days, recent, reach, knowledge] = await Promise.all([
    overviewStats(CONSOLE_OVERVIEW_DAYS),
    escalationsQueue(false),
    dailyActivity(CONSOLE_OVERVIEW_DAYS),
    recentConversations(6),
    coverage(),
    knowledgeCounts(),
  ]);
  const share = stats.finished ? Math.round((stats.resolvedWithoutHuman / stats.finished) * 100) : null;
  const t = CONSOLE.today;
  const setup = [
    { key: "recipients", done: reach.escalations > 0 && reach.critical_alerts > 0, copy: t.setup.recipients, href: "/console/settings" },
    { key: "voice", done: Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY && process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID), copy: t.setup.voice, href: null },
    { key: "knowledge", done: knowledge.document > 0, copy: t.setup.knowledge, href: null },
  ];

  return (
    <>
      <PageHeader eyebrow={CONSOLE.greeting(lagosDayPart())} title={t.heading} intro={t.intro(CONSOLE_OVERVIEW_DAYS)} />

      {setup.some((item) => !item.done) && (
        <section className={styles.setup} aria-labelledby="setup-heading">
          <div className={styles.setupHead}>
            <h2 id="setup-heading" className={styles.cardTitle}>
              {t.setup.heading}
            </h2>
            <span className={styles.setupProgress}>{t.setup.progress(setup.filter((item) => item.done).length, setup.length)}</span>
          </div>
          <div className={styles.meter} aria-hidden="true">
            <div className={styles.meterFill} style={{ width: `${(setup.filter((item) => item.done).length / setup.length) * 100}%` }} />
          </div>
          <ul className={styles.setupList}>
            {setup.map((item) => (
              <li key={item.key} className={styles.setupItem} data-done={item.done ? "true" : "false"}>
                <CheckCircleIcon size={18} className={styles.setupMark} />
                <div className={styles.setupText}>
                  <p className={styles.setupTitle}>{item.copy.title}</p>
                  {!item.done && <p className={styles.setupBody}>{item.copy.body}</p>}
                </div>
                {!item.done && item.href && "action" in item.copy && (
                  <Link href={item.href} className={styles.setupAction}>
                    {item.copy.action} <ArrowRightIcon size={14} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
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
          <p className={styles.statFoot}>{t.cards.today(stats.today)}</p>
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
          {stats.nextCallback && <p className={styles.statFoot}>{t.cards.next(whenWithZone(stats.nextCallback.at, stats.nextCallback.timezone))}</p>}
        </div>
        <div className={styles.stat}>
          <div className={styles.statTop}>
            <p className={styles.statLabel}>{t.cards.alerts}</p>
            <span className={styles.statIcon} data-tone={stats.critical ? "bad" : "accent"}>
              <BellIcon size={18} />
            </span>
          </div>
          <p className={styles.statValue}>{stats.alerts}</p>
          <p className={styles.statNote}>{t.cards.critical(stats.critical)}</p>
        </div>
      </div>

      <Card title={t.activity.heading(CONSOLE_OVERVIEW_DAYS)} intro={t.activity.intro}>
        {days.every((day) => SEGMENTS.every((key) => day[key] === 0)) ? (
          <Empty icon={<ChatIcon size={20} />}>{t.activity.empty(CONSOLE_OVERVIEW_DAYS)}</Empty>
        ) : (
          <div className={styles.activity}>
            <ActivityChart days={days} />
            <Outcomes days={days} />
          </div>
        )}
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
                  <Link href={`/console/escalations/${row.id}`} className={styles.listItem}>
                    <Avatar name={row.user_name} tone="accent" />
                    <div className={styles.listBody}>
                      <p className={styles.listTitle}>
                        {row.user_name}
                        {row.company_name && <span className={styles.muted}>{row.company_name}</span>}
                      </p>
                      <p className={styles.listText}>{row.reason}</p>
                      <p className={styles.listSub}>
                        <StatusText tone={statusTone(row.status)}>{CONSOLE.escalations.statuses[row.status] ?? row.status}</StatusText>
                        <span>
                          <CalendarLine when={row.appointment_time ? whenWithZone(row.appointment_time, row.timezone) : null} /> {categoryLabel(row.category)}
                        </span>
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
                        <span className={styles.listTitleText}>{row.first_words || CONSOLE.conversations.silent}</span>
                      </p>
                      <p className={styles.listSub}>
                        <StatusText tone={outcomeTone(row.final_status)}>{outcomeLabel(row.final_status)}</StatusText>
                        <span>{channelLabel(row.channel)}</span>
                      </p>
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
            { label: t.speed.firstText, value: stats.firstTextP50 === null ? t.none : ms(stats.firstTextP50), note: stats.firstTextP95 === null ? null : t.speed.slowest(ms(stats.firstTextP95)), empty: stats.firstTextP50 === null },
            { label: t.speed.vapiTurn, value: stats.vapiTurnP50 === null ? t.none : ms(stats.vapiTurnP50), note: stats.vapiTurnP95 === null ? null : t.speed.slowest(ms(stats.vapiTurnP95)), empty: stats.vapiTurnP50 === null },
            { label: t.speed.agentSpend, value: usd(stats.agentSpendEstimateUsd, 2), note: t.speed.estimate, empty: false },
            { label: t.speed.vapiCost, value: usd(stats.vapiCostUsd, 2), note: t.speed.billed, empty: false },
          ].map((item) => (
            <div key={item.label}>
              <p className={styles.statLabel}>{item.label}</p>
              <p className={styles.statValue} data-empty={item.empty ? "true" : "false"} data-size="small">
                {item.value}
              </p>
              {item.note && <p className={styles.statNote}>{item.note}</p>}
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
