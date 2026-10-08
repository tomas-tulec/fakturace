// Atomická rezervace jednoho Google file ID pro konkrétní fakturu a cílovou složku.
const crypto = require('node:crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const KEY = 'google-drive-exporty';
const MAX_RETRIES = 8;
const ALLOWED_EMAIL = 'tulectrendfoto@gmail.com';

function responseHeaders() {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
}

function checkToken(event) {
  const incoming = event.headers || {};
  const token = incoming['x-faktura-token'] || incoming['X-Faktura-Token'];
  return Boolean(token) && Boolean(process.env.FAKTURA_TOKEN) && token === process.env.FAKTURA_TOKEN;
}

function validBody(body) {
  return body && body.account === ALLOWED_EMAIL &&
    /^[A-Za-z0-9_-]{10,200}$/.test(String(body.folderId || '')) &&
    /^[A-Za-z0-9_-]{10,200}$/.test(String(body.candidateId || '')) &&
    /^\d{1,20}$/.test(String(body.invoiceNumber || '')) &&
    /^[a-f0-9]{64}$/.test(String(body.fingerprint || '')) &&
    (!body.previousFingerprint || /^[a-f0-9]{64}$/.test(String(body.previousFingerprint))) &&
    typeof body.fileName === 'string' && body.fileName.length >= 5 && body.fileName.length <= 180;
}

function reservationKey(body) {
  const plain = [body.account, body.folderId, body.invoiceNumber, body.test ? 'test' : 'real'].join('|');
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

exports.handler = async function (event) {
  connectLambda(event);
  const headers = responseHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!checkToken(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Neplatný nebo chybějící token.' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { body = null; }
  if (!validBody(body)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Neplatné údaje rezervace souboru.' }) };
  }

  try {
    const store = getStore('faktury');
    const key = reservationKey(body);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const existing = await store.getWithMetadata(KEY, { type: 'json', consistency: 'strong' });
      const map = existing && existing.data && typeof existing.data === 'object' ? Object.assign({}, existing.data) : {};
      const saved = map[key];
      if (saved) {
        if (saved.fileName !== body.fileName ||
            (saved.fingerprint !== body.fingerprint &&
             (body.test || saved.fingerprint !== body.previousFingerprint))) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ error: 'Rezervace souboru neodpovídá aktuální podobě faktury.' }),
          };
        }
        if (saved.fingerprint === body.fingerprint) {
          return { statusCode: 200, headers, body: JSON.stringify({ fileId: saved.fileId, opakovani: true, previousFingerprint: saved.previousFingerprint || null }) };
        }
        map[key] = Object.assign({}, saved, {
          previousFingerprint: saved.fingerprint,
          fingerprint: body.fingerprint,
          updatedAt: new Date().toISOString(),
        });
        const changed = await store.setJSON(KEY, map, { onlyIfMatch: existing.etag });
        if (changed.modified) {
          return { statusCode: 200, headers, body: JSON.stringify({ fileId: saved.fileId, opakovani: false, previousFingerprint: saved.fingerprint }) };
        }
        continue;
      }

      map[key] = {
        fileId: body.candidateId,
        fingerprint: body.fingerprint,
        fileName: body.fileName,
        account: body.account,
        folderId: body.folderId,
        invoiceNumber: String(body.invoiceNumber),
        test: Boolean(body.test),
        createdAt: new Date().toISOString(),
      };
      const options = existing && existing.etag ? { onlyIfMatch: existing.etag } : { onlyIfNew: true };
      const result = await store.setJSON(KEY, map, options);
      if (result.modified) {
        return { statusCode: 200, headers, body: JSON.stringify({ fileId: body.candidateId, opakovani: false }) };
      }
    }
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'Rezervaci souboru se nepodařilo bezpečně uložit. Zkuste to znovu.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Chyba serveru.', detail: String((err && err.message) || err) }) };
  }
};

exports._test = { validBody, reservationKey };
