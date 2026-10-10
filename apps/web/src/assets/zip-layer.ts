/** Storage only: folder-relative ZIP entries retain their original bytes and paths. */
export interface ZipEntry {
  readonly compressed: Uint8Array;
  readonly method: number;
  readonly byteLength: number;
  readonly crc32: number;
}
const archiveLimit = 64 * 1024 * 1024;
// Six-city terrain: ~108 MiB largest entry, ~328 MiB aggregate. Entries inflate
// only on request; these limits bound declared sizes without reducing source data.
const entryLimit = 128 * 1024 * 1024;
const aggregateLimit = 384 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});
const fail = (): never => {
  throw new Error('Invalid or unsupported public layer ZIP');
};
export function indexZip(bytes: Uint8Array): ReadonlyMap<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (offset: number, count: number) => {
    if (offset + count > bytes.length) fail();
  };
  const u16 = (offset: number) => {
    check(offset, 2);
    return view.getUint16(offset, true);
  };
  const u32 = (offset: number) => {
    check(offset, 4);
    return view.getUint32(offset, true);
  };
  if (bytes.length > archiveLimit) fail();
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65535);
  while (
    end >= earliest &&
    (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)
  )
    end--;
  if (
    end < earliest ||
    u16(end + 4) !== 0 ||
    u16(end + 6) !== 0 ||
    u16(end + 8) !== u16(end + 10)
  )
    fail();
  const count = u16(end + 10);
  const centralSize = u32(end + 12);
  let cursor = u32(end + 16);
  if (count === 65535 || cursor + centralSize !== end) fail();
  const centralStart = cursor;
  const entries = new Map<string, ZipEntry>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    check(cursor, 46);
    if (u32(cursor) !== 0x02014b50) fail();
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const compressedLength = u32(cursor + 20);
    const byteLength = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const local = u32(cursor + 42);
    check(cursor + 46, nameLength + extraLength + commentLength);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    const parts = name.replace(/\/$/, '').split('/');
    total += byteLength;
    if (
      (flags & ~0x080e) !== 0 ||
      (method !== 0 && method !== 8) ||
      u16(cursor + 34) !== 0 ||
      byteLength > entryLimit ||
      total > aggregateLimit ||
      parts.some((part) => !part || part === '.' || part === '..') ||
      /[\\:]/.test(name) ||
      name.includes(String.fromCharCode(0)) ||
      entries.has(name)
    )
      fail();
    check(local, 30);
    if (
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== nameLength
    )
      fail();
    const dataStart = local + 30 + nameLength + u16(local + 28);
    if (dataStart + compressedLength > centralStart) fail();
    const localName = bytes.subarray(local + 30, local + 30 + nameLength);
    if (!nameBytes.every((byte, i) => byte === localName[i])) fail();
    entries.set(
      name,
      Object.freeze({
        compressed: bytes.subarray(dataStart, dataStart + compressedLength),
        method,
        byteLength,
        crc32: u32(cursor + 16),
      }),
    );
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) fail();
  return entries;
}
export function verifyZipEntry(entry: ZipEntry, bytes: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++)
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]!) & 255]!;
  if (
    bytes.length !== entry.byteLength ||
    (crc ^ 0xffffffff) >>> 0 !== entry.crc32
  )
    throw new Error('Public layer entry integrity mismatch');
  return bytes;
}
export async function readZipEntry(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.method === 0)
    return verifyZipEntry(entry, entry.compressed.slice());
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(Uint8Array.from(entry.compressed));
      controller.close();
    },
  });
  const reader = source
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const output = new Uint8Array(entry.byteLength);
  let offset = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.length > output.length)
        throw new Error('Public layer inflation exceeds declared size');
      output.set(chunk.value, offset);
      offset += chunk.value.length;
    }
  } finally {
    await reader.cancel();
  }
  return verifyZipEntry(entry, output.subarray(0, offset));
}
