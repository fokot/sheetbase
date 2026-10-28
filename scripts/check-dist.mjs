import {execFileSync} from 'node:child_process';
const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'dist'], {encoding:'utf8'}).trim();
if (changed) throw new Error('Committed dist/ does not match source. Run npm run build:lib and commit dist/.\n' + changed);
console.log('Committed dist/ matches the current build.');
