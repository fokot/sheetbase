import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetbase, createMemoryStorage, createMemoryRemote, column } from '../dist/index.js';
import { googleFixture } from './google-fixture.mjs';
const dynamic = { sheet: 'Definitions', defaultType: 'text', codecs: { text: column.text, number: column.number, boolean: column.boolean } };
const definition = { spreadsheetId: 'test-file', sheet: 'Journal', keyColumn: 'Date', columns: {}, dynamic };
async function memory() {
  const storage = createMemoryStorage(), remote = createMemoryRemote();
  const client = createSheetbase({ accountId: 'alice', storage, remote, autoSync: false });
  const table = client.table(definition); await table.open({ create: true }); return { storage, remote, client, table };
}
async function google(rows = [['Date'], ['2026-10-27']]) {
  const fixture = await googleFixture({ rows: [['Date','Walk','Pages','Note','Unmanaged']] });
  fixture.rows.splice(0, fixture.rows.length, ...rows);
  const client = createSheetbase({ accountId: 'alice', storage: createMemoryStorage(), remote: fixture.remote, autoSync: false });
  const table = client.table(definition); await table.open(); return { ...fixture, get rows() { return fixture.rows; }, get sheets() { return fixture.sheets; }, get cellsRead() { return fixture.cellsRead; }, client, table };
}
test('dynamic columns and first values commit locally together, survive reload and sync in order', async () => {
  const env = await memory();
  await env.table.transaction(tx => { tx.addColumn({ id: 'a', header: 'Walk', type: 'boolean' }); tx.set('day', { a: true }); });
  await env.table.renameColumn('a', 'Run'); await env.table.set('day', { a: null }); await env.table.set('day', { a: true });
  env.client.dispose();
  const client = createSheetbase({ accountId: 'alice', storage: env.storage, remote: env.remote, autoSync: false });
  const table = client.table(definition); await table.open(); assert.equal(table.columns()[0].header, 'Run'); assert.equal(table.get('day').values.a, true);
  await table.sync(); await table.refresh(); assert.equal(table.get('day').values.a, true); assert.equal(table.columns()[0].header, 'Run');
  await table.removeColumn('a'); assert.equal(table.all().length, 0);
  await table.sync(); await table.refresh(); assert.deepEqual(table.columns(), []); client.dispose();
});
test('transactions validate latest local state and roll back schema plus values on failure', async () => {
  const { table, client } = await memory();
  await assert.rejects(table.transaction(tx => { tx.addColumn({ id: 'a', header: 'Pages', type: 'number' }); tx.set('day', { a: NaN }); }), /finite/);
  assert.deepEqual(table.columns(), []); assert.equal(table.pending(), 0);
  await table.addColumn({ id: '__proto__', header: 'Pages', type: 'number' });
  await table.set('__proto__', { ['__proto__']: 0 });
  await Promise.all([table.transaction(tx => tx.set('__proto__', { ['__proto__']: tx.get('__proto__').values.__proto__ + 1 })), table.transaction(tx => tx.set('__proto__', { ['__proto__']: tx.get('__proto__').values.__proto__ + 1 }))]);
  assert.equal(table.get('__proto__').values.__proto__, 2);
  await assert.rejects(table.addColumn({ id: 'b', header: 'pages', type: 'number' }), /distinct/);
  await assert.rejects(table.renameColumn('__proto__', 'Date'), /distinct/); client.dispose();
});
test('Google dynamic add, rename and removal preserve other columns, dates and stable metadata IDs', async () => {
  const env = await google([['Date','Old','Other'],['day','saved','keep'],['','','note']]);
  const id = env.table.columns()[0].id;
  await env.table.transaction(tx => { tx.addColumn({ id: 'new', header: 'New', type: 'number' }); tx.set('day', { new: 0 }); });
  await env.table.renameColumn(id, 'Renamed'); await env.table.sync();
  assert.deepEqual(env.rows[0], ['Date','Renamed','Other','New']); assert.deepEqual(env.rows[1], ['day','saved','keep','0']);
  assert.equal(env.sheets.find(tab => tab.properties.title === 'Definitions').rows[1][0], id);
  await env.table.removeColumn(id); await env.table.sync(); assert.deepEqual(env.rows[1], ['day','keep','0']); assert.deepEqual(env.rows[2], ['','note']);
  await env.table.refresh(); assert.equal(env.table.get('day').values.new, 0); env.client.dispose();
});
test('Google lost structural responses acknowledge the same receipt after reload', async () => {
  const env = await google(); await env.table.transaction(tx => { tx.addColumn({ id: 'a', header: 'First', type: 'text' }); tx.set('new-day', { a: '=literal' }); });
  env.loseReply(); await assert.rejects(env.table.sync(), /Cannot reach/); const batch = (await env.table.export()).batch.id;
  await env.table.sync(); assert.equal(env.table.pending(), 0); assert.equal(env.rows.filter(row => row[0] === 'new-day').length, 1); assert.equal(env.rows[0].filter(name => name === 'First').length, 1);
  assert.equal(env.sheets.find(tab => tab.properties.title === '_Sheetbase').rows.filter(row => row[0] === batch).length, 1); env.client.dispose();
});
test('dynamic warm writes use fresh indexes and metadata while preserving unrelated history', async () => {
  const env = await google([['Date','Count'], ...Array.from({length:1000}, (_, i) => [`day-${i}`, String(i)])]);
  const id = env.table.columns()[0].id; env.rows.splice(1, 0, ['earlier','keep']); env.rows.push(['','trailing note']);
  const before = env.cellsRead; await env.table.set('day-50', { [id]: 'changed' }); await env.table.set('new', { [id]: 'value' }); await env.table.sync();
  assert.equal(env.rows[52][1], 'changed'); assert.deepEqual(env.rows.at(-2), ['','trailing note']); assert.deepEqual(env.rows.at(-1), ['new','value']);
  const requests = env.calls.filter(call => !call.body).slice(-2); assert.ok(requests.some(call => new URL(call.url).searchParams.getAll('ranges').includes("'Journal'!A2:A"))); assert.ok(env.cellsRead > before); env.client.dispose();
});
test('schema transactions stay atomic across the batch size boundary', async () => {
  const { table, client, remote } = await memory(); await table.addColumn({ id:'first',header:'First',type:'text' }); await table.sync();
  for(let index=0;index<99;index++) await table.set(`day-${index}`,{first:'value'});
  await table.transaction(tx => { tx.addColumn({id:'second',header:'Second',type:'text'}); tx.set('new-day',{second:'first value'}); });
  await table.set('new-day',{second:'last value'});
  const commits=[],commit=remote.commit;remote.commit=async(...args)=>{commits.push(structuredClone(args[1]));return commit(...args);};
  await table.sync(); const structural=commits.find(operations=>operations.some(operation=>operation.schema));
  assert.ok(structural.some(operation=>operation.key==='new-day'&&operation.values.second==='first value')); assert.equal(table.get('new-day').values.second,'last value');client.dispose();
});
test('a remote removal cannot hide queued values during refresh', async () => {
  const { table, client, remote } = await memory(); await table.addColumn({id:'a',header:'A',type:'text'}); await table.sync(); await table.set('day',{a:'pending'});
  const readSchema=remote.readSchema;remote.readSchema=async()=>[];
  await assert.rejects(table.refresh(),/no longer exists/);assert.equal(table.get('day').values.a,'pending');assert.equal(table.pending(),1);remote.readSchema=readSchema;client.dispose();
});

test('the optional duplicate-key policy preserves last-row clears and writes every physical match', async () => {
  const env = await google([['Date','Count'],['day','first']]);
  env.rows.push(['day','last']);
  const client=createSheetbase({accountId:'alice',storage:createMemoryStorage(),remote:env.remote,autoSync:false});
  const table=client.table({...definition,duplicateKeys:'last'});await table.open();const id=table.columns()[0].id;assert.equal(table.get('day').values[id],'last');
  await table.set('day',{[id]:'edited'});await table.sync();assert.equal(env.rows[1][1],'edited');assert.equal(env.rows[2][1],'edited');
  env.rows[2][1]='';await table.refresh();assert.equal(table.get('day'),undefined);client.dispose();env.client.dispose();
});
test('a migrated legacy receipt recovers renamed exercise IDs before sending newer values', async () => {
  const env=await googleFixture({remoteOptions:{legacyLedgers:['FeroTrackerSync']}});
  env.rows.splice(0,env.rows.length,['Date','Renamed'],['day','7']);
  env.sheets.push({properties:{sheetId:9,title:'FeroTrackerSync',gridProperties:{rowCount:1000,columnCount:2}},rows:[['Batch ID','Saved at'],['old-batch','saved']]});
  const client=createSheetbase({accountId:'alice',storage:createMemoryStorage(),remote:env.remote,autoSync:false}),table=client.table(definition);
  await table.import({base:{day:{original:'5'}},columns:[{id:'original',header:'Old',type:'text'}],initialized:true,syncedAt:1,
    operations:[{id:'old',key:'',values:{},schema:{type:'rename',id:'original',header:'Renamed'}},{id:'new',key:'day',values:{original:'9'}}],batch:{id:'old-batch',operationIds:['old']}});
  await table.open({cachedOnly:true});await table.sync();assert.equal(table.get('day').values.original,'9');assert.equal(env.rows[1][1],'9');assert.equal(table.columns()[0].id,'original');
  assert.equal(env.sheets.find(sheet=>sheet.properties.title==='Definitions').rows[1][0],'original');client.dispose();env.client.dispose();
});
