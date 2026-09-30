import { CONSOLE } from "@/app/copy";
import { ChatIcon } from "@/app/icons";

import { ConversationInbox, InboxPlaceholder, readQuery } from "./inbox";

export default async function Conversations({ searchParams }: { searchParams: Promise<{ channel?: string; q?: string }> }) {
  const query = readQuery(await searchParams);
  const c = CONSOLE.conversations;
  return (
    <ConversationInbox query={query} activeId={null}>
      <InboxPlaceholder icon={<ChatIcon size={22} />} title={c.selectTitle} text={c.select} />
    </ConversationInbox>
  );
}
