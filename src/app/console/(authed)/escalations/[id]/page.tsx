import { EscalationArticle } from "../escalation-article";
import { EscalationInbox } from "../inbox";

export default async function EscalationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string }> }) {
  const [{ id }, { all }] = await Promise.all([params, searchParams]);
  const showAll = all === "1";
  return (
    <EscalationInbox all={showAll} activeId={id}>
      <EscalationArticle id={id} showAll={showAll} />
    </EscalationInbox>
  );
}
