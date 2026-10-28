import http from 'node:http';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../_site',import.meta.url))),port=Number(process.env.PORT??4188);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.ts':'text/plain; charset=utf-8','.mjs':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
 try{const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname),file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname)),relative=path.relative(root,file);
 if(relative.startsWith('..')||path.isAbsolute(relative)||relative.split(path.sep).some(part=>part.startsWith('.')||part==='node_modules')||!['GET','HEAD'].includes(req.method)){res.writeHead(403);res.end('Forbidden');return;}
 const stat=fs.statSync(file);if(!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
 res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');let script="'self'",style="'self'";
 if(path.basename(file)==='preview.html'){const html=fs.readFileSync(file,'utf8');const hash=value=>createHash('sha256').update(value).digest('base64');script+=` 'sha256-${hash(html.match(/<script>([\s\S]*?)<\/script>/)?.[1]??'')}'`;style+=` 'sha256-${hash(html.match(/<style>([\s\S]*?)<\/style>/)?.[1]??'')}'`;}
 res.setHeader('Content-Security-Policy',`default-src 'self'; style-src ${style}; script-src ${script}; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'`);
 if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Sheetbase local docs: http://127.0.0.1:${port}/`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
