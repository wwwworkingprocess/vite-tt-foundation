import { deflateRawSync } from 'node:zlib';
export function zipFixture(
  name = 'catalog.json',
  text = '{"unchanged":true}',
  method = 8,
) {
  const source = Buffer.from(text);
  const payload = method === 8 ? deflateRawSync(source) : source;
  let crc = 0xffffffff;
  for (const byte of source) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const path = Buffer.from(name);
  const local = Buffer.alloc(30 + path.length);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(path.length, 26);
  path.copy(local, 30);
  const central = Buffer.alloc(46 + path.length);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(path.length, 28);
  path.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + payload.length, 16);
  return Buffer.concat([local, payload, central, end]);
}
