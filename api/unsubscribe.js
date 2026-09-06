/* GET /api/unsubscribe/?e=<base64url email>&t=<signature>
   The link every mailing-list note carries. The signature is an HMAC of
   the address under UNSUBSCRIBE_SECRET, so a link only works for the
   address it was issued for. Marks the row unsubscribed and answers with a
   page; never reveals whether an address was on the list. */

'use strict';

const { method, text, hmac, clientIp, rateLimit, escapeHtml, sendHtml, htmlPage, HttpError, requestId, log, BASE_URL } = require('./_lib/http');
const db = require('./_lib/db');

function secret() { return process.env.UNSUBSCRIBE_SECRET || process.env.IP_HASH_SALT || 'kakde-research'; }

function queryParam(req, key) {
  if (req.query && typeof req.query === 'object' && req.query[key] != null) return String(req.query[key]);
  try { return new URL(req.url || '/', 'http://localhost').searchParams.get(key) || ''; } catch (_) { return ''; }
}

function page(res, status, heading, body) {
  return sendHtml(res, status, htmlPage({
    title: 'Mailing list', kicker: 'Kakde Research · Mailing list', heading, body,
    back: BASE_URL + '/', backLabel: 'Back to kakderesearch.com'
  }));
}

module.exports = async function handler(req, res) {
  const id = requestId();
  try {
    method(req, 'GET');
    rateLimit(`unsub:${clientIp(req)}`, 20, 10 * 60 * 1000);
    const e = text(queryParam(req, 'e'), 400);
    const t = text(queryParam(req, 't'), 80);
    let address = '';
    try { address = Buffer.from(e, 'base64url').toString('utf8').toLowerCase(); } catch (_) { address = ''; }
    const valid = address && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) && t && t === hmac(secret(), address).slice(0, 40);
    if (!valid) {
      log('info', id, 'unsubscribe_bad_link');
      return page(res, 400, 'That link is not valid.', `<p>The unsubscribe link may have been cut short. Reply to any note, or email <a href="mailto:inquiries@kakderesearch.com">inquiries@kakderesearch.com</a>, and you will be removed by hand.</p>`);
    }
    if (!db.configured()) throw new HttpError(503, 'Unavailable');
    await db.update('newsletter_subscribers', `email=eq.${encodeURIComponent(address)}`, { status: 'unsubscribed', unsubscribed_at: new Date().toISOString() }, id);
    log('info', id, 'unsubscribed');
    return page(res, 200, 'You are unsubscribed.', `<p>${escapeHtml(address)} will receive no further notes. If this was a mistake, email <a href="mailto:inquiries@kakderesearch.com">inquiries@kakderesearch.com</a>.</p>`);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    log('error', id, 'unsubscribe_failed', { status });
    return page(res, status >= 500 ? 503 : status, 'That could not be done just now.', `<p>Please reply to any note, or email <a href="mailto:inquiries@kakderesearch.com">inquiries@kakderesearch.com</a>, and you will be removed by hand.</p>`);
  }
};
