'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestPdf, handler } = require('../netlify/functions/rezervace-test-pdf');

test('fixed fake PDF has valid cross-reference offsets and a single A4 page', () => {
  const bytes = generateTestPdf();
  const text = bytes.toString('ascii');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.match(text, /\/Count 1/);
  assert.match(text, /595\.28 841\.89/);
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const offsets = [...text.matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
  offsets.forEach((offset, i) => assert.equal(text.slice(offset, offset + 7), (i + 1) + ' 0 obj'));
  const stream = text.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(Number(stream[1]), Buffer.byteLength(stream[2], 'ascii'));
});
test('PDF is deterministic, labelled and contains no live supplier or banking data', () => {
  assert.deepEqual(generateTestPdf(), generateTestPdf());
  const text = generateTestPdf().toString('ascii');
  assert.match(text, /TEST \\226 NEHRADIT/);
  assert.match(text, /test@example\.invalid/);
  assert.doesNotMatch(text, /226152322|66195284|260\d{3}|foto@tulectrend/);
});
test('HTTP export accepts no customer input and rejects write methods', async () => {
  const response = await handler({ httpMethod: 'GET', body: '{"customer":"ignored"}' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Buffer.from(response.body, 'base64'), generateTestPdf());
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
});
