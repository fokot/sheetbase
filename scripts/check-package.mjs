import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sheetbase-package-'));
const env={...process.env,npm_config_cache:path.join(temporary,'cache')};
try {
  const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',temporary],{cwd:root,encoding:'utf8',env}))[0];
  const files=packed.files.map(file=>file.path);
  if(!files.includes('dist/index.js')||!files.includes('dist/index.d.ts'))throw new Error('Compiled exports are missing.');
  if(files.some(file=>/^(assets|_site|\.github|node_modules)\//.test(file)))throw new Error('Documentation or build files leaked into the library package.');
  const consumer=path.join(temporary,'consumer'); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'sheetbase-consumer-test',private:true,type:'module'}));
  execFileSync('npm',['install','--ignore-scripts','--offline','--no-audit','--no-fund',path.join(temporary,packed.filename)],{cwd:consumer,stdio:'pipe',env});
  const installed=JSON.parse(fs.readFileSync(path.join(consumer,'node_modules/@fokot/sheetbase/package.json'),'utf8'));
  for(const hook of ['build','prepare','prepack','preinstall','install','postinstall'])if(installed.scripts?.[hook])throw new Error(`Unexpected installation/build hook: ${hook}`);
  execFileSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict'; import {createSheetbase,createMemoryStorage,createMemoryRemote,column} from '@fokot/sheetbase'; const db=createSheetbase({accountId:'smoke',storage:createMemoryStorage(),remote:createMemoryRemote(),autoSync:false}); const table=db.table({spreadsheetId:'smoke',sheet:'Journal',keyColumn:'Date',columns:{pages:column.number('Pages')}}); await table.open({create:true}); await table.set('2026-10-28',{pages:0}); assert.equal(table.get('2026-10-28').values.pages,0); await table.sync(); assert.equal(table.snapshot().pending,0); db.dispose();`],{cwd:consumer,stdio:'pipe',env});
  console.log(`Package installation/import/sync smoke test passed (${packed.filename}).`);
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
