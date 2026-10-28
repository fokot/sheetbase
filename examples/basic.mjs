// Runs without credentials or external services: node examples/basic.mjs
import assert from 'node:assert/strict';
import {createSheetbase,createMemoryStorage,createMemoryRemote,column} from '../dist/index.js';
const storage=createMemoryStorage(),remote=createMemoryRemote();
const db=createSheetbase({accountId:'example-user',storage,remote,autoSync:false});
const journal=db.table({spreadsheetId:'example-file',sheet:'Journal',keyColumn:'Date',columns:{walk:column.boolean('Walk'),pages:column.number('Pages')}});
await journal.open({create:true});
db.setOnline(false);
await journal.set('2026-10-27',{pages:24});
await journal.set('2026-10-27',{pages:25,walk:true});
assert.equal(journal.snapshot().pending,1);
console.log('Offline, durable in this storage instance:',journal.get('2026-10-27'));
db.setOnline(true);remote.loseNextResponse();
try{await journal.sync();}catch(error){console.log('Simulated lost acknowledgement:',error.message);}
assert.equal(journal.snapshot().pending,1);
await journal.sync();assert.equal(remote.stats().writes,1);assert.equal(journal.snapshot().pending,0);
console.log('Synchronized once:',remote.inspect(journal.target));
db.dispose();storage.close();
