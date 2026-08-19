/* POST /api/contact
   Delivers a project enquiry to the practice inbox. Honeypot + rate limit +
   idempotency. Truthful states only: a 503 is returned (not a fake success)
   when email delivery is not configured. No PII is written to routine logs. */

'use strict';

const { method, readBody, text, email, escapeHtml, clientIp, rateLimit, seenRecently, sendEmail, ok, fail, HttpError } = require('./_lib/http');

const SERVICES = ['Emerging Markets Desk', 'India Desk', 'Research', 'Consulting'];

module.exports = async function handler(req, res) {
  try {
    method(req, 'POST');
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`contact:${clientIp(req)}`, 5, 15 * 60 * 1000);

    const contact = {
      name: text(data.name, 160),
      email: email(data.email),
      organisation: text(data.organisation, 200),
      service: text(data.service, 80),
      question: text(data.question, 5000),
      timeframe: text(data.timeframe, 300),
      role: text(data.role, 160),        // optional
      country: text(data.country, 120)   // optional
    };
    for (const key of ['name', 'organisation', 'question', 'timeframe']) {
      if (!contact[key]) throw new HttpError(422, 'Please complete all required fields.');
    }
    if (!SERVICES.includes(contact.service)) throw new HttpError(422, 'Please choose a service.');

    if (seenRecently(`contact:${contact.email}:${contact.question.slice(0, 40)}`, 5 * 60 * 1000)) {
      return ok(res, { ok: true, message: 'Received. You will hear back within two working days.' });
    }

    const to = process.env.INQUIRY_TO_EMAIL;
    if (!to) throw new HttpError(503, 'Enquiry delivery is not configured yet.');

    const html = `
      <div style="font-family:Georgia,serif;color:#232837;max-width:640px">
        <p style="font-size:16px"><strong>New project enquiry</strong></p>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Name</td><td>${escapeHtml(contact.name)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Email</td><td>${escapeHtml(contact.email)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Organisation</td><td>${escapeHtml(contact.organisation)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Service</td><td>${escapeHtml(contact.service)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Role</td><td>${escapeHtml(contact.role) || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Country</td><td>${escapeHtml(contact.country) || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Timeframe</td><td>${escapeHtml(contact.timeframe)}</td></tr>
        </table>
        <p style="margin-top:12px;color:#5C6370;font-size:13px">Question / project need</p>
        <p style="white-space:pre-wrap">${escapeHtml(contact.question)}</p>
      </div>`;

    await sendEmail({ to, replyTo: contact.email, subject: `Enquiry — ${contact.service} — ${contact.organisation}`, html });

    return ok(res, { ok: true, message: 'Received. You will hear back within two working days.' });
  } catch (error) {
    return fail(res, error);
  }
};
