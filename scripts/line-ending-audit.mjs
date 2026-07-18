import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root =
  process.env.FOUNDATION_AUDIT_ROOT ??
  fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  'screenshots',
  'videos',
]);
const walk = async (directory = '') => {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
};
const attributes = await readFile(join(root, '.gitattributes'), 'utf8');
for (const policy of [
  '* text=auto eol=lf',
  'yarn.lock text eol=lf',
  '*.png binary',
])
  if (!attributes.includes(policy))
    throw new Error(`Missing line-ending policy: ${policy}`);
const violations = [];
for (const file of await walk()) {
  const bytes = await readFile(join(root, file));
  if (bytes.includes(0)) continue;
  if (bytes.includes(13)) violations.push(file);
}
if (violations.length)
  throw new Error(`Text files contain CR bytes: ${violations.join(', ')}`);
console.log('Portable LF line-ending audit passed.');
