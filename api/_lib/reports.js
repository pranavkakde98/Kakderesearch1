/* Server-side allowlist mapping a public reportId to an approved title and a
   delivery asset. The browser only ever sends a reportId; the file path is
   never accepted from the client. Add an entry here only when a real, finished
   deliverable exists and has been approved for email delivery.

   The flagship study is a DIRECT public download and is intentionally NOT gated
   through this flow, so it is not listed here. This registry exists for reports
   marked "Available on request". It is currently empty by design. */

'use strict';

const BASE = process.env.APP_BASE_URL || 'https://www.kakderesearch.com';

// reportId => { title, path (relative, under public assets), gated }
const REPORTS = {
  // Example shape (do not enable until a real approved file exists):
  // 'example-report': { title: 'Example Report', path: '/assets/papers/example-report.pdf' }
};

function getReport(reportId) {
  if (!reportId || !Object.prototype.hasOwnProperty.call(REPORTS, reportId)) return null;
  const r = REPORTS[reportId];
  return { id: reportId, title: r.title, url: BASE + r.path };
}

module.exports = { getReport, BASE };
