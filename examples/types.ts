import {createSheetbase,createMemoryStorage,createMemoryRemote,column} from '../dist/index.js';
const db=createSheetbase({accountId:'example',storage:createMemoryStorage(),remote:createMemoryRemote(),autoSync:false});
const journal=db.table({spreadsheetId:'file',sheet:'Journal',keyColumn:'Date',columns:{pages:column.number('Pages'),walk:column.boolean('Walk')}});
async function example(){
 await journal.open({create:true});
 await journal.set('day',{pages:0,walk:false});
 await journal.set('day',{pages:null});
 const row=journal.get('day');const pages:number|null|undefined=row?.values.pages;
 console.log(pages);
 // @ts-expect-error Numeric columns reject text at compile time.
 await journal.set('day',{pages:'wrong'});
 // @ts-expect-error Unknown fields are not part of the table schema.
 await journal.set('day',{unknown:true});
}
void example; // Type-check only; no network or storage activity.
