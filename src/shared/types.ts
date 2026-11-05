export interface Channel {
  channelId: string;
  name: string;
  url: string;
  avatarUrl?: string;
  subscriberCountText?: string;
  subscriberCountRaw?: number;
  description?: string;
  extractedAt: number;

  resolvedUcid?: string;
  lastUploadAt?: number;
  videoCount?: number;
  enrichedAt?: number;
  enrichmentStatus?: EnrichmentStatus;

  pendingUnsub?: boolean;
  /** Conferido: você decidiu manter este canal. */
  mantido?: boolean;
  unsubscribedAt?: number;
  /** A última leitura completa da lista não trouxe este canal. Quem decide é você. */
  sumiuDaListaEm?: number;
}

export type EnrichmentStatus = 'pending' | 'ok' | 'no-uploads' | 'unreachable';

/** Lifecycle of a long-running operation (extract / enrich / unsubscribe). The service
 *  worker owns the authoritative value; popup and dashboard render from it. */
export type OperationStatus =
  | 'idle'
  | 'running'
  | 'stopping'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface ExtractionRun {
  id?: number;
  startedAt: number;
  completedAt?: number;
  channelCount: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  errorMessage?: string;
  /** A rolagem chegou mesmo ao fim da lista do YouTube. */
  completo?: boolean;
  /** Se a leitura chegar ao fim, a lista salva é trocada pelo que veio do YouTube. */
  doZero?: boolean;
}

export interface ExtractionProgress {
  loaded: number;
  total?: number;
  current?: string;
  phase?: 'scrolling' | 'parsing' | 'setup';
}

export interface EnrichmentProgress {
  processed: number;
  total: number;
  ok: number;
  noUploads: number;
  unreachable: number;
  current?: string;
}

export interface EnrichmentTarget {
  channelId: string;
  resolvedUcid?: string;
}

export interface EnrichmentResult {
  channelId: string;
  resolvedUcid?: string;
  lastUploadAt?: number;
  videoCount?: number;
  avatarUrl?: string;
  enrichmentStatus: EnrichmentStatus;
}

export interface BackupRow {
  id?: number;
  createdAt: number;
  channelCount: number;
  plannedUnsubIds: string[];
  payload: Channel[];
}

export type UnsubOutcome = 'ok' | 'already-unsubbed' | 'unreachable' | 'error' | 'halted';

export interface UnsubResult {
  channelId: string;
  outcome: UnsubOutcome;
  detail?: string;
  attemptedAt: number;
}

export interface UnsubTarget {
  channelId: string;
  name: string;
}

export interface UnsubProgress {
  processed: number;
  total: number;
  ok: number;
  alreadyUnsubbed: number;
  unreachable: number;
  error: number;
  halted: number;
  current?: string;
}

export interface UnsubLogRow {
  id?: number;
  batchId: string;
  channelId: string;
  channelName?: string;
  outcome: UnsubOutcome;
  detail?: string;
  attemptedAt: number;
}
