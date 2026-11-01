'use strict';

// Independent fixed fixture. Never reads invoice history, tokens or customer data.
function generateTestPdf() {
  const lines = [
    'BT /F1 24 Tf 48 786 Td (TEST \\226 NEHRADIT) Tj ET',
    'BT /F1 12 Tf 48 751 Td (Cloud PDF connectivity test) Tj ET',
    '0.7 G 48 732 m 547 732 l S 0 G',
    'BT /F1 11 Tf 48 704 Td (Document: TEST-CLOUD-20261101) Tj ET',
    'BT /F1 11 Tf 48 680 Td (Supplier: Test supplier, example.invalid) Tj ET',
    'BT /F1 11 Tf 48 656 Td (Customer: Fictional customer, test@example.invalid) Tj ET',
    'BT /F1 11 Tf 48 620 Td (Issue date: 01.11.2026) Tj ET',
    'BT /F1 11 Tf 48 596 Td (Due date: NOT APPLICABLE - DO NOT PAY) Tj ET',
    '0.7 G 48 568 m 547 568 l S 0 G',
    'BT /F1 11 Tf 48 542 Td (Fictional photographic service) Tj ET',
    'BT /F1 11 Tf 440 542 Td (1234.00 CZK) Tj ET',
    'BT /F1 11 Tf 48 502 Td (No bank account. No payment QR code.) Tj ET',
    'BT /F1 11 Tf 48 478 Td (No invoice number allocated. No history entry created.) Tj ET',
    'BT /F1 11 Tf 48 454 Td (Generated entirely by a Netlify server function.) Tj ET',
    'BT /F1 18 Tf 48 96 Td (TEST \\226 NEHRADIT) Tj ET',
    'BT /F1 10 Tf 48 68 Td (Technical test only. Not a real invoice.) Tj ET',
  ];
  const stream = lines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + Buffer.byteLength(stream, 'ascii') + ' >>\nstream\n' + stream + '\nendstream',
  ];
  const chunks = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.from((i + 1) + ' 0 obj\n' + body + '\nendobj\n', 'ascii');
    chunks.push(chunk); length += chunk.length;
  });
  const xref = length;
  const entries = offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  chunks.push(Buffer.from('xref\n0 6\n0000000000 65535 f \n' + entries + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii'));
  return Buffer.concat(chunks);
}

exports.generateTestPdf = generateTestPdf;
exports.handler = async function(event) {
  if (!['GET', 'HEAD'].includes(event.httpMethod)) return { statusCode: 405, headers: { Allow: 'GET, HEAD' }, body: '' };
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="TEST_cloud_20261101_NEHRADIT.pdf"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
    isBase64Encoded: true,
    body: event.httpMethod === 'HEAD' ? '' : generateTestPdf().toString('base64'),
  };
};
