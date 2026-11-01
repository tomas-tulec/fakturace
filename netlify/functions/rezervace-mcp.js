'use strict';

// Public connectivity probe only. No credentials, storage or Google access.
const VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'];
const TOOL = {
  name: 'overit_cloudove_spojeni',
  description: 'Overi spojeni ChatGPT s cloudovou aplikaci Tulec Trend Foto. Pouzij pouze pro technickou diagnostiku. Necte ani nemeni rezervace, faktury, Google Disk nebo Kalendar. Nevkladej osobni udaje.',
  inputSchema: {
    type: 'object',
    properties: { challenge: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Nahodna nesenzitivni kontrolni znacka; nikdy heslo nebo token.' } },
    required: ['challenge'], additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function reply(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

exports.handler = async function (event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (headers.origin && !['https://chatgpt.com', 'https://chat.openai.com'].includes(headers.origin)) {
    return reply(403, { error: 'Origin is not allowed.' });
  }
  if (event.httpMethod !== 'POST') return reply(405, { service: 'TTF cloud connectivity probe', businessAccess: false }, { Allow: 'POST' });
  const raw = event.body || '';
  if (event.isBase64Encoded || Buffer.byteLength(raw, 'utf8') > 8192) return reply(413, { error: 'Request too large or unsupported encoding.' });
  if (!(headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reply(415, { error: 'Use application/json.' });
  let request;
  try { request = JSON.parse(raw); } catch (_) { return reply(400, error(null, -32700, 'Parse error')); }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number' && request.id !== null)) {
    return reply(400, error(null, -32600, 'Invalid request'));
  }
  const hasId = Object.prototype.hasOwnProperty.call(request, 'id');
  if (!hasId) {
    if (request.method.startsWith('notifications/')) return reply(202);
    return reply(400, error(null, -32600, 'Request id is required'));
  }
  const protocol = headers['mcp-protocol-version'];
  if (protocol && !VERSIONS.includes(protocol)) return reply(400, error(request.id, -32600, 'Unsupported protocol version'));
  let result;
  switch (request.method) {
    case 'initialize': {
      const params = request.params;
      if (!params || typeof params.protocolVersion !== 'string') return reply(200, error(request.id, -32602, 'protocolVersion is required'));
      result = {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[VERSIONS.length - 1],
        capabilities: { tools: {} },
        serverInfo: { name: 'tulec-trend-cloud-probe', version: '0.1.0' },
        instructions: 'Pouze technicka diagnostika bez pristupu k firemnim datum. Funkcnost rezervaci timto neni overena.',
      };
      break;
    }
    case 'ping': result = {}; break;
    case 'tools/list': result = { tools: [TOOL] }; break;
    case 'tools/call': {
      const params = request.params || {};
      const args = params.arguments || {};
      if (params.name !== TOOL.name || !args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).some(k => k !== 'challenge') || typeof args.challenge !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(args.challenge)) {
        return reply(200, error(request.id, -32602, 'Invalid tool or challenge; use only a non-sensitive test marker'));
      }
      const pdf = require('./rezervace-test-pdf').generateTestPdf();
      const pdfCheck = { bytes: pdf.length, sha256: require('node:crypto').createHash('sha256').update(pdf).digest('hex'), validHeader: pdf.subarray(0, 8).toString('ascii') === '%PDF-1.4', testOnly: true, path: '/.netlify/functions/rezervace-test-pdf' };
      result = {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, challenge: args.challenge, execution: 'netlify-function', businessAccess: false, version: '0.1.1', pdfCheck }) }],
        isError: false,
      };
      break;
    }
    default: return reply(200, error(request.id, -32601, 'Method not found'));
  }
  return reply(200, { jsonrpc: '2.0', id: request.id, result });
};
