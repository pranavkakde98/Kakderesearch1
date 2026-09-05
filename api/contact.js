/* POST /api/contact
   Delivers a project enquiry to the practice inbox and, where the Supabase
   project is configured, records it through the same edge function
   production uses (submit-project-inquiry). Honeypot + rate limit +
   idempotency (marked only after success). Truthful states only: a 503 is
   returned — never a fake success — when neither delivery nor storage is
   configured. No PII is written to routine logs. */

'use strict';

const { method, requireJson, readBody, text, email, escapeHtml, clientIp, rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress, ok, fail, HttpError } = require('./_lib/http');

const SERVICES = [
  'Research-led Consulting', 'Commissioned Research', 'Retained Research',
  'Emerging Markets Desk', 'India Desk', 'Not sure',
  /* Labels from the previous contact form, still accepted so nothing in flight breaks. */
  'Research', 'Consulting', 'Other / not sure'
];
const CONFIRM = 'Thank you. Your enquiry has been received. We will be in touch shortly.';

/* Production's persistence path: the Supabase edge function that writes the
   contact and the enquiry. Best-effort — a storage failure never blocks the
   email — and skipped entirely when the anon key is not configured. */
async function persist(contact) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { skipped: true };
  const response = await fetch(`${url}/functions/v1/submit-project-inquiry`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Origin: 'https://www.kakderesearch.com' },
    body: JSON.stringify({
      email: contact.email, name: contact.name, organisation: contact.organisation,
      position: contact.role, country: contact.country,
      project_type: contact.service, question: contact.question,
      timeframe: contact.timeframe, timeline: contact.timeframe,
      budget: '', source: contact.source
    })
  });
  const raw = await response.text();
  let result = null;
  try { result = raw ? JSON.parse(raw) : null; } catch (_) { result = null; }
  if (!response.ok || !result || result.ok !== true) {
    console.error('Inquiry function failed', response.status);
    return { ok: false };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  try {
    method(req, 'POST');
    requireJson(req);
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`contact:${clientIp(req)}`, 60, 60 * 1000);

    const contact = {
      name: text(data.name, 160),
      email: email(data.email),
      organisation: text(data.organisation, 200),
      service: text(data.service, 80),
      question: text(data.question, 5000),
      timeframe: text(data.timeframe, 300),
      role: text(data.role, 160),        // optional
      country: text(data.country, 120),  // optional
      source: [text(data.page_path, 200), text(data.referrer, 300), text(data.utm_source, 80)].filter(Boolean).join(' · ')
    };
    for (const key of ['name', 'organisation', 'question']) {
      if (!contact[key]) throw new HttpError(422, 'Please complete all required fields.');
    }
    if (!SERVICES.includes(contact.service)) throw new HttpError(422, 'Please choose a service.');

    const dupKey = `contact:${contact.email}:${contact.question.slice(0, 40)}`;
    if (isSeen(dupKey)) return ok(res, { ok: true, message: CONFIRM });

    const to = inboxAddress();
    const mail = mailConfig();
    const canMail = !!(to && mail.configured);
    const canStore = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
    if (!canMail && !canStore) throw new HttpError(503, 'Enquiry delivery is not configured yet.');

    let stored = { skipped: true };
    try { stored = await persist(contact); } catch (e) { console.error('Inquiry persistence failed', e && e.message); stored = { ok: false }; }

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
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Role</td><td>${escapeHtml(contact.role) || '&mdash;'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Country</td><td>${escapeHtml(contact.country) || '&mdash;'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Timeframe</td><td>${escapeHtml(contact.timeframe) || '&mdash;'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Source</td><td>${escapeHtml(contact.source) || '&mdash;'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Stored</td><td>${stored.ok ? 'yes' : stored.skipped ? 'not configured' : 'FAILED'}</td></tr>
          </table>
          <p style="margin-top:12px;color:#5C6370;font-size:13px">What they are trying to understand</p>
          <p style="white-space:pre-wrap">${escapeHtml(contact.question)}</p>
        </div>`;
      const plain = `New project enquiry\nName: ${contact.name}\nEmail: ${contact.email}\nOrganisation: ${contact.organisation}\nService: ${contact.service}\nRole: ${contact.role || '-'}\nCountry: ${contact.country || '-'}\nTimeframe: ${contact.timeframe || '-'}\n\n${contact.question}`;
      try {
        await sendEmail({ to, replyTo: contact.email, subject: `Enquiry — ${contact.service} — ${contact.organisation}`, html, text: plain });
        mailed = true;
      } catch (e) {
        if (!stored.ok) throw e;   // nothing worked: tell the visitor truthfully
        console.error('Enquiry email failed after storage succeeded', e && e.status);
      }
    }
    if (!mailed && !stored.ok) throw new HttpError(503, 'Enquiry delivery is not configured yet.');

    markSeen(dupKey, 5 * 60 * 1000);
    return ok(res, { ok: true, message: CONFIRM });
  } catch (error) {
    return fail(res, error);
  }
};
