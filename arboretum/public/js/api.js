// Pages talk to the same /api that the editor and agents use. Every write is JSON: the server refuses anything
// else (spec §3.2), so even a write with nothing to say sends `{}`.
export async function send(method, path, body) {
  const write = method !== 'GET';
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: write ? { 'Content-Type': 'application/json' } : {},
      body: write ? (typeof body === 'string' ? body : JSON.stringify(body ?? {})) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'arboretum unreachable; check before retrying a save' } };
  }
  let data = {};
  try {
    data = await res.json();
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('not an API object');
  } catch {
    return { ok: false, status: res.status, data: { error: res.ok ? 'the reply could not be read; check before retrying a save' : `something went wrong (${res.status})` } };
  }
  return { ok: res.ok, status: res.status, data };
}

// The server's own words when it has some, as it said them.
export const failure = (r) => r.data?.error ?? `something went wrong (${r.status})`;
