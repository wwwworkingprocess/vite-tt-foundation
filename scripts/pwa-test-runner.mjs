import { spawnSync } from 'node:child_process';

const base = process.argv[2] ?? '/';
const env = { ...process.env, VITE_BASE_PATH: base, PWA_BASE_PATH: base };
for (const args of [
  ['yarn', 'build'],
  ['yarn', 'test:pwa:run'],
]) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          process.env.ComSpec,
          ['/d', '/s', '/c', `corepack ${args.join(' ')}`],
          {
            env,
            stdio: 'inherit',
          },
        )
      : spawnSync('corepack', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
