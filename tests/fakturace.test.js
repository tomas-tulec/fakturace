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
  async list(options) {
    const prefix = (options && options.prefix) || '';
    return { blobs: Array.from(memory.keys()).filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
  },
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

test('prázdné úložiště bezpečně začíná číslem 260125', async () => {
  reset();
  const response = await counter.handler(event('GET'));
  assert.equal(response.statusCode, 200);
  assert.equal(json(response).dalsi, 260125);
});

test('starý číselný stav 260124 naváže číslem 260125', async () => {
  reset(260124);
  const response = await counter.handler(event('GET'));
  assert.equal(response.statusCode, 200);
  assert.equal(json(response).dalsi, 260125);
});

test('opakování stejného vystavení zachová číslo a čítač zvýší jen jednou', async () => {
  reset(260125);
  const body = { requestId: 'invoice-opakovani-1', fingerprint: fingerprintA, ocekavane: 260125 };
  const first = await counter.handler(event('POST', body));
  const second = await counter.handler(event('POST', body));
  assert.equal(json(first).cislo, 260125);
  assert.equal(json(second).cislo, 260125);
  assert.equal(memory.get('citac').data.next, 260126);
  assert.equal(memory.get('citac').data.assignments.length, 1);
});

test('stejný identifikátor vystavení s jiným obsahem je odmítnut', async () => {
  reset(260125);
  await counter.handler(event('POST', { requestId: 'invoice-nemenna-1', fingerprint: fingerprintA, ocekavane: 260125 }));
  const changed = await counter.handler(event('POST', { requestId: 'invoice-nemenna-1', fingerprint: fingerprintB, ocekavane: 260126 }));
  assert.equal(changed.statusCode, 409);
  assert.match(json(changed).error, /nelze změnit/);
  assert.equal(memory.get('citac').data.next, 260126);
});

test('dva souběžné požadavky dostanou různá čísla', async () => {
  reset(260125);
  const [one, two] = await Promise.all([
    counter.handler(event('POST', { requestId: 'invoice-soubeh-0001', fingerprint: fingerprintA, ocekavane: 260125 })),
    counter.handler(event('POST', { requestId: 'invoice-soubeh-0002', fingerprint: fingerprintB, ocekavane: 260125 })),
  ]);
  const responses = [one, two];
  const successful = responses.filter((response) => response.statusCode === 200).map((response) => json(response).cislo);
  const stale = responses.filter((response) => response.statusCode === 409);
  assert.deepEqual(successful, [260125]);
  assert.equal(stale.length, 1);
  assert.equal(json(stale[0]).dalsi, 260126);

  const retry = await counter.handler(event('POST', {
    requestId: 'invoice-soubeh-0002', fingerprint: fingerprintB, ocekavane: 260126,
  }));
  assert.equal(json(retry).cislo, 260126);
  assert.equal(memory.get('citac').data.next, 260127);
});

test('chybný testovací čítač se opraví podle poslední skutečné faktury', async () => {
  reset({ version: 2, next: 999003, assignments: [
    { id: 'test-999002', number: 999002, fingerprint: fingerprintA },
  ] });
  memory.set('historie', { data: [{ cislo: '260124' }], etag: 'etag-h' });
  const shown = await counter.handler(event('GET'));
  assert.equal(json(shown).dalsi, 260125);

  const first = await counter.handler(event('POST', {
    requestId: 'invoice-skutecna-1', fingerprint: fingerprintA, ocekavane: 260125,
  }));
  assert.equal(json(first).cislo, 260125);
  assert.equal(json(await counter.handler(event('GET'))).dalsi, 260126);

  const second = await counter.handler(event('POST', {
    requestId: 'invoice-skutecna-2', fingerprint: fingerprintB, ocekavane: 260126,
  }));
  assert.equal(json(second).cislo, 260126);
  assert.equal(json(await counter.handler(event('GET'))).dalsi, 260127);
});

test('další číslo respektuje samostatné záznamy i po ztrátě starých přidělení', async () => {
  reset({ version: 2, next: 260125, assignments: [] });
  memory.set('faktura/260301', { data: { cislo: '260301' }, etag: 'etag-invoice' });
  const response = await counter.handler(event('GET'));
  assert.equal(json(response).dalsi, 260302);
});

test('testovací číslo nelze ručně přidělit skutečné faktuře', async () => {
  reset(260125);
  const response = await counter.handler(event('POST', {
    requestId: 'invoice-test-999', fingerprint: fingerprintA, rucni: 999003,
  }));
  assert.equal(response.statusCode, 400);
  assert.equal(memory.get('citac').data, 260125);
});

test('historie opraví jen otevřenou fakturu, zachová číslo a odmítne novou duplicitu', async () => {
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
  const originalFingerprint = json(first).faktura.fingerprint;
  const corrected = await history.handler(event('POST', Object.assign({}, invoice, {
    castka: 2000, puvodniOtisk: originalFingerprint, opravil: 'Tomáš Tulec',
  })));
  assert.equal(corrected.statusCode, 200);
  assert.equal(json(corrected).faktura.cislo, '260124');
  assert.equal(json(corrected).faktura.castka, 2000);
  assert.equal(json(corrected).faktura.opravy[0].pred.castka, 1000);
  assert.equal(json(corrected).faktura.opravy[0].opravil, 'Tomáš Tulec');
  assert.equal(memory.get('citac').data, 260124);
  const stale = await history.handler(event('POST', Object.assign({}, invoice, {
    castka: 3000, puvodniOtisk: originalFingerprint, opravil: 'Tomáš Tulec',
  })));
  assert.equal(stale.statusCode, 409);
  const listed = await history.handler(event('GET'));
  assert.equal(json(listed).faktury.length, 1);
  assert.equal(json(listed).faktury[0].castka, 2000);
});

test('historie uchová více než deset faktur v aktuálním roce', async () => {
  reset(260125);
  for (let i = 0; i < 12; i++) {
    const response = await history.handler(event('POST', {
      cislo: String(260125 + i), odberatel: 'Fiktivní odběratel', castka: i + 1,
      datumVystaveni: '2026-10-08', datumSplatnosti: '2026-10-11', polozky: [],
    }));
    assert.equal(response.statusCode, 200);
  }
  const listed = await history.handler(event('GET'));
  assert.equal(json(listed).faktury.length, 12);
  assert.equal(json(listed).faktury[0].cislo, '260136');
  const otherYear = await history.handler(Object.assign(event('GET'), {
    queryStringParameters: { rok: '2027' },
  }));
  assert.equal(json(otherYear).faktury.length, 0);
});

test('starý záznam zůstane dostupný a oprava ho v roční historii nahradí', async () => {
  reset(260125);
  const legacy = {
    cislo: '260124', odberatel: 'Původní odběratel', castka: 1000,
    datumVystaveni: '2026-10-07', datumSplatnosti: '2026-10-10', polozky: [],
  };
  memory.set('historie', { data: [legacy], etag: 'etag-legacy' });
  const before = await history.handler(event('GET'));
  assert.equal(json(before).faktury[0].odberatel, 'Původní odběratel');
  const update = await history.handler(event('POST', Object.assign({}, legacy, {
    odberatel: 'Opravený odběratel',
    puvodniOtisk: history._test.invoiceFingerprint(legacy),
    opravil: 'Tomáš Tulec',
  })));
  assert.equal(update.statusCode, 200);
  const after = await history.handler(event('GET'));
  assert.equal(json(after).faktury.length, 1);
  assert.equal(json(after).faktury[0].odberatel, 'Opravený odběratel');
  assert.equal(memory.get('historie').data[0].odberatel, 'Původní odběratel');
});

test('odstraněný záznam se ze staré historie znovu neobjeví', async () => {
  reset(260125);
  const legacy = {
    cislo: '260124', odberatel: 'Fiktivní odběratel', castka: 1000,
    datumVystaveni: '2026-10-07', datumSplatnosti: '2026-10-10', polozky: [],
  };
  memory.set('historie', { data: [legacy], etag: 'etag-legacy' });
  const removed = await history.handler(event('DELETE', { cislo: '260124' }));
  assert.equal(json(removed).deleted, true);
  const listed = await history.handler(event('GET'));
  assert.equal(json(listed).faktury.length, 0);
  const reused = await history.handler(event('POST', legacy));
  assert.equal(reused.statusCode, 409);
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

test('opravený export na Disk ponechá původní file ID a vyžaduje předchozí otisk', async () => {
  reset(260124);
  const body = {
    account: 'tulectrendfoto@gmail.com', folderId: 'folder_1234567890',
    candidateId: 'file_123456789012', invoiceNumber: '260124',
    fingerprint: fingerprintA, fileName: 'Faktura_260124.pdf', test: false,
  };
  await reservation.handler(event('POST', body));
  const corrected = await reservation.handler(event('POST', Object.assign({}, body, {
    candidateId: 'file_999999999999', fingerprint: fingerprintB,
    previousFingerprint: fingerprintA,
  })));
  assert.equal(corrected.statusCode, 200);
  assert.equal(json(corrected).fileId, body.candidateId);
  assert.equal(json(corrected).previousFingerprint, fingerprintA);
  const repeated = await reservation.handler(event('POST', Object.assign({}, body, {
    fingerprint: fingerprintB,
  })));
  assert.equal(json(repeated).fileId, body.candidateId);
  assert.equal(json(repeated).previousFingerprint, fingerprintA);
  const stale = await reservation.handler(event('POST', body));
  assert.equal(stale.statusCode, 409);
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
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
  assert.equal(Object.hasOwn(body, 'appId'), false);
});

test('klient zachovává oddělené stažení a nejmenší rozsah drive.file', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Uložit PDF \(do Stažených\)/);
  assert.match(html, /Uložit PDF na Google Disk/);
  assert.match(html, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.doesNotMatch(html, /auth\/drive['"]/);
  assert.match(html, /TEST_Faktura_999001_NEHRADIT\.pdf/);
  assert.doesNotMatch(html, /google\.picker|setOAuthToken|apis\.google\.com\/js\/api\.js/);
  assert.match(html, /appProperties:\{ttfKind:'invoice-folder'\}/);
});
