import * as z from "zod";

import { companyKey, firstNameKey, normaliseEmail, normaliseReference } from "@/lib/normalise";

import { VERIFY_MAX_FAILURES } from "@/lib/constants";

import { lenientInput } from "../lenient-input";
import type { CustomerRecord, ToolDefinition, ToolOutcome } from "../types";
import { COMPLIANCE_TERMS, invalid, refused, refusedAfterEscalation, refusedLocked, verificationLocked } from "./shared";

type Input = { customer_id?: string; email?: string; company_name?: string; contact_name?: string };

type Identifiers = { customerId: string | null; email: string | null; companyKey: string | null; firstName: string | null };

const IDENTIFIER_NAMES: Record<keyof Identifiers, string> = {
  customerId: "customer_id",
  email: "email",
  companyKey: "company_name",
  firstName: "contact_name",
};

/** Which supplied identifiers this record agrees with, and which it contradicts. */
function compare(record: CustomerRecord, ids: Identifiers): { matched: string[]; contradicted: string[] } {
  const checks: [keyof Identifiers, boolean][] = [
    ["customerId", ids.customerId === record.customer_id],
    ["email", ids.email === record.contact_email.toLowerCase()],
    ["companyKey", ids.companyKey === record.company_key],
    ["firstName", ids.firstName === firstNameKey(record.contact_name)],
  ];
  const matched: string[] = [];
  const contradicted: string[] = [];
  for (const [key, agrees] of checks) {
    if (ids[key] === null) continue;
    (agrees ? matched : contradicted).push(IDENTIFIER_NAMES[key]);
  }
  return { matched, contradicted };
}

// A miss and a partial match get the same reply, so a caller cannot probe
// which companies are customers (DESIGN §2.5).
const NOT_VERIFIED: ToolOutcome = refused(
  "not_verified",
  "Those details could not be verified together. Say you couldn't verify the account with those details, and ask for a different identifier such as the company name, the contact's first name or the account email. Do not say which detail was wrong.",
  "refused: identifiers did not verify",
);

// One identity per conversation (DESIGN §7.2): a caller verified as Amara cannot
// become Daniel by naming his company. The same reply whether the new details
// are real or not, so a verified caller cannot test someone else's either.
const ALREADY_VERIFIED: ToolOutcome = refused(
  "already_verified",
  "This conversation is already verified for one account, and only that account can be discussed. Say you have already confirmed who you are speaking with, and that another account's holder needs to contact RelayPay themselves. Do not say whether the other details match anything.",
  "refused: conversation already verified for another account",
);

function routing(record: CustomerRecord): "normal" | "escalate_account_questions" | "verification_incomplete" {
  if (record.account_status === "restricted" || record.kyc_status === "review required") return "escalate_account_questions";
  if (record.account_status === "pending verification" || record.kyc_status === "pending") return "verification_incomplete";
  return "normal";
}

const STATUS_WORDS: Record<string, string> = {
  active: "active",
  restricted: "restricted",
  "pending verification": "waiting for business verification to be completed",
};

/** What may be said to the verified owner, written by code (DESIGN §7.3). */
export function speakableSummary(record: CustomerRecord): string {
  return `The account is ${STATUS_WORDS[record.account_status] ?? record.account_status} on the ${record.plan} plan.`;
}

export const lookupCustomer: ToolDefinition<Input> = {
  name: "lookup_customer",
  title: "Verify and look up a customer",
  description:
    "Verify the caller before anything about their account, a transaction or a payout. Needs at least two identifiers that agree on the same record: company name, the contact's first name, the account email or the customer id. " +
    "One identifier is not enough; the tool says which to ask for. On success the caller is verified for the rest of the call, for that one account only, and speakable_summary is what you may say. " +
    `After ${VERIFY_MAX_FAILURES} failed attempts in a call, verification closes. ` +
    "Never say anything listed in do_not_speak. routing escalate_account_questions means questions about the account itself go to a specialist; a transaction or payout reference the caller gave may still be looked up.",
  wireInput: lenientInput({
    customer_id: { type: "string", description: "A customer id the caller gave, for example CUS-1001. Rarely known by callers." },
    email: { type: "string", description: "The account email the caller gave, as they said it." },
    company_name: { type: "string", description: "The company name the caller gave, for example LagosLedger." },
    contact_name: { type: "string", description: "The caller's name as they gave it; the first name is compared." },
  }),
  strictInput: z.object({
    customer_id: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    company_name: z.string().trim().min(1).optional(),
    contact_name: z.string().trim().min(1).optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  purpose: (raw) => {
    const given = Object.entries(IDENTIFIER_NAMES)
      .map(([, name]) => name)
      .filter((name) => typeof raw[name] === "string" && String(raw[name]).trim() !== "");
    return `Verify the caller's account with ${given.length ? given.join(" and ") : "no identifiers"}.`;
  },

  invalidInput: () => invalid("No identifiers were given. Ask the caller for their company name and first name, or the account email.", "invalid_input: no identifiers"),

  async run({ input, context, state, repository }) {
    if (state?.escalated) return refusedAfterEscalation("customer lookup");
    if (verificationLocked(state)) return refusedLocked("customer lookup");

    const customer = normaliseReference(input.customer_id, "CUS");
    const ids: Identifiers = {
      customerId: customer.ok ? customer.id : null,
      email: normaliseEmail(input.email),
      companyKey: companyKey(input.company_name),
      firstName: firstNameKey(input.contact_name),
    };
    const supplied = (Object.keys(ids) as (keyof Identifiers)[]).filter((key) => ids[key] !== null);
    if (input.email && !ids.email) return invalid("The email did not read as an email address. Ask the caller to spell it.", "invalid_input: email did not validate");

    // Already verified: details that agree with that account confirm it again;
    // anything else is another account, refused before it is even checked.
    if (state?.verifiedCustomerId) {
      const current = await repository.findCustomer(state.verifiedCustomerId);
      const same = current ? compare(current, ids) : null;
      if (!current || !same || same.contradicted.length > 0 || same.matched.length === 0) return ALREADY_VERIFIED;
      return verifiedOutcome(current, same.matched);
    }

    if (supplied.length < 2) {
      const askFor = (["companyKey", "firstName", "email"] as const).filter((key) => ids[key] === null).map((key) => IDENTIFIER_NAMES[key]);
      return refused(
        "need_more_identifiers",
        `One identifier is not enough to verify an account. Ask the caller for one more: ${askFor.join(" or ")}.`,
        `refused: only ${supplied.length} identifier`,
        { ask_for: askFor },
      );
    }

    const candidates = await repository.findCustomerCandidates(ids);
    const verified = candidates
      .map((record) => ({ record, ...compare(record, ids) }))
      .filter((candidate) => candidate.matched.length >= 2 && candidate.contradicted.length === 0);
    if (verified.length !== 1) {
      // Counted on the conversation, so guessing ends at VERIFY_MAX_FAILURES.
      const failures = context.conversationId ? await repository.recordVerificationFailure(context.conversationId) : 0;
      return failures >= VERIFY_MAX_FAILURES ? refusedLocked("customer lookup") : NOT_VERIFIED;
    }

    const { record, matched } = verified[0]!;
    if (context.conversationId) await repository.setVerifiedCustomer(context.conversationId, record.customer_id);
    return verifiedOutcome(record, matched);
  },
};

function verifiedOutcome(record: CustomerRecord, matched: string[]): ToolOutcome {
  const route = routing(record);
  const payload = {
    found: true,
    verified: true,
    customer_id: record.customer_id,
    company_name: record.company_name,
    plan: record.plan,
    account_status: record.account_status,
    kyc_status: record.kyc_status,
    support_notes: record.support_notes,
    speakable_summary: speakableSummary(record),
    routing: route,
    region: record.region,
    // Returned because the spec requires them and routing needs them; never said.
    do_not_speak: ["customer_id", "kyc_status", "support_notes"],
    sensitive_terms: route === "escalate_account_questions" ? COMPLIANCE_TERMS : [],
  };
  return { status: "ok", isError: false, payload, summary: `verified ${record.customer_id} with ${matched.join(" and ")}: ${record.account_status}, routing ${route}` };
}
