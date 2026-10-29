import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createIndexedDBStorage, createSheetbase, createMemoryRemote, column } from '../dist/index.js';
globalThis.indexedDB = indexedDB;
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
const definition = { spreadsheetId:'file',sheet:'Journal',keyColumn:'Date',columns:{pages:column.number('Pages')} };
test('IndexedDB retains the schema, outbox and batch after storage and client reconstruction', async () => {
  const name = crypto.randomUUID(), remote = createMemoryRemote();
  let storage = createIndexedDBStorage(name), client = createSheetbase({accountId:'alice',storage,remote,autoSync:false}), table=client.table(definition);
  await table.open({create:true});await table.set('day',{pages:0});remote.loseNextResponse();await assert.rejects(table.sync());
  const batch=(await table.export()).batch.id;client.dispose();storage.close();
  storage=createIndexedDBStorage(name);client=createSheetbase({accountId:'alice',storage,remote,autoSync:false});table=client.table(definition);
  await table.open({cachedOnly:true});assert.equal(table.get('day').values.pages,0);assert.equal((await storage.list())[0].batch.id,batch);
  await table.sync();assert.equal(remote.stats().writes,1);assert.equal(table.pending(),0);client.dispose();storage.close();
});
test('IndexedDB lease fallback coordinates two independent adapters when Web Locks are unavailable', async () => {
  const name=crypto.randomUUID(), a=createIndexedDBStorage(name),b=createIndexedDBStorage(name),events=[];
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const first=a.withLock('file',async()=>{events.push('a');await gate;events.push('a done');});
  await new Promise(resolve=>setTimeout(resolve,10));
  const second=b.withLock('file',async()=>{events.push('b');});
  await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(events,['a']);release();await Promise.all([first,second]);assert.deepEqual(events,['a','a done','b']);a.close();b.close();
});
test('local transactions fail atomically and the previous record remains readable', async () => {
  const storage=createIndexedDBStorage(crypto.randomUUID()),remote=createMemoryRemote(),client=createSheetbase({accountId:'alice',storage,remote,autoSync:false}),table=client.table(definition);
  await table.open({create:true});await table.set('day',{pages:2});
  await assert.rejects(storage.update(table.key,()=>{throw new Error('Failed transaction');}),/Failed transaction/);
  assert.equal((await table.export()).operations.length,1);assert.equal(table.get('day').values.pages,2);client.dispose();storage.close();
});
