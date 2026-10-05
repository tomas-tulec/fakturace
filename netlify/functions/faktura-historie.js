// Historie posledních 10 skutečných faktur (Netlify Blobs, store "faktury", klíč "historie").
// Stejné číslo lze zapsat opakovaně pouze s totožným obsahem.
const crypto = require('node:crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const KEY = 'historie';
const MAX_ITEMS = 10;
const MAX_RETRIES = 8;

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, x-faktura-token',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function sanitizeInvoice(raw) {
  raw = raw || {};
  const items = Array.isArray(raw.polozky)
    ? raw.polozky.slice(0, 50).map((p) => ({
        d: String((p && p.d) || '').slice(0, 200),
        q: Number(p && p.q) || 0,
        p: Number(p && p.p) || 0,
      }))
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

function canonicalInvoice(invoice) {
  const clean = sanitizeInvoice(invoice);
  return JSON.stringify({
    cislo: clean.cislo,
    odberatel: clean.odberatel,
    castka: clean.castka,
    datumVystaveni: clean.datumVystaveni,
    datumSplatnosti: clean.datumSplatnosti,
    polozky: clean.polozky,
  });
}

function invoiceFingerprint(invoice) {
  return crypto.createHash('sha256').update(canonicalInvoice(invoice), 'utf8').digest('hex');
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

    if (event.httpMethod === 'DELETE') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Neplatný požadavek.' }) };
      }
      const number = String((body && body.cislo) || '');
      if (!/^\d{1,20}$/.test(number)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Neplatné číslo faktury.' }) };
      }
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const existing = await store.getWithMetadata(KEY, { type: 'json' });
        const list = Array.isArray(existing && existing.data) ? existing.data : [];
        const remaining = list.filter((f) => String(f && f.cislo) !== number);
        if (remaining.length === list.length) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: true, deleted: false, faktury: list }) };
        }
        const result = await store.setJSON(KEY, remaining, { onlyIfMatch: existing.etag });
        if (result.modified) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: true, deleted: true, faktury: remaining }) };
        }
      }
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Historie se mezitím změnila. Opakujte akci.' }) };
    }

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
      if (invoice.cislo === '999001') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Testovací doklad 999001 se do historie skutečných faktur neukládá.' }) };
      }

      const fingerprint = invoiceFingerprint(invoice);
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const existing = await store.getWithMetadata(KEY, { type: 'json' });
        const list = Array.isArray(existing && existing.data) ? existing.data.slice() : [];
        const etag = existing && existing.etag;
        const idx = list.findIndex((f) => f && String(f.cislo) === invoice.cislo);

        if (idx !== -1) {
          if (invoiceFingerprint(list[idx]) !== fingerprint) {
            return {
              statusCode: 409,
              headers,
              body: JSON.stringify({ error: 'Faktura č. ' + invoice.cislo + ' již existuje s jiným obsahem. Operace byla zastavena.' }),
            };
          }
          return { statusCode: 200, headers, body: JSON.stringify({ ok: true, unchanged: true, faktury: list.slice(0, MAX_ITEMS) }) };
        }

        list.unshift(Object.assign({}, invoice, { fingerprint }));
        const trimmed = list.slice(0, MAX_ITEMS);
        const options = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
        const result = await store.setJSON(KEY, trimmed, options);
        if (result.modified) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: true, unchanged: false, faktury: trimmed }) };
        }
      }

      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Historii se nepodařilo bezpečně uložit kvůli souběžné změně. Zkuste to znovu.' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Chyba serveru.', detail: String((err && err.message) || err) }) };
  }
};

exports._test = { sanitizeInvoice, canonicalInvoice, invoiceFingerprint };
