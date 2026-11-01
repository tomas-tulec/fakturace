'use strict';
const crypto=require('node:crypto');
const {createPdf}=require('./invoice-pdf.cjs');
const {validDate}=require('../functions/fakturace-mcp.js')._test;
const ORIGIN='https://fakturace-tulec-trend-foto.netlify.app';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const asDate=value=>value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4);
function validateInput(raw) {
  const keys=['odberatel','ucel','castka','vystaveno','splatnost'];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))throw Error('Vyplňte přesně odběratele, účel, částku a obě data.');
  if(typeof raw.odberatel!=='string'||raw.odberatel.length>450||/[\x00-\x09\x0b-\x1f\x7f]/.test(raw.odberatel))throw Error('Neplatné údaje odběratele.');
  const lines=raw.odberatel.split('\n');if(lines.length<2||lines.length>5||lines.some(s=>!s.trim()||s.length>65))throw Error('Odběratel musí obsahovat jméno a úplnou adresu na samostatných řádcích.');
  if(typeof raw.ucel!=='string'||!raw.ucel.trim()||raw.ucel.length>90||/[\x00-\x1f\x7f]/.test(raw.ucel))throw Error('Neplatný účel faktury.');
  if(typeof raw.castka!=='number'||!Number.isFinite(raw.castka)||raw.castka<=0||raw.castka>1000000||Math.abs(raw.castka*100-Math.round(raw.castka*100))>1e-6)throw Error('Neplatná částka.');
  if(!validDate(raw.vystaveno)||!validDate(raw.splatnost)||raw.splatnost<raw.vystaveno)throw Error('Neplatná data.');
  return Object.fromEntries(keys.map(k=>[k,raw[k]]));
}
function stableData(data,number='') {return {cislo:String(number),odberatel:data.odberatel,castka:data.castka,datumVystaveni:data.vystaveno,datumSplatnosti:data.splatnost,polozky:[{d:data.ucel,q:1,p:data.castka}]};}
function fingerprint(data) {return digest(JSON.stringify(stableData(data)));}
function pdfData(data,number,date) {return {num:String(number),items:[{d:data.ucel,q:1,p:data.castka}],total:data.castka,cust:data.odberatel.split('\n'),iss:asDate(data.vystaveno),due:asDate(data.splatnost),generatedOn:date,test:false,spd:'SPD*1.0*ACC:CZ7506000000000226152322*AM:'+data.castka.toFixed(2)+'*CC:CZK*X-VS:'+number+'*X-KS:0308'};}
async function legacyApi(secret,route,method='GET',body,fetcher=fetch,year) {
  if(!['faktura-cislo','faktura-historie'].includes(route))throw Error('Unsupported legacy route');
  if(year!==undefined&&!/^20\d{2}$/.test(year))throw Error('Invalid history year');
  const response=await fetcher(ORIGIN+'/.netlify/functions/'+route+(year?'?rok='+year:''),{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'x-faktura-token':secret,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Původní aplikace neodpověděla.');return result;
}
function createService({store,api,render=createPdf,now=()=>new Date().toISOString(),sign,verify}={}) {
  async function read(id) {return store.getWithMetadata('invoice/'+id,{type:'json'});}
  async function update(id,patch) {
    for(let attempt=0;attempt<6;attempt++) {const item=await read(id);if(!item)throw Error('Chybí rozpracovaná faktura.');const data={...item.data,...patch};if(item.data.status==='ready')data.status='ready';if((await store.setJSON('invoice/'+id,data,{onlyIfMatch:item.etag})).modified)return data;}
    throw Error('Souběžná změna faktury; opakujte stejné potvrzení.');
  }
  async function prepare(raw) {
    const data=validateInput(raw),id=fingerprint(data),prior=await read(id);
    if(prior?.data.status==='ready')return {stav:'JIŽ VYSTAVENO - NEVYTVÁŘET DUPLIKÁT',id,cislo:prior.data.number,data};
    // Compare complete billable data, not just a customer name.
    const response=await api('faktura-historie','GET',undefined,data.vystaveno.slice(0,4));
    const history=Array.isArray(response)?response:response.faktury;
    if(!Array.isArray(history))throw Error('Nelze ověřit historii; návrh nebyl připraven.');
    const duplicate=history.find(row=>{const normalized={cislo:'',odberatel:String(row.odberatel||''),castka:Number(row.castka),datumVystaveni:row.datumVystaveni,datumSplatnosti:row.datumSplatnosti,polozky:row.polozky};return digest(JSON.stringify(normalized))===id;});
    if(duplicate&&!prior)return {stav:'JIŽ VYSTAVENO V PŮVODNÍ APLIKACI - NEVYTVÁŘET DUPLIKÁT',cislo:String(duplicate.cislo),data};
    const expected=prior?.data.expected ?? (await api('faktura-cislo')).dalsi;
    if(!Number.isSafeInteger(expected)||expected<260000||expected>=999000)throw Error('Neplatné skutečné číslo faktury.');
    if(String(expected).slice(0,2)!==data.vystaveno.slice(2,4))throw Error('Rok číselné řady nesouhlasí s datem vystavení.');
    // Render before any number is assigned. Catch invalid layout/data at draft time.
    const date=prior?.data.date || now().slice(0,10);
    render(pdfData(data,expected,date));
    return {stav:prior?'ROZPRACOVÁNO - BEZ NOVÉHO ČÍSLA':'NEULOŽENÝ NÁVRH - NEVYSTAVENO',id,cislo:expected,data,schvaleni:'VYSTAVIT '+id.slice(0,12),navrhToken:sign('invoice-proposal',{id,data,expected,date},1200)};
  }
  async function issue(token,approval) {
    const p=verify(token,'invoice-proposal'),data=validateInput(p.data),id=fingerprint(data);
    if(p.id!==id||approval!=='VYSTAVIT '+id.slice(0,12))throw Error('Chybí schválení tohoto konkrétního návrhu.');
    let item=await read(id);
    if(!item) {
      const current=(await api('faktura-cislo')).dalsi;if(current!==p.expected)throw Error('Číslo se změnilo. Připravte nový návrh ke schválení.');
      const pdf=render(pdfData(data,p.expected,p.date));
      const initial={data,expected:p.expected,date:p.date,pdf:pdf.toString('base64'),sha256:digest(pdf),status:'pending',requestId:'cloud-'+id};
      await store.setJSON('invoice/'+id,initial,{onlyIfNew:true});item=await read(id);
    }
    if(!item||fingerprint(item.data.data)!==id)throw Error('Nesoulad uloženého návrhu.');
    let record=item.data;
    if(record.status==='ready')return {id,cislo:record.number,opakovani:true,sha256:record.sha256};
    const assigned=await api('faktura-cislo','POST',{requestId:record.requestId,fingerprint:id,ocekavane:record.expected});
    if(assigned.cislo!==record.expected)throw Error('Nesoulad přiděleného čísla; nevytvářejte novou fakturu.');
    record=await update(id,{number:assigned.cislo,status:'assigned'});
    await api('faktura-historie','POST',stableData(record.data,record.number));
    record=await update(id,{status:'ready'});
    return {id,cislo:record.number,opakovani:Boolean(assigned.opakovani),sha256:record.sha256};
  }
  async function exportPdf(id) {
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('Neplatné ID faktury.');const item=await read(id);if(!item||item.data.status!=='ready')throw Error('Faktura není dokončená.');
    const bytes=Buffer.from(item.data.pdf,'base64');if(digest(bytes)!==item.data.sha256)throw Error('Nesouhlasí kontrolní součet PDF.');return {bytes,filename:'Faktura_'+item.data.number+'.pdf',number:item.data.number,sha256:item.data.sha256};
  }
  return {prepare,issue,exportPdf};
}
module.exports={validateInput,stableData,fingerprint,pdfData,legacyApi,createService};
