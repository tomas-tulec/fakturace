'use strict';
const buildPdf=require('./invoice-template.cjs');
const crypto=require('node:crypto');
const {validDate}=require('../functions/fakturace-mcp.js')._test;
function testData() {
  return {num:'999001',items:[{d:'Fiktivní testovací fotografická služba',q:1,p:1234.5}],total:1234.5,cust:['Testovací zákazník','Ukázková 123','779 00 Vzorové Město'],iss:'01.11.2026',due:'15.11.2026',spd:'',test:true,generatedOn:'2026-11-01'};
}
function createPdf(data) {
  if(!data || !validDate(data.generatedOn))throw Error('Explicit generation date required');
  if(!Array.isArray(data.cust)||data.cust.length<1||data.cust.length>7||data.cust.some(s=>typeof s!=='string'||s.length>65))throw Error('Invalid customer lines');
  if(!Array.isArray(data.items)||data.items.length<1||data.items.length>8||data.items.some(it=>!it||typeof it.d!=='string'||it.d.length>90||!Number.isFinite(it.q)||it.q<=0||!Number.isFinite(it.p)||it.p<0))throw Error('Invalid invoice items');
  if(!Number.isFinite(data.total)||data.total<=0||Math.abs(data.items.reduce((v,it)=>v+Math.round(it.q*it.p*100),0)-Math.round(data.total*100))>0)throw Error('Amount does not match items');
  if(!/^\d{6}$/.test(data.num)||(!data.test&&(+data.num<260000||+data.num>=999000)))throw Error('Invalid invoice number');
  if(data.test && (data.num!=='999001'||data.spd))throw Error('Test must have no payment');
  if(!data.test && !data.spd.startsWith('SPD*1.0*ACC:CZ7506000000000226152322*'))throw Error('Invalid payment destination');
  const pdf=buildPdf(data);if(pdf.getNumberOfPages()!==1)throw Error('Unexpected page count');
  pdf.setFileId(crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,32));
  pdf.setCreationDate('D:'+data.generatedOn.replace(/-/g,'')+"120000+00'00'");
  return Buffer.from(pdf.output('arraybuffer'));
}
module.exports={createPdf,testData};
