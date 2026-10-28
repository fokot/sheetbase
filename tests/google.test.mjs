import test from 'node:test';
import assert from 'node:assert/strict';
import {googleFixture} from './google-fixture.mjs';

test('Google adapter writes only managed cells and creates an atomic hidden receipt',async()=>{
 const env=await googleFixture();await env.table.set('2026-10-27',{pages:7,walk:false});await env.table.sync();
 assert.deepEqual(env.rows[1],['2026-10-27','FALSE','7','hello','keep']);const receipt=env.sheets.find(sheet=>sheet.properties.title==='_Sheetbase');assert.equal(receipt.properties.hidden,true);assert.equal(receipt.rows[0][0],'Batch');assert.equal(receipt.rows.length,2);
 assert.ok(env.calls.every(call=>call.authorization==='Bearer token-a'));env.client.dispose();
});
test('fresh date indexes survive row insertion, while new rows preserve trailing notes',async()=>{
 const env=await googleFixture();env.rows.splice(1,0,['2026-10-26','','9','earlier','keep']);env.rows.push(['','orphan note']);
 await env.table.set('2026-10-27',{pages:8});await env.table.set('2026-10-28',{pages:2,note:'new'});await env.table.sync();
 assert.equal(env.rows[2][2],'8');assert.deepEqual(env.rows[3],['','orphan note']);assert.deepEqual(env.rows[4],['2026-10-28','','2','new']);env.client.dispose();
});
test('lost Google responses retry via their receipt without a second append',async()=>{
 const env=await googleFixture();await env.table.set('2026-10-28',{pages:4});env.loseReply();await assert.rejects(env.table.sync(),/Cannot reach Google/);await env.table.sync();
 assert.equal(env.rows.filter(row=>row[0]==='2026-10-28').length,1);assert.equal(env.calls.filter(call=>call.body).length,1);env.client.dispose();
});
test('a transient failed Google batch preserves data and can be retried',async()=>{
 const env=await googleFixture();await env.table.set('2026-10-27',{pages:8});env.failNextWrite();await assert.rejects(env.table.sync(),/Busy/);assert.equal(env.rows[1][2],'0');assert.equal(env.table.snapshot().pending,1);
 await env.table.sync();assert.equal(env.rows[1][2],'8');env.client.dispose();
});
test('a changed Google account cannot upload or acknowledge an earlier account queue',async()=>{
 const env=await googleFixture();await env.table.set('day',{pages:5});env.switchAccount();await assert.rejects(env.table.sync(),/verified Google account/);assert.equal(env.calls.filter(call=>call.body).length,0);assert.equal(env.table.snapshot().pending,1);assert.equal(env.table.snapshot().phase,'auth-required');env.client.dispose();
});
test('an account change while reading an index blocks the subsequent Google write',async()=>{
 const env=await googleFixture();await env.table.set('day',{pages:5});env.switchDuringRequest();await assert.rejects(env.table.sync(),/Authorization changed/);assert.equal(env.calls.filter(call=>call.body).length,0);env.client.dispose();
});
test('renamed managed columns and duplicate row keys stop writes without losing the queue',async()=>{
 const renamed=await googleFixture();renamed.rows[0][2]='Renamed';await renamed.table.set('day',{pages:5});await assert.rejects(renamed.table.sync(),/Missing column/);assert.equal(renamed.table.snapshot().pending,1);assert.equal(renamed.calls.filter(call=>call.body).length,0);renamed.client.dispose();
 const duplicate=await googleFixture();duplicate.rows.push([...duplicate.rows[1]]);await duplicate.table.set('day',{pages:5});await assert.rejects(duplicate.table.sync(),/Duplicate row key/);assert.equal(duplicate.calls.filter(call=>call.body).length,0);duplicate.client.dispose();
});
test('sheet names containing apostrophes are escaped as A1 ranges',async()=>{
 const env=await googleFixture({name:"Fero's log"});await env.table.set('day',{pages:1});await env.table.sync();assert.ok(env.calls.some(call=>new URL(call.url).searchParams.getAll('ranges').includes("'Fero''s log'!A2:A")));env.client.dispose();
});
test('normal writes read only header/key indexes, not historical values',async t=>{
 const rows=[['Date','Walk','Pages','Note','Unmanaged'],...Array.from({length:1000},(_,i)=>[`key-${i}`,'✓','7','hello','keep'])];const env=await googleFixture({rows});const before=env.cellsRead;
 await env.table.set('key-50',{pages:10});await env.table.sync();const read=env.cellsRead-before;assert.ok(read<before*0.25);assert.equal(env.rows[51][2],'10');t.diagnostic(`Google fixture: ${before} cells on full read; ${read} cells for a value sync.`);env.client.dispose();
});
test('initialization adds only a missing tab and never overwrites an incompatible non-empty one',async()=>{
 const env=await googleFixture();const definition={spreadsheetId:'test-file',keyColumn:'Date',columns:env.table.definition.columns};
 const newTable=env.client.table({...definition,sheet:'New table'});await newTable.open({create:true});assert.equal(newTable.all().length,0);assert.deepEqual(env.rows[1],['2026-10-27','✓','0','hello','keep']);
 const newTab=env.sheets.find(sheet=>sheet.properties.title==='New table');assert.deepEqual(newTab.rows[0],['Date','Walk','Pages','Note']);
 env.sheets.push({properties:{sheetId:99,title:'Unrelated',gridProperties:{rowCount:100,columnCount:10}},rows:[['Other data']]});
 const unsafe=env.client.table({...definition,sheet:'Unrelated'});await assert.rejects(unsafe.open({create:true}),/Column A/);assert.deepEqual(env.sheets.find(sheet=>sheet.properties.title==='Unrelated').rows,[['Other data']]);env.client.dispose();
});
test('Google delete clears managed values and leaves the key and unmanaged cell intact',async()=>{
 const env=await googleFixture();await env.table.delete('2026-10-27');await env.table.sync();assert.deepEqual(env.rows[1],['2026-10-27','','','','keep']);await env.table.refresh();assert.equal(env.table.get('2026-10-27'),undefined);env.client.dispose();
});
