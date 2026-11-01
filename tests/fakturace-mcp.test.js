'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, validateProposal } = require('../netlify/functions/fakturace-mcp')._test;
const FAKE_SECRET = 'FICTIONAL_TEST_KEY_NOT_A_REAL_CREDENTIAL';
const proposal = { odberatel: 'Testovaci zakaznik', ucel: 'Fiktivni foceni', castka: 1234.50, vystaveno: '2026-11-01', splatnost: '2026-11-02' };
const event = (name, args, token = FAKE_SECRET) => ({ httpMethod: 'POST', headers: { 'content-type': 'application/json', 'x-faktura-token': token }, body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name, arguments: args } }) });
test('unauthorized callers cannot read invoice state or submit proposals', async () => {
  let reads = 0;
  const handler = createHandler({ getSecret: () => FAKE_SECRET, readNumber: async () => { reads++; return 260555; } });
  for (const key of ['', 'wrong']) assert.equal((await handler(event('ttf_overit_cislo_faktury', {}, key))).statusCode, 401);
  assert.equal(reads, 0);
});
test('unset server key fails closed', async () => {
  const handler = createHandler({ getSecret: () => '', readNumber: async () => { throw Error('must not run'); } });
  assert.equal((await handler(event('ttf_overit_cislo_faktury', {}))).statusCode, 401);
});
test('authenticated proposal preserves exact inputs and does not issue an invoice', async () => {
  let reads = 0;
  const handler = createHandler({ getSecret: () => FAKE_SECRET, readNumber: async () => { reads++; return 260555; } });
  const result = JSON.parse((await handler(event('ttf_pripravit_fakturu', proposal))).body).result;
  const data = JSON.parse(result.content[0].text);
  assert.equal(result.isError, false);
  assert.equal(data.stav, 'POUZE NAVRH - NEVYSTAVENO');
  for (const key of Object.keys(proposal)) assert.equal(data[key], proposal[key]);
  assert.equal(reads, 1);
});
test('missing, inferred, negative, fractional-cent and impossible date inputs fail', () => {
  for (const data of [ {}, {...proposal, castka: 0}, {...proposal, castka: -500}, {...proposal, castka: 1.001}, {...proposal, splatnost: '2026-02-30'}, {...proposal, vystaveno: '2026-11-03'}, {...proposal, extra: true}, {...proposal, odberatel: 'x\ny'} ]) assert.throws(() => validateProposal(data));
});
test('unsupported writes are never delegated to the live application', async () => {
  let reads = 0;
  const handler = createHandler({ getSecret: () => FAKE_SECRET, readNumber: async () => { reads++; return 260555; } });
  const response = JSON.parse((await handler(event('vystavit_fakturu', proposal))).body);
  assert.equal(response.error.code, -32601);
  assert.equal(reads, 0);
});
