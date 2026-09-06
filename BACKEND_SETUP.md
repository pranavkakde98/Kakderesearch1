# Kakde Research — backend setup

Static site plus four Vercel Node functions. Nothing needs a build step. The functions accept the site's JSON posts and, for readers without script, plain form posts answered with a small page.

| Endpoint | Used by | Does |
|---|---|---|
| `POST /api/request-report` | the "Request the report" dialog (`js/request.js`) and the no-script page served by `GET /api/request-report/?report=<id>` | Resolves a `reportId` against `api/_lib/reports.js`, records the request in Supabase (`report_requests`), sends the document by Resend (a signed link from the **private** `reports` bucket, 7-day default, clamped to 5 minutes … 14 days; or an attachment when `REPORT_ATTACH=1`) and notifies the inbox. Responds `{ok, delivered, message}`. `delivered:false` means the request was captured (a database row, or a delivered internal note) and the team will send the document by hand. If nothing captured it, the visitor gets a **503** with the direct address, never a success. |
| `POST /api/contact` | `contact/` form (`js/app.js`) | Emails the enquiry to `inquiries@kakderesearch.com` and, when `SUPABASE_ANON_KEY` is set, stores it through production's `submit-project-inquiry` edge function. One validation contract with the form and the edge function: every field required, question of ten characters or more. |
| `POST /api/newsletter` | `insights/` form | Inserts into `newsletter_subscribers`. Success requires the stored row; an address that unsubscribed earlier is not reactivated (409); the confirmation carries a signed unsubscribe link. |
| `GET /api/unsubscribe/?e=…&t=…` | the link in every note | Verifies the signature and marks the row unsubscribed. |

All of them: honeypot, content-type and Origin check (the site, its own Vercel deployment hosts, localhost outside production), body byte limit on every input path, in-memory rate limit with `Retry-After` (contact 10 per 10 minutes per IP; reports 10 per 10 minutes per IP plus durable 10 per address and 30 per IP per day; newsletter 5 per 15 minutes), idempotency marked **after** success, bounded timeouts on every outbound call, structured logs with no personal data, `Cache-Control: no-store`. Routine 4xx outcomes never generate internal email.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

See `.env.example`. Minimum for the site to work end-to-end:

```
RESEND_API_KEY, EMAIL_FROM (verified domain), APP_BASE_URL
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      # report_requests, newsletter_subscribers, private storage
SUPABASE_ANON_KEY                            # optional: enquiry persistence via the edge function
SUPABASE_REPORTS_BUCKET=reports, REPORT_LINK_TTL_SECONDS=604800, REPORT_ATTACH=0
IP_HASH_SALT, UNSUBSCRIBE_SECRET
SHEETS_WEBHOOK_URL + SHEETS_WEBHOOK_SECRET   # optional mirror; runs only when both are set
```
`RESEND_FROM` (production's name) is read as an alias for `EMAIL_FROM`.

## 2. Supabase

1. Run `supabase/schema.sql` in the SQL editor. It creates `report_requests` and `newsletter_subscribers` (both with RLS and no public policy) and the private `reports` bucket. **Until this has run, report requests are recorded only by internal email and the newsletter form says subscriptions are unavailable.**
2. Upload the on-request PDFs to the `reports` bucket with exactly the object names in `api/_lib/reports.js` (ten documents as of September 2026). Until a file is there, a request for it is recorded, the inbox is notified with the requester's address as Reply-To, and the visitor is told the team will send it.
3. The flagship study stays a public direct download (`assets/papers/…`); it is **not** gated.

## 3. Resend

Verify `kakderesearch.com` (SPF, DKIM, DMARC). Send one live test of each endpoint from the preview deployment before pointing production at it. Provider acceptance is not inbox delivery: check the test messages arrive.

## 4. Tests

```
node --test tests/
```
Node 20 or later, nothing to install. Every external call is stubbed. The suite covers the failure paths the September 2026 audit reproduced: durable limiter windows and thresholds, schema-valid statuses, the "nothing captured" 503, no internal mail on 4xx, the no-script page and form post, body limits on pre-parsed input, the origin allowlist, whole-enquiry deduplication, the shared validation contract, unsubscribe protection, and the signed sheet mirror. `.github/workflows/test.yml` runs the same on every push and pull request.

## 5. First preview deploy — checks

```
curl -s -o /dev/null -w '%{http_code}\n' -L -X POST -H 'Content-Type: application/json' -d '{}' https://<preview>/api/request-report
```
Expect a `422` JSON from the function after the `308` to the slashed path (`trailingSlash: true` in `vercel.json` redirects API routes; `fetch` follows it with the method preserved). Also confirm `/advisory/`, `/services/` and `/research/the-india-you-cant-buy/` return 308 to their new homes, and that `GET /api/request-report/?report=cost-of-capital` renders the request page.

## 6. Known gaps

- There is no retry worker for an enquiry that was stored but whose email failed; the structured log line `enquiry_mail_failed_after_store` is the alert. Check the database for such rows if the inbox goes quiet.
- The Sheets mirror, if used, is a convenience copy; the database is the record.

## 7. Local development

`.claude/serve.ps1` (gitignored) serves the tree and **mocks** `/api/*` so the dialog and forms can be exercised without Node: `*@fail.test` → 502, `*@slow.test` → 503, `*@record.test` → recorded-not-delivered, anything else → sent.
