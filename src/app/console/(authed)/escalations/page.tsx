import { EscalationInbox } from "./inbox";

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === "1";
  return <EscalationInbox all={all} activeId={null} />;
}
