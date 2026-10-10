import { zipFixture } from '../test/zip-fixture.js';
import { expect, it } from 'vitest';
import { indexZip, readZipEntry } from './zip-layer.js';

it.each([0, 8])(
  'preserves exact stored/deflated bytes with method %i',
  async (method) => {
    const zip = indexZip(
      zipFixture(
        'nested/data.json',
        '{"native":[-1,null,1.234567890123]}',
        method,
      ),
    );
    expect([...zip.keys()]).toEqual(['nested/data.json']);
    expect(
      new TextDecoder().decode(
        await readZipEntry(zip.get('nested/data.json')!),
      ),
    ).toBe('{"native":[-1,null,1.234567890123]}');
  },
);

it('rejects unsafe paths and corrupt containers before inflation', () => {
  for (const name of ['../data', '/data', 'a/../data', 'a\\data', ''])
    expect(() => indexZip(zipFixture(name))).toThrow();
  expect(() => indexZip(new Uint8Array())).toThrow();
  const bytes = zipFixture();
  bytes[0] = 0;
  expect(() => indexZip(bytes)).toThrow();
});

it('rejects entry integrity corruption', async () => {
  const bytes = zipFixture('data', 'unchanged', 0);
  bytes[34] = 0;
  await expect(readZipEntry(indexZip(bytes).get('data')!)).rejects.toThrow(
    'integrity',
  );
});

it('rejects malformed headers, unsupported methods, disks, ZIP64 and excessive declared sizes', () => {
  const mutate = (
    where: 'end' | 'central' | 'local',
    offset: number,
    value: number,
    width = 2,
  ) => {
    const bytes = zipFixture();
    const end = bytes.length - 22;
    const start =
      where === 'end'
        ? end
        : where === 'central'
          ? bytes.readUInt32LE(end + 16)
          : 0;
    if (width === 4) bytes.writeUInt32LE(value, start + offset);
    else bytes.writeUInt16LE(value, start + offset);
    return bytes;
  };
  for (const [where, offset, value, width] of [
    ['end', 4, 1, 2],
    ['end', 6, 1, 2],
    ['end', 8, 2, 2],
    ['end', 8, 65535, 2],
    ['end', 12, 0, 4],
    ['end', 20, 1, 2],
    ['central', 0, 0, 4],
    ['central', 8, 1, 2],
    ['central', 10, 12, 2],
    ['central', 24, 128 * 1024 * 1024 + 1, 4],
    ['central', 34, 1, 2],
    ['central', 28, 65535, 2],
    ['central', 42, 0xffffffff, 4],
    ['central', 20, 0xffffffff, 4],
    ['local', 6, 1, 2],
    ['local', 8, 0, 2],
    ['local', 26, 0, 2],
  ] as const)
    expect(() => indexZip(mutate(where, offset, value, width))).toThrow();
  const sentinel = mutate('end', 8, 65535);
  sentinel.writeUInt16LE(65535, sentinel.length - 12);
  expect(() => indexZip(sentinel)).toThrow();
  const unmatched = zipFixture();
  unmatched[30] = 0;
  expect(() => indexZip(unmatched)).toThrow();
  for (const name of ['x:y', 'x\u0000y', './data'])
    expect(() => indexZip(zipFixture(name))).toThrow();
  expect(() => indexZip(new Uint8Array(64 * 1024 * 1024 + 1))).toThrow();
  const empty = Buffer.alloc(22);
  empty.writeUInt32LE(0x06054b50);
  expect(indexZip(empty).size).toBe(0);
  const unused = zipFixture();
  unused.writeUInt16LE(0, unused.length - 14);
  unused.writeUInt16LE(0, unused.length - 12);
  expect(() => indexZip(unused)).toThrow();
});

function joinZips(names: readonly string[], declaredSize = 0) {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const bytes = zipFixture(name, '', 0);
    const start = bytes.readUInt32LE(bytes.length - 6);
    const central = Buffer.from(bytes.subarray(start, bytes.length - 22));
    central.writeUInt32LE(offset, 42);
    central.writeUInt32LE(declaredSize, 24);
    centrals.push(central);
    locals.push(bytes.subarray(0, start));
    offset += start;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(
    centrals.reduce((n, b) => n + b.length, 0),
    12,
  );
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
it('accepts bounded large-entry and aggregate metadata without inflating entries', () => {
  const entryLimit = 128 * 1024 * 1024;
  expect(
    indexZip(joinZips(['height.json'], entryLimit)).get('height.json')
      ?.byteLength,
  ).toBe(entryLimit);
  // Six-city products total about 328 MiB; indexing retains compressed slices.
  expect(
    indexZip(joinZips(['a', 'b', 'c', 'd', 'e', 'f'], 64 * 1024 * 1024)).size,
  ).toBe(6);
});
it('rejects duplicate paths and aggregate inflation budgets', () => {
  expect(() => indexZip(joinZips(['same', 'same']))).toThrow();
  expect(() =>
    indexZip(joinZips(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 64 * 1024 * 1024)),
  ).toThrow();
});
it('bounds streamed inflation and rejects truncated declared output', async () => {
  const entry = indexZip(zipFixture()).get('catalog.json')!;
  await expect(readZipEntry({ ...entry, byteLength: 1 })).rejects.toThrow(
    'declared size',
  );
  await expect(
    readZipEntry({ ...entry, byteLength: entry.byteLength + 1 }),
  ).rejects.toThrow('integrity');
});
