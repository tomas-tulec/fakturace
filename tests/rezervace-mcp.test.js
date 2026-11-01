'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/rezervace-mcp');
const call = (request, overrides = {}) => handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), ...overrides });
const rpc = (method, params) => ({ jsonrpc: '2.0', id: 7, method, params });

test('handshake and discovery expose only the harmless probe', async () => {
  const hello = JSON.parse((await call(rpc('initialize', { protocolVersion: '2025-03-26' }))).body);
  assert.equal(hello.result.protocolVersion, '2025-03-26');
  const list = JSON.parse((await call(rpc('tools/list'))).body).result.tools;
  assert.equal(list.length, 1);
  assert.equal(list[0].annotations.readOnlyHint, true);
  assert.equal(list[0].annotations.openWorldHint, false);
});
test('probe echoes a fresh marker without business access', async () => {
  const body = JSON.parse((await call(rpc('tools/call', { name: 'overit_cloudove_spojeni', arguments: { challenge: 'TEST_20261101_a1' } }))).body);
  const content = JSON.parse(body.result.content[0].text);
  assert.equal(content.challenge, 'TEST_20261101_a1');
  assert.equal(content.businessAccess, false);
});
test('rejects unknown tools and extra fields instead of processing business data', async () => {
  for (const params of [
    { name: 'vystavit_fakturu', arguments: {} },
    { name: 'overit_cloudove_spojeni', arguments: { challenge: 'test', customer: 'fictional' } },
    { name: 'overit_cloudove_spojeni', arguments: { challenge: 'spaces are invalid' } },
  ]) assert.equal(JSON.parse((await call(rpc('tools/call', params))).body).error.code, -32602);
});
test('rejects malformed requests, foreign origins and oversized bodies', async () => {
  assert.equal((await call(null)).statusCode, 400);
  assert.equal((await call([], {})).statusCode, 400);
  assert.equal((await call({}, { body: '{' })).statusCode, 400);
  assert.equal((await call(rpc('ping'), { headers: { origin: 'https://example.invalid', 'content-type': 'application/json' } })).statusCode, 403);
  assert.equal((await call({}, { body: 'a'.repeat(8193) })).statusCode, 413);
  assert.equal((await call(rpc('ping'), { headers: {} })).statusCode, 415);
});
test('notifications are acknowledged and unsupported protocols/methods rejected', async () => {
  assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode, 202);
  assert.equal((await call(rpc('ping'), { headers: { 'content-type': 'application/json', 'mcp-protocol-version': 'invalid' } })).statusCode, 400);
  assert.equal(JSON.parse((await call(rpc('not-a-method'))).body).error.code, -32601);
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
});
