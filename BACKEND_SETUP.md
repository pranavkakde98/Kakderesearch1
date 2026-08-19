# Kakde Research V9 — backend setup

Static site + three Vercel Node functions. Nothing here needs a build step.

| Endpoint | Used by | Does |
|---|---|---|
| `POST /api/request-report` | the "Request report" modal (`js/request.js`) | Resolves a `reportId` against `api/_lib/reports.js`, records the request in Supabase (`report_requests`), sends the document by Resend — a signed link from the **private** `reports` bucket (7-day default) or an attachment when `REPORT_ATTACH=1` — and notifies the inbox. Responds `{ok, delivered, message}`; `delivered:false` means "recorded, will follow by email" (document not yet uploaded, or send failed) and the modal says exactly that. |
| `POST /api/contact` | `contact/` form (`js/app.js`) | Emails the enquiry to `INQUIRY_TO_EMAIL` and, when `SUPABASE_ANON_KEY` is set, stores it through production's `submit-project-inquiry` edge function. |
| `POST /api/newsletter` | `insights/` form | Upserts `newsletter_subscribers` (service role) and/or sends a confirmation. |

All three: honeypot, JSON + Origin check, in-memory rate limit, idempotency marked **after** success, truthful `503` when nothing is configured (never a fake success), `Cache-Control: no-store`.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

See `.env.example`. Minimum for the site to work end-to-end:

```
RESEND_API_KEY, EMAIL_FROM (verified domain), INQUIRY_TO_EMAIL, APP_BASE_URL
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      # report_requests + private storage
SUPABASE_ANON_KEY                            # optional: enquiry persistence via the edge function
SUPABASE_REPORTS_BUCKET=reports, REPORT_LINK_TTL_SECONDS=604800, REPORT_ATTACH=0, IP_HASH_SALT
```
`RESEND_FROM` / `ADMIN_NOTIFICATION_EMAIL` (production's names) are read as aliases.

## 2. Supabase

1. Run `supabase/schema.sql` in the SQL editor (creates `report_requests`, `newsletter_subscribers` if absent, and the private `reports` bucket).
2. Upload the four on-request PDFs to the `reports` bucket with exactly these object names:
   `credibility-and-transmission.pdf`, `the-balance-sheet-decade.pdf`, `the-rupee-managed.pdf`, `promoter-nation.pdf`.
   Until a file is uploaded, a request for it is still recorded and the inbox notified; the visitor sees "Request received… will be sent to your email directly."
3. The flagship study stays a public direct download (`assets/papers/…`); it is **not** gated.

## 3. Resend

Verify `kakderesearch.com` (SPF, DKIM, DMARC). Send one live test of each endpoint from the preview deployment before pointing production at it.

## 4. First preview deploy — checks

```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://<preview>/api/request-report
```
Expect `422`/`404` JSON from the function. If you see a `308` to `/api/request-report/`, `trailingSlash: true` in `vercel.json` is redirecting API routes; either remove `trailingSlash` or point the fetch URLs in `js/request.js` / `js/app.js` at the slashed path. Also confirm `/advisory/`, `/services/` and `/research/the-india-you-cant-buy/` return 308 to their new homes.

## 5. Local development

`.claude/serve.ps1` (gitignored) serves the tree and **mocks** `/api/*` so the modal and forms can be exercised without Node: `*@fail.test` → 502, `*@slow.test` → 503, `*@record.test` → recorded-not-delivered, anything else → sent.
