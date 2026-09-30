import { CONSOLE } from "@/app/copy";
import { FlagIcon } from "@/app/icons";

import { InboxPlaceholder } from "../conversations/inbox";
import { EscalationInbox } from "./inbox";

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === "1";
  const e = CONSOLE.escalations;
  return (
    <EscalationInbox all={all} activeId={null}>
      <InboxPlaceholder icon={<FlagIcon size={22} />} title={e.selectTitle} text={e.select} />
    </EscalationInbox>
  );
}
