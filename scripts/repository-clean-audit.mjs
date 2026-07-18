import { spawnSync } from 'node:child_process';

const run = (args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout;
};
run(['diff', '--check']);
run(['diff', '--exit-code']);
const status = run(['status', '--porcelain']);
if (status) throw new Error(`Repository is not clean:\n${status}`);
console.log('Repository clean-tree audit passed.');
