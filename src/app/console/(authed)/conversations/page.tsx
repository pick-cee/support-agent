import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { ChatIcon, KeyboardIcon, PhoneIcon } from "@/app/icons";
import { usd, when } from "@/lib/console/format";
import { conversationsList } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, channelLabel, Empty, outcomeLabel, outcomeTone, PageHeader } from "../../parts";

const CHANNELS = ["web", "phone", "text", "mcp_direct", "eval"];

export default async function Conversations({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const requested = (await searchParams).channel;
  const channel = requested && CHANNELS.includes(requested) ? requested : null;
  const rows = await conversationsList(channel);
  const c = CONSOLE.conversations;
  return (
    <>
      <PageHeader title={c.heading} intro={c.intro} />
      <div className={styles.toolbar}>
        <nav className={styles.filters} aria-label="Channel">
          <Link href="/console/conversations" className={styles.filter} aria-current={channel ? undefined : "page"}>
            {c.all}
          </Link>
          {CHANNELS.map((item) => (
            <Link key={item} href={`/console/conversations?channel=${item}`} className={styles.filter} aria-current={channel === item ? "page" : undefined}>
              {channelLabel(item)}
            </Link>
          ))}
        </nav>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<ChatIcon size={20} />}>{c.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {c.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.nowrap}>
                    <Link href={`/console/conversations/${row.id}`}>{when(row.created_at)}</Link>
                  </td>
                  <td className={styles.nowrap}>
                    <span className={styles.person}>
                      <span className={styles.avatar} data-tone="muted" aria-hidden="true" style={{ width: 28, height: 28 }}>
                        {row.channel === "text" ? <KeyboardIcon size={14} /> : <PhoneIcon size={14} />}
                      </span>
                      {channelLabel(row.channel)}
                    </span>
                  </td>
                  <td>
                    <Badge tone={outcomeTone(row.final_status)} dot>
                      {outcomeLabel(row.final_status)}
                    </Badge>
                  </td>
                  <td>
                    <span className={styles.clamp}>{row.summary ?? ""}</span>
                  </td>
                  <td className={styles.number}>{row.turn_count}</td>
                  <td className={styles.number}>{usd(row.agent_cost_estimate_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
