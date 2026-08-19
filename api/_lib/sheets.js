/* Google Sheets logger for report requests.
 *
 * Setup:
 *   1. Create a Google Sheet with columns:
 *      Timestamp | Name | Email | Organisation | Report ID | Report Title | Page | Referrer
 *   2. Extensions → Apps Script → paste the webhook handler below
 *   3. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
 *   4. Copy the web app URL into Vercel env var SHEETS_WEBHOOK_URL
 *
 * Apps Script (google-sheets-handler.gs):
 *
 *   function doPost(e) {
 *     try {
 *       const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Report Requests') ||
 *                     SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
 *       const data = JSON.parse(e.postData.contents);
 *       const row = [
 *         data.timestamp || new Date().toISOString(),
 *         data.name || '',
 *         data.email || '',
 *         data.organisation || '',
 *         data.report_id || '',
 *         data.report_title || '',
 *         data.page || '',
 *         data.referrer || ''
 *       ];
 *       sheet.appendRow(row);
 *       return ContentService.createTextOutput(JSON.stringify({ ok: true }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     } catch (err) {
 *       return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     }
 *   }
 *
 * The handler is best-effort: if the webhook is not configured or the request
 * fails, the report request still succeeds — the sheet is a convenience, not
 * a dependency.
 */

'use strict';

const WEBHOOK = process.env.SHEETS_WEBHOOK_URL || '';

async function logRequest({ name, email, organisation, reportId, reportTitle, page, referrer }) {
  if (!WEBHOOK) return { skipped: true };

  const payload = {
    timestamp: new Date().toISOString(),
    name: String(name || '').slice(0, 160),
    email: String(email || '').toLowerCase().slice(0, 254),
    organisation: String(organisation || '').slice(0, 200),
    report_id: String(reportId || '').slice(0, 80),
    report_title: String(reportTitle || '').slice(0, 300),
    page: String(page || '').slice(0, 300),
    referrer: String(referrer || '').slice(0, 500)
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);
    const text = await response.text();
    let result = null;
    try { result = JSON.parse(text); } catch (_) { result = { raw: text.slice(0, 100) }; }
    return { ok: response.ok && result && result.ok, result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

module.exports = { logRequest };
