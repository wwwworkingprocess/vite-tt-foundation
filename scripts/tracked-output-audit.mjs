import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { stdout } = await promisify(execFile)('git', ['ls-files']);
const generated = stdout
  .split(/\r?\n/)
  .filter((file) =>
    /(^|\/)(?:node_modules|dist|coverage|\.vite|screenshots|videos)(\/|$)|\.tsbuildinfo$/.test(
      file,
    ),
  );
if (generated.length)
  throw new Error(`Generated output is tracked: ${generated.join(', ')}`);
console.log('Git tracked-output audit passed.');
