/* POST /api/contact
   Delivers a project enquiry to the practice inbox and, where the Supabase
   project is configured, records it through the same edge function
   production uses (submit-project-inquiry). Accepts the site's JSON post
   and, for readers without script, a plain form post answered with a page.

   One validation contract, shared with the form and the edge function:
   name, email, organisation, service, question (ten characters or more),
   timeframe, role and country are all required. Honeypot, rate limit,
   idempotency keyed on the whole enquiry (marked only after success).
   Truthful states only: success means the enquiry was emailed or stored;
   when neither happened the visitor is told and given the direct address.
   No personal data is written to routine logs. */

'use strict';

const {
  method, requireBody, readBody, text, required, email, escapeHtml, clientIp, sha256,
  rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress, fetchWithTimeout,
  ok, fail, HttpError, requestId, log
} = require('./_lib/http');

const SERVICES = [
  'Consulting', 'Research', 'Emerging Markets Desk', 'India Desk', 'Not sure',
  /* Labels from earlier versions of the form, still accepted so nothing in flight breaks. */
  'Research-led Consulting', 'Commissioned Research', 'Retained Research', 'Other / not sure'
];
const CONFIRM = 'Thank you. Your enquiry has been received. We will be in touch shortly.';
const NOT_SENT = 'Your enquiry could not be sent just now. Please email inquiries@kakderesearch.com and it will be picked up directly.';
const LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };
const QUESTION_MIN = 10;

/* Production's persistence path: the Supabase edge function that writes the
   contact and the enquiry. Skipped entirely when the anon key is not
   configured; bounded by a timeout so it cannot hold the form open. */
async function persist(contact, reqId) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { skipped: true };
  let response;
  try {
    response = await fetchWithTimeout(`${url}/functions/v1/submit-project-inquiry`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Origin: 'https://www.kakderesearch.com' },
      body: JSON.stringify({
        email: contact.email, name: contact.name, organisation: contact.organisation,
        position: contact.role, country: contact.country,
        project_type: contact.service, question: contact.question,
        timeframe: contact.timeframe, timeline: contact.timeframe,
        budget: '', source: contact.source
      })
    }, 8000);
  } catch (e) {
    log('error', reqId, 'inquiry_function_unreachable', { reason: e && e.name });
    return { ok: false };
  }
  const raw = await response.text();
  let result = null;
  try { result = raw ? JSON.parse(raw) : null; } catch (_) { result = null; }
  if (!response.ok || !result || result.ok !== true) {
    log('error', reqId, 'inquiry_function_failed', { status: response.status });
    return { ok: false };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  const id = requestId();
  try {
    method(req, 'POST');
    requireBody(req);
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`contact:${clientIp(req)}`, LIMIT.max, LIMIT.windowMs);

    const contact = {
      name: required(data.name, 160),
      email: email(data.email),
      organisation: required(data.organisation, 200),
      service: required(data.service, 80),
      question: required(data.question, 5000, QUESTION_MIN, 'Your question'),
      timeframe: required(data.timeframe, 300),
      role: required(data.role, 160),
      country: required(data.country, 120),
      source: [text(data.page_path, 200), text(data.referrer, 300), text(data.utm_source, 80)].filter(Boolean).join(' · ')
    };
    if (!SERVICES.includes(contact.service)) throw new HttpError(422, 'Please choose a service.');

    /* One enquiry is the whole of what was written, not its first line. */
    const dupKey = 'contact:' + sha256([contact.email, contact.service, contact.organisation, contact.question].join('\n'));
    if (isSeen(dupKey)) return ok(req, res, { ok: true, message: CONFIRM });

    const to = inboxAddress();
    const mail = mailConfig();
    const canMail = !!(to && mail.configured);
    const canStore = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
    if (!canMail && !canStore) throw new HttpError(503, NOT_SENT);

    let stored = { skipped: true };
    try { stored = await persist(contact, id); } catch (e) { log('error', id, 'inquiry_persist_threw'); stored = { ok: false }; }

    let mailed = false;
    if (canMail) {
      const html = `
        <div style="font-family:Georgia,serif;color:#232837;max-width:640px">
          <p style="font-size:16px"><strong>New project enquiry</strong></p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Name</td><td>${escapeHtml(contact.name)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Email</td><td>${escapeHtml(contact.email)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Organisation</td><td>${escapeHtml(contact.organisation)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Service</td><td>${escapeHtml(contact.service)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Role</td><td>${escapeHtml(contact.role)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Country</td><td>${escapeHtml(contact.country)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Timeframe</td><td>${escapeHtml(contact.timeframe)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Source</td><td>${escapeHtml(contact.source) || '&mdash;'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Stored</td><td>${stored.ok ? 'yes' : stored.skipped ? 'not configured' : 'FAILED'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Request</td><td>${escapeHtml(id)}</td></tr>
          </table>
          <p style="margin-top:12px;color:#5C6370;font-size:13px">What they are trying to understand</p>
          <p style="white-space:pre-wrap">${escapeHtml(contact.question)}</p>
        </div>`;
      const plain = `New project enquiry\nName: ${contact.name}\nEmail: ${contact.email}\nOrganisation: ${contact.organisation}\nService: ${contact.service}\nRole: ${contact.role}\nCountry: ${contact.country}\nTimeframe: ${contact.timeframe}\nStored: ${stored.ok ? 'yes' : stored.skipped ? 'not configured' : 'FAILED'}\nRequest: ${id}\n\n${contact.question}`;
      try {
        await sendEmail({ to, replyTo: contact.email, subject: `Enquiry — ${contact.service} — ${contact.organisation}`, html, text: plain });
        mailed = true;
      } catch (e) {
        if (!stored.ok) throw new HttpError(503, NOT_SENT);   // nothing worked: tell the visitor truthfully
        /* Stored but not emailed: the record exists in the database; there
           is no retry worker yet, so this line is the alert. */
        log('error', id, 'enquiry_mail_failed_after_store', { status: e && e.status });
      }
    }
    if (!mailed && !stored.ok) throw new HttpError(503, NOT_SENT);

    markSeen(dupKey, 5 * 60 * 1000);
    log('info', id, 'enquiry_received', { mailed, stored: !!stored.ok, service: contact.service });
    return ok(req, res, { ok: true, message: CONFIRM });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    log(status >= 500 ? 'error' : 'info', id, 'enquiry_failed', { status });
    return fail(req, res, error);
  }
};
