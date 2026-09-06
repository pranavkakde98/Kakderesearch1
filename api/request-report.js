/* /api/request-report
   POST: delivers a finished, approved research document to an email
   address. GET: a small request page for readers without script, which
   posts back here as a plain form (?report=<id> names the document).

   Order of operations, and why:
   1. Validate the request and resolve the reportId against the server-side
      registry. The browser never names a file.
   2. Rate-limit (in-memory per instance, then durable per email and per IP
      in Supabase where configured) and refuse obvious bots via the honeypot.
   3. Record the request server-side BEFORE attempting delivery.
   4. Deliver: a published report links to its public PDF; an on-request
      report gets a time-limited signed link from PRIVATE storage (or an
      attachment when REPORT_ATTACH=1).
   5. Tell the visitor exactly what happened. "Recorded" is only ever said
      when the request was captured somewhere a person will see it: a
      database row, or a delivered internal notification. If neither
      happened, the visitor is told so and given the direct address.

   Publication status and delivery availability are kept apart: a study
   that is published but whose file is not yet in storage is still
   published; the visitor is told the team will send it, never that it is
   "nearing completion". Never auto-subscribes to marketing. Never fakes a
   send. Routine 4xx outcomes never generate internal email. */

'use strict';

const {
  method, requireBody, readBody, text, email, escapeHtml, clientIp, hashIp, sha256,
  rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress, ok, fail, HttpError,
  requestId, log, htmlPage, sendHtml, BASE_URL
} = require('./_lib/http');
const db = require('./_lib/db');
const storage = require('./_lib/storage');
const sheets = require('./_lib/sheets');
const { getReport } = require('./_lib/reports');

const BASE = BASE_URL;

/* What the visitor is told. Each sentence is only used when it is true. */
const MSG = {
  teamWillSend: 'Your request has been recorded. The research team will send the report to your email directly.',
  downloadUnavailable: 'Your request has been recorded. The download could not be prepared just now, so the research team will send the report to your email directly.',
  notCaptured: 'We could not record your request just now. Please email inquiries@kakderesearch.com with the report title and it will be sent to you directly.',
  alreadySent: 'That report is already on its way to your inbox.'
};

/* Limits. In-memory: per instance, resets on cold start. Durable: counted
   in Supabase where configured; if that count cannot be made, the request
   proceeds under the in-memory limit alone and the degradation is logged,
   because a database outage should not silence a research request. */
const LIMITS = {
  memory: { max: 10, windowMs: 10 * 60 * 1000 },
  perEmailDay: 10,
  perIpDay: 30
};

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

/* The internal note. replyTo is set only when a person is expected to
   answer the requester; operational notes carry no Reply-To at all. */
async function notifyInside({ report, to, name, org, outcome, recordId, context, replyTo }) {
  const inbox = inboxAddress();
  if (!inbox) return false;
  const html = `<div style="font-family:Georgia,serif;color:#232837;max-width:640px">
    <p style="font-size:16px"><strong>Report request &mdash; ${escapeHtml(outcome)}</strong></p>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Report</td><td>${escapeHtml(report.title)} <span style="color:#5C6370">(${escapeHtml(report.id)})</span></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Email</td><td>${escapeHtml(to || '')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Name</td><td>${escapeHtml(name) || '&mdash;'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Organisation</td><td>${escapeHtml(org) || '&mdash;'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Page</td><td>${escapeHtml((context && context.page_path) || '')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#5C6370">Record</td><td>${escapeHtml(recordId || 'not stored')}</td></tr>
    </table>
  </div>`;
  await sendEmail({
    to: inbox,
    replyTo: replyTo || undefined,
    subject: `Report request: ${report.title} — ${outcome}`,
    html,
    text: `Report request — ${outcome}\nReport: ${report.title} (${report.id})\nEmail: ${to || ''}\nName: ${name || '-'}\nOrganisation: ${org || '-'}\nRecord: ${recordId || 'not stored'}`
  });
  return true;
}

/* ---------- GET: the request page for readers without script ---------- */

function queryParam(req, key) {
  if (req.query && typeof req.query === 'object' && req.query[key] != null) return String(req.query[key]);
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    return u.searchParams.get(key) || '';
  } catch (_) { return ''; }
}

function requestPage(req, res) {
  const id = text(queryParam(req, 'report'), 80);
  const report = id ? getReport(id) : null;
  if (!report) {
    return sendHtml(res, 404, htmlPage({
      title: 'Not found', kicker: 'Research request', heading: 'That report is not available for request.',
      body: `<p>Choose a report from the <a href="${BASE}/research/">Research library</a>, or email <a href="mailto:${inboxAddress()}">${inboxAddress()}</a>.</p>`,
      back: BASE + '/research/', backLabel: 'Research library'
    }));
  }
  const body = `
  <p>${escapeHtml(report.title)}${report.meta ? ' &middot; ' + escapeHtml(report.meta) : ''}</p>
  <form method="post" action="${BASE}/api/request-report/">
    <input type="hidden" name="reportId" value="${escapeHtml(report.id)}">
    <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
    <label for="email">Work email</label>
    <input id="email" name="email" type="email" required autocomplete="email" inputmode="email">
    <label for="name">Name (optional)</label>
    <input id="name" name="name" type="text" autocomplete="name">
    <label for="organisation">Organisation (optional)</label>
    <input id="organisation" name="organisation" type="text" autocomplete="organization">
    <button type="submit">Send me the report</button>
  </form>
  <p style="margin-top:22px;color:#5C6370;font-size:14px">Your email will be used to deliver this research. It will not automatically subscribe you to marketing. See the <a href="${BASE}/legal/privacy/">privacy policy</a>.</p>`;
  return sendHtml(res, 200, htmlPage({
    title: 'Request this research', kicker: 'Research request', heading: 'Request this research',
    body, back: BASE + '/research/', backLabel: 'Back to the Research library'
  }));
}

/* ---------- POST ---------- */

module.exports = async function handler(req, res) {
  const id = requestId();
  let recordId = null, stored = false, notified = false;
  let to = '', name = '', org = '', reportId = '', report = null;
  let context = { page_path: '', referrer: '', user_agent: '' };
  try {
    method(req, ['GET', 'POST']);
    if (req.method === 'GET') return requestPage(req, res);
    requireBody(req);
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    const ip = clientIp(req);
    rateLimit(`req:${ip}`, LIMITS.memory.max, LIMITS.memory.windowMs);

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
    if (isSeen(dupKey)) return ok(req, res, { ok: true, delivered: true, message: MSG.alreadySent });

    /* Durable limits. Windows are defined once and used as declared. */
    if (db.configured()) {
      try {
        const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const since10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const [byIp, byEmail, recentSame] = await Promise.all([
          db.count('report_requests', `ip_hash=eq.${hashIp(ip)}&created_at=gte.${since24}`, id),
          db.count('report_requests', `email=eq.${encodeURIComponent(to)}&created_at=gte.${since24}`, id),
          db.count('report_requests', `email=eq.${encodeURIComponent(to)}&report_id=eq.${encodeURIComponent(reportId)}&status=eq.sent&created_at=gte.${since10}`, id)
        ]);
        if (byIp >= LIMITS.perIpDay || byEmail >= LIMITS.perEmailDay) throw new HttpError(429, 'Too many requests from this address today. Please try again tomorrow or email inquiries@kakderesearch.com.', { retryAfter: 3600 });
        if (recentSame >= 1) return ok(req, res, { ok: true, delivered: true, message: MSG.alreadySent });
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) throw e;
        /* Degradation policy: proceed under the in-memory limit; say so in the log. */
        log('error', id, 'durable_limit_unavailable', { reason: e && e.message });
      }
    }

    /* Record first. A request must never be lost because a send failed. */
    if (db.configured()) {
      try {
        const rows = await db.insert('report_requests', {
          report_id: reportId, report_title: report.title, email: to, name, organisation: org,
          delivery: 'pending', status: 'received', ip_hash: hashIp(ip),
          user_agent: context.user_agent, page_path: context.page_path, referrer: context.referrer,
          metadata: { request_id: id }
        }, null, id);
        recordId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
        stored = !!recordId;
      } catch (e) { log('error', id, 'record_insert_failed'); }
    }

    async function setRecord(fields) {
      if (!recordId) return;
      try { await db.update('report_requests', `id=eq.${recordId}`, fields, id); }
      catch (e) { log('error', id, 'record_update_failed', { fields: Object.keys(fields).join(',') }); }
    }
    async function tellInside(outcome, replyTo) {
      try { notified = (await notifyInside({ report, to, name, org, outcome, recordId, context, replyTo })) || notified; }
      catch (e) { log('error', id, 'internal_notify_failed', { outcome }); }
    }
    function captured() { return stored || notified; }

    /* Resolve the document. */
    let link = null, expiresAt = null, attachments = null, delivery = 'link';
    let unavailable = null;   /* 'missing' | 'error' when no link could be made */
    const attach = process.env.REPORT_ATTACH === '1';
    if (report.status === 'published' && report.publicPath) {
      link = BASE + report.publicPath;
      delivery = 'public-link';
    } else if (report.object) {
      const signed = await storage.signedUrl(report.object, report.filename, id);
      if (signed.status === 'ok') { link = signed.url; expiresAt = signed.expiresAt; }
      else unavailable = signed.status;
      if (link && attach) {
        const b64 = await storage.download(report.object, 24 * 1024 * 1024, id);
        if (b64) { attachments = [{ filename: report.filename || `${reportId}.pdf`, content: b64, content_type: 'application/pdf' }]; delivery = 'attachment'; }
      }
    } else {
      unavailable = 'missing';
    }

    const mail = mailConfig();

    /* No document to send: record what happened and say exactly that. */
    if (!link) {
      const missing = unavailable !== 'error';
      await setRecord({ status: missing ? 'undeliverable' : 'failed', delivery: 'none', metadata: { request_id: id, reason: missing ? 'document_not_in_storage' : 'storage_unavailable' } });
      if (mail.configured) await tellInside(missing ? 'DOCUMENT NOT IN STORAGE — send manually' : 'STORAGE UNAVAILABLE — send manually', to);
      await sheets.logRequest({ name, email: to, organisation: org, reportId, reportTitle: report.title, page: context.page_path, referrer: context.referrer }, id).catch(() => {});
      if (!captured()) throw new HttpError(503, MSG.notCaptured);
      log('info', id, 'request_recorded_not_delivered', { report: reportId, reason: missing ? 'not_in_storage' : 'storage_unavailable', stored, notified });
      return ok(req, res, { ok: true, delivered: false, message: missing ? MSG.teamWillSend : MSG.downloadUnavailable });
    }

    /* A document, but no way to email it. */
    if (!mail.configured) {
      await setRecord({ status: 'failed', delivery, metadata: { request_id: id, reason: 'mail_not_configured' } });
      if (!captured()) throw new HttpError(503, MSG.notCaptured);
      log('error', id, 'mail_not_configured', { report: reportId, stored });
      return ok(req, res, { ok: true, delivered: false, message: MSG.teamWillSend });
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
      await setRecord({ status: 'failed', delivery, metadata: { request_id: id, reason: 'send_failed' } });
      await sheets.logRequest({ name, email: to, organisation: org, reportId, reportTitle: report.title, page: context.page_path, referrer: context.referrer }, id).catch(() => {});
      await tellInside('SEND FAILED — please send manually', to);
      if (!captured()) throw new HttpError(503, MSG.notCaptured);
      log('error', id, 'send_failed_recorded', { report: reportId, stored, notified });
      return ok(req, res, { ok: true, delivered: false, message: MSG.teamWillSend });
    }

    markSeen(dupKey, 10 * 60 * 1000);
    await setRecord({
      status: 'sent', delivery, resend_id: sendResult && sendResult.id ? String(sendResult.id) : null,
      link_expires_at: expiresAt ? expiresAt.toISOString() : null
    });
    await tellInside(attached ? 'Sent (attachment)' : 'Sent (link)');
    await sheets.logRequest({ name, email: to, organisation: org, reportId, reportTitle: report.title, page: context.page_path, referrer: context.referrer }, id).catch(() => {});
    log('info', id, 'request_sent', { report: reportId, delivery, stored });

    const when = expiresAt ? ` The link is valid until ${fmtDate(expiresAt)}.` : '';
    return ok(req, res, { ok: true, delivered: true, message: `Sent to ${to}.${when} If it does not arrive within a few minutes, check your spam folder or email inquiries@kakderesearch.com.` });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    /* Only an unexpected failure is worth an internal email; a 4xx is the
       visitor's (or a bot's) doing and must not be able to generate mail. */
    if (status >= 500 && !(error instanceof HttpError && status === 503 && error.message === MSG.notCaptured) && mailConfig().configured) {
      await notifyInside({
        report: { title: (report && report.title) || 'Unknown', id: reportId || 'unknown' },
        to, name, org, outcome: 'ERROR — ' + (error && error.message || 'unknown failure'), recordId, context
      }).catch(() => {});
    }
    log(status >= 500 ? 'error' : 'info', id, 'request_failed', { status, report: reportId || null, reason: status >= 500 ? String(error && error.message) : undefined });
    return fail(req, res, error);
  }
};
