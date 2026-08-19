/* POST /api/newsletter
   Records a mailing-list subscription. Where Supabase is configured the
   address is upserted into newsletter_subscribers (production's table); a
   confirmation is emailed when Resend is configured; the practice inbox is
   notified best-effort. Honeypot + rate limit + idempotency (marked only
   after success). Truthful states only. */

'use strict';

const { method, requireJson, readBody, text, email, escapeHtml, clientIp, rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress, ok, fail, HttpError } = require('./_lib/http');
const db = require('./_lib/db');

const CONFIRM = 'Subscribed. You can unsubscribe at any time by replying to any note.';

module.exports = async function handler(req, res) {
  try {
    method(req, 'POST');
    requireJson(req);
    const data = await readBody(req);
    if (data.website || data._hp) throw new HttpError(400, 'Unable to process this submission.');

    rateLimit(`news:${clientIp(req)}`, 5, 15 * 60 * 1000);

    const to = email(data.email);
    const topic = text(data.topic, 160);
    const dupKey = `news:${to}:${topic}`;
    if (isSeen(dupKey)) return ok(res, { ok: true, message: CONFIRM });

    const canStore = db.configured();
    const canMail = mailConfig().configured;
    if (!canStore && !canMail) throw new HttpError(503, 'Subscriptions are not configured yet.');

    let stored = false;
    if (canStore) {
      try {
        await db.insert('newsletter_subscribers', {
          email: to, status: 'active', source: topic || 'site', page_path: text(data.page_path, 200),
          metadata: { user_agent: text(req.headers['user-agent'], 300) }, unsubscribed_at: null
        }, { upsert: true, onConflict: 'email' });
        stored = true;
      } catch (e) { console.error('Subscriber upsert failed', e && e.message); }
    }

    let mailed = false;
    if (canMail) {
      try {
        await sendEmail({
          to,
          subject: `You are subscribed — Kakde Research`,
          html: `<div style="font-family:Georgia,serif;color:#232837;max-width:560px">
            <p>Thanks — you are subscribed${topic ? ' (' + escapeHtml(topic) + ')' : ''}.</p>
            <p>You will receive the monthly note on emerging markets, and nothing else. Reply to any note to be removed.</p>
            <p style="color:#5C6370;font-size:13px">Kakde Research &middot; inquiries@kakderesearch.com</p>
          </div>`,
          text: `Thanks — you are subscribed. You will receive the monthly note on emerging markets, and nothing else. Reply to any note to be removed.\nKakde Research · inquiries@kakderesearch.com`
        });
        mailed = true;
        const inbox = inboxAddress();
        if (inbox) {
          sendEmail({ to: inbox, subject: `New subscriber${topic ? ' — ' + topic : ''}`, html: `<p>New subscriber</p><ul><li>Email: ${escapeHtml(to)}</li><li>Topic: ${escapeHtml(topic) || '—'}</li><li>Stored: ${stored ? 'yes' : 'no'}</li></ul>`, text: `New subscriber: ${to}` }).catch(() => {});
        }
      } catch (e) {
        if (!stored) throw e;
        console.error('Subscription confirmation failed after storage succeeded', e && e.status);
      }
    }
    if (!stored && !mailed) throw new HttpError(503, 'Subscriptions are not configured yet.');

    markSeen(dupKey, 10 * 60 * 1000);
    return ok(res, { ok: true, message: CONFIRM });
  } catch (error) {
    return fail(res, error);
  }
};
