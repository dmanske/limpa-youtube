/** O link temporário do YouTube aceita no máximo 50 vídeos. */
const LIMITE_LINK = 50;

export interface PlaylistCriada {
  id: string;
  criadaEm: number;
  videos: number;
  /** O que a extensão já mandou para esta playlist. Evita repetir vídeo ao atualizar. */
  videoIds?: string[];
}

export type PlaylistsCriadas = Record<string, PlaylistCriada>;

export const CHAVE_PLAYLISTS = 'playlistsCriadas';

type Objeto = Record<string, unknown>;

function ler(valor: unknown, ...caminho: string[]): unknown {
  let atual = valor;
  for (const passo of caminho) {
    if (typeof atual !== 'object' || atual === null) return undefined;
    atual = (atual as Objeto)[passo];
  }
  return atual;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Primeiro vídeo da aba Vídeos de um canal, que é o mais recente. Shorts e lives ficam de fora. */
export function ultimoVideoDaPagina(html: string): string | undefined {
  const marca = 'var ytInitialData = ';
  const inicio = html.indexOf(marca);
  if (inicio < 0) return undefined;
  const fim = html.indexOf(';</script>', inicio);
  if (fim < 0) return undefined;

  let dados: unknown;
  try {
    dados = JSON.parse(html.slice(inicio + marca.length, fim));
  } catch {
    return undefined;
  }

  for (const aba of lista(ler(dados, 'contents', 'twoColumnBrowseResultsRenderer', 'tabs'))) {
    const titulo = ler(aba, 'tabRenderer', 'title');
    if (titulo !== 'Videos' && titulo !== 'Vídeos') continue;
    const itens = ler(aba, 'tabRenderer', 'content', 'richGridRenderer', 'contents');
    for (const item of lista(itens)) {
      const bloco = ler(item, 'richItemRenderer', 'content');
      const antigo = ler(bloco, 'videoRenderer', 'videoId');
      if (typeof antigo === 'string') return antigo;
      const id = ler(bloco, 'lockupViewModel', 'contentId');
      const tipo = ler(bloco, 'lockupViewModel', 'contentType');
      if (typeof id === 'string' && tipo === 'LOCKUP_CONTENT_TYPE_VIDEO') return id;
    }
  }
  return undefined;
}

/** Vídeos que aparecem na resposta do YouTube sobre uma playlist. */
export function videosDaResposta(corpo: unknown): string[] {
  const achados = JSON.stringify(corpo ?? {}).matchAll(/"videoId":"([\w-]{11})"/g);
  return [...new Set([...achados].map((m) => m[1] as string))];
}

/** Lista temporária do YouTube, que não precisa de login. Serve de plano B. */
export function linkTemporario(ids: string[]): string {
  return `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, LIMITE_LINK).join(',')}`;
}

export function linkDaPlaylist(id: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
}
