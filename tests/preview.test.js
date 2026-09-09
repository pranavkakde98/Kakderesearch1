'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.VERCEL_ENV = 'preview';
process.env.VERCEL_URL = 'v15-test.vercel.app';
process.env.APP_BASE_URL = 'https://www.kakderesearch.com';
process.env.RESEND_API_KEY = 'test-only';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.SUPABASE_ANON_KEY = 'test-only';
process.env.UNSUBSCRIBE_SECRET = 'test-only';
let calls = 0;
global.fetch = async () => { calls++; throw new Error('Preview must never call an external service'); };
const contact = { name: 'Test', email: 'test@example.com', organisation: 'Preview', service: 'Consulting', question: 'A test question for the preview.', timeframe: 'Test', role: 'Tester', country: 'UK' };
function response() { return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(b) { this.body = b; } }; }
function request(body, html = false) {
  return { method: 'POST', body: html ? new URLSearchParams(body).toString() : body, headers: { origin: 'https://v15-test.vercel.app', 'content-type': html ? 'application/x-www-form-urlencoded' : 'application/json', accept: html ? 'text/html' : 'application/json' } };
}
for (const [name, body] of [['contact', contact], ['newsletter', { email: 'test@example.com' }], ['request-report', { email: 'test@example.com', reportId: 'cost-of-capital' }]]) {
  test(`${name}: JSON and plain-form previews validate without mail or database requests`, async () => {
    for (const html of [false, true]) {
      const res = response();
      await require(`../api/${name}`)(request(body, html), res);
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /V15 preview complete/);
      assert.match(res.body, /No email has been sent/);
      if (!html) assert.equal(JSON.parse(res.body).preview, true);
    }
    assert.equal(calls, 0);
  });
}
test('preview still rejects invalid contact data', async () => {
  const res = response();
  await require('../api/contact')(request({ ...contact, email: 'invalid' }), res);
  assert.equal(res.statusCode, 422);
  assert.equal(calls, 0);
});
test('valid unsubscribe preview never changes a live subscription', async () => {
  const email = 'test@example.com';
  const token = require('../api/_lib/http').hmac('test-only', email).slice(0, 40);
  const res = response();
  await require('../api/unsubscribe')({ method: 'GET', headers: {}, query: { e: Buffer.from(email).toString('base64url'), t: token } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No subscription has been changed/);
  assert.equal(calls, 0);
});
test('no-script report request stays on the preview host', async () => {
  const res = response();
  await require('../api/request-report')({ method: 'GET', headers: {}, query: { report: 'cost-of-capital' } }, res);
  assert.match(res.body, /action="\/api\/request-report\/"/);
  assert.doesNotMatch(res.body, /href="https:\/\/www\.kakderesearch\.com/);
  assert.equal(calls, 0);
});
