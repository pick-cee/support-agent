import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { UserIcon } from "@/app/icons";
import { customerSummaries } from "@/lib/console/customers";
import { listTime } from "@/lib/console/format";

import styles from "../../console.module.css";
import { accountTone } from "../../customer-card";
import { Avatar, Card, Empty, PageHeader, StatusText } from "../../parts";

// Every customer, the most recently in touch first (DESIGN §14), each opening
// their profile and everything support has done with them.
export default async function Customers() {
  const rows = await customerSummaries();
  const c = CONSOLE.customers;
  return (
    <>
      <PageHeader title={c.heading} intro={c.intro} />
      <Card title={c.count(rows.length)}>
        {rows.length === 0 ? (
          <Empty icon={<UserIcon size={20} />}>{c.empty.conversations}</Empty>
        ) : (
          <ul className={styles.customerList}>
            {rows.map((row) => (
              <li key={row.customer_id}>
                <Link href={`/console/customers/${row.customer_id}`} className={styles.customerRow}>
                  <span className={styles.customerPerson}>
                    <Avatar name={row.contact_name} />
                    <span className={styles.customerCell}>
                      <span className={styles.customerName}>{row.company_name}</span>
                      <span className={styles.muted}>
                        {row.contact_name} · {row.plan}
                      </span>
                    </span>
                  </span>
                  <span className={styles.customerCell}>
                    <StatusText tone={accountTone(row.account_status)}>{c.accountStatus[row.account_status] ?? row.account_status}</StatusText>
                    <span className={styles.muted}>
                      {c.labels.identity}: {c.kyc[row.kyc_status] ?? row.kyc_status}
                    </span>
                  </span>
                  <span className={styles.customerCell}>
                    <span>{c.conversations(row.conversations)}</span>
                    <span className={styles.muted}>{row.last_contact ? c.lastContact(listTime(row.last_contact)) : c.never}</span>
                  </span>
                  <span className={styles.customerCell}>
                    <StatusText tone={row.open_tickets + row.open_escalations > 0 ? "warn" : "neutral"}>{c.open(row.open_tickets, row.open_escalations)}</StatusText>
                    <span className={styles.muted}>{row.region}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
