import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import {
  coletarVideos,
  criarOuAtualizar,
  pedirNaPagina,
  type Pedir,
} from '../src/background/playlist-runner';
import { gruposDePlaylist, mantidosDoBackup } from '../src/painel/logica';
import type { Channel } from '../src/shared/types';
import { linkDaPlaylist, linkTemporario, ultimoVideoDaPagina } from '../src/shared/playlist';

const lockup = (id: string, tipo = 'LOCKUP_CONTENT_TYPE_VIDEO'): object => ({
  richItemRenderer: { content: { lockupViewModel: { contentId: id, contentType: tipo } } },
});
const pagina = (itens: object[], titulo = 'Videos'): string =>
  `<script>var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              title: 'Home',
              content: { richGridRenderer: { contents: [lockup('inicio')] } },
            },
          },
          { tabRenderer: { title: titulo, content: { richGridRenderer: { contents: itens } } } },
        ],
      },
    },
  })};</script>`;

describe('ultimoVideoDaPagina', () => {
  it('pega o primeiro vídeo da aba Vídeos, não o de outra aba', () => {
    expect(ultimoVideoDaPagina(pagina([lockup('novo'), lockup('velho')]))).toBe('novo');
  });
  it('pula o que não é vídeo', () => {
    expect(
      ultimoVideoDaPagina(pagina([lockup('lista', 'LOCKUP_CONTENT_TYPE_PLAYLIST'), lockup('v')])),
    ).toBe('v');
  });
  it('aceita a página em português e o modelo antigo', () => {
    expect(
      ultimoVideoDaPagina(
        pagina([{ richItemRenderer: { content: { videoRenderer: { videoId: 'a' } } } }], 'Vídeos'),
      ),
    ).toBe('a');
  });
  it('canal sem vídeos ou página estranha não quebra', () => {
    expect(ultimoVideoDaPagina(pagina([]))).toBeUndefined();
    expect(ultimoVideoDaPagina('<html></html>')).toBeUndefined();
    expect(ultimoVideoDaPagina('var ytInitialData = {quebrado;</script>')).toBeUndefined();
  });
});

describe('links', () => {
  it('a lista temporária respeita o limite de 50 vídeos', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `v${i}`);
    const url = new URL(linkTemporario(ids));
    expect(url.searchParams.get('video_ids')?.split(',')).toHaveLength(50);
  });
  it('monta o link da playlist', () => {
    expect(linkDaPlaylist('PLabc')).toBe('https://www.youtube.com/playlist?list=PLabc');
  });
});

describe('coletarVideos', () => {
  const canais = ['a', 'b', 'c', 'd'].map((n) => ({ channelId: `@${n}`, name: n }));

  it('mantém a ordem, junta repetidos e lista quem ficou sem vídeo', async () => {
    const respostas: Record<string, string | undefined> = {
      a: pagina([lockup('v1')]),
      b: undefined,
      c: pagina([lockup('v1')]),
      d: pagina([lockup('v4')]),
    };
    const r = await coletarVideos(
      canais,
      () => {},
      new AbortController().signal,
      async (url) => {
        const text = respostas[url.match(/@(\w)/)?.[1] ?? ''];
        return text ? { ok: true, text } : { ok: false, reason: 'http-404' };
      },
    );
    expect(r).toEqual({ ids: ['v1', 'v4'], semVideo: ['b'] });
  });
  it('para quando pedem', async () => {
    const parada = new AbortController();
    parada.abort();
    await expect(
      coletarVideos(
        canais,
        () => {},
        parada.signal,
        async () => ({ ok: true, text: '' }),
      ),
    ).rejects.toThrow();
  });
});

describe('pedirNaPagina', () => {
  type Copia = typeof pedirNaPagina;
  // O Chrome copia só o texto da função para a página: aqui ela roda do mesmo jeito, sem o módulo.
  const copiada = new Function(`return (${pedirNaPagina.toString()})`)() as Copia;
  const janela = window as unknown as { ytcfg?: { get: (chave: string) => unknown } };

  afterEach(() => {
    vi.unstubAllGlobals();
    delete janela.ytcfg;
    document.cookie = 'SAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('faz o pedido com o contexto da página, sem mandar o dado de sessão em texto', async () => {
    janela.ytcfg = {
      get: (c) => ({ INNERTUBE_CONTEXT: { client: { hl: 'pt' } }, SESSION_INDEX: 1 })[c],
    };
    document.cookie = 'SAPISID=segredo';
    const fetchFalso = vi.fn(
      async () => new Response(JSON.stringify({ playlistId: 'PL1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    expect(await copiada('playlist/create', { title: 'Culinária' })).toEqual({
      status: 200,
      corpo: { playlistId: 'PL1' },
    });

    const [url, pedido] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/youtubei/v1/playlist/create');
    expect(JSON.parse(pedido.body as string)).toEqual({
      context: { client: { hl: 'pt' } },
      title: 'Culinária',
    });
    const cabecalhos = pedido.headers as Record<string, string>;
    expect(cabecalhos.authorization).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(JSON.stringify(pedido)).not.toContain('segredo');
  });

  it('devolve o motivo quando o YouTube recusa', async () => {
    janela.ytcfg = { get: () => undefined };
    document.cookie = 'SAPISID=segredo';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: { message: 'negado' } }), { status: 403 }),
      ),
    );
    expect(await copiada('browse', {})).toEqual({ status: 403, detalhe: 'negado' });
  });

  it('sem login ou sem a página carregada, não chama o YouTube', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    expect((await copiada('browse', {})).status).toBe(0);
    janela.ytcfg = { get: () => undefined };
    expect((await copiada('browse', {})).detalhe).toContain('login');
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe('criarOuAtualizar', () => {
  const youtube = (
    respostas: Record<string, { status: number; corpo?: unknown; detalhe?: string }>,
  ) => {
    const pedidos: Array<[string, object]> = [];
    const pedir: Pedir = async (rota, dados) => {
      pedidos.push([rota, dados]);
      return respostas[rota] ?? { status: 200, corpo: {} };
    };
    return { pedir, pedidos };
  };
  const criada = { 'playlist/create': { status: 200, corpo: { playlistId: 'NOVA' } } };

  it('sem playlist salva, cria privada', async () => {
    const { pedir, pedidos } = youtube(criada);
    const r = await criarOuAtualizar(pedir, 'A', ['v1']);
    expect(r).toEqual({ playlistId: 'NOVA', novos: 1, criada: true, videoIds: ['v1'] });
    expect(pedidos[0]?.[1]).toMatchObject({ privacyStatus: 'PRIVATE', title: 'A' });
  });

  it('acrescenta só o que não está na playlist nem no que já foi enviado', async () => {
    const { pedir, pedidos } = youtube({
      browse: { status: 200, corpo: { x: { videoId: 'lido1234567' } } },
    });
    const r = await criarOuAtualizar(pedir, 'A', ['lido1234567', 'enviado1234', 'novo1234567'], {
      id: 'PL',
      videoIds: ['enviado1234'],
    });
    expect(r.novos).toBe(1);
    expect(r.criada).toBe(false);
    expect(pedidos[1]).toEqual([
      'browse/edit_playlist',
      { playlistId: 'PL', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'novo1234567' }] },
    ]);
  });

  it('em dia: não pede para editar', async () => {
    const { pedir, pedidos } = youtube({});
    const r = await criarOuAtualizar(pedir, 'A', ['v1'], { id: 'PL', videoIds: ['v1'] });
    expect(r.novos).toBe(0);
    expect(pedidos.map((p) => p[0])).toEqual(['browse']);
  });

  it('playlist apagada no YouTube: cria de novo', async () => {
    const { pedir } = youtube({ ...criada, browse: { status: 404 } });
    expect((await criarOuAtualizar(pedir, 'A', ['v1'], { id: 'PL' })).playlistId).toBe('NOVA');
  });

  it('não sabe o que tem na playlist: para, em vez de arriscar repetir vídeo', async () => {
    const { pedir, pedidos } = youtube({ browse: { status: 403, detalhe: 'negado' } });
    await expect(criarOuAtualizar(pedir, 'A', ['v1'], { id: 'PL' })).rejects.toThrow('negado');
    expect(pedidos).toHaveLength(1);
  });

  it('manda em lotes de 50', async () => {
    const { pedir, pedidos } = youtube({});
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    await criarOuAtualizar(pedir, 'A', ids, { id: 'PL' });
    expect(pedidos.filter((p) => p[0] === 'browse/edit_playlist')).toHaveLength(3);
  });
});

const canalBase = (id: string, extra: Partial<Channel> = {}): Channel => ({
  channelId: id,
  name: id,
  url: id,
  extractedAt: 1,
  ...extra,
});

describe('gruposDePlaylist', () => {
  it('agrupa por assunto, manda o resto para Outros e deixa de fora quem vai sair', () => {
    const grupos = gruposDePlaylist(
      [canalBase('a'), canalBase('b', { pendingUnsub: true }), canalBase('c'), canalBase('d')],
      { assuntos: { a: 'Música', b: 'Música', c: 'Culinária' }, valeOlhar: [] },
    );
    expect(grupos.map((g) => [g.assunto, g.canais.map((c) => c.channelId)])).toEqual([
      ['Culinária', ['c']],
      ['Música', ['a']],
      ['Outros', ['d']],
    ]);
  });
});

describe('mantidosDoBackup', () => {
  it('traz de volta só em canal que existe e ainda não tem decisão', () => {
    const ids = mantidosDoBackup(
      [canalBase('volta'), canalBase('tirar', { pendingUnsub: true }), canalBase('nao-era')],
      [
        canalBase('volta', { mantido: true }),
        canalBase('tirar', { mantido: true }),
        canalBase('cancelado', { mantido: true, unsubscribedAt: 5 }),
        canalBase('nao-era', { mantido: false }),
      ],
    );
    expect(ids).toEqual(['volta']);
  });
});
