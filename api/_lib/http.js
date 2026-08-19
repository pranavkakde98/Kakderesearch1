/* Shared helpers for the Kakde Research serverless API (Vercel Node runtime).
   Deliberately dependency-free: JSON body parsing, validation, escaping, a
   best-effort in-memory rate limiter and idempotency guard, and typed errors.
   The in-memory stores are per-instance and reset on cold start; a durable
   store (Vercel KV / Upstash Redis) is the documented production upgrade. */

'use strict';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function method(req, allowed) {
  if (req.method !== allowed) throw new HttpError(405, 'Method not allowed.');
}

async function readBody(req) {
  // Vercel may pre-parse JSON into req.body; otherwise read the stream.
  if (req.body && typeof req.body === 'object') return req.body;
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
  const s = String(value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Conservative single-line email check; the provider is the final authority.
function email(value) {
  const s = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(422, 'Enter a valid work email address.');
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
const seen = new Map();
function seenRecently(key, windowMs) {
  const now = Date.now();
  for (const [k, exp] of seen) { if (exp < now) seen.delete(k); }
  if (seen.has(key)) return true;
  seen.set(key, now + windowMs);
  return false;
}

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    // Never fake a send. Tell the caller it is not configured.
    throw new HttpError(503, 'Email delivery is not configured yet.');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo || process.env.EMAIL_REPLY_TO || undefined
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, detail.slice(0, 300));
    throw new HttpError(502, 'The message could not be delivered just now.');
  }
  return res.json().catch(() => ({}));
}

function ok(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(payload));
}

function fail(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  // 5xx are our problem: never leak internals to the caller.
  const message = status < 500 ? error.message : 'Something went wrong at our end. Please email inquiries@kakderesearch.com.';
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify({ ok: false, error: message }));
}

module.exports = {
  HttpError, method, readBody, text, email, escapeHtml, clientIp,
  rateLimit, seenRecently, sendEmail, ok, fail
};
