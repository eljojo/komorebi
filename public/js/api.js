// Pages talk to the same /api that the editor and agents use. Every write is JSON: the server refuses anything
// else (spec §3.2), so even a write with nothing to say sends `{}`.
export async function send(method, path, body) {
  const write = method !== 'GET';
  const res = await fetch(path, {
    method,
    headers: write ? { 'Content-Type': 'application/json' } : {},
    body: write ? (typeof body === 'string' ? body : JSON.stringify(body ?? {})) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { ok: res.ok, status: res.status, data };
}

// The server's own words when it has some, as it said them.
export const failure = (r) => r.data?.error ?? `something went wrong (${r.status})`;
