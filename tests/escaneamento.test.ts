import { describe, expect, it } from 'vitest';
import { decidirRolagem } from '../src/content/scroll';
import { canaisForaDaLista, mesclarCanal, zerarCanais } from '../src/shared/canais';
import type { Channel } from '../src/shared/types';
import { canaisNaLista, filtrarCanais, type Filtros } from '../src/painel/logica';

const fim = { cartoes: 500, semNovidadeMs: 2500, noFim: true, temMais: false };

describe('decidirRolagem', () => {
  it('só é completo no fim da página, sem mais nada para carregar', () => {
    expect(decidirRolagem(fim)).toBe('completo');
  });
  it('não para com o YouTube ainda prometendo mais canais', () => {
    expect(decidirRolagem({ ...fim, temMais: true })).toBe('continuar');
  });
  it('dá um tempo antes de concluir', () => {
    expect(decidirRolagem({ ...fim, semNovidadeMs: 1000 })).toBe('continuar');
  });
  it('sem canais na página nunca é completo: a página pode nem ter carregado', () => {
    expect(decidirRolagem({ ...fim, cartoes: 0 })).toBe('continuar');
    expect(decidirRolagem({ ...fim, cartoes: 0, semNovidadeMs: 30_000 })).toBe('incompleto');
  });
  it('travou sem chegar ao fim: é incompleto, não sucesso', () => {
    expect(decidirRolagem({ ...fim, temMais: true, semNovidadeMs: 30_000 })).toBe('incompleto');
    expect(decidirRolagem({ ...fim, noFim: false, semNovidadeMs: 30_000 })).toBe('incompleto');
  });
});

const canal = (id: string, extra: Partial<Channel> = {}): Channel => ({
  channelId: id,
  name: id,
  url: id,
  extractedAt: 100,
  ...extra,
});

describe('começar do zero', () => {
  it('tira datas e decisões de quem veio e apaga quem não veio', () => {
    const { manter, apagar } = zerarCanais(
      [
        canal('veio', {
          extractedAt: 200,
          mantido: true,
          pendingUnsub: true,
          lastUploadAt: 5,
          enrichedAt: 5,
          avatarUrl: 'foto',
        }),
        canal('nao-veio', { mantido: true }),
        canal('cancelado', { unsubscribedAt: 50 }),
      ],
      150,
    );
    expect(apagar).toEqual(['nao-veio', 'cancelado']);
    expect(manter).toEqual([
      {
        channelId: 'veio',
        name: 'veio',
        url: 'veio',
        extractedAt: 200,
        avatarUrl: 'foto',
        subscriberCountText: undefined,
        subscriberCountRaw: undefined,
        description: undefined,
      },
    ]);
  });
});

describe('canais que ficaram fora da lista', () => {
  it('pega só o ativo que a leitura não trouxe', () => {
    const fora = canaisForaDaLista(
      [canal('lido', { extractedAt: 200 }), canal('fora'), canal('saiu', { unsubscribedAt: 50 })],
      150,
    );
    expect(fora.map((c) => c.channelId)).toEqual(['fora']);
  });
  it('voltou a aparecer: deixa de contar como sumido', () => {
    const r = mesclarCanal(canal('a', { sumiuDaListaEm: 9, mantido: true }), canal('a'));
    expect(r.sumiuDaListaEm).toBeUndefined();
    expect(r.mantido).toBe(true);
  });
  it('sumido fica só no filtro dele, fora da lista de cancelar', () => {
    const lista = [canal('a'), canal('b', { sumiuDaListaEm: 9, pendingUnsub: true })];
    const filtros: Filtros = {
      visao: { tipo: 'sumidos' },
      busca: '',
      paradoDias: 0,
      ordem: 'nome',
    };
    const c = { assuntos: {}, valeOlhar: [] };
    expect(filtrarCanais(lista, filtros, c).map((x) => x.channelId)).toEqual(['b']);
    expect(
      filtrarCanais(lista, { ...filtros, visao: { tipo: 'todos' } }, c).map((x) => x.channelId),
    ).toEqual(['a']);
    expect(
      filtrarCanais(lista, { ...filtros, visao: { tipo: 'marcados' } }, c).map((x) => x.channelId),
    ).toEqual([]);
    expect(canaisNaLista(lista).map((x) => x.channelId)).toEqual(['a']);
  });
});
