/* Server-side registry of research that can be requested through the site.

   The browser only ever sends a reportId. Everything else — the title, where
   the document lives, whether it may be delivered — is decided here. Objects
   are held in a PRIVATE Supabase Storage bucket and delivered by expiring
   signed link (or as an attachment when REPORT_ATTACH=1); nothing under
   assets/ is used for gated research, because everything in this repo is
   publicly served.

   The flagship study is Published: a direct, ungated download from
   assets/papers/. It is listed here too so a "request" for it can be
   honoured with the public link without touching storage. */

'use strict';

const REPORTS = {
  'india-economic-rise': {
    title: 'Can Global Investors Actually Capture India’s Economic Rise?',
    meta: 'Flagship institutional study · August 2026',
    status: 'published',
    publicPath: '/assets/papers/can-global-investors-capture-indias-economic-rise.pdf',
    filename: 'Kakde-Research-Can-Global-Investors-Capture-Indias-Economic-Rise.pdf'
  },
  'credibility-transmission': {
    title: 'Credibility and Transmission',
    meta: 'Policy · India against major central banks',
    status: 'request',
    object: 'credibility-and-transmission.pdf',
    filename: 'Kakde-Research-Credibility-and-Transmission.pdf'
  },
  'balance-sheet-decade': {
    title: 'The Balance-Sheet Decade',
    meta: 'Banking · India against comparator systems',
    status: 'request',
    object: 'the-balance-sheet-decade.pdf',
    filename: 'Kakde-Research-The-Balance-Sheet-Decade.pdf'
  },
  'rupee-managed': {
    title: 'The Rupee, Managed',
    meta: 'Currency · India against EM peers',
    status: 'request',
    object: 'the-rupee-managed.pdf',
    filename: 'Kakde-Research-The-Rupee-Managed.pdf'
  },
  'promoter-nation': {
    title: 'Promoter Nation',
    meta: 'Governance · India',
    status: 'request',
    object: 'promoter-nation.pdf',
    filename: 'Kakde-Research-Promoter-Nation.pdf'
  }
};

const ID_PATTERN = /^[a-z0-9-]{3,64}$/;

function getReport(reportId) {
  if (typeof reportId !== 'string' || !ID_PATTERN.test(reportId)) return null;
  if (!Object.prototype.hasOwnProperty.call(REPORTS, reportId)) return null;
  return Object.assign({ id: reportId }, REPORTS[reportId]);
}

function listIds() { return Object.keys(REPORTS); }

module.exports = { getReport, listIds };
