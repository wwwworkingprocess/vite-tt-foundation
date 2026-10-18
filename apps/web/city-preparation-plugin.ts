import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
/** One Rollup graph shares pure modules with the module Worker; no duplicated dependency bundle. */
export function cityPreparationPlugin(base: string): Plugin {
  const id = 'virtual:city-preparation-worker-url',
    internal = '\0' + id;
  let serve = false;
  return {
    name: 'city-preparation-worker',
    configResolved(config) {
      serve = config.command === 'serve';
    },
    resolveId(source) {
      return source === id ? internal : undefined;
    },
    load(source) {
      if (source !== internal) return undefined;
      if (serve)
        return `export default ${JSON.stringify(base + 'src/city-preparation/city-preparation.worker.ts')};`;
      const ref = this.emitFile({
        type: 'chunk',
        id: fileURLToPath(
          new URL(
            './src/city-preparation/city-preparation.worker.ts',
            import.meta.url,
          ),
        ),
        name: 'city-preparation.worker',
      });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}
