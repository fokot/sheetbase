import test from 'node:test';
import assert from 'node:assert/strict';
import { column, createSheetbase, createMemoryStorage, createMemoryRemote, SheetbaseError } from '../dist/index.js';
const definition = { spreadsheetId:'test-file',sheet:'Journal',keyColumn:'Date',columns:{walk:column.boolean('Walk'),pages:column.number('Pages'),note:column.text('Note')} };
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(options={}) {
 const storage=options.storage??createMemoryStorage(),remote=options.remote??createMemoryRemote();
 const client=createSheetbase({accountId:'alice',storage,remote,autoSync:false,...options});const table=client.table(definition);
 await table.open({create:true});return{client,table,storage,remote};
}
test('typed values round-trip and remote is untouched until sync',async()=>{
 const {client,table,remote}=await setup();await table.set('2026-10-27',{walk:true,pages:0,note:'test'});
 assert.deepEqual(table.get('2026-10-27').values,{walk:true,pages:0,note:'test'});assert.equal(remote.stats().writes,0);assert.equal(table.snapshot().pending,1);
 await table.sync();assert.equal(remote.stats().writes,1);assert.equal(table.snapshot().pending,0);assert.equal(table.snapshot().phase,'ready');client.dispose();
});
test('patches coalesce by key while preserving different fields and explicit false or null',async()=>{
 const {client,table}=await setup();await table.set('day',{walk:true,pages:5});await table.set('day',{walk:false});await table.set('day',{pages:null});
 assert.equal(table.snapshot().pending,1);assert.deepEqual(table.get('day').values,{walk:false,pages:null,note:null});client.dispose();
});
test('offline writes survive a new client and resume with the exact schema',async()=>{
 const first=await setup();first.client.setOnline(false);await first.table.set('day',{pages:7});first.client.dispose();
 const next=await setup({storage:first.storage,remote:first.remote});assert.equal(next.table.get('day').values.pages,7);assert.equal(next.table.snapshot().pending,1);
 await next.client.sync();assert.equal(next.table.snapshot().pending,0);next.client.dispose();
});
test('lost reply retains the frozen receipt and never applies the batch twice',async()=>{
 const {client,table,remote}=await setup();await table.set('day',{pages:8});remote.loseNextResponse();await assert.rejects(table.sync(),/reply was lost/);
 const first=await table.export();assert.ok(first.batch);assert.equal(remote.stats().writes,1);
 await table.sync();assert.equal(remote.stats().writes,1);assert.equal(table.snapshot().pending,0);client.dispose();
});
test('new edits during upload survive its acknowledgement and are sent in a later batch',async()=>{
 const remote=createMemoryRemote();let started,release;
 const began=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);let once=true;
 const backend={...remote,async commit(...args){if(once){once=false;started();await gate;}return remote.commit(...args);}};
 const {client,table}=await setup({remote:backend});await table.set('day',{pages:1});const syncing=table.sync();await began;
 const frozen=await table.export();await table.set('day',{pages:2});await table.set('day',{pages:3});const current=await table.export();
 assert.equal(current.operations.length,2);assert.deepEqual(current.batch,frozen.batch);assert.deepEqual(current.operations[0],frozen.operations[0]);release();await syncing;
 assert.equal(table.get('day').values.pages,3);assert.equal(remote.stats().writes,2);assert.equal(table.snapshot().pending,0);client.dispose();
});
test('storage failure does not claim a write succeeded or change the displayed value',async()=>{
 const storage=createMemoryStorage();let fail=false;
 const failing={...storage,async update(...args){if(fail)throw new SheetbaseError('storage','Disk full');return storage.update(...args);}};
 const {client,table}=await setup({storage:failing});await table.set('day',{pages:1});fail=true;
 await assert.rejects(table.set('day',{pages:2}),/Disk full/);assert.equal(table.get('day').values.pages,1);assert.equal(table.snapshot().pending,1);client.dispose();
});
test('accounts and files are separate, and incompatible schemas preserve pending data',async()=>{
 const first=await setup();await first.table.set('day',{pages:5});
 const other=createSheetbase({accountId:'bob',storage:first.storage,remote:first.remote,autoSync:false});const otherTable=other.table(definition);await otherTable.open({create:true});assert.equal(otherTable.all().length,0);
 const incompatible=createSheetbase({accountId:'alice',storage:first.storage,remote:first.remote,autoSync:false});const bad=incompatible.table({...definition,columns:{pages:column.text('Pages')}});
 await assert.rejects(bad.open(),/cached schema differs/);assert.equal((await first.table.export()).operations.length,1);
 first.client.dispose();other.dispose();incompatible.dispose();
});
test('closing during a request prevents acknowledgement and new work',async()=>{
 const remote=createMemoryRemote();let started,release;const began=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 const backend={...remote,async commit(...args){started();await gate;return remote.commit(...args);}};
 const {client,table}=await setup({remote:backend});await table.set('day',{pages:1});const pending=table.sync();await began;client.dispose();release();
 await assert.rejects(pending,/closed/);assert.equal((await table.export()).operations.length,1);await assert.rejects(table.set('day',{pages:3}),/closed/);
});
test('delete clears only the registered values and survives refresh',async()=>{
 const {client,table}=await setup();await table.set('a',{pages:2});await table.set('b',{pages:3});await table.sync();await table.delete('a');await table.sync();await table.refresh();
 assert.equal(table.get('a'),undefined);assert.equal(table.get('b').values.pages,3);client.dispose();
});
test('refresh merges a new remote snapshot with local pending changes',async()=>{
 const {client,table,remote}=await setup();await table.set('day',{pages:2});await table.sync();client.setOnline(false);await table.set('day',{pages:5});
 await remote.commit(table.target,[{id:'outside',key:'other',values:{Pages:'9'}}],'outside',()=>{});client.setOnline(true);await table.refresh();
 assert.equal(table.get('day').values.pages,5);assert.equal(table.get('other').values.pages,9);assert.equal(table.snapshot().pending,1);client.dispose();
});
test('special keys and subscription errors cannot poison or block a save',async()=>{
 const {client,table}=await setup();table.subscribe(()=>{throw new Error('Consumer error');});await table.set('__proto__',{note:'safe'});
 assert.equal(table.get('__proto__').values.note,'safe');assert.equal({}.note,undefined);await table.sync();await tick();client.dispose();
});
test('local values are validated before entering the outbox',async()=>{
 const {client,table}=await setup();for(const patch of [{pages:NaN},{pages:Infinity},{walk:1},{unknown:'no'},{pages:undefined}])await assert.rejects(table.set('day',patch));
 await assert.rejects(table.set('',{pages:1}));assert.equal(table.snapshot().pending,0);client.dispose();
});
test('idle open does not reread history; explicit refresh does',async()=>{
 const {client,table,remote}=await setup();const before=remote.stats().reads;await table.open();await table.open();assert.equal(remote.stats().reads,before);await table.refresh();assert.equal(remote.stats().reads,before+1);client.dispose();
});
test('two clients sharing a storage serialize uploads and do not duplicate appends',async()=>{
 const storage=createMemoryStorage(),remote=createMemoryRemote(),a=await setup({storage,remote}),b=await setup({storage,remote});
 await a.table.set('day',{pages:1});await b.table.set('day',{note:'keep'});await Promise.all([a.table.sync(),b.table.sync()]);await a.table.reload();
 assert.deepEqual(a.table.get('day').values,{walk:null,pages:1,note:'keep'});assert.equal(remote.stats().writes,1);a.client.dispose();b.client.dispose();
});
test('custom codecs keep ordered workout sets in one readable cell',async()=>{
 const sets=column.custom('Bench',{id:'sets:v1',encode:values=>values.map(({reps,kg})=>`${reps}×${kg}`).join(', '),decode:text=>text.split(', ').map(part=>{const[reps,kg]=part.split('×').map(Number);return{reps,kg};})});
 const remote=createMemoryRemote(),client=createSheetbase({accountId:'alice',storage:createMemoryStorage(),remote,autoSync:false});const table=client.table({spreadsheetId:'workouts',sheet:'Workouts',keyColumn:'Date',columns:{bench:sets}});
 await table.open({create:true});await table.set('day',{bench:[{reps:5,kg:100},{reps:3,kg:0}]});await table.sync();assert.equal(remote.inspect(table.target).day.Bench,'5×100, 3×0');client.dispose();
});
test('codec edge cases distinguish null, zero and false and reject malformed remote data',()=>{
 assert.equal(column.number('N').decode('0'),0);assert.equal(column.boolean('B').decode('FALSE'),false);assert.equal(column.text('T').decode(''),null);
 assert.throws(()=>column.number('N').decode('Infinity'));assert.throws(()=>column.boolean('B').decode('maybe'));assert.throws(()=>column.text('T').encode(''));
 const json=column.json('Sets',Array.isArray);assert.deepEqual(json.decode('[1,2]'),[1,2]);assert.throws(()=>json.decode('{}'));
});
test('an acknowledgement storage failure keeps the frozen batch for a safe receipt retry',async()=>{
 const storage=createMemoryStorage();let full=false;
 const adapter={...storage,update(...args){if(full)return Promise.reject(new SheetbaseError('storage','Disk full'));return storage.update(...args);}};
 const remote=createMemoryRemote(),backend={...remote,async commit(...args){await remote.commit(...args);full=true;}};
 const {client,table}=await setup({storage:adapter,remote:backend});await table.set('day',{pages:5});await assert.rejects(table.sync(),/Disk full/);assert.equal((await table.export()).operations.length,1);assert.ok((await table.export()).batch);
 full=false;backend.commit=(...args)=>remote.commit(...args);await table.sync();assert.equal(remote.stats().writes,1);assert.equal(table.snapshot().pending,0);client.dispose();
});
test('automatic retries are bounded and permanent schema errors do not loop',async()=>{
 const {setTimeout:wait}=await import('node:timers/promises');
 for(const [retryable,expected]of [[true,2],[false,1]]){
  const remote=createMemoryRemote();let attempts=0;
  const backend={...remote,async commit(){attempts++;throw new SheetbaseError(retryable?'network':'schema','Simulated failure',retryable);}};
  const {client,table}=await setup({remote:backend,autoSync:true,debounceMs:0,retry:{attempts:2,baseDelayMs:1,maxDelayMs:2}});
  await table.set('day',{pages:2});await wait(100);assert.equal(attempts,expected);assert.equal(table.snapshot().pending,1);client.dispose();
 }
});
