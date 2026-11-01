'use strict';
const crypto=require('node:crypto');
const {validDate}=require('../functions/fakturace-mcp.js')._test;
const JANA='janatulda@gmail.com';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function validTime(value){if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:00\+0[12]:00$/.test(value)||!validDate(value.slice(0,10))||!Number.isFinite(Date.parse(value)))return false;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`===value.slice(0,19);}
function validate(raw){const keys=['title','clientEmail','location','start','end','attachment','sendInvitations','description'];if(!raw||typeof raw!=='object'||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))throw Error('Vyplňte přesně celý návrh rezervace.');
 for(const k of ['title','location'])if(typeof raw[k]!=='string'||!raw[k].trim()||raw[k].length>200||/[\x00-\x1f\x7f]/.test(raw[k]))throw Error('Chybí schválený název nebo úplné místo.');
 if(typeof raw.clientEmail!=='string'||! /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(raw.clientEmail)||raw.clientEmail.length>254||raw.clientEmail.toLowerCase()===JANA)throw Error('Chybí jednoznačný přesný e-mail klienta.');
 if(!validTime(raw.start)||!validTime(raw.end)||Date.parse(raw.end)<=Date.parse(raw.start)||Date.parse(raw.end)-Date.parse(raw.start)>12*3600000)throw Error('Zadejte potvrzený začátek a konec se správným pražským časovým posunem.');
 if(typeof raw.description!=='string'||raw.description.length>2000||/[\x00-\x08\x0b-\x1f\x7f]/.test(raw.description)||typeof raw.sendInvitations!=='boolean')throw Error('Neplatný popis nebo volba pozvánek.');
 const a=raw.attachment;if(!a||Object.keys(a).length!==4||['fileId','fileUrl','title','mimeType'].some(k=>typeof a[k]!=='string')||!/^[A-Za-z0-9_-]{10,200}$/.test(a.fileId)||!a.title.trim()||a.title.length>200||/[\x00-\x1f]/.test(a.title)||!/^[-\w.+]+\/[-\w.+]+$/.test(a.mimeType))throw Error('Chybí ověřená skutečná příloha Disku.');
 const url=new URL(a.fileUrl);if(url.protocol!=='https:'||!['drive.google.com','docs.google.com'].includes(url.hostname)||!url.pathname.includes('/d/'+a.fileId+'/')||url.username||url.password)throw Error('Příloha neodkazuje na ověřený soubor Google.');
 return Object.fromEntries(keys.map(k=>[k,raw[k]]));
}
function eventData(data){const {fileUrl,title,mimeType}=data.attachment;return {summary:data.title,location:data.location,description:data.description,start:{dateTime:data.start,timeZone:'Europe/Prague'},end:{dateTime:data.end,timeZone:'Europe/Prague'},attendees:[{email:data.clientEmail},{email:JANA}],attachments:[{fileUrl,title,mimeType}],reminders:{useDefault:false,overrides:[]},guestsCanModify:false,guestsCanInviteOthers:false};}
function createReservationService({google,sign,verify}){
 const idFor=data=>'ttf'+hash(eventData(data));
 async function existing(id){const r=await google.request('calendar','/calendars/primary/events/'+id);if(r.status===404)return null;if(r.status!==200)throw Error('Existující rezervaci nelze ověřit.');return r.data;}
 async function free(data,id){const query=new URLSearchParams({timeMin:data.start,timeMax:data.end,singleEvents:'true',maxResults:'250'});const r=await google.request('calendar','/calendars/primary/events?'+query);if(r.status!==200||r.data.nextPageToken)throw Error('Nelze bezpečně ověřit všechny kolize.');if((r.data.items||[]).some(e=>e.id!==id&&e.status!=='cancelled'&&e.transparency!=='transparent'))throw Error('Termín má kolizi. Návrh nebyl uložen.');}
 async function prepare(raw){const data=validate(raw),id=idFor(data);const prior=await existing(id);if(prior)return {stav:'REZERVACE JIŽ EXISTUJE - NEUKLÁDAT DUPLIKÁT',id,url:prior.htmlLink};await free(data,id);return {stav:'NEULOŽENÝ NÁVRH',data,event:eventData(data),id,schvaleni:(data.sendInvitations?'ULOŽIT A ODESLAT POZVÁNKY ':'ULOŽIT BEZ POZVÁNEK ')+id.slice(-12),navrhToken:sign('calendar-proposal',{data,id},1200),upozorneni:'Před uložením musí Tomáš schválit přesně tento název, termín, místo, příjemce, přílohu a odeslání pozvánek. Sdílení originálu přílohy se nemění.'};}
 async function create(token,approval){const p=verify(token,'calendar-proposal'),data=validate(p.data),id=idFor(data),expected=(data.sendInvitations?'ULOŽIT A ODESLAT POZVÁNKY ':'ULOŽIT BEZ POZVÁNEK ')+id.slice(-12);if(p.id!==id||approval!==expected)throw Error('Chybí souhlas s konkrétní rezervací a pozvánkami.');
  if(data.clientEmail.toLowerCase().endsWith('.invalid')||/NEUKL[ÁA]DAT/i.test(data.title))throw Error('Testovací návrh rezervace se nikdy neukládá.');
  const previous=await existing(id);if(previous){if(previous.extendedProperties?.private?.ttfFingerprint!==hash(eventData(data)))throw Error('Existující událost má jiný obsah.');return {id,url:previous.htmlLink,opakovani:true,pozvankyZnovuOdeslany:false};}
  await free(data,id);const event={...eventData(data),id,extendedProperties:{private:{ttfFingerprint:hash(eventData(data))}}};
  const result=await google.request('calendar','/calendars/primary/events?'+new URLSearchParams({supportsAttachments:'true',sendUpdates:data.sendInvitations?'all':'none'}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});
  if(result.status===409){const saved=await existing(id);if(saved?.extendedProperties?.private?.ttfFingerprint===hash(eventData(data)))return {id,url:saved.htmlLink,opakovani:true,pozvankyZnovuOdeslany:false};}
  if(![200,201].includes(result.status))throw Error('Uložení se nepotvrdilo. Opakujte pouze stejný návrh.');return {id,url:result.data.htmlLink,opakovani:false,pozvankyOdeslany:data.sendInvitations,priloha:result.data.attachments||[],pripominkyVypnuty:result.data.reminders?.useDefault===false};
 }
 return {prepare,create};
}
module.exports={createReservationService,validate,eventData,validTime,JANA};
