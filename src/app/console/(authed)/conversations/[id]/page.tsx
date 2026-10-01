import { ConversationArticle } from "../conversation-article";
import { ConversationInbox, readQuery } from "../inbox";

export default async function ConversationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ channel?: string; q?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams.then(readQuery)]);
  return (
    <ConversationInbox query={query} activeId={id}>
      <ConversationArticle id={id} query={query} />
    </ConversationInbox>
  );
}
