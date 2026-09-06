/* Optional Google Sheets mirror for report requests.
 *
 * The mirror is a convenience, not the record: the database is the record.
 * It runs only when BOTH SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET are
 * set. Every post is signed (HMAC-SHA256 of the exact body, hex, in the
 * X-Kakde-Signature header) so an Apps Script that anyone can reach cannot
 * be fed rows by anyone but this API, and every cell is neutralised so a
 * value beginning with =, +, - or @ cannot become a spreadsheet formula.
 *
 * Setup:
 *   1. Create a Google Sheet with columns:
 *      Timestamp | Name | Email | Organisation | Report ID | Report Title | Page | Referrer
 *   2. Extensions → Apps Script → paste the handler below; set a Script
 *      Property named SECRET to a long random string.
 *   3. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
 *   4. Vercel env: SHEETS_WEBHOOK_URL = the web app URL,
 *      SHEETS_WEBHOOK_SECRET = the same secret.
 *
 * Apps Script (google-sheets-handler.gs):
 *
 *   function doPost(e) {
 *     try {
 *       const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
 *       const body = e.postData.contents;
 *       const given = String((e.parameter && e.parameter.sig) || '');
 *       const mac = Utilities.computeHmacSha256Signature(body, secret)
 *         .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
 *       if (!given || given !== mac) {
 *         return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad signature' }))
 *           .setMimeType(ContentService.MimeType.JSON);
 *       }
 *       const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Report Requests') ||
 *                     SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
 *       const data = JSON.parse(body);
 *       sheet.appendRow([
 *         data.timestamp || new Date().toISOString(), data.name || '', data.email || '',
 *         data.organisation || '', data.report_id || '', data.report_title || '',
 *         data.page || '', data.referrer || ''
 *       ]);
 *       return ContentService.createTextOutput(JSON.stringify({ ok: true }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     } catch (err) {
 *       return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     }
 *   }
 *
 * Apps Script web apps do not expose custom request headers to doPost, so
 * the signature is also sent as the `sig` query parameter; the header is
 * kept for any other receiver.
 */

'use strict';

const { fetchWithTimeout, hmac, log } = require('./http');

/* A leading =, +, -, @, tab or carriage return would be read as a formula
   or break the row: prefix it with an apostrophe so it stays text. */
function cell(value, max) {
  let s = String(value == null ? '' : value).slice(0, max);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function configuredMirror() {
  return !!(process.env.SHEETS_WEBHOOK_URL && process.env.SHEETS_WEBHOOK_SECRET);
}

async function logRequest({ name, email, organisation, reportId, reportTitle, page, referrer }, reqId) {
  if (!configuredMirror()) {
    if (process.env.SHEETS_WEBHOOK_URL && !process.env.SHEETS_WEBHOOK_SECRET) log('error', reqId || '-', 'sheets_mirror_unsigned_skipped');
    return { skipped: true };
  }
  const payload = {
    timestamp: new Date().toISOString(),
    name: cell(name, 160),
    email: cell(String(email || '').toLowerCase(), 254),
    organisation: cell(organisation, 200),
    report_id: cell(reportId, 80),
    report_title: cell(reportTitle, 300),
    page: cell(page, 300),
    referrer: cell(referrer, 500)
  };
  const body = JSON.stringify(payload);
  const sig = hmac(process.env.SHEETS_WEBHOOK_SECRET, body);
  const url = process.env.SHEETS_WEBHOOK_URL + (process.env.SHEETS_WEBHOOK_URL.includes('?') ? '&' : '?') + 'sig=' + sig;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kakde-Signature': sig },
      body
    }, 5000);
    const textOut = await response.text();
    let result = null;
    try { result = JSON.parse(textOut); } catch (_) { result = { raw: textOut.slice(0, 100) }; }
    const okay = !!(response.ok && result && result.ok);
    if (!okay) log('error', reqId || '-', 'sheets_mirror_failed', { status: response.status });
    return { ok: okay };
  } catch (err) {
    log('error', reqId || '-', 'sheets_mirror_failed', { reason: err && err.name });
    return { ok: false };
  }
}

module.exports = { logRequest, cell, configuredMirror };
