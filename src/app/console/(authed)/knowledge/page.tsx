import { CONSOLE } from "@/app/copy";
import { when } from "@/lib/console/format";
import { knowledgeGaps } from "@/lib/console/queries";
import { listTeamKnowledge } from "@/lib/team-knowledge";

import { PageHeader } from "../../parts";
import { KnowledgeManager } from "./knowledge-manager";

// What the assistant could not answer is a deliverable (DESIGN §1): the backlog
// of answers worth writing once. Written here, they become knowledge the
// assistant uses from the next question on (DESIGN §8).
export default async function Knowledge() {
  const [gaps, entries] = await Promise.all([knowledgeGaps(), listTeamKnowledge()]);
  return (
    <>
      <PageHeader title={CONSOLE.knowledge.heading} intro={CONSOLE.knowledge.intro} />
      <KnowledgeManager
        gaps={gaps}
        initialEntries={entries.map((entry) => ({
          ...entry,
          expires_label: entry.expires_at ? when(entry.expires_at) : null,
          created_label: when(entry.created_at),
        }))}
      />
    </>
  );
}
