import type {
  Channel,
  EnrichmentProgress,
  EnrichmentResult,
  ExtractionProgress,
  OperationStatus,
  UnsubProgress,
  UnsubResult,
  UnsubTarget,
} from './types';

export interface ItemPlaylist {
  assunto: string;
  canais: Array<{ channelId: string; resolvedUcid?: string; name: string }>;
}

export interface ResultadoAssunto {
  assunto: string;
  playlistId: string;
  novos: number;
  criada: boolean;
}

export type Message =
  | { action: 'extract:start'; data?: { doZero?: boolean } }
  | { action: 'extract:progress'; data: { channels: Channel[]; progress: ExtractionProgress } }
  | {
      action: 'extract:complete';
      data: {
        total: number;
        runId?: number;
        durationMs: number;
        /** A rolagem chegou ao fim da lista. Sem isso, a leitura pode ter ficado pela metade. */
        completo: boolean;
        /** Só a extensão preenche, depois de gravar tudo. */
        sumiram?: number;
        doZero?: boolean;
      };
    }
  | { action: 'extract:error'; data: { message: string } }
  | { action: 'extract:stopping'; data: { operationId: string; progress: ExtractionProgress } }
  | { action: 'extract:cancelled'; data: { operationId: string; progress: ExtractionProgress } }
  | { action: 'extract:cancel'; data?: { operationId?: string } }
  | { action: 'extract:status' }
  | {
      action: 'extract:status:reply';
      data: {
        running: boolean;
        status: OperationStatus;
        operationId?: string;
        progress?: ExtractionProgress;
      };
    }
  | { action: 'enrich:start' }
  | {
      action: 'enrich:progress';
      data: { results: EnrichmentResult[]; progress: EnrichmentProgress };
    }
  | { action: 'enrich:complete'; data: { progress: EnrichmentProgress; durationMs: number } }
  | { action: 'enrich:error'; data: { message: string } }
  | { action: 'enrich:stopping'; data: { operationId: string; progress: EnrichmentProgress } }
  | { action: 'enrich:cancelled'; data: { operationId: string; progress: EnrichmentProgress } }
  | { action: 'enrich:cancel'; data?: { operationId?: string } }
  | { action: 'enrich:status' }
  | {
      action: 'enrich:status:reply';
      data: {
        running: boolean;
        status: OperationStatus;
        operationId?: string;
        progress?: EnrichmentProgress;
        pendingCount: number;
      };
    }
  | { action: 'unsub:start'; data: { channelIds: string[] } }
  | { action: 'unsub:batch'; data: { batchId: string; targets: UnsubTarget[] } }
  | {
      action: 'unsub:progress';
      data: { result?: UnsubResult; progress: UnsubProgress };
    }
  | {
      action: 'unsub:complete';
      data: { progress: UnsubProgress; durationMs: number; remaining: string[] };
    }
  | { action: 'unsub:error'; data: { message: string } }
  | { action: 'unsub:paused'; data: { progress: UnsubProgress; remaining: string[] } }
  | { action: 'unsub:stopping'; data: { operationId: string; progress: UnsubProgress } }
  | {
      action: 'unsub:cancelled';
      data: { operationId: string; progress: UnsubProgress; remaining: string[] };
    }
  | { action: 'unsub:cancel'; data?: { operationId?: string } }
  | { action: 'unsub:status' }
  | {
      action: 'unsub:status:reply';
      data: {
        running: boolean;
        status: OperationStatus;
        operationId?: string;
        progress?: UnsubProgress;
      };
    }
  | { action: 'historico:iniciar' }
  | { action: 'historico:ler' }
  | { action: 'historico:cancelar' }
  | { action: 'historico:progresso'; data: { videos: number } }
  | {
      action: 'historico:concluido';
      data: {
        contagem: Record<string, number>;
        videos: number;
        semCanal: number;
        textosSemCanal: string[][];
      };
    }
  | {
      action: 'historico:salvo';
      data: { contagem: Record<string, number>; videos: number; lidoEm: number };
    }
  | { action: 'historico:erro'; data: { message: string } }
  | { action: 'playlist:sincronizar'; data: { itens: ItemPlaylist[] } }
  | { action: 'playlist:cancelar' }
  | {
      action: 'playlist:progresso';
      data: {
        assunto: string;
        indice: number;
        assuntos: number;
        feito: number;
        total: number;
        criando: boolean;
      };
    }
  | {
      action: 'playlist:concluida';
      data: { resultados: ResultadoAssunto[]; semVideo: string[] };
    }
  | {
      action: 'playlist:temporaria';
      data: {
        assunto: string;
        url: string;
        videos: number;
        semVideo: string[];
        motivo: string;
        /** Assuntos que já tinham dado certo antes desta recusa. */
        feitos: number;
      };
    }
  | { action: 'playlist:erro'; data: { message: string } }
  | { action: 'playlist:cancelada' }
  | { action: 'backup:created'; data: { backupId: number } }
  | { action: 'dashboard:open' }
  | { action: 'export:csv' }
  | { action: 'export:json' }
  | { action: 'ping' }
  | { action: 'tab:check' }
  | { action: 'tab:check:reply'; data: { found: boolean } }
  | { action: 'tab:open-subscriptions' }
  | { action: 'clear:data' };

export type MessageAction = Message['action'];

export type MessageOf<A extends MessageAction> = Extract<Message, { action: A }>;

export const KEEPALIVE_PORT = 'yt-cleanup-keepalive';
