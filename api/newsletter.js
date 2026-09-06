/* POST /api/newsletter
   Records a mailing-list subscription. A subscription is only ever
   confirmed when a durable row exists in newsletter_subscribers: without
   the database there is no list, so the visitor is told so and given the
   address instead. An address that unsubscribed earlier is never
   reactivated by a plain resubmission. The confirmation email carries a
   signed unsubscribe link (see api/unsubscribe.js). Honeypot, rate limit,
   idempotency (marked only after success). Truthful states only. */

'use strict';

const {
  method, requireBody, readBody, text, email, escapeHtml, clientIp, hmac,
  rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress,
  ok, fail, HttpError, requestId, log, BASE_URL
} = require('./_lib/http');
const db = require('./_lib/db');

const CONFIRM = 'Subscribed. Every note carries an unsubscribe link.';
const ALREADY = 'That address is already on the list.';
const UNAVAILABLE = 'Subscriptions are not available just now. Email inquiries@kakderesearch.com and you will be added by hand.';
const WAS_UNSUBSCRIBED = 'That address unsubscribed earlier, so it has not been re-added. Email inquiries@kakderesearch.com if you would like to rejoin the list.';

function unsubscribeSecret() { return process.env.UNSUBSCRIBE_SECRET || process.env.IP_HASH_SALT || 'kakde-research'; }
function unsubscribeLink(address) {
  const e = Buffer.from(address, 'utf8').toString('base64url');
  const t = hmac(unsubscribeSecret(), address).slice(0, 40);
  return `${BASE_URL}/api/unsubscribe/?e=${e}&t=${t}`;
}

module.exports = async function handler(req, res) {
  const id = requestId();
  try {
    method(req, 'POST');
    requireBody(req);
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`news:${clientIp(req)}`, 5, 15 * 60 * 1000);

    const to = email(data.email);
    const topic = text(data.topic, 160);
    const dupKey = `news:${to}`;
    if (isSeen(dupKey)) return ok(req, res, { ok: true, message: CONFIRM });

    if (!db.configured()) throw new HttpError(503, UNAVAILABLE);

    /* The existing row decides what a resubmission means. */
    let existing = null;
    try {
      const rows = await db.select('newsletter_subscribers', `select=id,status&email=eq.${encodeURIComponent(to)}&limit=1`, id);
      existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (e) { throw new HttpError(503, UNAVAILABLE); }

    if (existing && existing.status === 'unsubscribed') {
      log('info', id, 'resubscribe_refused');
      throw new HttpError(409, WAS_UNSUBSCRIBED);
    }
    if (existing) {
      markSeen(dupKey, 10 * 60 * 1000);
      return ok(req, res, { ok: true, message: ALREADY });
    }

    try {
      await db.insert('newsletter_subscribers', {
        email: to, status: 'active', source: topic || 'site', page_path: text(data.page_path, 200),
        metadata: { user_agent: text(req.headers['user-agent'], 300), request_id: id }
      }, null, id);
    } catch (e) { throw new HttpError(503, UNAVAILABLE); }

    /* The row exists: the subscription is real. Confirmation is best-effort. */
    let mailed = false;
    if (mailConfig().configured) {
      const link = unsubscribeLink(to);
      try {
        await sendEmail({
          to,
          subject: `You are subscribed — Kakde Research`,
          html: `<div style="font-family:Georgia,serif;color:#232837;max-width:560px">
            <p>Thanks — you are subscribed${topic ? ' (' + escapeHtml(topic) + ')' : ''}.</p>
            <p>You will receive the monthly research note, and nothing else.</p>
            <p style="color:#5C6370;font-size:13px"><a href="${escapeHtml(link)}" style="color:#14294B">Unsubscribe</a> at any time, or reply to any note.</p>
            <p style="color:#5C6370;font-size:13px">Kakde Research &middot; inquiries@kakderesearch.com</p>
          </div>`,
          text: `Thanks — you are subscribed. You will receive the monthly research note, and nothing else.\nUnsubscribe at any time: ${link}\nKakde Research · inquiries@kakderesearch.com`
        });
        mailed = true;
      } catch (e) {
        log('error', id, 'subscription_confirmation_failed', { status: e && e.status });
      }
      const inbox = inboxAddress();
      if (inbox) {
        sendEmail({ to: inbox, subject: `New subscriber${topic ? ' — ' + topic : ''}`, html: `<p>New subscriber</p><ul><li>Email: ${escapeHtml(to)}</li><li>Topic: ${escapeHtml(topic) || '—'}</li><li>Confirmation sent: ${mailed ? 'yes' : 'no'}</li></ul>`, text: `New subscriber: ${to}\nConfirmation sent: ${mailed ? 'yes' : 'no'}` })
          .catch(() => { log('error', id, 'subscriber_inbox_note_failed'); });
      }
    }

    markSeen(dupKey, 10 * 60 * 1000);
    log('info', id, 'subscribed', { mailed });
    return ok(req, res, { ok: true, message: CONFIRM });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    log(status >= 500 ? 'error' : 'info', id, 'subscription_failed', { status });
    return fail(req, res, error);
  }
};
