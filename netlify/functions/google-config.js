// Veřejná konfigurace přihlášení Google. Klientské tajemství ani přístupový token se nevrací.
exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      configured: Boolean(clientId),
      clientId,
      allowedEmail: 'tulectrendfoto@gmail.com',
    }),
  };
};
