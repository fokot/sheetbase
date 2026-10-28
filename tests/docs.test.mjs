import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = path.join(root, '_site');
const read = file => fs.readFileSync(path.join(site, file), 'utf8');
function htmlFiles(directory = site) {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(file) : entry.name.endsWith('.html') ? [file] : [];
  });
}
test('landing and README pages are available in both languages', () => {
  for (const [file, lang] of [['sk/index.html','sk'],['en/index.html','en'],['sk/readme.html','sk'],['en/readme.html','en']]) {
    const html=read(file);
    assert.match(html, new RegExp(`<html lang="${lang}"`));
    assert.match(html, /data-language-switch/);
    assert.match(html, /class="language-switch"/);
  }
  assert.match(read('en/index.html'), /Your Sheet\./);
  assert.match(read('en/readme.html'), /Install from GitHub/);
  assert.match(read('sk/readme.html'), /Inštalácia/);
});
test('every generated local asset and page link resolves under a project Pages path', () => {
  const missing=[];
  for (const file of htmlFiles()) {
    for (const match of fs.readFileSync(file,'utf8').matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      const href=match[1].split('#')[0];
      if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue;
      assert.ok(!href.startsWith('/'), `${file}: absolute path breaks project hosting: ${href}`);
      let target=path.resolve(path.dirname(file),decodeURIComponent(href));
      assert.ok(!path.relative(site,target).startsWith('..'),`${href} leaves the deployed directory`);
      if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
      if(!fs.existsSync(target))missing.push(`${path.relative(site,file)} → ${href}`);
    }
  }
  assert.deepEqual(missing,[]);
});
test('README code is highlighted and copyable in both languages', () => {
  for (const file of ['sk/readme.html','en/readme.html']) {
    const html=read(file);
    assert.match(html,/class="hljs language-ts"/);
    assert.match(html,/class="hljs-keyword"/);
    assert.match(html,/class="hljs-string"/);
    assert.match(html,/data-copy-code/);
    assert.ok(!html.includes('<pre><code>import '));
  }
});
test('all interactive code examples retain highlighting in both languages', async () => {
  const generated=await import('../_site/assets/code-examples.js');
  for(const language of ['sk','en'])for(const name of ['connect','offline','workouts']) {
    const example=generated.examples[language][name];
    assert.match(example.html,/hljs-/);
    assert.ok(example.raw.length>100);
    assert.ok(!example.raw.includes('<span'));
  }
});
test('API, architecture, testing and Google setup have translated HTML routes', () => {
  for(const name of ['API','ARCHITECTURE','TESTING','GOOGLE-SETUP']) {
    assert.match(read(`sk/docs/${name}.html`),/<html lang="sk"/);
    assert.match(read(`en/docs/${name}.html`),/<html lang="en"/);
    assert.match(read(`en/docs/${name}.html`),/data-language-switch/);
  }
});
test('browser documentation has no CDN scripts or live Google integration', () => {
  for(const file of htmlFiles()) {
    const html=fs.readFileSync(file,'utf8');
    assert.ok(!/<script[^>]+src="https?:/i.test(html));
    assert.ok(!/<link[^>]+href="https?:[^>]+rel="stylesheet"/i.test(html));
  }
  const script=read('assets/site.js');
  assert.match(script,/createMemoryRemote/);
  assert.ok(!script.includes('createGoogleSheetsRemote('));
});
test('GitHub installation consumes dist without build lifecycle hooks', () => {
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.name,'@fokot/sheetbase');
  assert.equal(pkg.exports['.'].import,'./dist/index.js');
  assert.equal(pkg.exports['.'].types,'./dist/index.d.ts');
  assert.equal(pkg.private,true);
  assert.deepEqual(pkg.dependencies??{},{});
  for(const hook of ['build','prepare','prepack','preinstall','install','postinstall'])assert.equal(pkg.scripts[hook],undefined);
});

function chooseLanguage({browser, languages, saved, blocked=false, pathname='/sheetbase/'} = {}) {
  let redirected;
  const location={href:`https://example.test${pathname}?ref=docs#api`,search:'?ref=docs',hash:'#api',replace:url=>{redirected=url;}};
  vm.runInNewContext(read('assets/language.js'), {
    navigator:{language:browser, languages},
    localStorage:{getItem:()=>{if(blocked)throw new Error('Storage blocked');return saved;}},
    document:{querySelector:selector=>({href:`https://example.test/sheetbase/${selector.includes('"sk"')?'sk':'en'}/`})},
    location,URL
  });
  return redirected;
}
test('automatic entry selects Slovak only for the primary Slovak browser language', () => {
  for(const browser of ['sk','sk-SK','SK-sk'])assert.match(chooseLanguage({browser}),/\/sk\/\?ref=docs#api$/);
  for(const browser of ['en-US','cs-CZ','de-DE','fr',undefined])assert.match(chooseLanguage({browser}),/\/en\/\?ref=docs#api$/);
  assert.match(chooseLanguage({browser:'en',languages:['sk-SK','en']}),/\/sk\//);
  assert.match(chooseLanguage({browser:'sk',languages:['en-US','sk-SK']}),/\/en\//);
});
test('an explicit language choice wins and denied storage does not break routing', () => {
  assert.match(chooseLanguage({browser:'en-US',saved:'sk'}),/\/sk\//);
  assert.match(chooseLanguage({browser:'sk-SK',saved:'en'}),/\/en\//);
  assert.match(chooseLanguage({browser:'sk-SK',saved:'invalid'}),/\/sk\//);
  assert.match(chooseLanguage({browser:'en-US',blocked:true}),/\/en\//);
  assert.match(chooseLanguage({browser:'sk-SK',blocked:true}),/\/sk\//);
});
test('neutral entry pages default to English; explicit language routes never auto-redirect', () => {
  for(const file of ['index.html','readme.html','docs/API.html']) {
    const html=read(file);
    assert.match(html,/<html lang="en"/);
    assert.match(html,/hreflang="sk"/);
    assert.ok(html.indexOf('assets/language.js')<html.indexOf('rel="stylesheet"'));
  }
  for(const language of ['en','sk'])for(const file of ['index.html','readme.html','docs/API.html']) {
    assert.ok(!read(`${language}/${file}`).includes('assets/language.js'));
  }
});
