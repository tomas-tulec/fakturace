'use strict';
const {createReservationService}=require('./reservation-service.cjs');
const {createPdf,testData}=require('./invoice-pdf.cjs');
const RESERVATION_SCOPE='rezervace.write';
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string'};
const reservation={title:text,clientEmail:text,location:text,start:{type:'string',description:'Potvrzený pražský čas YYYY-MM-DDTHH:MM:00+01:00 nebo +02:00, včetně roku.'},end:text,attachment:object({fileId:text,fileUrl:text,title:text,mimeType:text}),sendInvitations:{type:'boolean'},description:text};
function tool(name,description,schema,scope,write=false){return {name,description,inputSchema:schema,annotations:{readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:scope==='fakturace.read'?[scope]:['fakturace.read',scope]}]};}
const TOOLS=[
 tool('ttf_stav_google','Ověří konfiguraci serverového propojení s firemním Googlem. Vrátí pouze stav a stránku pro bezpečné připojení, nikdy token nebo tajný klíč. Samo nic nepřipojuje.',object({}),'fakturace.read'),
 tool('ttf_test_disk','Pouze technický test: vytvoří pevné fiktivní TEST – NEHRADIT a uloží ho přímo ze serveru do schválené složky firemního Disku. Opakování zachová stejný soubor. Nezmění skutečnou číselnou řadu ani historii.',object({}),'fakturace.issue',true),
 tool('ttf_ulozit_pdf_na_disk','Uloží již vystavené PDF přímo ze serveru na firemní Disk do složky Faktury Tulec Trend Foto, ověří skutečný soubor a kontrolní součet. Při opakování použije stejné ID. Použij pouze po schválení tohoto uložení Tomášem. Nic neodesílá klientovi.',object({id:{type:'string',pattern:'^[a-f0-9]{64}$'}}),'fakturace.issue',true),
 tool('ttf_navrh_rezervace','Ověří kolize a připraví NEULOŽENÝ návrh se skutečnou přílohou, klientem a Janou, bez připomenutí. Všechny údaje musí být potvrzené v aktuální objednávce, název schválený a soubor ověřený na firemním Disku. Ukaž úplný souhrn a zastav před uložením.',object(reservation),RESERVATION_SCOPE),
 tool('ttf_ulozit_rezervaci','ULOŽÍ rezervaci a podle schváleného návrhu případně ODEŠLE POZVÁNKY. POUŽIJ JEN PO VÝSLOVNÉM SCHVÁLENÍ PRÁVĚ TOHOTO NÁVRHU A AKCÍ TOMÁŠEM. Testovací rezervace se nikdy neukládá. Nepřepisuje jiné události a nemění sdílení přílohy.',object({navrhToken:text,schvaleni:text}),RESERVATION_SCOPE,true),
];
function createWorkflowTools({google,invoiceTools,sign,verify}){const reservations=createReservationService({google,sign,verify});return {async call(name,args,identity){const t=TOOLS.find(t=>t.name===name);if(!t)return null;if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(t.inputSchema.properties,k))||t.inputSchema.required.some(k=>!Object.hasOwn(args,k)))throw Error('Neplatné vstupy.');const scope=t.securitySchemes[0].scopes.at(-1);if(!identity.scope.split(' ').includes(scope))return {needsScope:scope};let result;
 if(name==='ttf_stav_google'){result=await google.status(identity.sid);if(result.connected){try{Object.assign(result,await google.checkApis());}catch(error){result.apiCheckError=error.message;}}}
 else if(name==='ttf_test_disk')result={...await google.testUpload(createPdf(testData())),testOnly:true};
 else if(name==='ttf_ulozit_pdf_na_disk')result=await invoiceTools.saveToDrive(args.id,google);
 else if(name==='ttf_navrh_rezervace')result=await reservations.prepare(args);
 else result=await reservations.create(args.navrhToken,args.schvaleni);
 return {content:[{type:'text',text:JSON.stringify(result)}],isError:false};}};}
module.exports={TOOLS,RESERVATION_SCOPE,createWorkflowTools};
