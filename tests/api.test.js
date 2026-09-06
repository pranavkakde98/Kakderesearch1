/* Regression tests for the serverless API. Every external dependency is
   stubbed: no network, no mail, no database. Run with `node --test tests/`
   (Node 20 or later; nothing to install).

   Each test covers a failure path that the September 2026 audit reproduced,
   so a regression trips here before it reaches a visitor. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const API = path.join(__dirname, '..', 'api');

function fresh(mod) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API)) delete require.cache[k];
  return require(path.join(API, mod));
}
function env(vars) {
  for (const k of Object.keys(vars)) { if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
}
const BASE_ENV = {
  RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Kakde Research <research@kakderesearch.com>',
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: null,
  APP_BASE_URL: 'https://www.kakderesearch.com', VERCEL_ENV: 'production', VERCEL_URL: 'kakde-abc123.vercel.app',
  SHEETS_WEBHOOK_URL: null, SHEETS_WEBHOOK_SECRET: null, REPORT_ATTACH: null, UNSUBSCRIBE_SECRET: 'unsub-secret', IP_HASH_SALT: 'salt'
};

function req({ method = 'POST', body, headers = {}, url = '/api/x', query } = {}) {
  return {
    method, body, url, query,
    headers: Object.assign({ 'content-type': 'application/json', origin: 'https://www.kakderesearch.com', 'x-vercel-forwarded-for': '203.0.113.9' }, headers),
    on() {}
  };
}
function res() {
  return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } };
}
function json(r) { try { return JSON.parse(r.body); } catch (_) { return null; } }
function reply(status, body, headers) { return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }); }

/* A fetch stub with named routes and a call log. */
function stubFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url); const o = opts || {};
    calls.push({ url: u, method: o.method || 'GET', body: o.body ? String(o.body) : '', headers: o.headers || {} });
    for (const r of routes) if (r.when(u, o)) return r.then(u, o);
    return reply(200, {});
  };
  return calls;
}
const resendOk = { when: u => u.includes('api.resend.com'), then: () => reply(200, { id: 'msg_1' }) };
const resendFail = { when: u => u.includes('api.resend.com'), then: () => reply(500, 'boom') };
const countRoute = (n) => ({ when: (u, o) => u.includes('/rest/v1/report_requests?select=id') && (o.method || 'GET') === 'GET', then: () => reply(200, [], { 'content-range': `0-0/${n}` }) });
const insertOk = { when: (u, o) => /\/rest\/v1\/report_requests(\?|$)/.test(u) && o.method === 'POST', then: () => reply(201, [{ id: 'rec_1' }]) };
const insertFail = { when: (u, o) => /\/rest\/v1\/report_requests(\?|$)/.test(u) && o.method === 'POST', then: () => reply(500, { message: 'down' }) };
const patchOk = { when: (u, o) => u.includes('/rest/v1/report_requests?id=') && o.method === 'PATCH', then: () => reply(200, [{}]) };
const storageMissing = { when: u => u.includes('/storage/v1/object/sign/'), then: () => reply(404, { error: 'not found' }) };
const storageOk = { when: u => u.includes('/storage/v1/object/sign/'), then: () => reply(200, { signedURL: '/object/sign/reports/x.pdf?token=abc' }) };

const reportBody = { email: 'reader@example.com', reportId: 'cost-of-capital', name: 'R', organisation: 'Fund' };

test('durable limiter uses defined windows and enforces the per-IP threshold with Retry-After', async () => {
  env(BASE_ENV);
  const calls = stubFetch([countRoute(30), insertOk, patchOk, storageOk, resendOk]);
  const h = fresh('request-report.js');
  const r = res();
  await h(req({ body: reportBody }), r);
  const counts = calls.filter(c => c.url.includes('report_requests?select=id'));
  assert.equal(counts.length, 3, 'three durable counts are made');
  for (const c of counts) assert.match(c.url, /created_at=gte\.\d{4}-\d{2}-\d{2}T/, 'every window is a real timestamp');
  assert.equal(r.statusCode, 429);
  assert.ok(r.headers['retry-after'], 'Retry-After is set');
  assert.equal(calls.filter(c => c.url.includes('api.resend.com')).length, 0, 'nothing is emailed on a 429');
});

test('missing document: record marked with a schema-valid status, team notified with Reply-To, honest message', async () => {
  env(BASE_ENV);
  const calls = stubFetch([countRoute(0), insertOk, patchOk, storageMissing, resendOk]);
  const h = fresh('request-report.js');
  const r = res();
  await h(req({ body: reportBody }), r);
  const body = json(r);
  assert.equal(r.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.delivered, false);
  assert.doesNotMatch(body.message, /nearing completion/);
  const patch = calls.find(c => c.method === 'PATCH');
  assert.ok(patch, 'the record is updated');
  const fields = JSON.parse(patch.body);
  assert.ok(['received', 'sent', 'failed', 'undeliverable', 'duplicate'].includes(fields.status), 'status is one the schema allows');
  assert.equal(fields.delivery, 'none');
  const mails = calls.filter(c => c.url.includes('api.resend.com')).map(c => JSON.parse(c.body));
  assert.equal(mails.length, 1, 'one internal note');
  assert.equal(mails[0].reply_to, 'reader@example.com', 'a person is expected to reply to the requester');
});

test('nothing captured: no database, mail fails, storage missing → 503 with the direct address', async () => {
  env(Object.assign({}, BASE_ENV, { SUPABASE_URL: null, SUPABASE_SERVICE_ROLE_KEY: null }));
  stubFetch([resendFail]);
  const h = fresh('request-report.js');
  const r = res();
  await h(req({ body: reportBody }), r);
  const body = json(r);
  assert.equal(r.statusCode, 503);
  assert.equal(body.ok, false);
  assert.match(body.error, /inquiries@kakderesearch\.com/);
});

test('routine 4xx outcomes never generate internal email', async () => {
  env(BASE_ENV);
  const calls = stubFetch([resendOk]);
  const h = fresh('request-report.js');
  let r = res();
  await h(req({ method: 'PUT', body: reportBody }), r);
  assert.equal(r.statusCode, 405);
  r = res();
  await h(req({ body: Object.assign({}, reportBody, { email: 'not-an-email' }) }), r);
  assert.equal(r.statusCode, 422);
  r = res();
  await h(req({ body: Object.assign({}, reportBody, { reportId: 'no-such-report' }) }), r);
  assert.equal(r.statusCode, 404);
  assert.equal(calls.filter(c => c.url.includes('api.resend.com')).length, 0);
});

test('GET renders a request page for readers without script', async () => {
  env(BASE_ENV);
  stubFetch([]);
  const h = fresh('request-report.js');
  const r = res();
  await h(req({ method: 'GET', url: '/api/request-report/?report=cost-of-capital', headers: { 'content-type': '', accept: 'text/html' } }), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.body, /<form method="post"/);
  assert.match(r.body, /name="reportId" value="cost-of-capital"/);
});

test('a plain form post is answered with a page, not JSON', async () => {
  env(BASE_ENV);
  stubFetch([countRoute(0), insertOk, patchOk, storageOk, resendOk]);
  const h = fresh('request-report.js');
  const r = res();
  await h(req({ body: 'email=reader%40example.com&reportId=cost-of-capital', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' } }), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.body, /Thank you/);
});

test('pre-parsed bodies are held to the same byte limit', async () => {
  env(BASE_ENV);
  stubFetch([]);
  const h = fresh('contact.js');
  const r = res();
  await h(req({ body: { question: 'x'.repeat(200000), email: 'a@b.co' } }), r);
  assert.equal(r.statusCode, 413);
});

test('origin allowlist: unrelated Vercel projects are refused in production, our own preview host is allowed', async () => {
  env(BASE_ENV);
  stubFetch([]);
  const h = fresh('contact.js');
  let r = res();
  await h(req({ body: {}, headers: { origin: 'https://someone-else.vercel.app' } }), r);
  assert.equal(r.statusCode, 403);
  r = res();
  await h(req({ body: {}, headers: { origin: 'https://kakde-abc123.vercel.app' } }), r);
  assert.notEqual(r.statusCode, 403);
  r = res();
  await h(req({ body: {}, headers: { origin: 'http://localhost:5014' } }), r);
  assert.equal(r.statusCode, 403, 'localhost is not an origin in production');
});

const enquiry = { name: 'A', email: 'a@example.com', organisation: 'Org', service: 'Consulting', question: 'Should we enter the Mexican market this year?', timeframe: 'Q4', role: 'CIO', country: 'UK' };

test('contact: distinct questions sharing a prefix are both delivered; an identical enquiry is deduplicated', async () => {
  env(BASE_ENV);
  const calls = stubFetch([resendOk]);
  const h = fresh('contact.js');
  await h(req({ body: enquiry }), res());
  await h(req({ body: Object.assign({}, enquiry, { question: enquiry.question + ' And what about Brazil, which is a different question entirely?' }) }), res());
  await h(req({ body: enquiry }), res());
  assert.equal(calls.filter(c => c.url.includes('api.resend.com')).length, 2);
});

test('contact: the shared validation contract is enforced server-side', async () => {
  env(BASE_ENV);
  stubFetch([resendOk]);
  const h = fresh('contact.js');
  let r = res();
  await h(req({ body: Object.assign({}, enquiry, { question: 'x' }) }), r);
  assert.equal(r.statusCode, 422);
  r = res();
  await h(req({ body: Object.assign({}, enquiry, { role: '' }) }), r);
  assert.equal(r.statusCode, 422);
  r = res();
  await h(req({ body: Object.assign({}, enquiry, { country: '' }) }), r);
  assert.equal(r.statusCode, 422);
  r = res();
  await h(req({ body: enquiry }), r);
  assert.equal(r.statusCode, 200);
});

test('contact: the in-memory limit rejects the eleventh request in ten minutes with Retry-After', async () => {
  env(BASE_ENV);
  stubFetch([resendOk]);
  const h = fresh('contact.js');
  let last;
  for (let i = 0; i < 11; i++) {
    last = res();
    await h(req({ body: Object.assign({}, enquiry, { question: enquiry.question + ' variant ' + i }) }), last);
  }
  assert.equal(last.statusCode, 429);
  assert.ok(last.headers['retry-after']);
});

test('newsletter: an unsubscribed address is not reactivated by a resubmission', async () => {
  env(BASE_ENV);
  const calls = stubFetch([
    { when: (u, o) => u.includes('/rest/v1/newsletter_subscribers?select=') , then: () => reply(200, [{ id: 's1', status: 'unsubscribed' }]) },
    resendOk
  ]);
  const h = fresh('newsletter.js');
  const r = res();
  await h(req({ body: { email: 'gone@example.com' } }), r);
  assert.equal(r.statusCode, 409);
  assert.equal(calls.filter(c => c.method === 'POST' && c.url.includes('newsletter_subscribers')).length, 0, 'no insert or upsert');
  assert.equal(calls.filter(c => c.url.includes('api.resend.com')).length, 0);
});

test('newsletter: success requires the stored row; a failed insert is a 503 and sends no confirmation', async () => {
  env(BASE_ENV);
  const calls = stubFetch([
    { when: (u, o) => u.includes('/rest/v1/newsletter_subscribers?select='), then: () => reply(200, []) },
    { when: (u, o) => /\/rest\/v1\/newsletter_subscribers(\?|$)/.test(u) && o.method === 'POST', then: () => reply(500, { message: 'no table' }) },
    resendOk
  ]);
  const h = fresh('newsletter.js');
  const r = res();
  await h(req({ body: { email: 'new@example.com' } }), r);
  assert.equal(r.statusCode, 503);
  assert.equal(calls.filter(c => c.url.includes('api.resend.com')).length, 0);
});

test('newsletter: a stored subscription is confirmed with a signed unsubscribe link, and the link works', async () => {
  env(BASE_ENV);
  const calls = stubFetch([
    { when: (u, o) => u.includes('/rest/v1/newsletter_subscribers?select='), then: () => reply(200, []) },
    { when: (u, o) => /\/rest\/v1\/newsletter_subscribers(\?|$)/.test(u) && o.method === 'POST', then: () => reply(201, [{ id: 's2' }]) },
    { when: (u, o) => u.includes('/rest/v1/newsletter_subscribers?email=') && o.method === 'PATCH', then: () => reply(200, [{}]) },
    resendOk
  ]);
  const h = fresh('newsletter.js');
  const r = res();
  await h(req({ body: { email: 'new@example.com' } }), r);
  assert.equal(r.statusCode, 200);
  const confirm = calls.filter(c => c.url.includes('api.resend.com')).map(c => JSON.parse(c.body)).find(m => m.to[0] === 'new@example.com');
  assert.ok(confirm, 'confirmation sent to the subscriber');
  const link = (confirm.text.match(/https:\/\/www\.kakderesearch\.com\/api\/unsubscribe\/\?e=[^\s]+/) || [])[0];
  assert.ok(link, 'confirmation carries an unsubscribe link');
  const u = new URL(link);
  const unsub = fresh('unsubscribe.js');
  let r2 = res();
  await unsub(req({ method: 'GET', url: u.pathname + u.search, headers: { 'content-type': '', accept: 'text/html' } }), r2);
  assert.equal(r2.statusCode, 200);
  const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('newsletter_subscribers'));
  assert.ok(patch);
  assert.equal(JSON.parse(patch.body).status, 'unsubscribed');
  r2 = res();
  await unsub(req({ method: 'GET', url: u.pathname + '?e=' + u.searchParams.get('e') + '&t=deadbeef', headers: { 'content-type': '', accept: 'text/html' } }), r2);
  assert.equal(r2.statusCode, 400);
});

test('sheets mirror: cells that would become formulas are neutralised; unsigned mirrors are skipped', async () => {
  env(Object.assign({}, BASE_ENV, { SHEETS_WEBHOOK_URL: 'https://script.example/exec', SHEETS_WEBHOOK_SECRET: null }));
  const sheets = fresh('_lib/sheets.js');
  assert.equal(sheets.cell('=SUM(A1:A9)', 50), "'=SUM(A1:A9)");
  assert.equal(sheets.cell('+1', 50), "'+1");
  assert.equal(sheets.cell('plain', 50), 'plain');
  assert.equal(sheets.configuredMirror(), false);
  env({ SHEETS_WEBHOOK_SECRET: 's' });
  const calls = stubFetch([{ when: u => u.includes('script.example'), then: () => reply(200, { ok: true }) }]);
  const out = await sheets.logRequest({ name: 'n', email: 'E@X.CO', organisation: 'o', reportId: 'r', reportTitle: 't', page: '/p', referrer: '' }, 'id');
  assert.equal(out.ok, true);
  assert.match(calls[0].url, /[?&]sig=[0-9a-f]{64}/);
  assert.ok(calls[0].headers['X-Kakde-Signature']);
});

test('storage: the signed-link lifetime is clamped to the documented bounds', () => {
  env(Object.assign({}, BASE_ENV, { REPORT_LINK_TTL_SECONDS: '99999999' }));
  const storage = fresh('_lib/storage.js');
  assert.equal(storage.ttlSeconds(), storage.MAX_TTL);
  env({ REPORT_LINK_TTL_SECONDS: '10' });
  assert.equal(fresh('_lib/storage.js').ttlSeconds(), 300);
  env({ REPORT_LINK_TTL_SECONDS: null });
  assert.equal(fresh('_lib/storage.js').ttlSeconds(), 7 * 24 * 60 * 60);
});
