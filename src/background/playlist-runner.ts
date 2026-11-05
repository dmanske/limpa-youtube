import { channelVideosUrl, effectiveUcid } from '../shared/enrichment';
import { ultimoVideoDaPagina, videosDaResposta } from '../shared/playlist';
import { defaultFetchPage, type PageFetcher } from './enrich-runner';

const CONCORRENCIA = 4;
const LOTE_EDICAO = 50;

export interface CanalDaPlaylist {
  channelId: string;
  resolvedUcid?: string;
  name: string;
}

export interface VideosColetados {
  ids: string[];
  semVideo: string[];
}

/** Busca o vídeo mais recente de cada canal, mantendo a ordem da lista. */
export async function coletarVideos(
  canais: CanalDaPlaylist[],
  aoAvancar: (feito: number) => void,
  signal: AbortSignal,
  buscar: PageFetcher = defaultFetchPage,
): Promise<VideosColetados> {
  const achados: Array<string | undefined> = new Array(canais.length).fill(undefined);
  let proximo = 0;
  let feito = 0;

  const trabalhar = async (): Promise<void> => {
    while (proximo < canais.length) {
      const i = proximo++;
      const canal = canais[i];
      if (!canal) continue;
      signal.throwIfAborted();
      const alvo = effectiveUcid(canal.channelId, canal.resolvedUcid) ?? canal.channelId;
      const pagina = await buscar(channelVideosUrl(alvo), signal);
      achados[i] = pagina.text ? ultimoVideoDaPagina(pagina.text) : undefined;
      aoAvancar(++feito);
    }
  };
  await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhar));

  const vistos = new Set<string>();
  const ids: string[] = [];
  const semVideo: string[] = [];
  canais.forEach((canal, i) => {
    const id = achados[i];
    if (!id) semVideo.push(canal.name);
    else if (!vistos.has(id)) {
      vistos.add(id);
      ids.push(id);
    }
  });
  return { ids, semVideo };
}

export interface RespostaYouTube {
  status: number;
  corpo?: unknown;
  detalhe?: string;
}

/**
 * Roda dentro da página do YouTube e faz o mesmo pedido que a própria página faz.
 * O Chrome copia só o texto desta função para a página, então ela não pode usar nada de fora.
 * O dado de sessão fica na página: sai só como resumo, para o próprio YouTube.
 */
export async function pedirNaPagina(rota: string, dados: object): Promise<RespostaYouTube> {
  const cfg = (window as unknown as { ytcfg?: { get: (chave: string) => unknown } }).ytcfg;
  if (!cfg) return { status: 0, detalhe: 'a página do YouTube não terminou de carregar' };

  const biscoito = (nome: string): string | undefined =>
    document.cookie
      .split('; ')
      .find((parte) => parte.startsWith(`${nome}=`))
      ?.slice(nome.length + 1);
  const sessao = biscoito('SAPISID') ?? biscoito('__Secure-3PAPISID');
  if (!sessao) return { status: 0, detalhe: 'não achei o login do YouTube nesta aba' };

  const agora = Math.floor(Date.now() / 1000);
  const resumo = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(`${agora} ${sessao} ${location.origin}`),
  );
  const hex = [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const cabecalhos: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `SAPISIDHASH ${agora}_${hex}`,
    'x-origin': location.origin,
    'x-goog-authuser': String(cfg.get('SESSION_INDEX') ?? 0),
  };
  const conta = cfg.get('DELEGATED_SESSION_ID');
  if (typeof conta === 'string') cabecalhos['x-goog-pageid'] = conta;

  const resposta = await fetch(`/youtubei/v1/${rota}?prettyPrint=false`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: cabecalhos,
    body: JSON.stringify({ context: cfg.get('INNERTUBE_CONTEXT'), ...dados }),
  });
  const corpo = (await resposta.json().catch(() => ({}))) as { error?: { message?: string } };
  if (resposta.ok) return { status: resposta.status, corpo };
  return {
    status: resposta.status,
    detalhe: corpo.error?.message ?? `o YouTube respondeu ${resposta.status}`,
  };
}

export type Pedir = (rota: string, dados: object) => Promise<RespostaYouTube>;

export function pedirNaAba(tabId: number): Pedir {
  return async (rota, dados) => {
    const [resultado] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: pedirNaPagina,
      args: [rota, dados],
    });
    return resultado?.result ?? { status: 0, detalhe: 'a aba do YouTube não respondeu' };
  };
}

export interface ResultadoPlaylist {
  playlistId: string;
  /** Vídeos que entraram agora. */
  novos: number;
  criada: boolean;
  videoIds: string[];
}

async function criar(pedir: Pedir, titulo: string, ids: string[]): Promise<ResultadoPlaylist> {
  const r = await pedir('playlist/create', {
    title: titulo,
    privacyStatus: 'PRIVATE',
    videoIds: ids,
  });
  const playlistId = (r.corpo as { playlistId?: string } | undefined)?.playlistId;
  if (!playlistId) throw new Error(r.detalhe ?? 'o YouTube não devolveu a playlist');
  return { playlistId, novos: ids.length, criada: true, videoIds: ids };
}

/**
 * Sem playlist salva, cria. Com playlist salva, acrescenta só o vídeo que ainda não está lá.
 * Se o YouTube disser que ela não existe mais, cria de novo. Qualquer outra recusa para aqui,
 * porque acrescentar sem saber o que já está na lista repetiria vídeos.
 */
export async function criarOuAtualizar(
  pedir: Pedir,
  titulo: string,
  ids: string[],
  salva?: { id: string; videoIds?: string[] },
): Promise<ResultadoPlaylist> {
  if (!salva) return criar(pedir, titulo, ids);

  const lida = await pedir('browse', { browseId: `VL${salva.id}` });
  if (lida.status === 404) return criar(pedir, titulo, ids);
  if (lida.status !== 200) throw new Error(lida.detalhe ?? 'não consegui ler a playlist');

  const presentes = new Set([...(salva.videoIds ?? []), ...videosDaResposta(lida.corpo)]);
  const novos = ids.filter((id) => !presentes.has(id));
  for (let i = 0; i < novos.length; i += LOTE_EDICAO) {
    const editada = await pedir('browse/edit_playlist', {
      playlistId: salva.id,
      actions: novos
        .slice(i, i + LOTE_EDICAO)
        .map((addedVideoId) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId })),
    });
    if (editada.status === 404) return criar(pedir, titulo, ids);
    if (editada.status !== 200)
      throw new Error(editada.detalhe ?? 'não consegui atualizar a playlist');
  }
  return {
    playlistId: salva.id,
    novos: novos.length,
    criada: false,
    videoIds: [...presentes, ...novos],
  };
}
