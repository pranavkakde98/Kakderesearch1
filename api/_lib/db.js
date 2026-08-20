/* Supabase PostgREST access with the service-role key — server-side only,
   the same shape production uses. Every function here is optional at the
   call site: if Supabase is not configured, `configured()` is false and the
   handlers proceed without persistence rather than failing the visitor. */

'use strict';

const { HttpError } = require('./http');

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Backend storage is not configured yet.');
  return { url: url.replace(/\/$/, ''), key };
}

async function request(path, options) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {})
    }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
  if (!response.ok) {
    console.error('Supabase request failed', response.status, typeof data === 'string' ? data.slice(0, 200) : data);
    throw new HttpError(502, 'Could not save the submission.');
  }
  return { data, headers: response.headers };
}

async function select(table, query) {
  const r = await request(`${table}?${query || 'select=*'}`, { method: 'GET' });
  return r.data;
}

/* Exact row count for a filter, read from the Content-Range header. */
async function count(table, query) {
  const r = await request(`${table}?select=id&${query}`, { method: 'GET', headers: { Prefer: 'count=exact', Range: '0-0' } });
  const range = r.headers.get('content-range') || '';
  const n = parseInt(range.split('/')[1], 10);
  return isNaN(n) ? (Array.isArray(r.data) ? r.data.length : 0) : n;
}

async function insert(table, row, options) {
  const headers = { Prefer: (options && options.upsert ? 'resolution=merge-duplicates,' : '') + 'return=representation' };
  const suffix = options && options.onConflict ? `?on_conflict=${encodeURIComponent(options.onConflict)}` : '';
  const r = await request(`${table}${suffix}`, { method: 'POST', headers, body: JSON.stringify(row) });
  return r.data;
}

async function update(table, query, row) {
  const r = await request(`${table}?${query}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  return r.data;
}

module.exports = { configured, config, request, select, count, insert, update };
