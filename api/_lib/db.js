/* Supabase PostgREST access with the service-role key — server-side only,
   the same shape production uses. Every function here is optional at the
   call site: if Supabase is not configured, `configured()` is false and the
   handlers decide, truthfully, what they can still promise. Every request
   carries a timeout so a slow database cannot hold a visitor's form open. */

'use strict';

const { HttpError, fetchWithTimeout, log } = require('./http');

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Backend storage is not configured yet.');
  return { url: url.replace(/\/$/, ''), key };
}

async function request(path, options, reqId) {
  const { url, key } = config();
  let response;
  try {
    response = await fetchWithTimeout(`${url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {})
      }
    }, 8000);
  } catch (e) {
    log('error', reqId || '-', 'db_unreachable', { path: path.split('?')[0], reason: e && e.name });
    throw new HttpError(502, 'Could not save the submission.');
  }
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
  if (!response.ok) {
    /* The error body names a table or a constraint, never a visitor: safe to log. */
    log('error', reqId || '-', 'db_request_failed', { path: path.split('?')[0], status: response.status, detail: typeof data === 'string' ? data.slice(0, 200) : (data && (data.message || data.code)) || null });
    throw new HttpError(502, 'Could not save the submission.');
  }
  return { data, headers: response.headers };
}

async function select(table, query, reqId) {
  const r = await request(`${table}?${query || 'select=*'}`, { method: 'GET' }, reqId);
  return r.data;
}

/* Exact row count for a filter, read from the Content-Range header. */
async function count(table, query, reqId) {
  const r = await request(`${table}?select=id&${query}`, { method: 'GET', headers: { Prefer: 'count=exact', Range: '0-0' } }, reqId);
  const range = r.headers.get('content-range') || '';
  const n = parseInt(range.split('/')[1], 10);
  return isNaN(n) ? (Array.isArray(r.data) ? r.data.length : 0) : n;
}

async function insert(table, row, options, reqId) {
  const headers = { Prefer: (options && options.upsert ? 'resolution=merge-duplicates,' : '') + 'return=representation' };
  const suffix = options && options.onConflict ? `?on_conflict=${encodeURIComponent(options.onConflict)}` : '';
  const r = await request(`${table}${suffix}`, { method: 'POST', headers, body: JSON.stringify(row) }, reqId);
  return r.data;
}

async function update(table, query, row, reqId) {
  const r = await request(`${table}?${query}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }, reqId);
  return r.data;
}

module.exports = { configured, config, request, select, count, insert, update };
