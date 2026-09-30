import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { ChatIcon, ClipboardIcon, KeyboardIcon, MicIcon, PhoneIcon, SearchIcon, WrenchIcon } from "@/app/icons";
import { listTime } from "@/lib/console/format";
import { conversationsList } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { channelLabel, outcomeLabel, outcomeTone, StatusText } from "../../parts";

export const CHANNELS = ["web", "phone", "text", "mcp_direct", "eval"];

const CHANNEL_ICONS: Record<string, typeof ChatIcon> = { web: MicIcon, phone: PhoneIcon, text: KeyboardIcon, eval: ClipboardIcon, mcp_direct: WrenchIcon };

export type InboxQuery = { channel: string | null; search: string | null };

export function readQuery(params: { channel?: string; q?: string }): InboxQuery {
  const channel = params.channel && CHANNELS.includes(params.channel) ? params.channel : null;
  const search = params.q?.trim().slice(0, 100) || null;
  return { channel, search };
}

/** The list's filters travel with every link, so opening a conversation keeps the list as it was. */
export function queryString({ channel, search }: InboxQuery, change: Partial<InboxQuery> = {}): string {
  const next = { channel, search, ...change };
  const params = new URLSearchParams();
  if (next.channel) params.set("channel", next.channel);
  if (next.search) params.set("q", next.search);
  const text = params.toString();
  return text ? `?${text}` : "";
}

// The conversations inbox (DESIGN §14): the list stays on the left, the
// conversation opens beside it. On a narrow screen one or the other shows.
export async function ConversationInbox({ query, activeId, children }: { query: InboxQuery; activeId: string | null; children: React.ReactNode }) {
  const rows = await conversationsList(query.channel, query.search);
  const c = CONSOLE.conversations;
  return (
    <div className={styles.inbox} data-has-detail={activeId ? "true" : "false"}>
      <section className={styles.inboxList} aria-labelledby="inbox-heading">
        <div className={styles.inboxHead}>
          <div className={styles.inboxTitleRow}>
            <h1 id="inbox-heading" className={styles.inboxTitle}>
              {c.heading}
            </h1>
            <span className={styles.inboxCount}>{c.count(rows.length)}</span>
          </div>
          <form className={styles.search} action="/console/conversations" role="search">
            {query.channel && <input type="hidden" name="channel" value={query.channel} />}
            <SearchIcon size={16} className={styles.searchIcon} />
            <input name="q" type="search" defaultValue={query.search ?? ""} placeholder={c.searchPlaceholder} aria-label={c.search} className={styles.searchInput} />
            {query.search && (
              <Link href={`/console/conversations${queryString(query, { search: null })}`} className={styles.searchClear}>
                {c.clear}
              </Link>
            )}
          </form>
          <nav className={styles.chips} aria-label="Channel">
            <Link href={`/console/conversations${queryString(query, { channel: null })}`} className={styles.chip} aria-current={query.channel ? undefined : "page"}>
              {c.all}
            </Link>
            {CHANNELS.map((item) => (
              <Link key={item} href={`/console/conversations${queryString(query, { channel: item })}`} className={styles.chip} aria-current={query.channel === item ? "page" : undefined}>
                {channelLabel(item)}
              </Link>
            ))}
          </nav>
        </div>

        {rows.length === 0 ? (
          <p className={styles.inboxNothing}>{query.search ? c.noMatch(query.search) : c.empty}</p>
        ) : (
          <ul className={styles.inboxItems}>
            {rows.map((row) => {
              const Icon = CHANNEL_ICONS[row.channel] ?? ChatIcon;
              const refs = [...row.escalations, ...row.tickets];
              return (
                <li key={row.id}>
                  <Link href={`/console/conversations/${row.id}${queryString(query)}`} className={styles.inboxItem} aria-current={row.id === activeId ? "page" : undefined}>
                    <span className={styles.channelIcon} title={channelLabel(row.channel)}>
                      <Icon size={16} />
                    </span>
                    <span className={styles.inboxItemBody}>
                      <span className={styles.inboxItemTop}>
                        <span className={styles.inboxItemTitle}>{row.first_words || c.silent}</span>
                        <time className={styles.inboxItemTime} dateTime={row.created_at}>
                          {listTime(row.created_at)}
                        </time>
                      </span>
                      <span className={styles.inboxItemMeta}>
                        <StatusText tone={outcomeTone(row.final_status)}>{outcomeLabel(row.final_status)}</StatusText>
                        <span className={styles.inboxItemSub}>
                          {[channelLabel(row.channel), c.turns(row.turn_count), ...refs].join(" · ")}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className={styles.inboxDetail}>{children}</section>
    </div>
  );
}

export function InboxPlaceholder({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className={styles.placeholder}>
      <span className={styles.placeholderIcon}>{icon}</span>
      <p className={styles.placeholderTitle}>{title}</p>
      <p className={styles.placeholderText}>{text}</p>
    </div>
  );
}
