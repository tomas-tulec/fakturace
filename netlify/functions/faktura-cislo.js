// Serverová synchronizace čísla faktury (Netlify Blobs, store "faktury", klíč "citac").
// Verze 2 ukládá čítač a idempotentní přidělení v jediném podmíněném zápisu.
const { getStore, connectLambda } = require('@netlify/blobs');

const INIT_VALUE = 260124;
const KEY = 'citac';
const MAX_RETRIES = 8;
const MAX_ASSIGNMENTS = 500;

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, x-faktura-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
  if (allowed.indexOf(origin) !== -1) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function checkToken(event) {
  const headers = event.headers || {};
  const token = headers['x-faktura-token'] || headers['X-Faktura-Token'];
  return Boolean(token) && Boolean(process.env.FAKTURA_TOKEN) && token === process.env.FAKTURA_TOKEN;
}

function normalizeState(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { version: 2, next: Math.trunc(raw), assignments: [] };
  }
  if (raw && typeof raw === 'object') {
    const next = Number(raw.next);
    return {
      version: 2,
      next: Number.isFinite(next) ? Math.trunc(next) : INIT_VALUE,
      assignments: Array.isArray(raw.assignments) ? raw.assignments.slice(-MAX_ASSIGNMENTS) : [],
    };
  }
  return { version: 2, next: INIT_VALUE, assignments: [] };
}

async function readState(store) {
  const res = await store.getWithMetadata(KEY, { type: 'json' });
  if (!res || res.data === null || res.data === undefined) {
    const initial = normalizeState(null);
    const created = await store.setJSON(KEY, initial, { onlyIfNew: true });
    if (created.modified) return { state: initial, etag: created.etag };
    const retry = await store.getWithMetadata(KEY, { type: 'json' });
    return { state: normalizeState(retry && retry.data), etag: retry && retry.etag };
  }
  return { state: normalizeState(res.data), etag: res.etag };
}

function validRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{8,120}$/.test(value);
}

function validFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

exports.handler = async function (event) {
  connectLambda(event);
  const headers = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!checkToken(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Neplatný nebo chybějící token.' }) };
  }

  try {
    const store = getStore('faktury');

    if (event.httpMethod === 'GET') {
      const { state } = await readState(store);
      return { statusCode: 200, headers, body: JSON.stringify({ dalsi: state.next }) };
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }

      const requestId = body.requestId || '';
      const fingerprint = body.fingerprint || '';
      const expected = body.ocekavane === null || body.ocekavane === undefined || body.ocekavane === ''
        ? null : Math.trunc(Number(body.ocekavane));
      let manual = null;
      if (body.rucni !== undefined && body.rucni !== null && body.rucni !== '') {
        const parsed = Number(body.rucni);
        if (Number.isFinite(parsed)) manual = Math.trunc(parsed);
      }

      if (!validRequestId(requestId) || !validFingerprint(fingerprint)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Chybí platný identifikátor vystavení nebo otisk obsahu.' }) };
      }

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const { state, etag } = await readState(store);
        const existing = state.assignments.find((item) => item && item.id === requestId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            return {
              statusCode: 409,
              headers,
              body: JSON.stringify({ error: 'Obsah již vystavené faktury nelze změnit. Založte novou fakturu.' }),
            };
          }
          return { statusCode: 200, headers, body: JSON.stringify({ cislo: existing.number, opakovani: true }) };
        }

        if (manual === null && expected !== null && expected !== state.next) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
              error: 'Číslo faktury se mezitím změnilo. Načtěte aktuální číslo a zkontrolujte souhrn znovu.',
              dalsi: state.next,
            }),
          };
        }

        const assigned = manual === null ? state.next : manual;
        const next = manual === null ? state.next + 1 : (manual >= state.next ? manual + 1 : state.next);
        const updated = {
          version: 2,
          next,
          assignments: state.assignments.concat([{
            id: requestId,
            number: assigned,
            fingerprint,
            createdAt: new Date().toISOString(),
          }]).slice(-MAX_ASSIGNMENTS),
        };
        const options = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
        const result = await store.setJSON(KEY, updated, options);
        if (result.modified) {
          return { statusCode: 200, headers, body: JSON.stringify({ cislo: assigned, opakovani: false }) };
        }
      }

      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Číslo se nepodařilo bezpečně přidělit kvůli souběžné změně. Zkuste to znovu.' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Chyba serveru.', detail: String((err && err.message) || err) }) };
  }
};

// Export čistých funkcí usnadňuje lokální regresní testy bez přístupu k produkčním datům.
exports._test = { normalizeState, validRequestId, validFingerprint };
