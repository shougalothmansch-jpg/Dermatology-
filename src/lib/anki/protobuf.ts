/** Minimal protobuf wire-format reader — just enough for Anki's config blobs. */

export type PbValue = number | Uint8Array;

export function readFields(buf: Uint8Array): Map<number, PbValue[]> {
  const out = new Map<number, PbValue[]>();
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= buf.length) throw new Error('Truncated protobuf');
      const b = buf[pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
    }
  };
  while (pos < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let value: PbValue;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const len = varint();
      value = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wire === 1) {
      pos += 8;
      continue;
    } else if (wire === 5) {
      pos += 4;
      continue;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
    const list = out.get(field) ?? [];
    list.push(value);
    out.set(field, list);
  }
  return out;
}

const utf8 = new TextDecoder();

export function pbString(fields: Map<number, PbValue[]>, n: number): string {
  const v = fields.get(n)?.[0];
  return v instanceof Uint8Array ? utf8.decode(v) : '';
}

export function pbNumber(fields: Map<number, PbValue[]>, n: number): number | undefined {
  const v = fields.get(n)?.[0];
  return typeof v === 'number' ? v : undefined;
}
