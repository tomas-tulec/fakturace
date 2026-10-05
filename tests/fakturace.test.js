'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const memory = new Map();
let revision = 0;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const fakeStore = {
  async getWithMetadata(key) {
    const item = memory.get(key);
    return item ? { data: clone(item.data), etag: item.etag } : { data: null, etag: undefined };
  },
  async get(key) {
    const item = memory.get(key);
    return item ? clone(item.data) : null;
  },
  async setJSON(key, value, options) {
    const current = memory.get(key);
    if (options && options.onlyIfNew && current) return { modified: false, etag: current.etag };
    if (options && options.onlyIfMatch && (!current || current.etag !== options.onlyIfMatch)) {
      return { modified: false, etag: current && current.etag };
    }
    const etag = 'etag-' + (++revision);
    memory.set(key, { data: clone(value), etag });
    return { modified: true, etag };
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@netlify/blobs') {
    return { getStore: () => fakeStore, connectLambda: () => {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const counter = require('../netlify/functions/faktura-cislo.js');
const history = require('../netlify/functions/faktura-historie.js');
const reservation = require('../netlify/functions/google-drive-rezervace.js');
const googleConfig = require('../netlify/functions/google-config.js');
Module._load = originalLoad;

process.env.FAKTURA_TOKEN = 'test-token';
process.env.URL = 'https://example.test';

function event(httpMethod, body) {
  return {
    httpMethod,
    headers: { 'x-faktura-token': 'test-token', origin: 'https://example.test' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function json(response) {
  return JSON.parse(response.body || '{}');
}

function reset(next) {
  memory.clear();
  revision = 0;
  if (next !== undefined) memory.set('citac', { data: next, etag: 'etag-0' });
}

const fingerprintA = 'a'.repeat(64);
const fingerprintB = 'b'.repeat(64);

test('prázdné úložiště bezpečně začíná číslem 260124', async () => {
  reset();
  const response = await counter.handler(event('GET'));
  assert.equal(response.statusCode, 200);
  assert.equal(json(response).dalsi, 260124);
});

test('starý číselný stav se načte s dalším číslem 260124', async () => {
  reset(260124);
  const response = await counter.handler(event('GET'));
  assert.equal(response.statusCode, 200);
  assert.equal(json(response).dalsi, 260124);
});

test('opakování stejného vystavení zachová číslo a čítač zvýší jen jednou', async () => {
  reset(260124);
  const body = { requestId: 'invoice-opakovani-1', fingerprint: fingerprintA, ocekavane: 260124 };
  const first = await counter.handler(event('POST', body));
  const second = await counter.handler(event('POST', body));
  assert.equal(json(first).cislo, 260124);
  assert.equal(json(second).cislo, 260124);
  assert.equal(memory.get('citac').data.next, 260125);
  assert.equal(memory.get('citac').data.assignments.length, 1);
});

test('stejný identifikátor vystavení s jiným obsahem je odmítnut', async () => {
  reset(260124);
  await counter.handler(event('POST', { requestId: 'invoice-nemenna-1', fingerprint: fingerprintA, ocekavane: 260124 }));
  const changed = await counter.handler(event('POST', { requestId: 'invoice-nemenna-1', fingerprint: fingerprintB, ocekavane: 260125 }));
  assert.equal(changed.statusCode, 409);
  assert.match(json(changed).error, /nelze změnit/);
  assert.equal(memory.get('citac').data.next, 260125);
});

test('dva souběžné požadavky dostanou různá čísla', async () => {
  reset(260124);
  const [one, two] = await Promise.all([
    counter.handler(event('POST', { requestId: 'invoice-soubeh-0001', fingerprint: fingerprintA, ocekavane: 260124 })),
    counter.handler(event('POST', { requestId: 'invoice-soubeh-0002', fingerprint: fingerprintB, ocekavane: 260124 })),
  ]);
  const responses = [one, two];
  const successful = responses.filter((response) => response.statusCode === 200).map((response) => json(response).cislo);
  const stale = responses.filter((response) => response.statusCode === 409);
  assert.deepEqual(successful, [260124]);
  assert.equal(stale.length, 1);
  assert.equal(json(stale[0]).dalsi, 260125);

  const retry = await counter.handler(event('POST', {
    requestId: 'invoice-soubeh-0002', fingerprint: fingerprintB, ocekavane: 260125,
  }));
  assert.equal(json(retry).cislo, 260125);
  assert.equal(memory.get('citac').data.next, 260126);
});

test('historie je idempotentní a nepovolí změnu stejného čísla', async () => {
  reset(260124);
  const invoice = {
    cislo: '260124', odberatel: 'Fiktivní odběratel', castka: 1000,
    datumVystaveni: '2026-10-05', datumSplatnosti: '2026-10-08',
    polozky: [{ d: 'Fotoslužby', q: 1, p: 1000 }],
  };
  const first = await history.handler(event('POST', invoice));
  const repeated = await history.handler(event('POST', invoice));
  const changed = await history.handler(event('POST', Object.assign({}, invoice, { castka: 2000 })));
  assert.equal(first.statusCode, 200);
  assert.equal(json(repeated).unchanged, true);
  assert.equal(changed.statusCode, 409);
  assert.equal(memory.get('historie').data.length, 1);
  assert.equal(memory.get('historie').data[0].castka, 1000);
});

test('test 999001 se neukládá do historie a nemění čítač', async () => {
  reset(260124);
  const response = await history.handler(event('POST', {
    cislo: '999001', odberatel: 'TEST – NEHRADIT', castka: 1234,
    datumVystaveni: '2026-01-01', datumSplatnosti: '2026-01-04', polozky: [],
  }));
  assert.equal(response.statusCode, 400);
  assert.equal(memory.has('historie'), false);
  assert.equal(memory.get('citac').data, 260124);
});

test('opakovaný export na Disk vrátí stejné file ID a jiný obsah odmítne', async () => {
  reset(260124);
  const body = {
    account: 'tulectrendfoto@gmail.com', folderId: 'folder_1234567890',
    candidateId: 'file_123456789012', invoiceNumber: '260124',
    fingerprint: fingerprintA, fileName: 'Faktura_260124.pdf', test: false,
  };
  const first = await reservation.handler(event('POST', body));
  const repeated = await reservation.handler(event('POST', Object.assign({}, body, { candidateId: 'file_999999999999' })));
  const changed = await reservation.handler(event('POST', Object.assign({}, body, { fingerprint: fingerprintB })));
  assert.equal(json(first).fileId, 'file_123456789012');
  assert.equal(json(repeated).fileId, 'file_123456789012');
  assert.equal(changed.statusCode, 409);
});

test('veřejná Google konfigurace neobsahuje interní fakturační token', async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'public-client-id';
  process.env.GOOGLE_PICKER_API_KEY = 'restricted-public-key';
  process.env.GOOGLE_CLOUD_PROJECT_NUMBER = '123456789';
  const response = await googleConfig.handler({ httpMethod: 'GET' });
  const body = json(response);
  assert.equal(body.configured, true);
  assert.equal(body.allowedEmail, 'tulectrendfoto@gmail.com');
  assert.equal(response.body.includes('test-token'), false);
});

test('klient zachovává oddělené stažení a nejmenší rozsah drive.file', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Uložit PDF \(do Stažených\)/);
  assert.match(html, /Uložit PDF na Google Disk/);
  assert.match(html, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.doesNotMatch(html, /auth\/drive['"]/);
  assert.match(html, /TEST_Faktura_999001_NEHRADIT\.pdf/);
});
