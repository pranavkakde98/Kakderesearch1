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
,
  /* Six studies listed as published on the research page (September 2026).
     Upload each PDF to the private bucket under the object name below; until
     it is there, a request is recorded and the enquirer is told the study
     will be sent as soon as it is published. */
  'cost-of-capital': {
    title: 'The Cost of Capital Has Changed. Has Your Hurdle Rate?',
    meta: 'Rates · Global',
    status: 'request',
    object: 'the-cost-of-capital-has-changed.pdf',
    filename: 'Kakde-Research-The-Cost-of-Capital-Has-Changed.pdf'
  },
  'tariff-arithmetic': {
    title: 'Tariff Arithmetic',
    meta: 'Trade · Global',
    status: 'request',
    object: 'tariff-arithmetic.pdf',
    filename: 'Kakde-Research-Tariff-Arithmetic.pdf'
  },
  'concentration-problem': {
    title: 'The Concentration Problem',
    meta: 'Equity markets · Global',
    status: 'request',
    object: 'the-concentration-problem.pdf',
    filename: 'Kakde-Research-The-Concentration-Problem.pdf'
  },
  'private-credit-decade': {
    title: 'Private Credit’s Decade',
    meta: 'Private markets · Global',
    status: 'request',
    object: 'private-credits-decade.pdf',
    filename: 'Kakde-Research-Private-Credits-Decade.pdf'
  },
  'public-debt-after-pandemic': {
    title: 'Public Debt After the Pandemic',
    meta: 'Sovereign · Global',
    status: 'request',
    object: 'public-debt-after-the-pandemic.pdf',
    filename: 'Kakde-Research-Public-Debt-After-the-Pandemic.pdf'
  },
  'em-ex-china': {
    title: 'EM ex-China: The Allocation Nobody Designed',
    meta: 'Allocation · Emerging markets',
    status: 'request',
    object: 'em-ex-china.pdf',
    filename: 'Kakde-Research-EM-ex-China.pdf'
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
