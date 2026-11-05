import { db, TABLE_NAMES, type TableName } from './db';

export const BACKUP_APP_ID = 'derm-path';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  version: number;
  exportedAt: string;
  data: Partial<Record<TableName, unknown[]>>;
}

export async function exportAll(): Promise<BackupFile> {
  const data: Partial<Record<TableName, unknown[]>> = {};
  await db.transaction('r', TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) data[t] = await db.table(t).toArray();
  });
  return { app: BACKUP_APP_ID, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

export function validateBackup(obj: unknown): BackupFile {
  if (!obj || typeof obj !== 'object') throw new Error('File is not a JSON object.');
  const b = obj as BackupFile;
  if (b.app !== BACKUP_APP_ID) throw new Error('This file is not a Derm Path backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION)
    throw new Error('Backup was made by a newer version of Derm Path.');
  if (!b.data || typeof b.data !== 'object') throw new Error('Backup has no data section.');
  for (const [k, v] of Object.entries(b.data)) {
    if (!(TABLE_NAMES as readonly string[]).includes(k)) throw new Error(`Unknown table "${k}" in backup.`);
    if (!Array.isArray(v)) throw new Error(`Table "${k}" is not a list.`);
  }
  return b;
}

/** Replaces ALL current data with the backup contents. */
export async function importAll(backup: BackupFile) {
  await db.transaction('rw', TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) {
      await db.table(t).clear();
      const rows = backup.data[t];
      if (rows && rows.length) await db.table(t).bulkPut(rows);
    }
  });
}

export async function resetAll() {
  await db.delete();
  await db.open(); // re-runs populate with fresh seed
}
