import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHandler, ORIGIN, RESOURCE, CLIENT, CALLBACK, SCOPE } from '../netlify/functions/fakturace-cloud.mjs';
const SECRET='FICTIONAL_TEST_KEY_NOT_A_REAL_CREDENTIAL';
const verifier='x'.repeat(64);
const sha=value=>crypto.createHash('sha256').update(value).digest('base64url');
function memoryStore() {
  const items=new Map(); let serial=0;
  return { items, async getWithMetadata(key){const item=items.get(key);return item?structuredClone(item):null;},async setJSON(key,data,options={}){const item=items.get(key);if((options.onlyIfNew&&item)||(options.onlyIfMatch&&item?.etag!==options.onlyIfMatch))return {modified:false}; const etag=String(++serial);items.set(key,{data:structuredClone(data),etag});return {modified:true,etag};} };
}
function fixture() {
  const store=memoryStore(); let seconds=1800000000,reads=0;
  const handler=createHandler({getSecret:()=>SECRET,storeProvider:async()=>store,now:()=>seconds,bridgeHandler:async e=>{reads++;assert.equal(e.headers['x-faktura-token'],SECRET);return {statusCode:200,body:JSON.stringify({ok:true})};}});
  const request=(path,method='GET',data,headers={})=>handler(new Request(ORIGIN+path,{method,headers,...(data?{body:data}:{})}),{ip:'fictional-test-address'});
  const formPost=(path,params,headers={})=>request(path,'POST',new URLSearchParams(params),{'content-type':'application/x-www-form-urlencoded',...headers});
  async function consent(overrides={}) {
    const params={client_id:CLIENT,redirect_uri:CALLBACK,response_type:'code',code_challenge:sha(verifier),code_challenge_method:'S256',resource:RESOURCE,scope:SCOPE,state:'FICTIONAL_STATE',...overrides};
    const page=await request('/api/ttf-oauth/authorize?'+new URLSearchParams(params));
    const html=await page.text(), cookie=page.headers.get('set-cookie')?.split(';')[0];
    return {page,html,cookie,form:html.match(/name="request" value="([^"]+)"/)?.[1]};
  }
  async function grant() {
    const c=await consent(); const auth=await formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:SECRET},{origin:ORIGIN,cookie:c.cookie});
    assert.equal(auth.status,303);const redirect=new URL(auth.headers.get('location'));assert.equal(redirect.origin+redirect.pathname,CALLBACK);assert.equal(redirect.searchParams.get('iss'),ORIGIN);assert.equal(redirect.searchParams.get('state'),'FICTIONAL_STATE');
    return {code:redirect.searchParams.get('code'),c};
  }
  const exchange=code=>formPost('/api/ttf-oauth/token',{client_id:CLIENT,resource:RESOURCE,grant_type:'authorization_code',code,redirect_uri:CALLBACK,code_verifier:verifier});
  const refresh=token=>formPost('/api/ttf-oauth/token',{client_id:CLIENT,resource:RESOURCE,grant_type:'refresh_token',refresh_token:token});
  const mcp=token=>request('/api/ttf-mcp','POST','{}',{'content-type':'application/json',authorization:'Bearer '+token});
  return {request,formPost,consent,grant,exchange,refresh,mcp,store,handler,reads:()=>reads,advance:n=>{seconds+=n;}};
}
test('discovery advertises exact issuer, resource, scope, PKCE and public predefined client',async()=>{
  const f=fixture();const metadata=await (await f.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.issuer,ORIGIN);assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);assert.deepEqual(metadata.token_endpoint_auth_methods_supported,['none']);assert.equal(metadata.authorization_response_iss_parameter_supported,true);
  const r=await f.request('/api/ttf-mcp');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/resource_metadata=/);assert.equal(f.reads(),0);
});
test('valid consent, PKCE exchange and authenticated gateway never expose owner key',async()=>{
  const f=fixture(), {code,c}=await f.grant();assert.doesNotMatch(c.html,new RegExp(SECRET));assert.match(c.page.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.match(c.page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const response=await f.exchange(code);assert.equal(response.status,200);const tokens=await response.json();assert.equal(tokens.expires_in,600);assert.equal(tokens.scope,SCOPE);assert.equal((await f.mcp(tokens.access_token)).status,200);assert.equal(f.reads(),1);
  assert.equal((await f.exchange(code)).status,400);
});
test('unapproved clients, redirects, scopes, audiences and plain PKCE cannot get login form',async()=>{
  const f=fixture();for(const overrides of [{redirect_uri:'https://evil.example/callback'},{client_id:'evil'},{scope:'fakturace.write'},{resource:'https://evil.example'},{code_challenge_method:'plain'},{code_challenge:'short'},{state:''}]) assert.notEqual((await f.consent(overrides)).page.status,200);
  assert.equal(f.store.items.size,0);assert.equal(f.reads(),0);
});
test('consent is bound to same-origin POST, browser cookie and one-use nonce',async()=>{
  const f=fixture(),c=await f.consent();
  assert.equal((await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:SECRET},{origin:ORIGIN})).status,403);
  assert.equal((await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:SECRET},{origin:'https://evil.example',cookie:c.cookie})).status,403);
  assert.equal((await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:'wrong'},{origin:ORIGIN,cookie:c.cookie})).status,403);
  assert.equal((await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:SECRET},{origin:ORIGIN,cookie:c.cookie})).status,303);
  assert.equal((await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:SECRET},{origin:ORIGIN,cookie:c.cookie})).status,400);
});
test('wrong PKCE cannot redeem code and concurrent redemption succeeds once',async()=>{
  const f=fixture(),{code}=await f.grant();const bad=await f.formPost('/api/ttf-oauth/token',{client_id:CLIENT,resource:RESOURCE,grant_type:'authorization_code',code,redirect_uri:CALLBACK,code_verifier:'z'.repeat(64)});assert.equal(bad.status,400);
  const pair=await Promise.all([f.exchange(code),f.exchange(code)]);assert.deepEqual(pair.map(x=>x.status).sort(),[200,400]);
});
test('refresh rotates atomically, access expires and revocation blocks current access',async()=>{
  const f=fixture(),{code}=await f.grant();const first=await (await f.exchange(code)).json();f.advance(601);assert.equal((await f.mcp(first.access_token)).status,401);
  const current=await (await f.refresh(first.refresh_token)).json();assert.ok(current.access_token);
  assert.equal((await f.mcp(current.access_token)).status,200);
  await f.formPost('/api/ttf-oauth/revoke',{client_id:CLIENT,token:current.refresh_token});assert.equal((await f.mcp(current.access_token)).status,401);assert.equal((await f.refresh(current.refresh_token)).status,400);
});
test('replay of a rotated refresh token revokes the whole authorization session',async()=>{
  const f=fixture(),{code}=await f.grant();const first=await(await f.exchange(code)).json();const second=await(await f.refresh(first.refresh_token)).json();assert.ok(second.access_token);
  assert.equal((await f.refresh(first.refresh_token)).status,400);assert.equal((await f.mcp(second.access_token)).status,401);assert.equal((await f.refresh(second.refresh_token)).status,400);
});
test('tampered tokens, expired code/form/session and missing server key fail closed',async()=>{
  const f=fixture(),{code}=await f.grant();assert.equal((await f.exchange(code+'bad')).status,400);f.advance(121);assert.equal((await f.exchange(code)).status,400);
  const noKey=createHandler({getSecret:()=>'',bridgeHandler:()=>{throw Error('must not run');}});assert.equal((await noKey(new Request(RESOURCE))).status,503);assert.equal(f.reads(),0);
  const g=fixture(),{code:good}=await g.grant();const t=await(await g.exchange(good)).json();g.advance(30*86400+1);assert.equal((await g.refresh(t.refresh_token)).status,400);
});
test('login guesses are bounded across separate forms for the same source',async()=>{
  const f=fixture();for(let i=0;i<6;i++){const c=await f.consent();const r=await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:'wrong'},{origin:ORIGIN,cookie:c.cookie});assert.equal(r.status,i<5?403:429);}assert.equal(f.reads(),0);
});
test('oversized bodies and duplicate OAuth parameters do not reach invoice bridge',async()=>{
  const f=fixture();assert.equal((await f.formPost('/api/ttf-oauth/token',[['client_id',CLIENT],['client_id',CLIENT]])).status,400);
  const c=await f.consent();assert.equal((await f.formPost('/api/ttf-oauth/authorize',{request:c.form,owner_key:'x'.repeat(20000)},{origin:ORIGIN,cookie:c.cookie})).status,503);assert.equal(f.reads(),0);
});
