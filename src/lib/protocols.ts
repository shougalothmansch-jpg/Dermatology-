import { db } from '../db/db';
import type { Protocol } from '../db/types';
import { emptyFields } from './prospero';
import { nowIso, uid } from './utils';

/** Next ID of the form PRS-YYYY-NNN, unique among existing protocols. */
export async function nextProtocolId(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRS-${year}-`;
  const ids = await db.protocols.toCollection().primaryKeys();
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      const n = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export async function createProtocol(name: string, fields?: Record<string, string>): Promise<Protocol> {
  const p: Protocol = {
    id: await nextProtocolId(),
    name: name.trim() || 'Untitled protocol',
    fields: { ...emptyFields(), ...(fields ?? {}) },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.protocols.add(p);
  return p;
}

export async function duplicateProtocol(src: Protocol, name: string): Promise<Protocol> {
  const copy = await createProtocol(name, src.fields);
  const tasks = await db.protocolTasks.where('protocolId').equals(src.id).toArray();
  if (tasks.length) {
    await db.protocolTasks.bulkAdd(tasks.map((t) => ({ ...t, id: uid(), protocolId: copy.id, done: false, createdAt: nowIso() })));
  }
  return copy;
}

export async function deleteProtocol(id: string) {
  await db.transaction('rw', [db.protocols, db.protocolTasks], async () => {
    await db.protocolTasks.where('protocolId').equals(id).delete();
    await db.protocols.delete(id);
  });
}
