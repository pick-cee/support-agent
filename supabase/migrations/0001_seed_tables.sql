-- The client's seed records (assets/seed-data). Status columns take exactly
-- the values in the CSVs, spaces included, so a typo in code fails loudly
-- instead of matching nothing. An empty CSV field is NULL: unknown is not empty.
-- Nothing the agent can reach writes to these tables.

create table support_agent.customers (
  customer_id text primary key check (customer_id ~ '^CUS-[0-9]+$'),
  company_name text not null,
  -- For matching what speech-to-text produces: "Lagos Ledger" finds LagosLedger.
  company_key text generated always as (lower(regexp_replace(company_name, '[^A-Za-z0-9]', '', 'g'))) stored,
  contact_name text not null,
  contact_email text not null,
  plan text not null check (plan in ('Starter', 'Growth', 'Scale')),
  account_status text not null check (account_status in ('active', 'restricted', 'pending verification')),
  region text not null,
  kyc_status text not null check (kyc_status in ('pending', 'approved', 'review required')),
  support_notes text null
);

create unique index customers_company_key_idx on support_agent.customers (company_key);

create table support_agent.transactions (
  transaction_id text primary key check (transaction_id ~ '^TXN-[0-9]+$'),
  customer_id text not null references support_agent.customers (customer_id),
  transaction_type text not null check (transaction_type in ('incoming transfer', 'outgoing payout', 'invoice payment')),
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  destination_country text null,
  status text not null check (status in ('processing', 'completed', 'delayed', 'failed', 'review required')),
  created_at date not null,
  estimated_arrival date null,
  support_summary text null
);

create index transactions_customer_idx on support_agent.transactions (customer_id);

create table support_agent.payouts (
  payout_id text primary key check (payout_id ~ '^PAY-[0-9]+$'),
  transaction_id text not null references support_agent.transactions (transaction_id),
  customer_id text not null references support_agent.customers (customer_id),
  recipient_name text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('scheduled', 'processing', 'completed', 'failed', 'review required')),
  scheduled_for date not null,
  failure_reason text null
);

create index payouts_transaction_idx on support_agent.payouts (transaction_id);
create index payouts_customer_idx on support_agent.payouts (customer_id);

-- RLS on, no policies: the browser never reads the database. The app connects
-- as the table owner through the pooler and is not subject to these.
alter table support_agent.customers enable row level security;
alter table support_agent.transactions enable row level security;
alter table support_agent.payouts enable row level security;

revoke all on support_agent.customers, support_agent.transactions, support_agent.payouts from public, anon, authenticated;
