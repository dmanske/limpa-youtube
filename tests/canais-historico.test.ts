import { describe, expect, it } from 'vitest';
import { chaveDoLink, contarCanais } from '../src/content/historico';
import { contarPorNome, mesclarCanal } from '../src/shared/canais';
import type { Channel } from '../src/shared/types';

const base: Channel = { channelId: '@a', name: 'A', url: 'u', extractedAt: 1 };

describe('mesclarCanal', () => {
  it('reescanear mantém datas, foto e decisões', () => {
    const atual: Channel = {
      ...base,
      lastUploadAt: 10,
      avatarUrl: 'foto',
      enrichedAt: 5,
      videoCount: 30,
      pendingUnsub: true,
      mantido: false,
    };
    const novo: Channel = { ...base, name: 'A novo', extractedAt: 2, avatarUrl: undefined };
    expect(mesclarCanal(atual, novo)).toEqual({ ...atual, name: 'A novo', extractedAt: 2 });
  });
  it('canal novo entra como veio', () => {
    expect(mesclarCanal(undefined, base)).toEqual(base);
  });
  it('canal que voltou a aparecer nas inscrições deixa de contar como cancelado', () => {
    const r = mesclarCanal({ ...base, unsubscribedAt: 9, pendingUnsub: false }, base);
    expect(r.unsubscribedAt).toBeUndefined();
    expect(r.pendingUnsub).toBe(false);
  });
});

describe('chaveDoLink', () => {
  it('normaliza os dois formatos de link de canal', () => {
    expect(chaveDoLink('/@Canal/videos')).toBe('@canal');
    expect(chaveDoLink('/@Jo%C3%A3o?x=1')).toBe('@joão');
    expect(chaveDoLink('/channel/UC123')).toBe('uc123');
  });
});

describe('contarCanais', () => {
  it('conta por canal nos dois modelos de item e separa o que não tem canal', () => {
    const raiz = document.createElement('div');
    raiz.innerHTML = `
      <ytd-video-renderer><a href="/watch?v=1">v</a><ytd-channel-name><a href="/@Um">Um</a></ytd-channel-name></ytd-video-renderer>
      <yt-lockup-view-model><a href="/watch?v=2">v</a><a href="/@um/videos">Um</a></yt-lockup-view-model>
      <yt-lockup-view-model><a href="/channel/UCdois">Dois</a></yt-lockup-view-model>
      <yt-lockup-view-model><a href="/shorts/3">s</a></yt-lockup-view-model>`;
    expect(contarCanais(raiz)).toEqual({
      contagem: { '@um': 2, ucdois: 1 },
      videos: 3,
      semCanal: 1,
      textosSemCanal: [['s']],
    });
  });
  it('respeita o limite de vídeos', () => {
    const raiz = document.createElement('div');
    raiz.innerHTML = '<ytd-video-renderer><a href="/@a">a</a></ytd-video-renderer>'.repeat(5);
    expect(contarCanais(raiz, 2).videos).toBe(2);
  });
  it('guarda os textos do vídeo que só tem link para /watch, como na página real', () => {
    const raiz = document.createElement('div');
    raiz.innerHTML = '<yt-lockup-view-model><a href="/watch?v=1">v</a></yt-lockup-view-model>';
    Object.defineProperty(raiz.firstElementChild, 'innerText', {
      value: '11:31\nTítulo do vídeo\nCanal Exemplo\n9,3 mil',
    });
    expect(contarCanais(raiz)).toEqual({
      contagem: {},
      videos: 0,
      semCanal: 1,
      textosSemCanal: [['11:31', 'Título do vídeo', 'Canal Exemplo', '9,3 mil']],
    });
  });
});

describe('contarPorNome', () => {
  const canais = [
    { channelId: '@CanalExemplo', name: 'Canal Exemplo' },
    { channelId: 'UCmusica', name: 'Música' },
  ];
  it('acha o canal pelo nome na tela, com a mesma chave que o painel usa', () => {
    const r = contarPorNome(
      [
        ['11:31', 'Título', 'canal exemplo', '9,3 mil'],
        ['Outro título', 'Canal Exemplo'],
      ],
      canais,
    );
    expect(r).toEqual({ contagem: { '@canalexemplo': 2 }, reconhecidos: 2 });
  });
  it('quando o título é igual ao nome de outro canal, vale o canal, que vem depois', () => {
    expect(contarPorNome([['Música', 'Canal Exemplo', '10 mil']], canais).contagem).toEqual({
      '@canalexemplo': 1,
    });
  });
  it('não conta vídeo de canal fora da lista', () => {
    expect(contarPorNome([['Título', 'Canal de fora']], canais)).toEqual({
      contagem: {},
      reconhecidos: 0,
    });
  });
});
