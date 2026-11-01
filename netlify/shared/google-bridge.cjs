'use strict';
const crypto=require('node:crypto');
const ORIGIN='https://fakturace-tulec-trend-foto.netlify.app';
const CALLBACK=ORIGIN+'/api/ttf-google/callback';
const ACCOUNT='tulectrendfoto@gmail.com';
const FOLDER='1FuAVp0aXRRVAg3gq1OeSaqtBZ4iXQcfp';
const SCOPES=['openid','email','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/calendar.events'];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin','Content-Security-Policy':"default-src 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",'Content-Type':'text/html; charset=utf-8'};
const page=(text,status=200)=>new Response('<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Firemní Google v cloudu</title>'+text+'</html>',{status,headers});
async function defaultStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'ttf-google-connection-v1',consistency:'strong'});}
function seal(secret,value){const iv=crypto.randomBytes(12),key=crypto.hkdfSync('sha256',secret,'ttf-google','encrypted-storage-v1',32),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return {v:1,iv:iv.toString('base64'),data:bytes.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}
function unseal(secret,value){if(value?.v!==1)throw Error('Neplatné uložené připojení.');const key=crypto.hkdfSync('sha256',secret,'ttf-google','encrypted-storage-v1',32),cipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));}
function createGoogleBridge({getSecret,sign,verify,checkSession,env=process.env,storeProvider=defaultStore,fetcher=fetch,now=()=>Math.floor(Date.now()/1000)}={}){
 let cache=null;
 const configured=()=>Boolean(env.GOOGLE_OAUTH_CLIENT_ID&&env.GOOGLE_OAUTH_CLIENT_SECRET);
 const send=(url,options={})=>fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000),...options});
 async function tokenRequest(data){const r=await send('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,...data})});if(!r.ok)throw Error('Google připojení nelze obnovit. Ověřte konfiguraci nebo se znovu přihlaste.');return r.json();}
 async function connection(){const store=await storeProvider(),item=await store.getWithMetadata('connection',{type:'json'});return item?.data?unseal(getSecret(),item.data):null;}
 async function status(sid){const c=await connection();return {configured:configured(),connected:Boolean(c&&c.email===ACCOUNT&&c.refreshToken),account:c?.email||null,refreshExpiresAt:c?.refreshExpiresAt||null,callback:CALLBACK,requiredClientSecretVariable:'GOOGLE_OAUTH_CLIENT_SECRET',connectUrl:ORIGIN+'/api/ttf-google/connect?t='+encodeURIComponent(sign('google-start',{sid},600))};}
 async function access(){if(!configured())throw Error('V Netlify chybí GOOGLE_OAUTH_CLIENT_ID nebo GOOGLE_OAUTH_CLIENT_SECRET.');const c=await connection();if(!c||c.email!==ACCOUNT||!c.refreshToken)throw Error('Firemní Google není připojen k serveru.');if(c.refreshExpiresAt&&c.refreshExpiresAt<=now())throw Error('Přihlášení Googlu vypršelo.');if(cache&&cache.version===c.version&&cache.expires>now()+60)return cache.token;const t=await tokenRequest({grant_type:'refresh_token',refresh_token:c.refreshToken});if(!t.access_token)throw Error('Google neposkytl přístupový token.');cache={version:c.version,token:t.access_token,expires:now()+(Number(t.expires_in)||3600)};return cache.token;}
 async function request(service,path,options={}){const root=service==='drive'?'https://www.googleapis.com/drive/v3':service==='upload'?'https://www.googleapis.com/upload/drive/v3':service==='calendar'?'https://www.googleapis.com/calendar/v3':null;if(!root||!path.startsWith('/')||path.includes('..'))throw Error('Neplatná cesta API.');const r=await send(root+path,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+await access()}});let data;try{data=await r.json();}catch{data={};}if(r.status===401){cache=null;throw Error('Google vyžaduje nové přihlášení.');}if(r.status===403)throw Error('Google operaci nepovolil. Ověřte zapnutí příslušného API a rozsahy oprávnění.');return {status:r.status,data};}
 async function web(req){const u=new URL(req.url);if(!u.pathname.startsWith('/api/ttf-google/'))return null;
  try{
   if(u.pathname==='/api/ttf-google/connect'){
    const form=req.method==='POST'?new URLSearchParams(await req.text()):u.searchParams;
    const p=verify(form.get('t'),'google-start');await checkSession(p.sid);
    if(!configured())return page('<h1>Chybí konfigurace Googlu</h1><p>V Netlify nastavte proměnnou <strong>GOOGLE_OAUTH_CLIENT_SECRET</strong> stávajícího webového klienta. Klíč nevkládejte do chatu.</p><p>U stejného klienta Google přidejte přesnou návratovou adresu:</p><pre>'+esc(CALLBACK)+'</pre><p>Zapněte Google Calendar API. Ověřte stav publikování OAuth; režim Testing může omezit platnost obnovovacího tokenu na sedm dní.</p>',503);
    if(req.method==='GET')return page('<h1>Připojit firemní Google k serveru</h1><p>Účet: <strong>'+ACCOUNT+'</strong>.</p><p>Povolíte průběžné obnovování přístupu k souborům vytvořeným touto aplikací na Disku a k událostem Kalendáře. Server bude moci uložit schválené PDF a vytvořit konkrétně schválenou rezervaci se skutečnou přílohou. Originálům příloh nebude měnit sdílení.</p><p>Obnovovací token bude uložen šifrovaně na stávajícím Netlify. Oprávnění lze odvolat u Googlu; nelze slíbit neomezenou platnost.</p><form method="post"><input type="hidden" name="t" value="'+esc(form.get('t'))+'"><button type="submit">Pokračovat k souhlasu Google</button></form>');
    if(req.method!=='POST'||req.headers.get('origin')!==ORIGIN)return page('<h1>Neplatný požadavek.</h1>',403);
    const nonce=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url'),store=await storeProvider();
    await store.setJSON('state/'+sha(nonce),seal(getSecret(),{sid:p.sid,verifier,expires:now()+600}),{onlyIfNew:true});
    const state=sign('google-state',{nonce,sid:p.sid},600),target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search=new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID,redirect_uri:CALLBACK,response_type:'code',scope:SCOPES.join(' '),access_type:'offline',prompt:'consent',login_hint:ACCOUNT,state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return new Response(null,{status:303,headers:{...headers,Location:target.href}});
   }
   if(u.pathname==='/api/ttf-google/callback'&&req.method==='GET'){
    const p=verify(u.searchParams.get('state'),'google-state');await checkSession(p.sid);if(u.searchParams.has('error'))return page('<h1>Připojení Google nebylo potvrzeno.</h1>',400);
    const store=await storeProvider(),key='state/'+sha(p.nonce),item=await store.getWithMetadata(key,{type:'json'});if(!item)throw Error('Přihlašovací požadavek chybí.');const state=unseal(getSecret(),item.data);
    if(state.used||state.expires<=now()||state.sid!==p.sid)throw Error('Přihlašovací požadavek už není platný.');
    if(!(await store.setJSON(key,seal(getSecret(),{...state,used:true}),{onlyIfMatch:item.etag})).modified)throw Error('Přihlášení již bylo použito.');
    const code=u.searchParams.get('code');if(!code||code.length>4096)throw Error('Chybí autorizační kód Google.');
    const t=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:CALLBACK,code_verifier:state.verifier});
    if(!t.access_token||!t.refresh_token)throw Error('Google neposkytl obnovovací token; připojení nebylo uloženo.');
    const scopes=String(t.scope||'').split(' ');if(SCOPES.slice(2).some(s=>!scopes.includes(s)))throw Error('Nebyly povoleny všechny požadované rozsahy.');
    const who=await send('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+t.access_token}});if(!who.ok)throw Error('Účet Google nelze ověřit.');const user=await who.json();
    if(String(user.email).toLowerCase()!==ACCOUNT||user.email_verified!==true){try{await send('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token})});}catch{}throw Error('Vyberte výhradně firemní účet '+ACCOUNT+'. Připojení jiného účtu nebylo uloženo.');}
    const saved={email:ACCOUNT,refreshToken:t.refresh_token,scope:scopes,connectedAt:now(),version:crypto.randomUUID(),refreshExpiresAt:t.refresh_token_expires_in?now()+Number(t.refresh_token_expires_in):null};
    await store.setJSON('connection',seal(getSecret(),saved));cache=null;
    return page('<h1>Firemní Google je připojený</h1><p>'+ACCOUNT+'</p><p>Vraťte se do tohoto chatu. Následuje zkouška testovacího PDF na Disku a čtení Kalendáře. Žádná rezervace ani skutečná faktura nebyla tímto přihlášením vytvořena.</p>');
   }
   return page('<h1>Stránka neexistuje.</h1>',404);
  }catch(error){return page('<h1>Připojení nebylo dokončeno</h1><p>'+esc(error.message||'Otevřete nové připojení.')+'</p>',400);}
 }
 async function generateDriveId(){const r=await request('drive','/files/generateIds?count=1&space=drive');if(r.status!==200||!r.data.ids?.[0])throw Error('Nelze získat ID souboru.');return r.data.ids[0];}
 async function uploadPdf(bytes,filename,fileId){if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)||!/^[-A-Za-z0-9_.]+\.pdf$/.test(filename))throw Error('Neplatný PDF export.');
  const folder=await request('drive','/files/'+FOLDER+'?fields=id,mimeType,trashed');if(folder.status!==200||folder.data.trashed||folder.data.mimeType!=='application/vnd.google-apps.folder')throw Error('Připojení nevidí schválenou složku faktur.');
  const checksum=crypto.createHash('md5').update(bytes).digest('hex');const read=()=>request('drive','/files/'+encodeURIComponent(fileId)+'?fields=id,name,parents,trashed,mimeType,md5Checksum,webViewLink');
  let found=await read();if(found.status===404){const boundary='ttf_'+crypto.randomBytes(16).toString('hex');const metadata={id:fileId,name:filename,mimeType:'application/pdf',parents:[FOLDER]};const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/pdf\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);const created=await request('upload','/files?uploadType=multipart',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});if(![200,201,409].includes(created.status))throw Error('Nahrání PDF selhalo. Opakujte stejné ID souboru.');found=await read();}
  const file=found.data;if(found.status!==200||file.trashed||file.name!==filename||file.mimeType!=='application/pdf'||!file.parents?.includes(FOLDER)||file.md5Checksum!==checksum)throw Error('Soubor na Disku nesouhlasí s PDF; nebyl přepsán.');
  return {fileId:file.id,filename:file.name,folderId:FOLDER,account:ACCOUNT,url:file.webViewLink||'https://drive.google.com/file/d/'+file.id+'/view',verifiedChecksum:true};
 }
 async function checkApis(){const r=await request('calendar','/calendars/primary/events?maxResults=1');const d=await request('drive','/files/'+FOLDER+'?fields=id,mimeType,trashed');return {calendarAvailable:r.status===200,invoiceFolderAvailable:d.status===200&&!d.data.trashed,account:ACCOUNT};}
 async function testUpload(bytes){const store=await storeProvider();let item=await store.getWithMetadata('test-pdf-file',{type:'json'});if(!item){await store.setJSON('test-pdf-file',{fileId:await generateDriveId()},{onlyIfNew:true});item=await store.getWithMetadata('test-pdf-file',{type:'json'});}if(!item)throw Error('Nelze rezervovat testovací PDF.');return uploadPdf(bytes,'TEST_cloud_original_NEHRADIT.pdf',item.data.fileId);}
 return {status,web,request,generateDriveId,uploadPdf,checkApis,testUpload};
}
module.exports={createGoogleBridge,seal,unseal,ACCOUNT,FOLDER,CALLBACK,SCOPES};
