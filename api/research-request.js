/* POST /api/research-request
   Emails a link to an approved, finished report to a work email address.
   - Honeypot + per-IP rate limit + idempotency guard.
   - reportId is resolved against a server-side allowlist; arbitrary paths are
     never accepted from the browser.
   - Never auto-subscribes to marketing: newsletter consent is separate.
   - Never generates a report dynamically. Never fakes a send. */

'use strict';

const { method, readBody, text, email, escapeHtml, clientIp, rateLimit, seenRecently, sendEmail, ok, fail, HttpError } = require('./_lib/http');
const { getReport } = require('./_lib/reports');

module.exports = async function handler(req, res) {
  try {
    method(req, 'POST');
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`req:${clientIp(req)}`, 5, 15 * 60 * 1000);

    const to = email(data.email);
    const name = text(data.name, 160);
    const org = text(data.organisation, 200);
    const reportId = text(data.reportId, 80);
    const wantsNewsletter = data.newsletter === true || data.newsletter === 'true';

    const report = getReport(reportId);
    if (!report) throw new HttpError(404, 'That report is not available for request.');

    // Idempotency: collapse duplicate submissions within 10 minutes.
    if (seenRecently(`req:${to}:${reportId}`, 10 * 60 * 1000)) {
      return ok(res, { ok: true, message: 'That report is already on its way to your inbox.' });
    }

    const html = `
      <div style="font-family:Georgia,serif;color:#232837;max-width:560px">
        <p>Thank you${name ? ', ' + escapeHtml(name) : ''} — here is the report you requested.</p>
        <p style="font-size:18px"><strong>${escapeHtml(report.title)}</strong></p>
        <p><a href="${escapeHtml(report.url)}" style="color:#14294B">Download the report (PDF)</a></p>
        <p style="color:#5C6370;font-size:13px">Sent by Kakde Research. If you did not request this, you can ignore this email.</p>
      </div>`;
    await sendEmail({ to, subject: `Your report: ${report.title}`, html });

    // Internal notification (best-effort; failure must not break the request).
    if (process.env.INQUIRY_TO_EMAIL) {
      try {
        await sendEmail({
          to: process.env.INQUIRY_TO_EMAIL,
          subject: `Report request: ${report.title}`,
          html: `<p>Report request</p><ul>
            <li>Report: ${escapeHtml(report.title)}</li>
            <li>Email: ${escapeHtml(to)}</li>
            <li>Name: ${escapeHtml(name) || '—'}</li>
            <li>Organisation: ${escapeHtml(org) || '—'}</li>
            <li>Newsletter opt-in: ${wantsNewsletter ? 'yes' : 'no'}</li>
          </ul>`
        });
      } catch (e) { console.error('internal notify failed', e && e.status); }
    }

    // Newsletter is a SEPARATE, explicit opt-in — never implied by a request.
    // Actual list subscription is handled by /api/newsletter; here we only flag it.

    return ok(res, { ok: true, message: 'Sent. Check your inbox for the report.' });
  } catch (error) {
    return fail(res, error);
  }
};
