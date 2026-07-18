import { readFile } from 'node:fs/promises';
const expectedNode = (
  await readFile(new URL('../.node-version', import.meta.url), 'utf8')
).trim();
const expectedYarn = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).packageManager.replace('yarn@', '');
const actualNode = process.versions.node;
const userAgent = process.env.npm_config_user_agent ?? '';
const actualYarn = /yarn\/([^\s]+)/.exec(userAgent)?.[1];
if (actualNode !== expectedNode || actualYarn !== expectedYarn) {
  throw new Error(
    `Pinned runtime required: Node ${expectedNode} and Yarn ${expectedYarn}; received Node ${actualNode} and Yarn ${actualYarn ?? 'unknown'}.`,
  );
}
console.log(
  `Pinned runtime confirmed: Node ${actualNode}, Yarn ${actualYarn}.`,
);
