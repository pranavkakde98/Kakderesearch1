/* Private Supabase Storage: signed links and downloads for gated research.
   The bucket is private (storage.objects RLS default-deny); only the
   service-role key, held server-side, can sign or read. Nothing here is
   ever exposed to the browser except a time-limited signed URL.

   signedUrl() tells the caller which of three things happened, because
   they mean different things to the visitor: the link is ready; the object
   is not in the bucket; or storage could not be reached. */

'use strict';

const { fetchWithTimeout, log } = require('./http');

const MIN_TTL = 300;                 /* five minutes */
const MAX_TTL = 14 * 24 * 60 * 60;   /* fourteen days: the documented upper bound */
const DEFAULT_TTL = 7 * 24 * 60 * 60;

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
  if (isNaN(n)) return DEFAULT_TTL;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, n));
}

/* Returns { status: 'ok', url, expiresAt } | { status: 'missing' } | { status: 'error' }. */
async function signedUrl(objectPath, downloadName, reqId) {
  if (!configured()) return { status: 'error', reason: 'not_configured' };
  const expiresIn = ttlSeconds();
  let res;
  try {
    res = await fetchWithTimeout(`${base()}/storage/v1/object/sign/${bucket()}/${objectPath}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn })
    }, 8000);
  } catch (e) {
    log('error', reqId || '-', 'storage_unreachable', { reason: e && e.name });
    return { status: 'error', reason: 'unreachable' };
  }
  if (res.status === 404 || res.status === 400) return { status: 'missing' };
  if (!res.ok) {
    log('error', reqId || '-', 'storage_sign_failed', { status: res.status });
    return { status: 'error', reason: 'sign_failed' };
  }
  const data = await res.json().catch(() => ({}));
  if (!data || !data.signedURL) return { status: 'error', reason: 'no_url' };
  const url = `${base()}/storage/v1${data.signedURL}${downloadName ? '&download=' + encodeURIComponent(downloadName) : ''}`;
  return { status: 'ok', url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

/* Base64 body for an email attachment, or null if unavailable / too large. */
async function download(objectPath, maxBytes, reqId) {
  if (!configured()) return null;
  let res;
  try {
    res = await fetchWithTimeout(`${base()}/storage/v1/object/${bucket()}/${objectPath}`, { headers: headers() }, 15000);
  } catch (e) {
    log('error', reqId || '-', 'storage_download_failed', { reason: e && e.name });
    return null;
  }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buf.length > maxBytes) return null;
  return buf.toString('base64');
}

module.exports = { configured, signedUrl, download, ttlSeconds, MAX_TTL };
