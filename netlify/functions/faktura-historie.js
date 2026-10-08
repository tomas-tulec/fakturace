// Každá faktura má vlastní záznam. Starý seznam deseti faktur zůstává čitelný.
const crypto = require('node:crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const PREFIX = 'faktura/';
const RETRIES = 8;

function headersFor(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL].filter(Boolean);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, x-faktura-token',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function checkToken(event) {
  const headers = event.headers || {};
  const token = headers['x-faktura-token'] || headers['X-Faktura-Token'];
  return Boolean(token) && Boolean(process.env.FAKTURA_TOKEN) && token === process.env.FAKTURA_TOKEN;
}

function sanitizeInvoice(raw) {
  raw = raw || {};
  return {
    cislo: String(raw.cislo || '').replace(/\D/g, ''),
    odberatel: String(raw.odberatel || '').slice(0, 2000),
    castka: Number(raw.castka) || 0,
    datumVystaveni: String(raw.datumVystaveni || ''),
    datumSplatnosti: String(raw.datumSplatnosti || ''),
    polozky: Array.isArray(raw.polozky) ? raw.polozky.slice(0, 50).map((p) => ({
      d: String((p && p.d) || '').slice(0, 200),
      q: Number(p && p.q) || 0,
      p: Number(p && p.p) || 0,
    })) : [],
  };
}

function invoiceFingerprint(invoice) {
  return crypto.createHash('sha256').update(JSON.stringify(sanitizeInvoice(invoice)), 'utf8').digest('hex');
}

async function legacyInvoices(store) {
  const data = await store.get('historie', { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function legacyInvoice(store, number) {
  return (await legacyInvoices(store)).find((f) => f && String(f.cislo) === number) || null;
}

async function listInvoices(store, year) {
  const invoices = new Map();
  for (const invoice of await legacyInvoices(store)) {
    if (invoice && invoice.cislo) invoices.set(String(invoice.cislo), invoice);
  }
  const { blobs } = await store.list({ prefix: PREFIX });
  const savedInvoices = await Promise.all(blobs.map((blob) =>
    store.get(blob.key, { type: 'json' })
  ));
  for (const invoice of savedInvoices) {
    if (invoice && invoice.cislo) invoices.set(String(invoice.cislo), invoice);
  }
  return Array.from(invoices.values())
    .filter((invoice) => !invoice.deleted && String(invoice.datumVystaveni || '').slice(0, 4) === year)
    .sort((a, b) => Number(b.cislo) - Number(a.cislo));
}

function reply(statusCode, headers, data) {
  return { statusCode, headers, body: JSON.stringify(data) };
}

exports.handler = async function (event) {
  connectLambda(event);
  const headers = headersFor(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!checkToken(event)) return reply(401, headers, { error: 'Neplatný nebo chybějící token.' });

  try {
    const store = getStore('faktury');
    const year = (event.queryStringParameters && event.queryStringParameters.rok) || String(new Date().getFullYear());
    if (!/^20\d{2}$/.test(year)) return reply(400, headers, { error: 'Neplatný rok historie.' });
    if (event.httpMethod === 'GET') {
      return reply(200, headers, { faktury: await listInvoices(store, year), rok: year });
    }
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
      return reply(405, headers, { error: 'Metoda není podporována.' });
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { body = null; }
    const number = String((body && body.cislo) || '');
    if (!/^\d{1,20}$/.test(number) || /^999\d{3}$/.test(number)) {
      return reply(400, headers, { error: 'Neplatné číslo skutečné faktury.' });
    }
    const key = PREFIX + number;
    const invoice = event.httpMethod === 'POST' ? sanitizeInvoice(body) : null;
    if (invoice && !/^20\d{2}-\d{2}-\d{2}$/.test(invoice.datumVystaveni)) {
      return reply(400, headers, { error: 'Vyplňte platné datum vystavení faktury.' });
    }
    const fingerprint = invoice ? invoiceFingerprint(invoice) : null;
    const expected = String((body && body.puvodniOtisk) || '');
    const author = String((body && body.opravil) || '').trim().slice(0, 120);
    if (expected && !/^[a-f0-9]{64}$/.test(expected)) {
      return reply(400, headers, { error: 'Neplatná identita opravované faktury.' });
    }

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const saved = await store.getWithMetadata(key, { type: 'json' });
      const current = saved && saved.data ? saved.data : await legacyInvoice(store, number);
      const options = saved && saved.etag ? { onlyIfMatch: saved.etag } : { onlyIfNew: true };

      if (event.httpMethod === 'DELETE') {
        if (!current || current.deleted) {
          return reply(200, headers, { ok: true, deleted: false, faktury: await listInvoices(store, year) });
        }
        const tombstone = { cislo: number, datumVystaveni: current.datumVystaveni, deleted: true };
        const result = await store.setJSON(key, tombstone, options);
        if (result.modified) {
          return reply(200, headers, { ok: true, deleted: true, faktury: await listInvoices(store, year) });
        }
        continue;
      }

      if (current && current.deleted) {
        return reply(409, headers, { error: 'Toto číslo již bylo použito a z historie odstraněno.' });
      }
      if (current && invoiceFingerprint(current) === fingerprint) {
        return reply(200, headers, { ok: true, unchanged: true, faktura: current });
      }
      if (current && (!expected || expected !== invoiceFingerprint(current))) {
        return reply(409, headers, { error: 'Faktura č. ' + number + ' již existuje nebo se mezitím změnila.' });
      }
      if (!current && expected) {
        return reply(409, headers, { error: 'Opravovaná faktura již v historii není.' });
      }
      if (current && !author) {
        return reply(400, headers, { error: 'Uveďte osobu, která opravu provedla.' });
      }
      const changes = current && Array.isArray(current.opravy) ? current.opravy.slice() : [];
      if (current) {
        changes.push({ pred: sanitizeInvoice(current), po: invoice, opravil: author, kdy: new Date().toISOString() });
      }
      const updated = Object.assign({}, invoice, { fingerprint, opravy: changes });
      const result = await store.setJSON(key, updated, options);
      if (result.modified) {
        return reply(200, headers, { ok: true, unchanged: false, corrected: Boolean(current), faktura: updated });
      }
    }
    return reply(409, headers, { error: 'Historie se mezitím změnila. Opakujte akci.' });
  } catch (err) {
    return reply(500, headers, { error: 'Chyba serveru.', detail: String((err && err.message) || err) });
  }
};

exports._test = { sanitizeInvoice, invoiceFingerprint };
