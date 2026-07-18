import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const base = '/torrevieja-tycoon/';
const options = {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, VITE_BASE_PATH: base },
  stdio: 'inherit',
};
const command =
  process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec,
        ['/d', '/s', '/c', 'corepack yarn build'],
        options,
      )
    : spawnSync('corepack', ['yarn', 'build'], options);
if (command.status !== 0) process.exit(command.status ?? 1);
const manifest = JSON.parse(
  await readFile(
    new URL('../apps/web/dist/manifest.webmanifest', import.meta.url),
    'utf8',
  ),
);
if (manifest.start_url !== base || manifest.scope !== base)
  throw new Error(
    `Non-root manifest paths are invalid: ${JSON.stringify({ start_url: manifest.start_url, scope: manifest.scope })}`,
  );
for (const size of [192, 512])
  if (
    !manifest.icons.some(
      (icon) => icon.src === `${base}icons/foundation-${size}.png`,
    )
  )
    throw new Error(`Non-root icon URL is missing for ${size}.`);
const html = await readFile(
  new URL('../apps/web/dist/index.html', import.meta.url),
  'utf8',
);
if (
  !html.includes(`${base}assets/index-`) ||
  !html.includes(`${base}registerSW.js`)
)
  throw new Error(
    'Application or service-worker registration URL is not base-aware.',
  );
console.log('Non-root production build audit passed.');
