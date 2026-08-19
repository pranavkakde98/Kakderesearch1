/* Shared helpers for the Kakde Research serverless API (Vercel Node runtime).
   Deliberately dependency-free: JSON body parsing, validation, escaping, a
   best-effort in-memory rate limiter and idempotency guard, Resend delivery
   and typed errors. The in-memory stores are per-instance and reset on cold
   start; the durable checks live in Supabase (see db.js) where configured. */

'use strict';

const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function method(req, allowed) {
  if (req.method !== allowed) throw new HttpError(405, 'Method not allowed.');
}

/* Cheap abuse guard: the site's own scripts always send JSON, and a browser
   always sends an Origin on a cross-site POST. Anything else is not the site. */
function requireJson(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) throw new HttpError(415, 'Send JSON.');
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  const allowed = [process.env.APP_BASE_URL, 'https://www.kakderesearch.com', 'https://kakderesearch.com']
    .filter(Boolean).map(u => u.replace(/\/$/, ''));
  const ok = allowed.includes(origin.replace(/\/$/, '')) || /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin) || /^https?:\/\/localhost(:\d+)?$/i.test(origin);
  if (!ok) throw new HttpError(403, 'Origin not allowed.');
}

async function readBody(req) {
  // Vercel may pre-parse JSON into req.body; otherwise read the stream.
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { throw new HttpError(400, 'Invalid JSON body.'); }
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100000) reject(new HttpError(413, 'Payload too large.'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(new HttpError(400, 'Invalid JSON body.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'Could not read request.')));
  });
}

function text(value, max) {
  if (value == null) return '';
  const s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Conservative single-line email check; the provider is the final authority.
function email(value) {
  const s = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new HttpError(422, 'Enter a valid work email address.');
  return s;
}

// Escape untrusted values before they enter an HTML email template.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'unknown';
}

/* IPs are only ever stored hashed. */
function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || 'kakde-research';
  return crypto.createHash('sha256').update(salt + '|' + String(ip || '')).digest('hex').slice(0, 32);
}

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// --- best-effort in-memory rate limiter (per instance) ---
const rlStore = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const rec = rlStore.get(key);
  if (!rec || now > rec.reset) { rlStore.set(key, { count: 1, reset: now + windowMs }); return; }
  if (rec.count >= max) throw new HttpError(429, 'Too many requests. Please try again later.');
  rec.count += 1;
}

// --- best-effort idempotency guard (per instance) ---
// isSeen() only reads; markSeen() is called AFTER a send succeeds, so a
// failed first attempt can never turn the retry into a false "already sent".
const seen = new Map();
function sweep(now) { for (const [k, exp] of seen) { if (exp < now) seen.delete(k); } }
function isSeen(key) { sweep(Date.now()); return seen.has(key); }
function markSeen(key, windowMs) { seen.set(key, Date.now() + windowMs); }

/* Resend. `from` reads both this repo's name and production's, so the
   function works in either Vercel project without a rename. */
function mailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM;
  return { apiKey, from, configured: !!(apiKey && from) };
}

async function sendEmail({ to, subject, html, text: plain, replyTo, attachments, idempotencyKey, headers }) {
  const { apiKey, from, configured } = mailConfig();
  if (!configured) {
    // Never fake a send. Tell the caller it is not configured.
    throw new HttpError(503, 'Email delivery is not configured yet.');
  }
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: plain,
    reply_to: replyTo || process.env.EMAIL_REPLY_TO || undefined,
    headers: headers || undefined,
    attachments: attachments && attachments.length ? attachments : undefined
  };
  const reqHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) reqHeaders['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: reqHeaders, body: JSON.stringify(payload) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, detail.slice(0, 300));
    throw new HttpError(502, 'The message could not be delivered just now.');
  }
  return res.json().catch(() => ({}));
}

function inboxAddress() {
  return process.env.INQUIRY_TO_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || '';
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}
function ok(res, payload) { send(res, 200, payload); }
function fail(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  // 5xx are our problem: never leak internals to the caller.
  const message = status < 500 ? error.message : 'Something went wrong at our end. Please email inquiries@kakderesearch.com.';
  if (status >= 500) console.error(error);
  send(res, status, { ok: false, error: message });
}

module.exports = {
  HttpError, method, requireJson, readBody, text, email, escapeHtml, clientIp, hashIp, sha256,
  rateLimit, isSeen, markSeen, mailConfig, sendEmail, inboxAddress, ok, fail
};
