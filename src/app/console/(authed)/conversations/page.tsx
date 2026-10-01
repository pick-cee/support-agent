import { ConversationInbox, readQuery } from "./inbox";

export default async function Conversations({ searchParams }: { searchParams: Promise<{ channel?: string; q?: string }> }) {
  const query = readQuery(await searchParams);
  return <ConversationInbox query={query} activeId={null} />;
}
