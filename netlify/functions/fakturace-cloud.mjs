import crypto from 'node:crypto';
import bridge from './fakturace-mcp.js';
import invoices from '../shared/invoice-tools.cjs';
import googleModule from '../shared/google-bridge.cjs';
import workflow from '../shared/workflow-tools.cjs';

// Owner-only OAuth gateway. No Google credentials, invoice writes or customer messages.
export const ORIGIN = 'https://fakturace-tulec-trend-foto.netlify.app';
export const RESOURCE = ORIGIN + '/api/ttf-mcp';
export const SCOPE = 'fakturace.read';
export const CLIENT = 'ttf-chatgpt-cloud';
export const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const META = ORIGIN + '/.well-known/oauth-protected-resource';
const AUTH = ORIGIN + '/api/ttf-oauth/';
const COOKIE = '__Host-ttf-oauth';
const MAX_BODY = 16384;
export const config = { path: ['/api/ttf-mcp', '/api/ttf-oauth/:action', '/api/ttf-google/:action', '/api/ttf-test-invoice.pdf', '/api/ttf-invoice-file', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/ttf-mcp'] };
const SUPPORTED_SCOPES=[SCOPE,invoices.ISSUE_SCOPE,workflow.RESERVATION_SCOPE];
function normalizeScope(value) { const parts=typeof value==='string'?value.trim().split(/\s+/):[];if(!parts.includes(SCOPE)||new Set(parts).size!==parts.length||parts.some(s=>!SUPPORTED_SCOPES.includes(s)))throw Error('invalid scope');return SUPPORTED_SCOPES.filter(s=>parts.includes(s)).join(' '); }
const hash = value => crypto.createHash('sha256').update(value).digest('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const random = () => crypto.randomBytes(32).toString('base64url');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = { 'Cache-Control':'no-store', 'Pragma':'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...base, 'Content-Type':'application/json; charset=utf-8', ...headers } });
const failure = (error, status = 400) => json({error}, status);
const loginError = (error,message,status=400) => new Response(`<!doctype html><html lang="cs"><meta charset="utf-8"><title>Přihlášení fakturace</title><h1>Přihlášení nebylo dokončeno</h1><p>${escape(message)}</p><p>Kód chyby: ${escape(error)}</p><p>Vraťte se do připojení aplikace v ChatGPT a otevřete nové přihlášení. Klíč neposílejte do chatu.</p></html>`,{status,headers:{...base,'Content-Type':'text/html; charset=utf-8'}});
const challenge = () => json({ error:'authorization_required' }, 401, {'WWW-Authenticate':`Bearer resource_metadata="${META}", scope="${SCOPE}"`});
async function getStore() { const { getStore } = await import('@netlify/blobs'); return getStore({name:'ttf-oauth-sessions-v1', consistency:'strong'}); }
export async function readLiveNumber(secret, fetcher = fetch) {
  // Invoke the existing Lambda through its own route so Netlify injects its real
  // Blobs context. A fabricated Lambda event must not replace that context.
  const response=await fetcher(ORIGIN+'/.netlify/functions/faktura-cislo',{method:'GET',headers:{'x-faktura-token':secret},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok) throw Error('number unavailable');
  const number=(await response.json()).dalsi;
  if(!Number.isSafeInteger(number) || number<260000 || number>=999000) throw Error('invalid number');
  return number;
}

export function createHandler({getSecret = () => process.env.FAKTURA_TOKEN || '', storeProvider = getStore, now = () => Math.floor(Date.now()/1000), bridgeHandler} = {}) {
  const invoiceBridge=bridgeHandler || bridge._test.createHandler({getSecret,readNumber:(_event,secret)=>readLiveNumber(secret)});
  function sign(type, data, seconds) {
    const payload = Buffer.from(JSON.stringify({...data, typ:type, iss:ORIGIN, iat:now(), exp:now()+seconds})).toString('base64url');
    return `TTF1.${payload}.${crypto.createHmac('sha256', getSecret()).update('ttf-oauth-v1.'+payload).digest('base64url')}`;
  }
  function verify(token, type) {
    if (typeof token !== 'string' || token.length > 10000) throw Error('invalid token');
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'TTF1' || !equal(parts[2], crypto.createHmac('sha256', getSecret()).update('ttf-oauth-v1.'+parts[1]).digest('base64url'))) throw Error('invalid token');
    const data = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (data.typ !== type || data.iss !== ORIGIN || !Number.isInteger(data.exp) || data.exp <= now() || !Number.isInteger(data.iat) || data.iat > now()+30) throw Error('expired token');
    return data;
  }
  function authorization(params) {
    for (const key of ['client_id','redirect_uri','response_type','code_challenge','code_challenge_method','resource','scope','state']) if (params.getAll(key).length !== 1) throw Error('invalid request');
    const p = Object.fromEntries(params);
    if (p.client_id !== CLIENT || p.redirect_uri !== CALLBACK || p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge) || p.resource !== RESOURCE || !p.state || p.state.length>2048) throw Error('invalid request');
    p.scope=normalizeScope(p.scope);
    return Object.fromEntries(['client_id','redirect_uri','code_challenge','resource','scope','state'].map(k=>[k,p[k]]));
  }
  async function readBody(req) {
    // Bound actual bytes, including requests without Content-Length.
    const reader = req.body?.getReader(); const chunks=[]; let bytes=0;
    if (!reader) return '';
    while (true) { const {done,value}=await reader.read(); if(done) break; bytes+=value.byteLength; if(bytes>MAX_BODY) {await reader.cancel(); throw Error('body too large');} chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function session(store, sid) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sid || '')) throw Error('invalid session');
    const item = await store.getWithMetadata('session/'+sid, {type:'json'});
    if (!item || !item.data || item.data.expires <= now() || item.data.revoked) throw Error('invalid session');
    return item;
  }
  async function limitAttempts(store, ip) {
    // Atomic slots prevent concurrent guesses from bypassing the limit. No raw IP/key stored.
    const bucket = Math.floor(now()/900);
    const prefix = 'attempt/'+bucket+'/'+hash(ip || 'unknown')+'/';
    for(let i=0;i<5;i++) if((await store.setJSON(prefix+i,{expires:now()+900},{onlyIfNew:true})).modified) return;
    throw Error('rate limited');
  }
  async function revokeSession(store,sid) {
    for(let attempt=0;attempt<3;attempt++) {
      const item=await session(store,sid);
      if((await store.setJSON('session/'+sid,{...item.data,revoked:true},{onlyIfMatch:item.etag})).modified) return;
    }
    throw Error('revocation conflict');
  }
  function issueTokens(sid, data, refresh, expires) {
    return { access_token:sign('access',{sid, client_id:CLIENT, aud:RESOURCE, scope:data.scope},600), token_type:'Bearer', expires_in:600, scope:data.scope, refresh_token:sign('refresh',{sid,nonce:refresh,client_id:CLIENT,aud:RESOURCE,scope:data.scope},Math.max(1,expires-now())) };
  }
  const invoiceTools=invoices.createTools({sign,verify,getSecret,now:()=>new Date(now()*1000).toISOString()});
  const google=googleModule.createGoogleBridge({sign,verify,getSecret,now,checkSession:async sid=>session(await storeProvider(),sid)});
  const workflowTools=workflow.createWorkflowTools({google,invoiceTools,sign,verify});
  return async (req, context = {}) => {
    const url = new URL(req.url);
    if (url.origin !== ORIGIN) return failure('invalid_host',400);
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:{...base,'Access-Control-Allow-Origin':'https://chatgpt.com','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, MCP-Protocol-Version'}});
    if (url.pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') return json({issuer:ORIGIN, authorization_endpoint:AUTH+'authorize', token_endpoint:AUTH+'token', revocation_endpoint:AUTH+'revoke', response_types_supported:['code'], grant_types_supported:['authorization_code','refresh_token'], token_endpoint_auth_methods_supported:['none'], code_challenge_methods_supported:['S256'], scopes_supported:SUPPORTED_SCOPES, authorization_response_iss_parameter_supported:true});
    if (['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/ttf-mcp'].includes(url.pathname) && req.method === 'GET') return json({resource:RESOURCE,authorization_servers:[ORIGIN],scopes_supported:SUPPORTED_SCOPES,bearer_methods_supported:['header'],resource_name:'Tulec Trend - fakturace a rezervace'});
    if(url.pathname==='/api/ttf-test-invoice.pdf'&&req.method==='GET'){const bytes=invoices.createPdf(invoices.testData());return new Response(bytes,{headers:{...base,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="TEST_cloud_original_NEHRADIT.pdf"'}});}
    // A weak/unset owner key must never enable authorization or tool execution.
    if (getSecret().length < 24) return failure('server_not_configured',503);
    if (req.headers.get('origin') && ![ORIGIN,'https://chatgpt.com'].includes(req.headers.get('origin'))) return failure('invalid_origin',403);
    try {
      if(url.pathname.startsWith('/api/ttf-google/'))return await google.web(req);
      if(url.pathname==='/api/ttf-invoice-file'&&req.method==='GET') {
        let ticket;try{ticket=verify(url.searchParams.get('t'),'invoice-file');await session(await storeProvider(),ticket.sid);}catch{return challenge();}
        const file=await invoiceTools.file(url.searchParams.get('t'));
        return new Response(file.bytes,{headers:{...base,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+file.filename+'"'}});
      }
      if (url.pathname === '/api/ttf-mcp') {
        let token;
        try { token=verify((req.headers.get('authorization') || '').replace(/^Bearer /i,''),'access'); if(token.aud!==RESOURCE || normalizeScope(token.scope)!==token.scope || token.client_id!==CLIENT) throw Error('wrong audience'); }
        catch { return challenge(); }
        const store=await storeProvider();
        try { await session(store,token.sid); } catch { return challenge(); }
        if(req.method!=='POST') return json({error:'Use POST'},405,{Allow:'POST'});
        if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return failure('use_application_json',415);
        const body=await readBody(req);let rpc;try{rpc=JSON.parse(body);}catch{}
        if(rpc?.method==='tools/call'&&[...invoices.TOOLS,...workflow.TOOLS].some(t=>t.name===rpc.params?.name)) {
          if(rpc.jsonrpc!=='2.0'||!Object.hasOwn(rpc,'id'))return failure('invalid_request');
          let result;try{result=await invoiceTools.call(rpc.params.name,rpc.params.arguments||{},token)||await workflowTools.call(rpc.params.name,rpc.params.arguments||{},token);}catch(error){result={content:[{type:'text',text:String(error.message||'Operaci nelze dokončit.')}],isError:true};}
          if(result?.needsScope)return json({error:'insufficient_scope'},401,{'WWW-Authenticate':`Bearer resource_metadata="${META}", scope="${SCOPE} ${result.needsScope}", error="insufficient_scope"`});
          return json({jsonrpc:'2.0',id:rpc.id,result});
        }
        const response = await invoiceBridge({httpMethod:'POST',headers:{'content-type':req.headers.get('content-type') || '', 'mcp-protocol-version':req.headers.get('mcp-protocol-version') || '', 'x-faktura-token':getSecret()},body});
        if(response.statusCode===200&&['tools/list','initialize'].includes(rpc?.method)) {
          const envelope=JSON.parse(response.body);
          if(rpc.method==='tools/list'&&envelope.result?.tools)envelope.result.tools.push(...invoices.TOOLS,...workflow.TOOLS);
          if(rpc.method==='initialize'&&envelope.result){envelope.result.serverInfo.version='0.3.0';envelope.result.instructions='Pracuj česky podle pokynů projektu. Základní přístup čte číslo a návrhy. Vystavení a rezervace vyžadují oddělené rozsahy a výslovné schválení konkrétního návrhu i akcí. Opakovaný export nepřiděluje číslo. Testovací rezervace se nikdy neukládá. Google účty ověřuj, používej jen tulectrendfoto@gmail.com.';}
          response.body=JSON.stringify(envelope);
        }
        return new Response(response.body || null,{status:response.statusCode,headers:{...base,...response.headers}});
      }
      if (url.pathname === '/api/ttf-oauth/authorize' && req.method === 'GET') {
        let p; try { p=authorization(url.searchParams); } catch { return failure('invalid_request'); }
        const nonce=random(), form=sign('form',{...p,nonce},600);
        const issue=p.scope.split(' ').includes(invoices.ISSUE_SCOPE);
        const reservations=p.scope.split(' ').includes(workflow.RESERVATION_SCOPE);
        const permissions=(issue?'Povolíte kontrolu historie, návrhy a skutečné vystavení faktury se zápisem čísla, historie a PDF. PDF lze uložit na firemní Disk. ':'')+(reservations?'Povolíte návrhy a ukládání rezervací se skutečnou přílohou a případné odeslání pozvánek. ':'');
        const html=`<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Připojení fakturace Tulec Trend</title><h1>Připojit administrativu k ChatGPT</h1><p>${permissions||'Povolíte kontrolu dalšího čísla a přípravu neuloženého návrhu faktury. Tento základní přístup nevystavuje faktury, nemění historii a neodesílá zprávy.'}</p><p>Každý konkrétní návrh a jeho uložení, vystavení, export či odeslání pozvánek musí Tomáš výslovně schválit. Přihlášení samo žádnou objednávku nezpracuje.</p><p>Přihlášení platí nejvýše 30 dní. Přístup lze odvolat. Heslo zůstane pouze na této doméně fakturace a nebude předáno ChatGPT.</p><form method="post" action="${AUTH}authorize"><input type="hidden" name="request" value="${escape(form)}"><p><label>Přístupový klíč aplikace fakturace <input type="password" name="owner_key" autocomplete="off" required maxlength="1024"></label></p><button type="submit">${issue||reservations?'Povolit vybrané akce po schválení jednotlivých návrhů':'Povolit kontrolu a návrhy faktur'}</button></form></html>`;
        // no-referrer makes Chromium send Origin:null on an HTML form POST.
        // Keep same-origin Origin validation; allow only the public origin as referrer.
        const cookieName=COOKIE+'-'+hash(nonce).slice(0,16);
        return new Response(html,{headers:{...base,'Content-Security-Policy':`default-src 'none'; form-action 'self' ${CALLBACK}; frame-ancestors 'none'; base-uri 'none'`,'Referrer-Policy':'strict-origin','Content-Type':'text/html; charset=utf-8','Set-Cookie':`${cookieName}=${nonce}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`}});
      }
      if (url.pathname === '/api/ttf-oauth/authorize' && req.method === 'POST') {
        if(req.headers.get('origin')!==ORIGIN || !(req.headers.get('content-type') || '').startsWith('application/x-www-form-urlencoded')) return loginError('invalid_form_origin','Formulář nebyl odeslán ze správné stránky.',403);
        const p = new URLSearchParams(await readBody(req)); if(p.getAll('request').length!==1 || p.getAll('owner_key').length!==1) return loginError('invalid_form_fields','Formulář neobsahuje všechny potřebné údaje.');
        let form; try { form=verify(p.get('request'),'form'); } catch { return loginError('expired_login_form','Platnost tohoto přihlašovacího formuláře vypršela.'); }
        const cookieName=COOKIE+'-'+hash(form.nonce).slice(0,16);
        const cookie=(req.headers.get('cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(!equal(cookie,form.nonce)) return loginError('login_cookie_mismatch','Chybí relace tohoto přihlašovacího okna. Povolte cookies pro stránku fakturace a otevřete nové přihlášení.',403);
        const store=await storeProvider();
        try { await limitAttempts(store,context.ip); } catch { return loginError('too_many_attempts','Bylo provedeno příliš mnoho pokusů. Další přihlášení zkuste za 15 minut.',429); }
        if(!equal(p.get('owner_key'),getSecret())) return loginError('access_denied','Zadaný klíč neodpovídá přístupovému klíči aplikace. V Netlify ověřte hodnotu FAKTURA_TOKEN pro Production.',403);
        // Consent nonce and authorization code can each be used only once.
        if(!(await store.setJSON('consent/'+hash(form.nonce),{expires:now()+600},{onlyIfNew:true})).modified) return loginError('login_form_already_used','Tento přihlašovací formulář již byl potvrzen.');
        const sid=random(), expires=now()+30*86400;
        if(!(await store.setJSON('session/'+sid,{expires,codeUsed:false,refreshHash:null,revoked:false},{onlyIfNew:true})).modified) return failure('temporarily_unavailable',503);
        const code=sign('code',{sid,client_id:form.client_id,redirect_uri:form.redirect_uri,challenge:form.code_challenge,aud:form.resource,scope:form.scope},120);
        const target=new URL(CALLBACK); target.searchParams.set('code',code); target.searchParams.set('state',form.state); target.searchParams.set('iss',ORIGIN);
        return new Response(null,{status:303,headers:{...base,Location:target.href,'Set-Cookie':`${cookieName}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`}});
      }
      if (['/api/ttf-oauth/token','/api/ttf-oauth/revoke'].includes(url.pathname) && req.method === 'POST') {
        if(!(req.headers.get('content-type') || '').startsWith('application/x-www-form-urlencoded')) return failure('invalid_request');
        const p = new URLSearchParams(await readBody(req));
        for(const key of new Set(p.keys())) if(p.getAll(key).length!==1) return failure('invalid_request');
        if(p.get('client_id')!==CLIENT || p.has('client_secret') || req.headers.has('authorization')) return failure('invalid_client',401);
        const store=await storeProvider();
        if(url.pathname.endsWith('/revoke')) {
          let data; try { data=verify(p.get('token'),'refresh'); } catch { return json({}); }
          if(data.client_id===CLIENT && data.aud===RESOURCE) {
            let item; try { item=await session(store,data.sid); } catch { return json({}); }
            if(equal(item.data.refreshHash,hash(data.nonce))) await revokeSession(store,data.sid);
          }
          return json({});
        }
        if(p.get('resource')!==RESOURCE) return failure('invalid_target');
        let data,item;
        try {
          if(p.get('grant_type')==='authorization_code') {
            data=verify(p.get('code'),'code'); item=await session(store,data.sid);
            const verifier=p.get('code_verifier') || '';
            if(item.data.codeUsed || p.get('redirect_uri')!==CALLBACK || data.redirect_uri!==CALLBACK || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !equal(hash(verifier),data.challenge)) throw Error('invalid grant');
          } else if(p.get('grant_type')==='refresh_token') {
            data=verify(p.get('refresh_token'),'refresh'); item=await session(store,data.sid);
            if(!equal(item.data.refreshHash,hash(data.nonce))) { await revokeSession(store,data.sid); throw Error('refresh replay'); }
          } else return failure('unsupported_grant_type');
          if(data.client_id!==CLIENT || data.aud!==RESOURCE || normalizeScope(data.scope)!==data.scope || (p.has('scope')&&normalizeScope(p.get('scope'))!==data.scope)) throw Error('invalid grant');
          const next=random();
          if(!(await store.setJSON('session/'+data.sid,{...item.data,codeUsed:true,refreshHash:hash(next)},{onlyIfMatch:item.etag})).modified) throw Error('grant already used');
          return json(issueTokens(data.sid,data,next,item.data.expires));
        } catch { return failure('invalid_grant'); }
      }
      return failure('not_found',404);
    } catch { return failure('temporarily_unavailable',503); }
  };
}
export default createHandler();
