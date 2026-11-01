'use strict';
const {createPdf,testData}=require('./invoice-pdf.cjs');
const {createService,legacyApi}=require('./invoice-service.cjs');
const crypto=require('node:crypto');
const ORIGIN='https://fakturace-tulec-trend-foto.netlify.app';
const ISSUE_SCOPE='fakturace.issue';
const fields={odberatel:{type:'string',description:'Přesné jméno a úplná adresa, každý údaj na samostatném řádku.',maxLength:450},ucel:{type:'string',maxLength:90},castka:{type:'number',exclusiveMinimum:0,maximum:1000000},vystaveno:{type:'string',pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'},splatnost:{type:'string',pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'}};
function descriptor(name,description,properties,required,write=false,scope=ISSUE_SCOPE){return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:scope==='fakturace.read'?[scope]:['fakturace.read',scope]}]};}
const TOOLS=[
 descriptor('ttf_testovaci_pdf','Vygeneruje v cloudu pevný fiktivní TEST – NEHRADIT ve vzhledu aplikace, bez skutečného čísla, historie a QR platby. Vrátí skutečný PDF soubor.',{},[],false,'fakturace.read'),
 descriptor('ttf_navrh_vystaveni','Připraví neuložený návrh skutečné faktury, ověří číselnou řadu a duplicitní historii. Vyžaduje úplné potvrzené fakturační údaje. Ukaž celý návrh Tomášovi a vyčkej na výslovné schválení právě tohoto návrhu; nevystavuj automaticky.',fields,Object.keys(fields)),
 descriptor('ttf_vystavit_fakturu','Vystaví přesně dříve připravený a Tomášem výslovně schválený návrh. POUŽIJ JEN PO SCHVÁLENÍ KONKRÉTNÍHO NÁVRHU. Přidělí číslo a uloží historii i PDF. Opakuj pouze se stejným tokenem při chybě; export již vystavené faktury používej bez nového návrhu. Nic neodesílá zákazníkovi.',{navrhToken:{type:'string'},schvaleni:{type:'string',description:'Přesný schvalovací text z návrhu, pouze po skutečném souhlasu Tomáše.'}},['navrhToken','schvaleni'],true),
 descriptor('ttf_pdf_faktury','Načte již vystavené PDF beze změny čísla a historie. Použij při opakovaném exportu stejné faktury. Vrátí skutečný PDF soubor, nikoli potvrzení o jeho uložení na Disk.',{id:{type:'string',pattern:'^[a-f0-9]{64}$'}},['id']),
];
async function invoiceStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'ttf-cloud-invoices-v1',consistency:'strong'});}
function fileResult(filename,url,extra={}) {return {content:[{type:'text',text:JSON.stringify({filename,mimeType:'application/pdf',...extra})},{type:'resource_link',uri:url,name:filename,mimeType:'application/pdf'}],isError:false};}
function createTools({sign,verify,getSecret,storeProvider=invoiceStore,now=()=>new Date().toISOString()}={}) {
 const service=async()=>createService({store:await storeProvider(),api:(route,method,body,year)=>legacyApi(getSecret(),route,method,body,fetch,year),sign,verify,now});
 async function call(name,args,identity){
   const tool=TOOLS.find(t=>t.name===name);if(!tool)return null;
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k))||tool.inputSchema.required.some(k=>!Object.hasOwn(args,k)))throw Error('Neplatné vstupy nástroje.');
   if(name==='ttf_testovaci_pdf') {
     const pdf=createPdf(testData());return fileResult('TEST_cloud_original_NEHRADIT.pdf',ORIGIN+'/api/ttf-test-invoice.pdf',{bytes:pdf.length,sha256:crypto.createHash('sha256').update(pdf).digest('hex'),testOnly:true});
   }
   if(!identity.scope.split(' ').includes(ISSUE_SCOPE))return {needsScope:ISSUE_SCOPE};
   const invoices=await service();
   if(name==='ttf_navrh_vystaveni')return {content:[{type:'text',text:JSON.stringify(await invoices.prepare(args))}],isError:false};
   let id,info;
   if(name==='ttf_vystavit_fakturu'){info=await invoices.issue(args.navrhToken,args.schvaleni);id=info.id;}
   else {id=args.id; const pdf=await invoices.exportPdf(id);info={cislo:pdf.number,sha256:pdf.sha256,opakovani:true};}
   const ticket=sign('invoice-file',{id,sid:identity.sid},300);
   return fileResult('Faktura_'+info.cislo+'.pdf',ORIGIN+'/api/ttf-invoice-file?t='+encodeURIComponent(ticket),info);
 }
 async function file(ticket){const p=verify(ticket,'invoice-file');return {...await(await service()).exportPdf(p.id),sid:p.sid};}
 return {call,file};
}
module.exports={TOOLS,ISSUE_SCOPE,createTools,createPdf,testData};
