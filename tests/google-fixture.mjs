import {createGoogleSheetsRemote,createSheetbase,createMemoryStorage,column} from '../dist/index.js';
export async function googleFixture({rows=[['Date','Walk','Pages','Note','Unmanaged'],['2026-10-27','✓','0','hello','keep']],name='Journal',remoteOptions={}}={}) {
 let sheets=[{properties:{sheetId:0,title:name,gridProperties:{rowCount:1000,columnCount:26}},rows:structuredClone(rows)}],credentials={accountId:'alice',accessToken:'token-a'},lost=false,failed=false,mutateAuth=false;
 const calls=[];let cellsRead=0;
 const col=text=>[...text].reduce((value,char)=>value*26+char.charCodeAt(0)-64,0)-1;
 const result=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 const fetch=async(url,options)=>{
  const parsed=new URL(url),body=options.body?JSON.parse(options.body):null;calls.push({url,body,authorization:options.headers.Authorization});
  if(mutateAuth){credentials={accountId:'bob',accessToken:'token-b'};mutateAuth=false;}
  if(body){
   if(failed){failed=false;return new Response(JSON.stringify({error:{message:'Busy'}}),{status:503});}
   const copy=structuredClone(sheets);
   for(const request of body.requests){
    if(request.addSheet){copy.push({properties:request.addSheet.properties,rows:[]});continue;}
    const id=request.updateCells?.start.sheetId??request.appendCells?.sheetId??request.appendDimension?.sheetId??request.deleteDimension?.range.sheetId,target=copy.find(sheet=>sheet.properties.sheetId===id);
    if(!target)throw new Error('No target tab');
    if(request.deleteDimension){const {dimension,startIndex,endIndex}=request.deleteDimension.range;if(dimension==='COLUMNS'){for(const row of target.rows)row.splice(startIndex,endIndex-startIndex);}else target.rows.splice(startIndex,endIndex-startIndex);target.properties.gridProperties[dimension==='COLUMNS'?'columnCount':'rowCount']-=endIndex-startIndex;continue;}
    if(request.appendDimension){target.properties.gridProperties[request.appendDimension.dimension==='ROWS'?'rowCount':'columnCount']+=request.appendDimension.length;continue;}
    const update=request.updateCells??request.appendCells,values=update.rows.map(row=>row.values.map(cell=>cell.userEnteredValue.stringValue));
    const start=request.updateCells?.start??{rowIndex:target.rows.length,columnIndex:0};
    for(const[i,row]of values.entries()){target.rows[start.rowIndex+i]??=[];for(const[j,value]of row.entries())target.rows[start.rowIndex+i][start.columnIndex+j]=value;}
   }
   sheets=copy;if(lost){lost=false;throw new TypeError('Lost after commit');}return result({});
  }
  const ranges=parsed.searchParams.getAll('ranges');if(!ranges.length)return result({sheets:sheets.map(({properties})=>({properties}))});
  const response=[];
  for(const sheet of sheets){const data=[];
   for(const range of ranges){
    const match=range.match(/^'((?:[^']|'')*)'(?:!(.*))?$/);if(!match)throw new Error('Unquoted fixture range');if(match[1].replaceAll("''", "'")!==sheet.properties.title)continue;
    const selection=match[2];let startRow=0,startColumn=0,endRow=sheet.rows.length,endColumn=Infinity;
    if(selection==='1:1')endRow=Math.min(endRow,1);
    else if(selection){const coords=selection.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);if(!coords)throw new Error('Unsupported fixture range '+range);startColumn=col(coords[1]);endColumn=col(coords[3]??coords[1])+1;startRow=coords[2]?Number(coords[2])-1:0;if(!selection.includes(':'))endRow=Math.min(endRow,startRow+1);}
    const selected=sheet.rows.slice(startRow,endRow).map(row=>Array.from({length:Math.max(0,Math.min(row.length,endColumn)-startColumn)},(_,i)=>row[startColumn+i]??''));
    while(selected.length&&!selected.at(-1).some(Boolean))selected.pop();cellsRead+=selected.reduce((n,row)=>n+row.length,0);
    data.push({startRow,startColumn,rowData:selected.map(row=>({values:row.map(stringValue=>({userEnteredValue:{stringValue}}))}))});
   }if(data.length)response.push({properties:sheet.properties,data});
  }return result({sheets:response});
 };
 const remote=createGoogleSheetsRemote({getCredentials:()=>credentials,fetch,...remoteOptions}),client=createSheetbase({accountId:'alice',storage:createMemoryStorage(),remote,autoSync:false});
 const table=client.table({spreadsheetId:'test-file',sheet:name,keyColumn:'Date',columns:{walk:column.boolean('Walk'),pages:column.number('Pages'),note:column.text('Note')}});
 await table.open();return{remote,client,table,calls,get sheets(){return sheets;},get rows(){return sheets[0].rows;},get cellsRead(){return cellsRead;},loseReply(){lost=true;},failNextWrite(){failed=true;},switchAccount(){credentials={accountId:'bob',accessToken:'token-b'};},switchDuringRequest(){mutateAuth=true;}};
}
