import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(
  await readFile(resolve(root, 'torrevieja-project.json'), 'utf8'),
);
const loadCoverage = async (coverageCandidates) => {
  let coverage;
  for (const candidate of coverageCandidates) {
    try {
      coverage = JSON.parse(await readFile(resolve(root, candidate), 'utf8'));
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
  }
  if (!coverage)
    throw new Error(
      `Critical coverage audit requires one of: ${coverageCandidates.join(', ')}`,
    );
  return coverage;
};
const normalize = (value) => value.replaceAll('\\', '/').split(sep).join('/');
if (normalize('mixed\\separator/path.ts') !== 'mixed/separator/path.ts')
  throw new Error('Critical coverage path normalization is not portable.');
const percent = (covered, total) =>
  total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2));
const count = (values) => {
  const entries = Object.values(values);
  return percent(entries.filter((value) => value > 0).length, entries.length);
};
const branchCount = (values) => {
  const entries = Object.values(values).flat();
  return percent(entries.filter((value) => value > 0).length, entries.length);
};
const lineCount = (entry) => {
  const lines = new Map();
  for (const [statementId, location] of Object.entries(entry.statementMap)) {
    const line = location.start.line;
    lines.set(line, Math.max(lines.get(line) ?? 0, entry.s[statementId]));
  }
  return count(Object.fromEntries(lines));
};
const failures = [];
const results = {};
const auditGroup = async (configuration, candidates) => {
  const coverage = await loadCoverage(candidates);
  for (const relative of configuration.files) {
    const absolute = normalize(resolve(root, relative));
    const entry = Object.entries(coverage).find(
      ([path]) => normalize(path) === absolute,
    )?.[1];
    if (!entry) {
      failures.push(`${relative}: missing from coverage`);
      continue;
    }
    const metrics = {
      statements: count(entry.s),
      lines: lineCount(entry),
      functions: count(entry.f),
      branches: branchCount(entry.b),
    };
    results[relative] = metrics;
    for (const metric of ['statements', 'lines', 'functions', 'branches'])
      if (metrics[metric] < configuration[metric])
        failures.push(
          `${relative} ${metric}: ${metrics[metric]} < ${configuration[metric]}`,
        );
  }
};
await auditGroup(manifest.criticalCoverage, [
  'coverage/web-simulation-host/coverage-final.json',
  'coverage/coverage-final.json',
]);
await auditGroup(manifest.simulationCriticalCoverage, [
  'coverage/simulation/coverage-final.json',
]);
if (failures.length)
  throw new Error(`Critical coverage audit failed:\n${failures.join('\n')}`);
console.log(`Critical coverage audit passed: ${JSON.stringify(results)}`);
