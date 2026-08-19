/* Private Supabase Storage: signed links and downloads for gated research.
   The bucket is private (storage.objects RLS default-deny); only the
   service-role key, held server-side, can sign or read. Nothing here is
   ever exposed to the browser except a time-limited signed URL. */

'use strict';

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function base() { return String(process.env.SUPABASE_URL || '').replace(/\/$/, ''); }
function bucket() { return process.env.SUPABASE_REPORTS_BUCKET || 'reports'; }
function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}
function ttlSeconds() {
  const n = parseInt(process.env.REPORT_LINK_TTL_SECONDS || '', 10);
  return isNaN(n) || n < 300 ? 7 * 24 * 60 * 60 : n;
}

/* Returns { url, expiresAt } or null when the object does not exist. */
async function signedUrl(objectPath, downloadName) {
  if (!configured()) return null;
  const expiresIn = ttlSeconds();
  const res = await fetch(`${base()}/storage/v1/object/sign/${bucket()}/${objectPath}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn })
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Storage sign failed', res.status, detail.slice(0, 200));
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!data || !data.signedURL) return null;
  const url = `${base()}/storage/v1${data.signedURL}${downloadName ? '&download=' + encodeURIComponent(downloadName) : ''}`;
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

/* Base64 body for an email attachment, or null if unavailable / too large. */
async function download(objectPath, maxBytes) {
  if (!configured()) return null;
  const res = await fetch(`${base()}/storage/v1/object/${bucket()}/${objectPath}`, { headers: headers() });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buf.length > maxBytes) return null;
  return buf.toString('base64');
}

module.exports = { configured, signedUrl, download, ttlSeconds };
