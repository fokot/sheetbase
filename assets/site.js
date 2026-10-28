import {createSheetbase,createIndexedDBStorage,createMemoryRemote,column} from '../dist/index.js';
const $=id=>document.getElementById(id);
import {examples as allExamples} from './code-examples.js';
const english=document.documentElement.lang==='en';
const t=(sk,en)=>english?en:sk;
const examples=allExamples[english?'en':'sk'];
let selectedExample='connect';
function selectExample(button){selectedExample=button.dataset.example;document.querySelectorAll('[data-example]').forEach(tab=>{const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});$('exampleCode').innerHTML='<code class="hljs language-typescript">'+examples[selectedExample].html+'</code>';$('exampleCode').setAttribute('aria-labelledby',button.id);$('copyExample').textContent=t('Kopírovať','Copy');}
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>selectExample(button)));
function wireArrows(container,select){container.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=[...container.querySelectorAll('[role=tab]')];const current=tabs.indexOf(document.activeElement);if(current<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;select(tabs[next]);tabs[next].focus();});}
wireArrows(document.querySelector('.code-tabs'),selectExample);
$('copyExample').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(examples[selectedExample].raw);$('copyExample').textContent=t("Skopírované ✓","Copied ✓");}catch{$('copyExample').textContent=t("Označ a skopíruj kód","Select and copy the code");}});

const DB='sheetbase-docs-v1',CLOUD='sheetbase-docs-cloud-v1',OFFLINE='sheetbase-docs-offline';
const TODAY='2026-10-27',remoteKey=JSON.stringify(['demo-local','demo-journal','Journal']);
const baseline={ '2026-10-25':{Walk:'✓',Pages:'12',Note:'Pomaly a pravidelne'},'2026-10-26':{Walk:'✓',Pages:'18',Note:'Kapitola pred spaním'},[TODAY]:{Walk:'',Pages:'24',Note:'Dnes je dobrý deň'}};
let saved=null;try{saved=JSON.parse(localStorage.getItem(CLOUD)||'null');}catch{}
let simulation=createMemoryRemote(saved?.tables??{[remoteKey]:baseline},saved?.receipts??{});
let online=true;try{online=sessionStorage.getItem(OFFLINE)!=='true';}catch{}
let storage,client,table,unsubscribe,snapshot,view='local',busy=false;
function persistRemote(){try{localStorage.setItem(CLOUD,JSON.stringify(simulation.checkpoint()));}catch{$('demoLog').textContent=t("Prehliadač nepovolil uložiť simuláciu cloudu. Lokálny zápis používa IndexedDB.","Your browser could not save the simulated cloud. Local writes use IndexedDB.");}}
const remote={initialize:async(...args)=>{try{return await simulation.initialize(...args);}finally{persistRemote();}},read:(...args)=>simulation.read(...args),commit:async(...args)=>{try{return await simulation.commit(...args);}finally{persistRemote();}}};
function renderRows(){const body=$('demoRows');body.replaceChildren();let rows;
 if(view==='local')rows=snapshot?.rows??[];
 else rows=Object.entries(simulation.inspect(table.target)).map(([key,raw])=>({key,values:{walk:raw.Walk==='✓'?true:raw.Walk==='FALSE'?false:null,pages:raw.Pages===''||raw.Pages===undefined?null:Number(raw.Pages),note:raw.Note??null}}));
 rows.sort((a,b)=>a.key.localeCompare(b.key));for(const row of rows){const tr=document.createElement('tr');if(row.key===TODAY)tr.className='is-current';for(const value of [row.key,row.values.walk===true?'✓':row.values.walk===false?'—':'·',row.values.pages===null?'·':`${row.values.pages} ${t('strán','pages')}`,(english?({'Pomaly a pravidelne':'Slow and steady','Kapitola pred spaním':'A chapter before bed','Dnes je dobrý deň':'Today is a good day'}[row.values.note]??row.values.note):row.values.note)??'·']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}}
function render(next){snapshot=next;const error=next.error;const label=next.phase==='offline'?t("Offline · uložené lokálne","Offline · saved locally"):next.phase==='syncing'?t("Synchronizujem…","Syncing…"):error?t("Uložené lokálne · čaká na retry","Saved locally · retry needed"):next.pending?t("Uložené lokálne","Saved locally"):t("Synchronizované","Synced");$('demoStatus').textContent=label;$('demoStatus').className=`status-pill ${error?'error':next.pending?'pending':!online?'offline':''}`;$('pendingCount').textContent=String(next.pending);
 $('connectionToggle').setAttribute('aria-checked',String(!online));$('connectionText').textContent=online?'Online':'Offline';
 for(const id of ['connectionToggle','walkButton','pageButton','reopenButton','resetButton','lostButton'])$(id).disabled=busy||next.phase==='opening'||next.phase==='closed';
 $('syncButton').disabled=busy||!online||!next.pending||next.phase==='syncing';renderRows();
 if(error)$('demoLog').textContent=error.message.includes('reply was lost')?t("Simulovaný Sheet dávku uložil. Odpoveď sa stratila. Znova klikni na Synchronizovať — použije sa potvrdenie pôvodnej dávky.","The simulated Sheet saved the batch, but its reply was lost. Click Sync again to check the original receipt."):error.message;
}
async function start(){storage??=createIndexedDBStorage(DB);client=createSheetbase({accountId:'demo-local',storage,remote,autoSync:false});client.setOnline(online);simulation.setOnline(online);table=client.table({spreadsheetId:'demo-journal',sheet:'Journal',keyColumn:'Date',columns:{walk:column.boolean('Walk'),pages:column.number('Pages'),note:column.text('Note')}});unsubscribe=table.subscribe(render);
 await table.open();$('demoFallback').hidden=true;render(table.snapshot());}
async function act(action){if(busy)return;busy=true;render(table.snapshot());try{await action();}catch(error){$('demoLog').textContent=error.message;}finally{busy=false;render(table.snapshot());}}
$('connectionToggle').addEventListener('click',()=>{online=!online;try{sessionStorage.setItem(OFFLINE,String(!online));}catch{}simulation.setOnline(online);client.setOnline(online);render(table.snapshot());});
$('walkButton').addEventListener('click',()=>void act(()=>table.set(TODAY,{walk:table.get(TODAY)?.values.walk!==true})));
$('pageButton').addEventListener('click',()=>void act(()=>table.set(TODAY,{pages:(table.get(TODAY)?.values.pages??0)+1})));
$('syncButton').addEventListener('click',()=>void act(async()=>{await table.sync();$('demoLog').textContent=t(`Hotovo. V tejto návšteve: ${simulation.stats().writes} uložených dávok v simulovanom Sheete.`,`Done. This visit: ${simulation.stats().writes} saved batches in the simulated Sheet.`);}));
$('lostButton').addEventListener('click',()=>{simulation.loseNextResponse();$('demoLog').textContent=t("Pripravené. Urob zmenu a synchronizuj ju. Ďalšia odpoveď sa úmyselne stratí.","Ready. Make a change and sync it. The next reply will be deliberately lost.");});
$('reopenButton').addEventListener('click',()=>void act(async()=>{unsubscribe?.();client.dispose();await start();$('demoLog').textContent=t("Klient sa otvoril znova. Dáta a čakajúca fronta sa obnovili z IndexedDB.","Client reopened. Data and pending changes were restored from IndexedDB.");}));
$('resetButton').addEventListener('click',()=>void act(async()=>{unsubscribe?.();client.dispose();storage.close();storage=null;await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(DB);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error(t("Zatvor ďalšie karty tejto ukážky a zopakuj obnovu.","Close other tabs running this demo and try resetting again.")));});simulation=createMemoryRemote({[remoteKey]:baseline});online=true;try{localStorage.removeItem(CLOUD);sessionStorage.removeItem(OFFLINE);}catch{}await start();$('demoLog').textContent=t("Obnovené iba testovacie dáta tejto ukážky.","Only this demo’s test data was reset.");}));
function selectView(button){view=button.id==='tabLocal'?'local':'remote';for(const tab of [$('tabLocal'),$('tabRemote')]){const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}$('tablePanel').setAttribute('aria-labelledby',button.id);renderRows();}
for(const button of [$('tabLocal'),$('tabRemote')])button.addEventListener('click',()=>selectView(button));wireArrows(document.querySelector('.demo-tabs'),selectView);
selectExample($('exampleConnect'));
try{await start();}catch(error){$('demoFallback').hidden=false;$('demoFallback').textContent=t(`Ukážka: ${error.message} Otvor stránku cez npm run docs a povoľ úložisko prehliadača.`,`Demo: ${error.message} Open this page with npm run docs and allow browser storage.`);}
window.addEventListener('pagehide',()=>{client?.dispose();storage?.close();});
