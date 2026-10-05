// Veřejná konfigurace Google Pickeru. Tyto identifikátory nejsou přístupové tokeny ani klientské tajemství.
exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metoda není podporována.' }) };
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const apiKey = process.env.GOOGLE_PICKER_API_KEY || '';
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '';
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      configured: Boolean(clientId && apiKey && appId),
      clientId,
      apiKey,
      appId,
      allowedEmail: 'tulectrendfoto@gmail.com',
    }),
  };
};
