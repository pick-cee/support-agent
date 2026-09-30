import { CONSOLE } from "@/app/copy";
import { DEFAULT_AGENT_MODEL } from "@/lib/constants";
import { knowledgeCounts } from "@/lib/console/queries";
import { optionalEnv } from "@/lib/env";
import { listRecipients } from "@/lib/notifications";

import styles from "../../console.module.css";
import { Badge, Card, PageHeader } from "../../parts";
import { RecipientsManager } from "./recipients-manager";

export default async function Settings() {
  const [recipients, knowledge] = await Promise.all([listRecipients(), knowledgeCounts()]);
  const s = CONSOLE.settings;
  const voiceReady = Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY && process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID);
  return (
    <>
      <PageHeader title={s.heading} intro={s.intro} />
      <Card title={s.notifications.heading} intro={s.notifications.intro}>
        <RecipientsManager initial={recipients} />
      </Card>
      <Card title={s.system.heading}>
        <dl className={styles.facts}>
          <div>
            <dt>{s.system.model}</dt>
            <dd>{optionalEnv("AGENT_MODEL") ?? DEFAULT_AGENT_MODEL}</dd>
          </div>
          <div>
            <dt>{s.system.voice}</dt>
            <dd>
              <Badge tone={voiceReady ? "good" : "warn"} dot>
                {voiceReady ? s.system.voiceReady : s.system.voiceMissing}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>{s.system.knowledge}</dt>
            <dd>{s.system.knowledgeChunks(knowledge.document, knowledge.team)}</dd>
          </div>
          <div>
            <dt>{s.system.sender}</dt>
            <dd>{optionalEnv("RESEND_FROM_EMAIL") ?? s.system.notSet}</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}
