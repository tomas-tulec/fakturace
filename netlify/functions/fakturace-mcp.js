'use strict';
// Separate private bridge. The public connectivity probe never imports this file.
const crypto = require('node:crypto');
const PROTOCOLS = ['2025-03-26', '2025-06-18', '2025-11-25'];
const FIELDS = {
  odberatel: { type: 'string', minLength: 1, maxLength: 200, description: 'Presne schvalene jmeno odberatele.' },
  ucel: { type: 'string', minLength: 1, maxLength: 200, description: 'Presny ucel a popis fakturovane sluzby.' },
  castka: { type: 'number', exclusiveMinimum: 0, maximum: 1000000, description: 'Vyslovne urcena castka v CZK, nejvyse dve desetinna mista.' },
  vystaveno: { type: 'string', pattern: '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$', description: 'Presne datum vystaveni YYYY-MM-DD.' },
  splatnost: { type: 'string', pattern: '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$', description: 'Presne datum splatnosti YYYY-MM-DD.' },
};
const TOOLS = [
  { name: 'ttf_overit_cislo_faktury', description: 'Pouzij pred pripravou faktury Tulec Trend Foto k precteni aktualniho dalsiho cisla z existujici aplikace. Neprideluje cislo a nevystavuje fakturu.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'ttf_pripravit_fakturu', description: 'Pripravi pouze kontrolni navrh faktury z vyslovne zadanych udaju. Pouzij az po ziskani jmena, ucelu, castky a obou dat. Nic nedoplnuj z jine objednavky. Nevystavuje fakturu, nevytvari PDF, neuklada historii a nic neodesila. Skutecne vystaveni zatim tento nastroj nepodporuje.', inputSchema: { type: 'object', properties: FIELDS, required: Object.keys(FIELDS), additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
function sameSecret(a, b) {
  if (!a || !b) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
function validDate(value) {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function validateProposal(raw) {
  if (!raw || Array.isArray(raw) || Object.keys(raw).length !== 5 || Object.keys(raw).some(k => !Object.hasOwn(FIELDS, k))) throw Error('Vyplnte presne vsech pet udaju.');
  for (const key of ['odberatel', 'ucel']) if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > 200 || /[\x00-\x1f\x7f]/.test(raw[key])) throw Error('Neplatne jmeno nebo ucel faktury.');
  if (typeof raw.castka !== 'number' || !Number.isFinite(raw.castka) || raw.castka <= 0 || raw.castka > 1000000 || Math.abs(raw.castka * 100 - Math.round(raw.castka * 100)) > 0.000001) throw Error('Neplatna castka v CZK.');
  if (!validDate(raw.vystaveno) || !validDate(raw.splatnost) || raw.splatnost < raw.vystaveno) throw Error('Neplatna data vystaveni nebo splatnosti.');
  return { odberatel: raw.odberatel, ucel: raw.ucel, castka: raw.castka, vystaveno: raw.vystaveno, splatnost: raw.splatnost };
}
async function readCurrentNumber(event, secret) {
  const response = await require('./faktura-cislo').handler({ ...event, httpMethod: 'GET', headers: { ...(event.headers || {}), 'x-faktura-token': secret }, body: null });
  if (response.statusCode !== 200) throw Error('Aktualni cislo nelze overit v aplikaci.');
  const number = JSON.parse(response.body).dalsi;
  if (!Number.isSafeInteger(number) || number < 260000 || number >= 999000) throw Error('Aplikace vratila neplatne skutecne cislo.');
  return number;
}
function createHandler({ getSecret = () => process.env.FAKTURA_TOKEN || '', readNumber = readCurrentNumber } = {}) {
  return async event => {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(), String(v)]));
    const base = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...base, ...extra }, body: body === undefined ? '' : JSON.stringify(body) });
    const rpcError = (id, code, message) => reply(200, { jsonrpc: '2.0', id, error: { code, message } });
    if (headers.origin && !['https://chatgpt.com', 'https://chat.openai.com'].includes(headers.origin)) return reply(403, { error: 'Origin not allowed' });
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Use POST' }, { Allow: 'POST' });
    if (!(headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reply(415, { error: 'Use application/json' });
    if (event.isBase64Encoded || Buffer.byteLength(event.body || '', 'utf8') > 16384) return reply(413, { error: 'Request too large' });
    let request;
    try { request = JSON.parse(event.body || ''); } catch (_) { return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return reply(400, { error: 'Invalid request' });
    const id = request.id;
    if (!Object.hasOwn(request, 'id')) return request.method.startsWith('notifications/') ? reply(202) : reply(400, { error: 'Missing id' });
    if (id !== null && typeof id !== 'string' && typeof id !== 'number') return reply(400, { error: 'Invalid id' });
    if (headers['mcp-protocol-version'] && !PROTOCOLS.includes(headers['mcp-protocol-version'])) return reply(400, { error: 'Unsupported protocol' });
    let result;
    if (request.method === 'initialize') {
      const version = request.params && request.params.protocolVersion;
      if (typeof version !== 'string') return rpcError(id, -32602, 'protocolVersion is required');
      result = { protocolVersion: PROTOCOLS.includes(version) ? version : PROTOCOLS.at(-1), capabilities: { tools: {} }, serverInfo: { name: 'tulec-trend-private-invoices', version: '0.1.0' }, instructions: 'Soukrome overeni cisla a neulozene navrhy. Faktury se zde zatim nevystavuji. Pracuj cesky podle pokynu projektu. Pri chybejicich udajich se zeptej.' };
    } else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') result = { tools: TOOLS };
    else if (request.method === 'tools/call') {
      const secret = getSecret();
      const supplied = headers['x-faktura-token'] || (headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!sameSecret(supplied, secret)) return reply(401, { error: 'Je nutne soukrome pripojeni fakturacni aplikace.' }, { 'WWW-Authenticate': 'Bearer realm="Tulec Trend Fakturace"' });
      const params = request.params || {};
      const args = params.arguments || {};
      try {
        if (params.name === 'ttf_overit_cislo_faktury') {
          if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw Error('Tento nastroj nema zadne vstupy.');
          result = { dalsiCislo: await readNumber(event, secret), vystaveno: false };
        } else if (params.name === 'ttf_pripravit_fakturu') {
          const data = validateProposal(args);
          result = { stav: 'POUZE NAVRH - NEVYSTAVENO', cisloNavrhu: await readNumber(event, secret), mena: 'CZK', ...data, pripominka: 'Pred vystavenim je nutne schvalit konkretni navrh. Cislo neni rezervovano.' };
        } else return rpcError(id, -32601, 'Unknown tool');
      } catch (_) {
        return reply(200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Navrh nebo cislo nelze bezpecne pripravit. Overte vsechna vstupni data a dostupnost puvodni aplikace; nic nebylo vystaveno.' }], isError: true } });
      }
      result = { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    } else return rpcError(id, -32601, 'Method not found');
    return reply(200, { jsonrpc: '2.0', id, result });
  };
}
exports.handler = createHandler();
exports._test = { createHandler, sameSecret, validDate, validateProposal };
