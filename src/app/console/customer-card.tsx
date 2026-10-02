import Link from "next/link";

import { CONSOLE } from "@/app/copy";
import { ArrowRightIcon } from "@/app/icons";
import type { CustomerProfile } from "@/lib/console/customers";
import { VERIFY_MAX_FAILURES } from "@/lib/constants";

import styles from "./console.module.css";
import { Avatar, Badge, StatusText, type Tone } from "./parts";

export function accountTone(status: string): Tone {
  return status === "active" ? "good" : status === "restricted" ? "bad" : "warn";
}

/** A transaction's or payout's status from the records. */
export function recordTone(status: string): Tone {
  if (status === "completed") return "good";
  if (status === "failed" || status === "review required") return "bad";
  if (status === "processing" || status === "delayed") return "warn";
  return "neutral";
}

/** "review required" reads "Review required". */
export function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function kycTone(status: string): Tone {
  return status === "approved" ? "good" : status === "review required" ? "bad" : "warn";
}

/** A long address wraps after the @, never mid-word. */
export function EmailLink({ email }: { email: string }) {
  const [local, ...rest] = email.split("@");
  return (
    <a href={`mailto:${email}`}>
      {local}
      {rest.length > 0 && (
        <>
          @<wbr />
          {rest.join("@")}
        </>
      )}
    </a>
  );
}

/** The account's facts, for the team: the contact's email and the support note included. */
export function CustomerFacts({ customer }: { customer: CustomerProfile }) {
  const c = CONSOLE.customers;
  return (
    <>
      <dl className={styles.summaryFacts}>
        <div>
          <dt>{c.labels.email}</dt>
          <dd>
            <EmailLink email={customer.contact_email} />
          </dd>
        </div>
        <div>
          <dt>{c.labels.plan}</dt>
          <dd>{customer.plan}</dd>
        </div>
        <div>
          <dt>{c.labels.account}</dt>
          <dd>
            <StatusText tone={accountTone(customer.account_status)}>{c.accountStatus[customer.account_status] ?? customer.account_status}</StatusText>
          </dd>
        </div>
        <div>
          <dt>{c.labels.identity}</dt>
          <dd>
            <StatusText tone={kycTone(customer.kyc_status)}>{c.kyc[customer.kyc_status] ?? customer.kyc_status}</StatusText>
          </dd>
        </div>
        <div>
          <dt>{c.labels.region}</dt>
          <dd>{customer.region}</dd>
        </div>
        <div>
          <dt>{c.labels.customerId}</dt>
          <dd>{customer.customer_id}</dd>
        </div>
      </dl>
      <div className={styles.noteBox}>
        <p className={styles.summaryLabel}>{c.labels.note}</p>
        <p>{customer.support_notes || c.noNote}</p>
      </div>
    </>
  );
}

/**
 * Who a conversation was with (DESIGN §14). Verified: the account in full and
 * a link to everything else with them. Not verified: what the caller said
 * about themselves, and any failed identity checks, so the team knows why
 * nothing was shared.
 */
export function CustomerCard({ customer, failures, gave }: { customer: CustomerProfile | null; failures: number; gave: { names: string[]; emails: string[] } }) {
  const k = CONSOLE.customerCard;
  if (customer) {
    return (
      <section className={styles.summaryCard} aria-label={k.heading}>
        <div className={styles.customerHead}>
          <Avatar name={customer.contact_name} />
          <div className={styles.customerWho}>
            <p className={styles.customerName}>
              {customer.contact_name}
              <span className={styles.muted}>{customer.company_name}</span>
            </p>
            <Badge tone="good" dot>
              {k.verified}
            </Badge>
          </div>
          <Link href={`/console/customers/${customer.customer_id}`} className={styles.sectionLink}>
            {CONSOLE.customers.view} <ArrowRightIcon size={14} />
          </Link>
        </div>
        <CustomerFacts customer={customer} />
      </section>
    );
  }
  const name = gave.names[0] ?? null;
  return (
    <section className={styles.summaryCard} aria-label={k.heading}>
      <div className={styles.customerHead}>
        <Avatar name={name ?? "?"} tone="muted" />
        <div className={styles.customerWho}>
          <p className={styles.customerName}>{name ?? k.unverified}</p>
          <Badge tone="neutral">{k.unverified}</Badge>
        </div>
      </div>
      <p className={styles.summaryNote}>{k.unverifiedBody}</p>
      {failures > 0 && (
        <p className={styles.summaryNote}>
          <StatusText tone={failures >= VERIFY_MAX_FAILURES ? "bad" : "warn"}>{k.failures(failures, failures >= VERIFY_MAX_FAILURES)}</StatusText>
        </p>
      )}
      <dl className={styles.summaryFacts}>
        <div>
          <dt>{k.name}</dt>
          <dd>{gave.names.length ? gave.names.join(", ") : k.gaveNothing}</dd>
        </div>
        <div>
          <dt>{k.email}</dt>
          <dd>
            {gave.emails.length
              ? gave.emails.map((email, index) => (
                  <span key={email}>
                    {index > 0 && ", "}
                    <EmailLink email={email} />
                  </span>
                ))
              : k.gaveNothing}
          </dd>
        </div>
      </dl>
    </section>
  );
}
