import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const expectedNode = (
  await readFile(new URL('../.node-version', import.meta.url), 'utf8')
).trim();
const expectedYarn = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).packageManager.replace('yarn@', '');
const actualNode = process.versions.node;
const userAgent = process.env.npm_config_user_agent ?? '';
const yarnFromUserAgent = /yarn\/([^\s]+)/.exec(userAgent)?.[1];
const actualYarn =
  yarnFromUserAgent ??
  (process.platform === 'win32'
    ? execFileSync(
        process.env.ComSpec,
        ['/d', '/s', '/c', 'corepack yarn --version'],
        { encoding: 'utf8' },
      ).trim()
    : execFileSync('corepack', ['yarn', '--version'], {
        encoding: 'utf8',
      }).trim());
if (actualNode !== expectedNode || actualYarn !== expectedYarn) {
  throw new Error(
    `Pinned runtime required: Node ${expectedNode} and Yarn ${expectedYarn}; received Node ${actualNode} and Yarn ${actualYarn}.`,
  );
}
console.log(
  `Pinned runtime confirmed: Node ${actualNode}, Yarn ${actualYarn}.`,
);
