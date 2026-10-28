import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=fs.readdirSync(path.join(root,'src')).filter(name=>name.endsWith('.ts'));
const modules=source.map(name=>{
 const content=fs.readFileSync(path.join(root,'src',name),'utf8');
 const compiled=ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 return `${JSON.stringify(name.replace(/\.ts$/,''))}:function(require,module,exports){\n${compiled}\n}`;
}).join(',\n');
const site=fs.readFileSync(path.join(root,'assets/site.js'),'utf8').replace(/^import .*?;\n/gm,'');
const clipboard=fs.readFileSync(path.join(root,'assets/clipboard.js'),'utf8').replace('export async function','async function');
const navigation=fs.readFileSync(path.join(root,'assets/navigation.js'),'utf8').replace(/^import .*?;\n/gm,'');
const codeExamples=fs.readFileSync(path.join(root,'_site/assets/code-examples.js'),'utf8').replace('export const examples=','const allExamples=');
const javascript=`(()=>{${clipboard}\n${navigation}})();(()=>{const modules={${modules}};const cache={};function require(name){const id=name.replace(/^\\.\\//,'').replace(/\\.js$/,'');if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;if(!modules[id])throw new Error('Missing bundled module '+id);modules[id](require,module,module.exports);return module.exports;}const {createSheetbase,createIndexedDBStorage,createMemoryRemote,column}=require('./index.js');(async()=>{${clipboard}\n${codeExamples}\n${site}})().catch(console.error);})();`;
const css=fs.readFileSync(path.join(root,'assets/site.css'),'utf8'),mark=Buffer.from(fs.readFileSync(path.join(root,'assets/mark.svg'))).toString('base64');
const html=fs.readFileSync(path.join(root,'_site/index.html'),'utf8')
 .replace('<link rel="stylesheet" href="assets/site.css">',`<style>${css}</style>`)
 .replaceAll('assets/mark.svg',`data:image/svg+xml;base64,${mark}`)
 .replace('<script type="module" src="assets/navigation.js"></script>','')
 .replace('<script type="module" src="assets/site.js"></script>',`<script>${javascript.replace(/<\/script/gi,'<\\/script')}</script>`);
fs.writeFileSync(path.join(root,'preview.html'),html);
fs.writeFileSync(path.join(root,'_site/preview.html'),html);
console.log('Standalone preview.html built (no external assets).');
