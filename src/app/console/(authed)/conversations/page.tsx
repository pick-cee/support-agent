import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { usd, when } from "@/lib/console/format";
import { conversationsList } from "@/lib/console/queries";

import styles from "../../console.module.css";
import { Badge, channelLabel, Empty, outcomeLabel, outcomeTone, PageHeader } from "../../parts";

const CHANNELS = ["web", "phone", "text", "mcp_direct", "eval"];

export default async function Conversations({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const requested = (await searchParams).channel;
  const channel = requested && CHANNELS.includes(requested) ? requested : null;
  const rows = await conversationsList(channel);
  return (
    <>
      <PageHeader title={CONSOLE.conversations.heading} intro={CONSOLE.conversations.intro} />
      <nav className={styles.filters} aria-label="Channel">
        <Link href="/console/conversations" className={styles.filter} aria-current={channel ? undefined : "page"}>
          {CONSOLE.conversations.all}
        </Link>
        {CHANNELS.map((item) => (
          <Link key={item} href={`/console/conversations?channel=${item}`} className={styles.filter} aria-current={channel === item ? "page" : undefined}>
            {channelLabel(item)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Empty>{CONSOLE.conversations.empty}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {CONSOLE.conversations.columns.map((column) => (
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
                  <td className={styles.nowrap}>{channelLabel(row.channel)}</td>
                  <td className={styles.number}>{row.turn_count}</td>
                  <td>
                    <Badge tone={outcomeTone(row.final_status)}>{outcomeLabel(row.final_status)}</Badge>
                  </td>
                  <td className={styles.wide}>{row.summary ?? ""}</td>
                  <td className={styles.number}>{usd(row.agent_cost_estimate_usd)}</td>
                  <td className={styles.number}>{row.vapi_cost_usd ? usd(row.vapi_cost_usd) : <span className={styles.muted}>{CONSOLE.conversations.noVapiCost}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
