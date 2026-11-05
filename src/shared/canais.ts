import type { Channel } from './types';

/**
 * Junta o que o escaneamento leu com o que já estava salvo. O escaneamento só conhece nome,
 * link, inscritos e descrição, então datas, foto e decisões continuam como estão. Se o canal
 * apareceu na lista de inscrições, a inscrição existe, então o cancelamento antigo deixa de valer.
 */
export function mesclarCanal(atual: Channel | undefined, novo: Channel): Channel {
  if (!atual) return novo;
  const preenchidos = Object.fromEntries(
    Object.entries(novo).filter(([, valor]) => valor !== undefined),
  );
  const juntos: Channel = { ...atual, ...preenchidos };
  if (juntos.unsubscribedAt) {
    delete juntos.unsubscribedAt;
    juntos.pendingUnsub = false;
  }
  delete juntos.sumiuDaListaEm;
  return juntos;
}

/**
 * Canais ativos que uma leitura completa, iniciada em `inicio`, não trouxe. Só vale para leitura
 * completa: numa leitura pela metade, faltar na lista não quer dizer nada.
 */
export function canaisForaDaLista(canais: Channel[], inicio: number): Channel[] {
  return canais.filter((c) => !c.unsubscribedAt && c.extractedAt < inicio);
}

/**
 * Começar do zero: fica só o que a leitura trouxe, sem datas nem decisões. Quem não veio sai da
 * lista. Roda depois da leitura completa, para uma leitura pela metade não apagar nada.
 */
export function zerarCanais(
  canais: Channel[],
  inicio: number,
): { manter: Channel[]; apagar: string[] } {
  const manter: Channel[] = [];
  const apagar: string[] = [];
  for (const c of canais) {
    if (c.extractedAt < inicio) {
      apagar.push(c.channelId);
      continue;
    }
    manter.push({
      channelId: c.channelId,
      name: c.name,
      url: c.url,
      avatarUrl: c.avatarUrl,
      subscriberCountText: c.subscriberCountText,
      subscriberCountRaw: c.subscriberCountRaw,
      description: c.description,
      extractedAt: c.extractedAt,
    });
  }
  return { manter, apagar };
}

/** Mesma chave para o que vem do histórico e para o que está salvo no canal. */
export function chaveNormalizada(valor: string): string {
  try {
    return decodeURIComponent(valor).toLowerCase();
  } catch {
    return valor.toLowerCase();
  }
}

function nomeComparavel(nome: string): string {
  return nome.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Conta vídeos do histórico pelo nome do canal escrito na tela. Vale a última linha que bate,
 * porque o nome do canal vem depois do título, e um título pode ser igual ao nome de outro canal.
 */
export function contarPorNome(
  textos: string[][],
  canais: Pick<Channel, 'channelId' | 'name'>[],
): { contagem: Record<string, number>; reconhecidos: number } {
  const porNome = new Map<string, string[]>();
  for (const canal of canais) {
    const nome = nomeComparavel(canal.name);
    if (!nome) continue;
    porNome.set(nome, [...(porNome.get(nome) ?? []), chaveNormalizada(canal.channelId)]);
  }
  const contagem: Record<string, number> = {};
  let reconhecidos = 0;
  for (const linhas of textos) {
    const achada = [...linhas].reverse().find((linha) => porNome.has(nomeComparavel(linha)));
    if (achada === undefined) continue;
    reconhecidos += 1;
    for (const chave of porNome.get(nomeComparavel(achada)) ?? []) {
      contagem[chave] = (contagem[chave] ?? 0) + 1;
    }
  }
  return { contagem, reconhecidos };
}
