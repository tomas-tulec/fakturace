// Historie posledních 10 faktur (Netlify Blobs, store "faktury", klíč "historie").
const { getStore } = require('@netlify/blobs');

const KEY = 'historie';
const MAX_ITEMS = 10;
const MAX_RETRIES = 8;

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, x-faktura-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (allowed.indexOf(origin) !== -1) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function checkToken(event) {
  const headers = event.headers || {};
  const token = headers['x-faktura-token'] || headers['X-Faktura-Token'];
  return Boolean(token) && Boolean(process.env.FAKTURA_TOKEN) && token === process.env.FAKTURA_TOKEN;
}

function sanitizeInvoice(raw) {
  raw = raw || {};
  const items = Array.isArray(raw.polozky)
    ? raw.polozky.slice(0, 50).map(function (p) {
        return {
          d: String((p && p.d) || '').slice(0, 200),
          q: Number(p && p.q) || 0,
          p: Number(p && p.p) || 0,
        };
      })
    : [];
  return {
    cislo: String(raw.cislo || '').replace(/\D/g, ''),
    odberatel: String(raw.odberatel || '').slice(0, 2000),
    castka: Number(raw.castka) || 0,
    datumVystaveni: String(raw.datumVystaveni || ''),
    datumSplatnosti: String(raw.datumSplatnosti || ''),
    polozky: items,
  };
}

exports.handler = async function (event) {
  const headers = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (!checkToken(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Neplatný nebo chybějící token.' }) };
  }

  try {
    const store = getStore('faktury');

    if (event.httpMethod === 'GET') {
      const data = await store.get(KEY, { type: 'json' });
      const list = Array.isArray(data) ? data.slice(0, MAX_ITEMS) : [];
      return { statusCode: 200, headers, body: JSON.stringify({ faktury: list }) };
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }
      const invoice = sanitizeInvoice(body);
      if (!invoice.cislo) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Chybí číslo faktury.' }) };
      }

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const existing = await store.getWithMetadata(KEY, { type: 'json' });
        const list = Array.isArray(existing && existing.data) ? existing.data.slice() : [];
        const etag = existing && existing.etag;

        const idx = list.findIndex(function (f) { return f && f.cislo === invoice.cislo; });
        if (idx !== -1) {
          list[idx] = invoice; // recyklace čísla — přepsat existující záznam
        } else {
          list.unshift(invoice);
        }
        const trimmed = list.slice(0, MAX_ITEMS);

        const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
        const result = await store.setJSON(KEY, trimmed, opts);
        if (result.modified) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: true, faktury: trimmed }) };
        }
        // konflikt souběžného zápisu — zkusit znovu s čerstvou historií
      }

      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Nepodařilo se uložit historii, zkuste to prosím znovu.' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Chyba serveru.', detail: String((err && err.message) || err) }) };
  }
};
