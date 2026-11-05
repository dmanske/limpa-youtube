import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from '../lib/chrome';
import { getSetting } from '../shared/db';
import { friendlyError } from '../shared/errors';
import {
  KEEPALIVE_PORT,
  type ItemPlaylist,
  type Message,
  type ResultadoAssunto,
} from '../shared/messages';
import { CHAVE_PLAYLISTS, linkDaPlaylist, type PlaylistsCriadas } from '../shared/playlist';
import type { EnrichmentProgress, ExtractionProgress, UnsubProgress } from '../shared/types';

export type Andamento =
  | { tipo: 'escanear'; parando: boolean; progresso: ExtractionProgress }
  | { tipo: 'checar'; parando: boolean; progresso: EnrichmentProgress }
  | { tipo: 'cancelar'; parando: boolean; progresso: UnsubProgress }
  | { tipo: 'historico'; parando: boolean; videos: number }
  | {
      tipo: 'playlist';
      parando: boolean;
      assunto: string;
      indice: number;
      assuntos: number;
      feito: number;
      total: number;
      criando: boolean;
    };

export interface HistoricoLido {
  contagem: Record<string, number>;
  videos: number;
  lidoEm: number;
}

export interface Aviso {
  nivel: 'ok' | 'erro';
  texto: string;
  falhas?: string[];
  /** Canais que ficaram sem cancelar porque a aba do YouTube fechou. */
  retomar?: string[];
  /** Botão que abre uma página do YouTube. */
  link?: { url: string; rotulo: string };
}

interface Opcoes {
  /** Relê a lista de canais depois de uma mudança feita pela extensão. */
  aoMudarDados: () => void;
  nomeDoCanal: (id: string) => string;
  /** A lista salva foi trocada: a tela volta para os filtros iniciais. */
  aoZerar: () => void;
}

const numero = (n: number): string => n.toLocaleString('pt-BR');

function voltarParaEstaAba(): void {
  chrome.tabs.getCurrent((aba) => {
    if (aba?.id !== undefined) void chrome.tabs.update(aba.id, { active: true });
  });
}

export function avisoDasPlaylists(resultados: ResultadoAssunto[], semVideo: string[]): Aviso {
  const novos = resultados.reduce((soma, r) => soma + r.novos, 0);
  const [unica] = resultados;
  if (resultados.length === 1 && unica) {
    const { assunto, playlistId, criada } = unica;
    return {
      nivel: 'ok',
      texto: criada
        ? `Playlist "${assunto}" criada, privada, com ${numero(novos)} vídeos.`
        : novos === 0
          ? `Playlist "${assunto}" já estava em dia.`
          : `Playlist "${assunto}" atualizada: ${numero(novos)} ${novos === 1 ? 'vídeo novo' : 'vídeos novos'}.`,
      falhas: semVideo,
      link: { url: linkDaPlaylist(playlistId), rotulo: 'Abrir no YouTube' },
    };
  }
  const criadas = resultados.filter((r) => r.criada).length;
  const atualizadas = resultados.length - criadas;
  return {
    nivel: 'ok',
    texto: `Pronto: ${numero(criadas)} ${criadas === 1 ? 'playlist criada' : 'playlists criadas'} e ${numero(atualizadas)} ${atualizadas === 1 ? 'atualizada' : 'atualizadas'}, com ${numero(novos)} vídeos novos.`,
    falhas: semVideo,
    link: { url: 'https://www.youtube.com/feed/playlists', rotulo: 'Abrir minhas playlists' },
  };
}

export function avisoDoEscaneamento(
  total: number,
  completo: boolean,
  sumiram: number,
  doZero = false,
): Aviso {
  if (!completo) {
    return {
      nivel: 'erro',
      texto: `Li ${numero(total)} canais, mas o YouTube parou de carregar antes do fim da lista.${doZero ? ' Nada foi apagado.' : ''} Deixe a aba do YouTube na frente e tente de novo.`,
    };
  }
  const fora =
    sumiram === 0
      ? ''
      : sumiram === 1
        ? ' 1 canal não apareceu na lista: veja "Não apareceram".'
        : ` ${numero(sumiram)} canais não apareceram na lista: veja "Não apareceram".`;
  return { nivel: 'ok', texto: `${numero(total)} inscrições encontradas.${fora}` };
}

/** Escanear, checar e cancelar rodam na extensão; aqui a tela acompanha cada um. */
export function useOperacoes({ aoMudarDados, nomeDoCanal, aoZerar }: Opcoes) {
  const [andamento, setAndamento] = useState<Andamento | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendentes, setPendentes] = useState(0);
  const [historico, setHistorico] = useState<HistoricoLido | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistsCriadas>({});
  const falhas = useRef<string[]>([]);
  const portaChecagem = useRef<chrome.runtime.Port | null>(null);
  const opcoes = useRef({ aoMudarDados, nomeDoCanal, aoZerar });
  opcoes.current = { aoMudarDados, nomeDoCanal, aoZerar };
  const checarDepois = useRef<() => void>(() => {});

  const soltarPorta = useCallback(() => {
    try {
      portaChecagem.current?.disconnect();
    } catch {
      /* já desconectada */
    }
    portaChecagem.current = null;
  }, []);

  const lerPlaylists = useCallback(() => {
    getSetting<PlaylistsCriadas>(CHAVE_PLAYLISTS, {})
      .then(setPlaylists)
      .catch(() => {});
  }, []);

  const atualizarPendentes = useCallback(() => {
    sendMessage({ action: 'enrich:status' })
      .then((resposta) => {
        const r = resposta as Extract<Message, { action: 'enrich:status:reply' }> | undefined;
        if (r?.action !== 'enrich:status:reply') return;
        setPendentes(r.data.pendingCount);
        if (r.data.running && r.data.progress) {
          setAndamento({
            tipo: 'checar',
            parando: r.data.status === 'stopping',
            progresso: r.data.progress,
          });
        }
      })
      .catch(() => {
        /* a extensão reenvia o estado na próxima mensagem */
      });
  }, []);

  useEffect(() => {
    sendMessage({ action: 'extract:status' })
      .then((resposta) => {
        const r = resposta as Extract<Message, { action: 'extract:status:reply' }> | undefined;
        if (r?.action === 'extract:status:reply' && r.data.running && r.data.progress) {
          setAndamento({
            tipo: 'escanear',
            parando: r.data.status === 'stopping',
            progresso: r.data.progress,
          });
        }
      })
      .catch(() => {});
    sendMessage({ action: 'unsub:status' })
      .then((resposta) => {
        const r = resposta as Extract<Message, { action: 'unsub:status:reply' }> | undefined;
        if (r?.action === 'unsub:status:reply' && r.data.running && r.data.progress) {
          setAndamento({
            tipo: 'cancelar',
            parando: r.data.status === 'stopping',
            progresso: r.data.progress,
          });
        }
      })
      .catch(() => {});
    atualizarPendentes();
    getSetting<HistoricoLido | null>('historicoVistos', null)
      .then(setHistorico)
      .catch(() => {});
    lerPlaylists();
  }, [atualizarPendentes, lerPlaylists]);

  useEffect(() => {
    const ouvir = (bruta: unknown): void => {
      const msg = bruta as Message;
      const mudou = (): void => opcoes.current.aoMudarDados();
      switch (msg.action) {
        case 'playlist:progresso':
          setAndamento((a) =>
            a?.tipo === 'playlist' && a.parando
              ? a
              : { tipo: 'playlist', parando: false, ...msg.data },
          );
          break;
        case 'playlist:concluida':
          soltarPorta();
          setAndamento(null);
          lerPlaylists();
          setAviso(avisoDasPlaylists(msg.data.resultados, msg.data.semVideo));
          break;
        case 'playlist:temporaria': {
          const { assunto, url, videos, semVideo, motivo, feitos } = msg.data;
          soltarPorta();
          setAndamento(null);
          lerPlaylists();
          setAviso({
            nivel: 'erro',
            texto: `${feitos > 0 ? `${numero(feitos)} playlists prontas. ` : ''}Parei em "${assunto}": o YouTube recusou (${friendlyError(motivo)}). Montei uma lista temporária desse assunto com ${numero(Math.min(videos, 50))} vídeos. Se quiser, abra e salve por lá.`,
            falhas: semVideo,
            link: { url, rotulo: 'Abrir lista temporária' },
          });
          break;
        }
        case 'playlist:erro':
          soltarPorta();
          setAndamento(null);
          setAviso({ nivel: 'erro', texto: friendlyError(msg.data.message) });
          break;
        case 'playlist:cancelada':
          soltarPorta();
          setAndamento(null);
          setAviso({ nivel: 'ok', texto: 'Parei. Nenhuma playlist foi criada.' });
          break;
        case 'historico:progresso':
          setAndamento((a) =>
            a?.tipo === 'historico' && a.parando
              ? a
              : { tipo: 'historico', parando: false, videos: msg.data.videos },
          );
          break;
        case 'historico:salvo':
          setAndamento(null);
          setHistorico(msg.data);
          setAviso({
            nivel: 'ok',
            texto: `Li ${numero(msg.data.videos)} vídeos do seu histórico. Veja o filtro "Assisti ultimamente".`,
          });
          voltarParaEstaAba();
          break;
        case 'historico:erro':
          setAndamento(null);
          setAviso({ nivel: 'erro', texto: friendlyError(msg.data.message) });
          voltarParaEstaAba();
          break;
        case 'extract:progress':
          setAndamento((a) =>
            a?.tipo === 'escanear' && a.parando
              ? a
              : { tipo: 'escanear', parando: false, progresso: msg.data.progress },
          );
          break;
        case 'extract:stopping':
          setAndamento({ tipo: 'escanear', parando: true, progresso: msg.data.progress });
          break;
        case 'extract:cancelled':
          setAndamento(null);
          setAviso({
            nivel: 'ok',
            texto: 'Escaneamento interrompido. O que já foi lido ficou salvo.',
          });
          mudou();
          atualizarPendentes();
          voltarParaEstaAba();
          break;
        case 'extract:complete':
          // A aba do YouTube também manda esta mensagem; vale a da extensão, que já gravou tudo.
          if (msg.data.sumiram === undefined) break;
          setAndamento(null);
          setAviso(
            avisoDoEscaneamento(
              msg.data.total,
              msg.data.completo,
              msg.data.sumiram,
              msg.data.doZero,
            ),
          );
          mudou();
          atualizarPendentes();
          voltarParaEstaAba();
          // Do zero, as fotos e datas foram junto: busca de novo sem esperar um clique.
          if (msg.data.doZero && msg.data.completo && msg.data.total > 0) {
            opcoes.current.aoZerar();
            checarDepois.current();
          }
          break;
        case 'extract:error':
          setAndamento(null);
          setAviso({ nivel: 'erro', texto: friendlyError(msg.data.message, 'Scan') });
          mudou();
          voltarParaEstaAba();
          break;
        case 'enrich:progress':
          setAndamento((a) =>
            a?.tipo === 'checar' && a.parando
              ? a
              : { tipo: 'checar', parando: false, progresso: msg.data.progress },
          );
          mudou();
          break;
        case 'enrich:stopping':
          setAndamento({ tipo: 'checar', parando: true, progresso: msg.data.progress });
          break;
        case 'enrich:cancelled':
          soltarPorta();
          setAndamento(null);
          setAviso({ nivel: 'ok', texto: 'Checagem interrompida. O que já foi lido ficou salvo.' });
          mudou();
          atualizarPendentes();
          break;
        case 'enrich:complete': {
          soltarPorta();
          const { ok, noUploads, unreachable } = msg.data.progress;
          setAndamento(null);
          setAviso({
            nivel: 'ok',
            texto: `Checagem concluída: ${numero(ok)} ativos, ${numero(noUploads)} sem vídeos e ${numero(unreachable)} sem resposta.`,
          });
          mudou();
          atualizarPendentes();
          break;
        }
        case 'enrich:error':
          soltarPorta();
          setAndamento(null);
          setAviso({ nivel: 'erro', texto: friendlyError(msg.data.message, 'Check') });
          mudou();
          atualizarPendentes();
          break;
        case 'unsub:progress': {
          const r = msg.data.result;
          if (r && ['error', 'halted', 'unreachable'].includes(r.outcome)) {
            const linha = `${opcoes.current.nomeDoCanal(r.channelId)}: ${friendlyError(r.detail ?? 'Unknown error')}`;
            if (!falhas.current.includes(linha)) falhas.current.push(linha);
          }
          setAndamento((a) =>
            a?.tipo === 'cancelar' && a.parando
              ? a
              : { tipo: 'cancelar', parando: false, progresso: msg.data.progress },
          );
          mudou();
          break;
        }
        case 'unsub:stopping':
          setAndamento({ tipo: 'cancelar', parando: true, progresso: msg.data.progress });
          break;
        case 'unsub:complete': {
          const p = msg.data.progress;
          const restantes = msg.data.remaining.length;
          const erros = p.error + p.halted + p.unreachable;
          setAndamento(null);
          setAviso({
            nivel: erros > 0 ? 'erro' : 'ok',
            texto:
              `${numero(p.ok + p.alreadyUnsubbed)} inscrições canceladas` +
              (erros > 0 ? `, ${numero(erros)} com falha` : '') +
              (restantes > 0
                ? `. Faltam ${numero(restantes)}: clique em "Cancelar inscrições" para continuar.`
                : '.'),
            falhas: [...falhas.current],
          });
          mudou();
          atualizarPendentes();
          voltarParaEstaAba();
          break;
        }
        case 'unsub:cancelled':
        case 'unsub:paused':
          setAndamento(null);
          setAviso({
            nivel: 'erro',
            texto: `Cancelamento pausado: ${numero(msg.data.progress.ok)} canceladas e ${numero(msg.data.remaining.length)} restantes.`,
            falhas: [...falhas.current],
            retomar: msg.data.remaining,
          });
          mudou();
          voltarParaEstaAba();
          break;
        case 'unsub:error':
          setAndamento(null);
          setAviso({ nivel: 'erro', texto: friendlyError(msg.data.message) });
          mudou();
          voltarParaEstaAba();
          break;
      }
    };
    chrome.runtime.onMessage.addListener(ouvir);
    return () => chrome.runtime.onMessage.removeListener(ouvir);
  }, [atualizarPendentes, lerPlaylists, soltarPorta]);

  const pedir = useCallback(async (msg: Message, aoFalhar: (texto: string) => void) => {
    try {
      const r = (await sendMessage(msg)) as { ok: boolean; error?: string } | undefined;
      if (r && r.ok === false) aoFalhar(friendlyError(r.error ?? 'Unknown error'));
    } catch {
      aoFalhar('A extensão está reconectando. Tente de novo.');
    }
  }, []);

  const falhar = useCallback((texto: string) => {
    setAndamento(null);
    setAviso({ nivel: 'erro', texto });
  }, []);

  const escanear = useCallback(() => {
    setAviso(null);
    setAndamento({ tipo: 'escanear', parando: false, progresso: { loaded: 0, phase: 'setup' } });
    void pedir({ action: 'extract:start' }, falhar);
  }, [pedir, falhar]);

  const escanearDoZero = useCallback(() => {
    setAviso(null);
    setAndamento({ tipo: 'escanear', parando: false, progresso: { loaded: 0, phase: 'setup' } });
    void pedir({ action: 'extract:start', data: { doZero: true } }, falhar);
  }, [pedir, falhar]);

  const sincronizarPlaylists = useCallback(
    (itens: ItemPlaylist[]) => {
      const [primeiro] = itens;
      if (!primeiro) return;
      setAviso(null);
      setAndamento({
        tipo: 'playlist',
        parando: false,
        assunto: primeiro.assunto,
        indice: 1,
        assuntos: itens.length,
        feito: 0,
        total: primeiro.canais.length,
        criando: false,
      });
      try {
        portaChecagem.current = chrome.runtime.connect({ name: KEEPALIVE_PORT });
      } catch {
        /* segue sem a porta */
      }
      void pedir({ action: 'playlist:sincronizar', data: { itens } }, (texto) => {
        soltarPorta();
        falhar(texto);
      });
    },
    [pedir, falhar, soltarPorta],
  );

  const lerHistorico = useCallback(() => {
    setAviso(null);
    setAndamento({ tipo: 'historico', parando: false, videos: 0 });
    void pedir({ action: 'historico:iniciar' }, falhar);
  }, [pedir, falhar]);

  const checar = useCallback(() => {
    setAviso(null);
    setAndamento({
      tipo: 'checar',
      parando: false,
      progresso: { processed: 0, total: 0, ok: 0, noUploads: 0, unreachable: 0 },
    });
    try {
      portaChecagem.current = chrome.runtime.connect({ name: KEEPALIVE_PORT });
    } catch {
      /* a checagem roda mesmo sem a porta, só fica mais sujeita a interrupção */
    }
    void pedir({ action: 'enrich:start' }, (texto) => {
      soltarPorta();
      falhar(texto);
    });
  }, [pedir, falhar, soltarPorta]);

  checarDepois.current = checar;

  const cancelarInscricoes = useCallback(
    (ids: string[]) => {
      falhas.current = [];
      setAviso(null);
      setAndamento({
        tipo: 'cancelar',
        parando: false,
        progresso: {
          processed: 0,
          total: Math.min(ids.length, 200),
          ok: 0,
          alreadyUnsubbed: 0,
          unreachable: 0,
          error: 0,
          halted: 0,
        },
      });
      void pedir({ action: 'unsub:start', data: { channelIds: ids } }, falhar);
    },
    [pedir, falhar],
  );

  const parar = useCallback(() => {
    setAndamento((a) => {
      if (!a) return a;
      const acoes = {
        escanear: 'extract:cancel',
        checar: 'enrich:cancel',
        cancelar: 'unsub:cancel',
        historico: 'historico:cancelar',
        playlist: 'playlist:cancelar',
      } as const;
      const acao = acoes[a.tipo];
      void sendMessage({ action: acao }).catch(() => {});
      return { ...a, parando: true } as Andamento;
    });
  }, []);

  return {
    andamento,
    aviso,
    pendentes,
    historico,
    playlists,
    sincronizarPlaylists,
    lerHistorico,
    escanear,
    escanearDoZero,
    checar,
    cancelarInscricoes,
    parar,
    fecharAviso: () => setAviso(null),
  };
}
