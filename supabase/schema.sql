-- Kakde Research — research-request and mailing-list storage.
-- Run once in the Supabase SQL editor. The API uses the service-role key
-- server-side only; RLS is enabled with no policies, so nothing is readable
-- from the browser.

create extension if not exists pgcrypto;

create table if not exists public.report_requests (
  id uuid primary key default gen_random_uuid(),
  report_id text not null,
  report_title text not null default '',
  email text not null,
  name text not null default '',
  organisation text not null default '',
  delivery text not null default 'pending' check (delivery in ('pending','link','public-link','attachment','none')),
  status text not null default 'received' check (status in ('received','sent','failed','undeliverable','duplicate')),
  resend_id text,
  link_expires_at timestamptz,
  ip_hash text not null default '',
  user_agent text not null default '',
  page_path text not null default '',
  referrer text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists report_requests_created_idx on public.report_requests (created_at desc);
create index if not exists report_requests_email_report_idx on public.report_requests (email, report_id, created_at desc);
create index if not exists report_requests_ip_idx on public.report_requests (ip_hash, created_at desc);
alter table public.report_requests enable row level security;

-- Mailing list (same shape as production's table; harmless if it already exists).
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'active' check (status in ('active','unsubscribed')),
  source text not null default '',
  page_path text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);
alter table public.newsletter_subscribers enable row level security;

-- Private bucket for "Available on request" PDFs. Upload the documents through
-- the dashboard using the object names in api/_lib/reports.js:
--   credibility-and-transmission.pdf, the-balance-sheet-decade.pdf,
--   the-rupee-managed.pdf, promoter-nation.pdf, the-cost-of-capital-has-changed.pdf,
--   tariff-arithmetic.pdf, the-concentration-problem.pdf, private-credits-decade.pdf,
--   public-debt-after-the-pandemic.pdf, em-ex-china.pdf
-- Application states written to report_requests.status: received, sent, failed
-- (send or storage error), undeliverable (document not in the bucket yet),
-- duplicate. metadata.reason records why.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- Mailing-list lookups by address and status (api/newsletter.js, api/unsubscribe.js).
create index if not exists newsletter_subscribers_status_idx on public.newsletter_subscribers (status);
