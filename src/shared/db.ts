import Dexie, { type Table } from 'dexie';
import type { BackupRow, Channel, ExtractionRun, UnsubLogRow } from './types';

export interface SettingsRow {
  key: string;
  value: unknown;
}

class CleanupDB extends Dexie {
  channels!: Table<Channel, string>;
  extractions!: Table<ExtractionRun, number>;
  settings!: Table<SettingsRow, string>;
  backups!: Table<BackupRow, number>;
  unsubLog!: Table<UnsubLogRow, number>;

  constructor() {
    super('yt-subscription-cleanup');
    this.version(1).stores({
      channels: 'channelId, name, extractedAt, subscriberCountRaw',
      extractions: '++id, startedAt, completedAt, status',
      settings: 'key',
    });
    this.version(2).stores({
      channels:
        'channelId, name, extractedAt, subscriberCountRaw, lastUploadAt, enrichmentStatus, pendingUnsub',
      extractions: '++id, startedAt, completedAt, status',
      settings: 'key',
      backups: '++id, createdAt',
    });
    this.version(3).stores({
      channels:
        'channelId, name, extractedAt, subscriberCountRaw, lastUploadAt, enrichmentStatus, pendingUnsub, unsubscribedAt',
      extractions: '++id, startedAt, completedAt, status',
      settings: 'key',
      backups: '++id, createdAt',
      unsubLog: '++id, batchId, channelId, attemptedAt, outcome',
    });
    // Older builds could mislabel parse failures as 'no-uploads'. Clear enrichedAt on
    // those rows so the next activity check re-validates them under the corrected logic.
    this.version(4)
      .stores({
        channels:
          'channelId, name, extractedAt, subscriberCountRaw, lastUploadAt, enrichmentStatus, pendingUnsub, unsubscribedAt',
        extractions: '++id, startedAt, completedAt, status',
        settings: 'key',
        backups: '++id, createdAt',
        unsubLog: '++id, batchId, channelId, attemptedAt, outcome',
      })
      .upgrade((tx) =>
        tx
          .table('channels')
          .toCollection()
          .modify((c: Channel) => {
            if (c.enrichmentStatus === 'no-uploads') delete c.enrichedAt;
          }),
      );
  }
}

let _db: CleanupDB | null = null;

export function db(): CleanupDB {
  if (!_db) _db = new CleanupDB();
  return _db;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db().settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db().settings.put({ key, value });
}
