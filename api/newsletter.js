/* POST /api/newsletter
   Records a newsletter / "notify me" request and emails the subscriber a
   confirmation of that request only — no report, no draft, no implied
   availability. Honeypot + rate limit + idempotency. A real list provider
   (or Vercel KV store) is the documented production upgrade; until then this
   confirms the request and notifies the practice inbox. */

'use strict';

const { method, readBody, text, email, escapeHtml, clientIp, rateLimit, seenRecently, sendEmail, ok, fail, HttpError } = require('./_lib/http');

module.exports = async function handler(req, res) {
  try {
    method(req, 'POST');
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`news:${clientIp(req)}`, 5, 15 * 60 * 1000);

    const to = email(data.email);
    const topic = text(data.topic, 160); // optional: which forthcoming title, if any

    if (seenRecently(`news:${to}:${topic}`, 10 * 60 * 1000)) {
      return ok(res, { ok: true, message: 'You are on the list. We will be in touch.' });
    }

    const subjectBit = topic ? ` for ${topic}` : '';
    await sendEmail({
      to,
      subject: `You are registered${subjectBit} — Kakde Research`,
      html: `<div style="font-family:Georgia,serif;color:#232837;max-width:560px">
        <p>Thanks — your request has been registered${topic ? ' for <strong>' + escapeHtml(topic) + '</strong>' : ''}.</p>
        <p>We will email you when there is something to send. Nothing is sent in the meantime, and you can ask us to remove you at any time by replying.</p>
        <p style="color:#5C6370;font-size:13px">Kakde Research &middot; inquiries@kakderesearch.com</p>
      </div>`
    });

    if (process.env.INQUIRY_TO_EMAIL) {
      try {
        await sendEmail({
          to: process.env.INQUIRY_TO_EMAIL,
          subject: `Newsletter / notify request${subjectBit}`,
          html: `<p>New registration</p><ul><li>Email: ${escapeHtml(to)}</li><li>Topic: ${escapeHtml(topic) || '—'}</li></ul>`
        });
      } catch (e) { console.error('internal notify failed', e && e.status); }
    }

    return ok(res, { ok: true, message: 'Registered. We will be in touch when there is something to send.' });
  } catch (error) {
    return fail(res, error);
  }
};
