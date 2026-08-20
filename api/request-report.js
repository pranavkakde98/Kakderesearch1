/* POST /api/request-report
   Delivers a finished, approved research document to a work email address.

   Order of operations, and why:
   1. Validate the request and resolve the reportId against the server-side
      registry. The browser never names a file.
   2. Rate-limit (in-memory per instance, then durable per email/IP in
      Supabase where configured) and refuse obvious bots via the honeypot.
   3. Record the request server-side BEFORE attempting delivery, so a
      request is never lost even if the send fails.
   4. Deliver: a published report links to its public PDF; an on-request
      report gets a time-limited signed link from PRIVATE storage (or an
      attachment when REPORT_ATTACH=1). If the object is not in storage yet,
      the request is still recorded and the practice notified, and the
      visitor is told truthfully that it will follow by email — never
      "check your inbox" for a message that was not sent.
   5. Confirm the visitor's address was sent to only if Resend accepted it.

   Never auto-subscribes to marketing. Never fakes a send. */

'use strict';

const {
  method, requireJson, readBody, text, email, escapeHtml, clientIp, hashIp, sha256,
  rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress, ok, fail, HttpError
} = require('./_lib/http');
const db = require('./_lib/db');
const storage = require('./_lib/storage');
const sheets = require('./_lib/sheets');
const { getReport } = require('./_lib/reports');

const BASE = (process.env.APP_BASE_URL || 'https://www.kakderesearch.com').replace(/\/$/, '');

const NOT_PUBLISHED_MESSAGE = 'This report is nearing completion. Your request has been recorded and the finished study will be sent to your email as soon as it is published.';
const NOT_CONFIGURED_MESSAGE = 'Your request has been recorded. The report will be sent to your email once it is available.';
const SEND_FAILED_MESSAGE = 'Your request has been recorded. The research team will send the report to your email directly.';

function fmtDate(d) {
  try { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  catch (_) { return d.toISOString().slice(0, 10); }
}

function visitorHtml({ name, report, link, expiresAt, attached }) {
  const greet = name ? `Thank you, ${escapeHtml(name)}` : 'Thank you';
  const access = attached
    ? `<p>The report is attached to this email as a PDF.</p>`
    : `<p><a href="${escapeHtml(link)}" style="color:#14294B">Download the report (PDF)</a>${expiresAt ? ` &mdash; this link is valid until ${escapeHtml(fmtDate(expiresAt))}.` : ''}</p>`;
  return `
    <div style="font-family:Georgia,'Times New Roman',serif;color:#232837;max-width:560px;line-height:1.55">
      <p style="font-family:Inter,Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C6370;margin:0 0 14px">Kakde Research &middot; Research request</p>
      <p>${greet} &mdash; here is the research you requested.</p>
      <p style="font-size:19px;line-height:1.3;color:#14294B;margin:18px 0 6px"><strong style="font-weight:500">${escapeHtml(report.title)}</strong></p>
      <p style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#5C6370;margin:0 0 18px">${escapeHtml(report.meta || '')}</p>
      ${access}
      <p style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#5C6370;margin-top:22px">Independent research for professional and institutional readers. Not investment advice, an offer or a solicitation. If you did not request this, you can ignore this email.</p>
      <p style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#5C6370">Kakde Research &middot; <a href="${BASE}/" style="color:#14294B">kakderesearch.com</a> &middot; <a href="mailto:inquiries@kakderesearch.com" style="color:#14294B">inquiries@kakderesearch.com</a></p>
    </div>`;
}

function visitorText({ name, report, link, expiresAt, attached }) {
  return [
    `${name ? 'Thank you, ' + name : 'Thank you'} — here is the research you requested.`,
    '',
    report.title,
    report.meta || '',
    '',
    attached ? 'The report is attached to this email as a PDF.' : `Download the report (PDF): ${link}${expiresAt ? `\nThis link is valid until ${fmtDate(expiresAt)}.` : ''}`,
    '',
    'Independent research for professional and institutional readers. Not investment advice, an offer or a solicitation. If you did not request this, you can ignore this email.',
    'Kakde Research · kakderesearch.com · inquiries@kakderesearch.com'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  let recordId = null;
  var ip = '', to = '', name = '', org = '', reportId = '', context = { page_path: '', referrer: '', user_agent: '' }, report = null;
  try {
    method(req, 'POST');
    requireJson(req);
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    ip = clientIp(req);
    rateLimit(`req:${ip}`, 100, 10 * 60 * 1000);

    to = email(data.email);
    name = text(data.name, 160);
    org = text(data.organisation, 200);
    reportId = text(data.reportId, 80);
    context = {
      page_path: text(data.page_path, 300),
      referrer: text(data.referrer, 500),
      user_agent: text(req.headers['user-agent'], 300)
    };

    report = getReport(reportId);
    if (!report) throw new HttpError(404, 'That report is not available for request.');

    /* Idempotency: the same address asking for the same report inside ten
       minutes gets one delivery and one honest reply. Only marked after a
       successful send (see below). */
    const dupKey = `req:${to}:${reportId}`;
    if (isSeen(dupKey)) return ok(res, { ok: true, delivered: true, message: 'That report is already on its way to your inbox.' });

    /* Durable limits where the database is available: 100 per address and
       100 per IP per ten-minute window. These survive cold starts; the
       in-memory limiter above does not. */
    if (db.configured()) {
      try {
        const since10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const [byIp, byEmail, recentSame] = await Promise.all([
          db.count('report_requests', `ip_hash=eq.${hashIp(ip)}&created_at=gte.${since15}`),
          db.count('report_requests', `email=eq.${encodeURIComponent(to)}&created_at=gte.${since24}`),
          db.count('report_requests', `email=eq.${encodeURIComponent(to)}&report_id=eq.${encodeURIComponent(reportId)}&status=eq.sent&created_at=gte.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`)
        ]);
        if (byIp >= 100 || byEmail >= 100) throw new HttpError(429, 'Too many requests. Please try again later.');
        if (recentSame >= 1) return ok(res, { ok: true, delivered: true, message: 'That report is already on its way to your inbox.' });
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) throw e;
        console.error('Durable limit check skipped', e && e.message);
      }
    }

    /* Record first. A request must never be lost because a send failed. */
    if (db.configured()) {
      try {
        const rows = await db.insert('report_requests', {
          report_id: reportId, report_title: report.title, email: to, name, organisation: org,
          delivery: 'pending', status: 'received', ip_hash: hashIp(ip),
          user_agent: context.user_agent, page_path: context.page_path, referrer: context.referrer,
          metadata: {}
        });
        recordId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
      } catch (e) { console.error('Record insert failed', e && e.message); }
    }

    /* Resolve the document. */
    let link = null, expiresAt = null, attachments = null, delivery = 'link';
    const attach = process.env.REPORT_ATTACH === '1';
    if (report.status === 'published' && report.publicPath) {
      link = BASE + report.publicPath;
      delivery = 'public-link';
    } else if (report.object) {
      const signed = await storage.signedUrl(report.object, report.filename);
      if (signed) { link = signed.url; expiresAt = signed.expiresAt; }
      if (link && attach) {
        const b64 = await storage.download(report.object, 24 * 1024 * 1024);
        if (b64) { attachments = [{ filename: report.filename || `${reportId}.pdf`, content: b64, content_type: 'application/pdf' }]; delivery = 'attachment'; }
      }
    }

    const mail = mailConfig();
    if (!mail.configured) {
      await notifyInside({ report, to, name, org, outcome: 'FAILED — email not configured', recordId, context }).catch(() => {});
      throw new HttpError(503, 'Email delivery is not configured yet.');
    }

    /* The document is not yet published: record, notify, and say so. */
    if (!link) {
      await notifyInside({ report, to, name, org, outcome: 'NOT PUBLISHED — report nearing completion', recordId, context }).catch(() => {});
      if (recordId) db.update('report_requests', `id=eq.${recordId}`, { status: 'awaiting_publication', delivery: 'none' }).catch(() => {});
      await sheets.logRequest({ name, email: to, organisation: org, reportId, reportTitle: report.title, page: context.page_path, referrer: context.referrer }).catch(() => {});
      return ok(res, { ok: true, delivered: false, message: NOT_PUBLISHED_MESSAGE });
    }

    const attached = !!attachments;
    const idem = 'request-report/' + sha256(`${to}|${reportId}|${Math.floor(Date.now() / (10 * 60 * 1000))}`).slice(0, 48);
    let sendResult;
    try {
      sendResult = await sendEmail({
        to,
        subject: `Your report: ${report.title}`,
        html: visitorHtml({ name, report, link, expiresAt, attached }),
        text: visitorText({ name, report, link, expiresAt, attached }),
        attachments,
        idempotencyKey: idem,
        headers: { 'X-Entity-Ref-ID': recordId || idem }
      });
    } catch (e) {
      if (recordId) db.update('report_requests', `id=eq.${recordId}`, { status: 'failed', delivery }).catch(() => {});
      await sheets.logRequest({ name, email: to, organisation: org, reportId, reportTitle: report.title, page: context.page_path, referrer: context.referrer }).catch(() => {});
      await notifyInside({ report, to, name, org, outcome: 'SEND FAILED — please send manually', recordId, context }).catch(() => {});
      /* A recorded request the practice will fulfil by hand is not a
         success the visitor should be told to look for in their inbox. */
      return ok(res, { ok: true, delivered: false, message: SEND_FAILED_MESSAGE });
    }

    markSeen(dupKey, 10 * 60 * 1000);
    if (recordId) {
      db.update('report_requests', `id=eq.${recordId}`, {
        status: 'sent', delivery, resend_id: sendResult && sendResult.id ? String(sendResult.id) : null,
        link_expires_at: expiresAt ? expiresAt.toISOString() : null
      }).catch(() => {});
    }
    await notifyInside({ report, to, name, org, outcome: attached ? 'Sent (attachment)' : 'Sent (link)', recordId, context }).catch(() => {});

    const when = expiresAt ? ` The link is valid until ${fmtDate(expiresAt)}.` : '';
    return ok(res, { ok: true, delivered: true, message: `Sent to ${to}.${when} If it does not arrive within a few minutes, check your spam folder or email inquiries@kakderesearch.com.` });
  } catch (error) {
    /* Last-resort safety net: log + notify the practice for any unhandled
       error (missing env vars, Supabase outage, etc.) so nothing is silent. */
    console.error('Report request handler error', error && error.message, error && error.status);
    await notifyInside({
      report: { title: (report && report.title) || 'Unknown', id: reportId || 'unknown' },
      to: to || 'not provided',
      name: name || '',
      org: org || '',
      outcome: 'ERROR — ' + (error && error.message || 'unknown failure'),
      recordId,
      context: context || { page_path: '', referrer: '' }
    }).catch(() => {});
    return fail(res, error);
  }
};

async function notifyInside({ report, to, name, org, outcome, recordId, context }) {
  const inbox = inboxAddress();
  if (!inbox) return;
  const html = `<div style="font-family:Georgia,serif;color:#232837;max-width:640px">
    <p style="font-size:16px"><strong>Report request &mdash; ${escapeHtml(outcome)}</strong></p>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Report</td><td>${escapeHtml(report.title)} <span style="color:#5C6370">(${escapeHtml(report.id)})</span></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Email</td><td>${escapeHtml(to)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Name</td><td>${escapeHtml(name) || '&mdash;'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Organisation</td><td>${escapeHtml(org) || '&mdash;'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Page</td><td>${escapeHtml(context.page_path || '')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Record</td><td>${escapeHtml(recordId || 'not stored')}</td></tr>
    </table>
  </div>`;
  await sendEmail({ to: inbox, replyTo: to, subject: `Report request: ${report.title} — ${outcome}`, html, text: `Report request — ${outcome}\nReport: ${report.title} (${report.id})\nEmail: ${to}\nName: ${name || '-'}\nOrganisation: ${org || '-'}\nRecord: ${recordId || 'not stored'}` });
}
