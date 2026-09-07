// Serverová synchronizace čísla faktury (Netlify Blobs, store "faktury", klíč "citac").
const { getStore, connectLambda } = require('@netlify/blobs');

const INIT_VALUE = 260050;
const KEY = 'citac';
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

// vrátí aktuální hodnotu čítače (a jeho etag) a v případě potřeby ho bezpečně inicializuje
async function readCounter(store) {
  const res = await store.getWithMetadata(KEY, { type: 'json' });
  const value = res && res.data;
  if (value === null || value === undefined) {
    const init = await store.setJSON(KEY, INIT_VALUE, { onlyIfNew: true });
    if (init.modified) {
      return { value: INIT_VALUE, etag: init.etag };
    }
    // mezitím čítač inicializoval jiný požadavek — přečti aktuální stav
    const retry = await store.getWithMetadata(KEY, { type: 'json' });
    return { value: retry && retry.data, etag: retry && retry.etag };
  }
  return { value, etag: res.etag };
}

exports.handler = async function (event) {
  // funkce běží v CommonJS (Lambda compatibility mode) — Blobs kontext se
  // v tomto režimu neinicializuje automaticky, je nutné ho napojit ručně
  connectLambda(event);
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
      const { value } = await readCounter(store);
      return { statusCode: 200, headers, body: JSON.stringify({ dalsi: value }) };
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }

      let manual = null;
      if (body && body.rucni !== undefined && body.rucni !== null && body.rucni !== '') {
        const n = Number(body.rucni);
        if (!isNaN(n)) manual = Math.trunc(n);
      }

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const { value: counter, etag } = await readCounter(store);

        let assigned, next;
        if (manual !== null) {
          assigned = manual;
          next = manual >= counter ? manual + 1 : counter; // ruční číslo nižší/rovné čítači → čítač neposouváme dolů
        } else {
          assigned = counter;
          next = counter + 1;
        }

        if (next === counter) {
          return { statusCode: 200, headers, body: JSON.stringify({ cislo: assigned }) };
        }

        const result = await store.setJSON(KEY, next, { onlyIfMatch: etag });
        if (result.modified) {
          return { statusCode: 200, headers, body: JSON.stringify({ cislo: assigned }) };
        }
        // konflikt souběžného zápisu — zkusit znovu s čerstvým čítačem
      }

      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Nepodařilo se atomicky přidělit číslo faktury, zkuste to prosím znovu.' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Chyba serveru.', detail: String((err && err.message) || err) }) };
  }
};
