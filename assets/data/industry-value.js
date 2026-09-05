/* Value-creation spread by global industry, 2016 to 2026.

   Source: Aswath Damodaran, NYU Stern, Global Industry Data: "EVA and
   Equity EVA by Industry" (return on capital and cost of capital) and
   "Historical Growth Rates" (five-year revenue CAGR). Annual January
   observations. Retrieved 5 September 2026 from
   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html

   Value-creation spread = return on capital less weighted average cost of
   capital, in percentage points, rounded to one decimal place. The
   underlying company data are collected and aggregated by NYU Stern; the
   selection, comparison, presentation and interpretation are Kakde
   Research's. Stored here so the page never fetches the source
   spreadsheets. Not live data, not a forecast, not a recommendation. */
window.INDUSTRY_VALUE = {
  source: {
    name: 'Aswath Damodaran, NYU Stern, Global Industry Data',
    datasets: ['EVA and Equity EVA by Industry', 'Historical Growth Rates'],
    url: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html',
    observation: 'Annual January observations',
    retrieved: '2026-09-05'
  },
  measure: 'Return on capital less weighted average cost of capital',
  unit: 'percentage points',
  years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  series: [
    { id: 'software',        label: 'Software',        source_category: 'Software (System & Application)',
      spread: [7.9, 6.7, 6.5, 5.2, 8.9, 12.4, 13.7, 3.4, 6.6, 9.8, 12.5], revenue_cagr_5y: 14.8 },
    { id: 'semiconductors',  label: 'Semiconductors',  source_category: 'Semiconductor',
      spread: [0.3, 1.4, 4.2, 5.7, 1.9, 5.2, 9.4, 2.1, -2.5, 2.3, 6.4],    revenue_cagr_5y: 7.8 },
    { id: 'pharmaceuticals', label: 'Pharmaceuticals', source_category: 'Drugs (Pharmaceutical)',
      spread: [3.3, 4.1, 4.1, 1.1, 3.0, 6.4, 8.9, 2.5, 3.6, 3.9, 5.5],     revenue_cagr_5y: 14.1 },
    { id: 'automotive',      label: 'Automotive',      source_category: 'Auto & Truck',
      spread: [-1.5, -0.1, -1.4, -2.1, -1.9, -4.2, -0.5, -5.3, -1.2, -3.4, -5.1], revenue_cagr_5y: 14.2 }
  ]
};
