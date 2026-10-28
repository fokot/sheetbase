import fs from 'node:fs';
const {version} = JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const expected = `v${version}`;
if (process.env.RELEASE_TAG !== expected) throw new Error(`Release tag must be ${expected}.`);
console.log(`Release tag matches package version: ${expected}`);
