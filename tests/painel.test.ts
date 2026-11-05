import { describe, expect, it } from 'vitest';
import {
  camposDoEstado,
  falaDeIA,
  filtrarCanais,
  inicialDoCanal,
  resumoAssuntos,
  textoInscritos,
  textoUltimoVideo,
  vistosDoCanal,
  type Classificacao,
  type Filtros,
} from '../src/painel/logica';
import type { Channel } from '../src/shared/types';

const AGORA = 1_800_000_000_000;
const DIA = 86_400_000;

function canal(channelId: string, extra: Partial<Channel> = {}): Channel {
  return {
    channelId,
    name: channelId,
    url: `https://www.youtube.com/${channelId}`,
    extractedAt: 1,
    ...extra,
  };
}

const CLASSIFICACAO: Classificacao = {
  assuntos: { a: 'Infantil', b: 'Infantil', c: 'Música' },
  valeOlhar: ['b'],
};

const CANAIS = [
  canal('a', { name: 'Ábaco', subscriberCountRaw: 10, lastUploadAt: AGORA - 400 * DIA }),
  canal('b', {
    name: 'Bola',
    subscriberCountRaw: 30,
    description: 'canções',
    lastUploadAt: AGORA - 10 * DIA,
  }),
  canal('c', { name: 'Coral', subscriberCountRaw: 20 }),
];

const BASE: Filtros = {
  visao: { tipo: 'todos' },
  busca: '',
  paradoDias: 0,
  ordem: 'inscritos-maior',
};
const ids = (lista: Channel[]): string[] => lista.map((c) => c.channelId);
const filtrar = (f: Partial<Filtros>): string[] =>
  ids(filtrarCanais(CANAIS, { ...BASE, ...f }, CLASSIFICACAO, {}, AGORA));

describe('filtrarCanais', () => {
  it('ordena por inscritos por padrão', () => {
    expect(filtrar({})).toEqual(['b', 'c', 'a']);
  });
  it('filtra por assunto', () => {
    expect(filtrar({ visao: { tipo: 'assunto', assunto: 'Infantil' } })).toEqual(['b', 'a']);
  });
  it('canal sem classificação cai em Outros', () => {
    const lista = filtrarCanais(
      [canal('novo')],
      { ...BASE, visao: { tipo: 'assunto', assunto: 'Outros' } },
      CLASSIFICACAO,
      {},
      AGORA,
    );
    expect(ids(lista)).toEqual(['novo']);
  });
  it('mostra os que valem olhar', () => {
    expect(filtrar({ visao: { tipo: 'olhar' } })).toEqual(['b']);
  });
  it('busca sem diferenciar acento nem maiúscula, no nome e na descrição', () => {
    expect(filtrar({ busca: 'abaco' })).toEqual(['a']);
    expect(filtrar({ busca: 'CANCOES' })).toEqual(['b']);
  });
  it('filtro de parado ignora canal sem data', () => {
    expect(filtrar({ paradoDias: 365 })).toEqual(['a']);
  });
  it('vídeo mais antigo primeiro, com canal sem data no fim', () => {
    expect(filtrar({ ordem: 'video-antigo' })).toEqual(['a', 'b', 'c']);
  });
  it('ordena por nome', () => {
    expect(filtrar({ ordem: 'nome' })).toEqual(['a', 'b', 'c']);
  });
});

describe('canais conferidos', () => {
  const DECIDIDOS = [canal('a', { pendingUnsub: true }), canal('b', { mantido: true }), canal('c')];
  const lista = (visao: Filtros['visao']): string[] =>
    ids(filtrarCanais(DECIDIDOS, { ...BASE, visao }, CLASSIFICACAO, {}, AGORA));
  it('canal decidido sai de todas as listas de conferência', () => {
    expect(lista({ tipo: 'todos' })).toEqual(['c']);
    expect(lista({ tipo: 'assunto', assunto: 'Infantil' })).toEqual([]);
    expect(lista({ tipo: 'olhar' })).toEqual([]);
  });
  it('cada decisão vai para o seu filtro', () => {
    expect(lista({ tipo: 'marcados' })).toEqual(['a']);
    expect(lista({ tipo: 'mantidos' })).toEqual(['b']);
  });
  it('tirar e manter não valem ao mesmo tempo', () => {
    expect(camposDoEstado('tirar')).toEqual({ pendingUnsub: true, mantido: false });
    expect(camposDoEstado('manter')).toEqual({ pendingUnsub: false, mantido: true });
    expect(camposDoEstado('conferir')).toEqual({ pendingUnsub: false, mantido: false });
  });
  it('o resumo conta só o que falta conferir e mostra quantos vão sair', () => {
    expect(resumoAssuntos(DECIDIDOS, CLASSIFICACAO)).toEqual([
      { assunto: 'Música', total: 1, marcados: 0 },
      { assunto: 'Infantil', total: 0, marcados: 1 },
    ]);
  });
});

describe('Assisti ultimamente', () => {
  const VISTOS = { '@joão': 5, uc123: 2 };
  const LISTA = [
    canal('@Jo%C3%A3o', { subscriberCountRaw: 1 }),
    canal('@outro', { resolvedUcid: 'UC123', subscriberCountRaw: 2 }),
    canal('@nunca', { subscriberCountRaw: 3 }),
  ];
  it('acha o canal pelo nome de usuário ou pelo código', () => {
    expect(vistosDoCanal(LISTA[0] as Channel, VISTOS)).toBe(5);
    expect(vistosDoCanal(LISTA[1] as Channel, VISTOS)).toBe(2);
    expect(vistosDoCanal(LISTA[2] as Channel, VISTOS)).toBe(0);
  });
  it('mostra só os assistidos, do mais visto para o menos', () => {
    const lista = filtrarCanais(
      LISTA,
      { ...BASE, visao: { tipo: 'assistidos' }, ordem: 'mais-vistos' },
      CLASSIFICACAO,
      VISTOS,
      AGORA,
    );
    expect(ids(lista)).toEqual(['@Jo%C3%A3o', '@outro']);
  });
});

describe('falaDeIA', () => {
  const fala = (name: string, description = ''): boolean =>
    falaDeIA(canal('x', { name, description }), CLASSIFICACAO);
  it('reconhece os termos de IA', () => {
    expect(fala('Rafa Voss | IA na Prática')).toBe(true);
    expect(fala('Canal', 'novidades de inteligência artificial')).toBe(true);
    expect(fala('Canal', 'Tools, software, AI, and gear')).toBe(true);
    expect(fala('Canal', 'usar a plataforma n8n')).toBe(true);
    expect(fala('Canal', 'dicas de Chat GPT')).toBe(true);
    expect(fala("JOKER DAS IA'S")).toBe(true);
  });
  it('não confunde com palavras comuns', () => {
    expect(fala('Testa Ai Careca!')).toBe(false);
    expect(fala('Canal', 'eu ia viajar e fui para a Bahia')).toBe(false);
    expect(fala('Canal', 'Automação Residencial')).toBe(false);
  });
  it('aceita canal incluído à mão', () => {
    expect(falaDeIA(canal('z'), { assuntos: {}, valeOlhar: [], iaExtra: ['z'] })).toBe(true);
  });
  it('filtra na visão de IA', () => {
    const lista = filtrarCanais(
      [canal('a', { name: 'IA hoje' }), canal('b')],
      { ...BASE, visao: { tipo: 'ia' } },
      CLASSIFICACAO,
      {},
      AGORA,
    );
    expect(ids(lista)).toEqual(['a']);
  });
});

describe('textos', () => {
  it('acha a inicial mesmo com símbolo no começo do nome', () => {
    expect(inicialDoCanal('#Refúgio Mental')).toBe('R');
    expect(inicialDoCanal('🌟Mary Silva')).toBe('M');
    expect(inicialDoCanal('3em3')).toBe('3');
    expect(inicialDoCanal('🌟')).toBe('?');
  });
  it('limpa o número de inscritos', () => {
    expect(textoInscritos(canal('a', { subscriberCountText: '1,2 mi de inscritos' }))).toBe(
      '1,2 mi',
    );
    expect(textoInscritos(canal('a', { subscriberCountText: '43,2 mil inscritos' }))).toBe(
      '43,2 mil',
    );
    expect(textoInscritos(canal('a', { subscriberCountText: '1 inscrito' }))).toBe('1');
  });
  it('mostra a data do último vídeo ou a situação', () => {
    expect(textoUltimoVideo(canal('a', { lastUploadAt: AGORA - 40 * DIA }), AGORA)).toBe(
      'há 1 mês',
    );
    expect(textoUltimoVideo(canal('a', { lastUploadAt: AGORA - 800 * DIA }), AGORA)).toBe(
      'há 2 anos',
    );
    expect(textoUltimoVideo(canal('a', { enrichmentStatus: 'no-uploads' }), AGORA)).toBe(
      'sem vídeos',
    );
    expect(textoUltimoVideo(canal('a', { enrichmentStatus: 'ok' }), AGORA)).toBe(
      'só Shorts ou lives',
    );
    expect(textoUltimoVideo(canal('a', { enrichmentStatus: 'ok', videoCount: 30 }), AGORA)).toBe(
      'a checar',
    );
  });
});
