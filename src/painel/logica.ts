import { chaveNormalizada } from '../shared/canais';
import type { Channel } from '../shared/types';

export const SEM_ASSUNTO = 'Outros';
const DIA_MS = 86_400_000;

export type Estado = 'conferir' | 'tirar' | 'manter';

export type Visao =
  | { tipo: 'todos' }
  | { tipo: 'marcados' }
  | { tipo: 'mantidos' }
  | { tipo: 'sumidos' }
  | { tipo: 'olhar' }
  | { tipo: 'ia' }
  | { tipo: 'assistidos' }
  | { tipo: 'assunto'; assunto: string };

export type Ordem = 'inscritos-maior' | 'inscritos-menor' | 'nome' | 'video-antigo' | 'mais-vistos';

export interface Classificacao {
  assuntos: Record<string, string>;
  valeOlhar: string[];
  /** Canais de IA que não usam nenhum dos termos no nome nem na descrição. */
  iaExtra?: string[];
}

export type ContagemVistos = Record<string, number>;

export interface Filtros {
  visao: Visao;
  busca: string;
  paradoDias: number;
  ordem: Ordem;
}

function normalizar(texto: string | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function assuntoDe(canal: Channel, classificacao: Classificacao): string {
  return classificacao.assuntos[canal.channelId] ?? SEM_ASSUNTO;
}

export function estadoDe(canal: Channel): Estado {
  if (canal.pendingUnsub) return 'tirar';
  if (canal.mantido) return 'manter';
  return 'conferir';
}

export function camposDoEstado(estado: Estado): Pick<Channel, 'pendingUnsub' | 'mantido'> {
  return { pendingUnsub: estado === 'tirar', mantido: estado === 'manter' };
}

// Maiúsculas importam: "IA" e "AI" são a sigla; "ia" é o verbo e "ai" é o "aí" sem acento.
const SIGLA_IA =
  /(?<![\p{L}\p{N}])(?:IAs?|I\.A\.?|AI)(?![\p{L}\p{N}])|DinastIA|EntusIAsta|IA['’]s/u;
const TERMOS_IA =
  /intelig[eê]ncias? artificia|chat ?gpt|\bgpt-?\d|openai|anthropic|\bclaude\b|\bgemini\b|machine learning|vibe ?coding|\bllms?\b|\bn8n\b|agentes? (?:de )?(?:ia|ai)\b|\bmidjourney\b|\bprompts?\b|\blovable\b/i;

/** O canal fala de inteligência artificial, pelo nome ou pela descrição? */
export function falaDeIA(canal: Channel, classificacao: Classificacao): boolean {
  if (classificacao.iaExtra?.includes(canal.channelId)) return true;
  const texto = `${canal.name} ${canal.description ?? ''}`;
  return SIGLA_IA.test(texto) || TERMOS_IA.test(texto);
}

/** Canais que ainda estão inscritos. O que já foi cancelado não aparece no painel. */
export function canaisAtivos(canais: Channel[]): Channel[] {
  return canais.filter((c) => !c.unsubscribedAt);
}

/** Canais que a última leitura completa não trouxe. Ficam só no filtro "Não apareceram". */
export function canaisForaDaListaNoPainel(canais: Channel[]): Channel[] {
  return canais.filter((c) => c.sumiuDaListaEm !== undefined);
}

export function canaisNaLista(canais: Channel[]): Channel[] {
  return canais.filter((c) => c.sumiuDaListaEm === undefined);
}

/** Quantos vídeos deste canal apareceram no histórico lido. */
export function vistosDoCanal(canal: Channel, vistos: ContagemVistos): number {
  const chaves = new Set([chaveNormalizada(canal.channelId)]);
  if (canal.resolvedUcid) chaves.add(chaveNormalizada(canal.resolvedUcid));
  let total = 0;
  for (const chave of chaves) total += vistos[chave] ?? 0;
  return total;
}

/** Assuntos com o que falta conferir e o que já vai sair, do maior para o menor. */
export function resumoAssuntos(
  canais: Channel[],
  classificacao: Classificacao,
): Array<{ assunto: string; total: number; marcados: number }> {
  const mapa = new Map<string, { total: number; marcados: number }>();
  for (const canal of canais) {
    const assunto = assuntoDe(canal, classificacao);
    const item = mapa.get(assunto) ?? { total: 0, marcados: 0 };
    const estado = estadoDe(canal);
    if (estado === 'conferir') item.total += 1;
    if (estado === 'tirar') item.marcados += 1;
    mapa.set(assunto, item);
  }
  return [...mapa.entries()]
    .map(([assunto, item]) => ({ assunto, ...item }))
    .sort((a, b) => b.total - a.total || a.assunto.localeCompare(b.assunto, 'pt-BR'));
}

export function filtrarCanais(
  canais: Channel[],
  filtros: Filtros,
  classificacao: Classificacao,
  vistos: ContagemVistos = {},
  agora: number = Date.now(),
): Channel[] {
  const busca = normalizar(filtros.busca.trim());
  const olhar = new Set(classificacao.valeOlhar);
  const { visao } = filtros;
  const estadoDaVisao: Estado =
    visao.tipo === 'marcados' ? 'tirar' : visao.tipo === 'mantidos' ? 'manter' : 'conferir';

  const lista = canais.filter((canal) => {
    if ((visao.tipo === 'sumidos') !== (canal.sumiuDaListaEm !== undefined)) return false;
    if (visao.tipo !== 'sumidos' && estadoDe(canal) !== estadoDaVisao) return false;
    if (visao.tipo === 'olhar' && !olhar.has(canal.channelId)) return false;
    if (visao.tipo === 'ia' && !falaDeIA(canal, classificacao)) return false;
    if (visao.tipo === 'assistidos' && vistosDoCanal(canal, vistos) === 0) return false;
    if (visao.tipo === 'assunto' && assuntoDe(canal, classificacao) !== visao.assunto) return false;
    if (busca && !normalizar(`${canal.name} ${canal.description ?? ''}`).includes(busca)) {
      return false;
    }
    if (filtros.paradoDias > 0) {
      if (canal.lastUploadAt === undefined) return false;
      if (agora - canal.lastUploadAt < filtros.paradoDias * DIA_MS) return false;
    }
    return true;
  });

  return ordenarCanais(lista, filtros.ordem, vistos);
}

function ordenarCanais(lista: Channel[], ordem: Ordem, vistos: ContagemVistos): Channel[] {
  const copia = [...lista];
  const inscritos = (c: Channel): number => c.subscriberCountRaw ?? 0;
  switch (ordem) {
    case 'inscritos-menor':
      return copia.sort((a, b) => inscritos(a) - inscritos(b));
    case 'nome':
      return copia.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    case 'video-antigo':
      // Canal sem data vai para o fim, porque não dá para dizer que está parado.
      return copia.sort((a, b) => (a.lastUploadAt ?? Infinity) - (b.lastUploadAt ?? Infinity));
    case 'mais-vistos':
      return copia.sort(
        (a, b) =>
          vistosDoCanal(b, vistos) - vistosDoCanal(a, vistos) || inscritos(b) - inscritos(a),
      );
    default:
      return copia.sort((a, b) => inscritos(b) - inscritos(a));
  }
}

/** Primeira letra ou número do nome, para o lugar da foto quando ela não existe. */
export function inicialDoCanal(nome: string): string {
  const achou = nome.match(/[\p{L}\p{N}]/u);
  return achou ? achou[0].toUpperCase() : '?';
}

/** Mostra o número como no YouTube, sem a palavra "inscritos". */
export function textoInscritos(canal: Channel): string {
  const texto = canal.subscriberCountText;
  if (!texto) return canal.subscriberCountRaw?.toLocaleString('pt-BR') ?? 'Não informado';
  return texto
    .replace(/\u00a0/g, ' ')
    .replace(/\s*(de\s+)?inscritos?$/i, '')
    .replace(/\s*subscribers?$/i, '')
    .trim();
}

export function textoUltimoVideo(canal: Channel, agora: number = Date.now()): string {
  if (canal.lastUploadAt !== undefined) {
    const dias = Math.floor((agora - canal.lastUploadAt) / DIA_MS);
    if (dias < 1) return 'hoje';
    if (dias < 30) return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
    if (dias < 365) {
      const meses = Math.floor(dias / 30);
      return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
    }
    const anos = dias / 365;
    if (anos < 2) return `há ${anos.toFixed(1).replace('.', ',')} ano`;
    return `há ${Math.floor(anos)} anos`;
  }
  if (canal.enrichmentStatus === 'no-uploads') return 'sem vídeos';
  if (canal.enrichmentStatus === 'unreachable') return 'sem resposta';
  if (canal.enrichmentStatus === 'ok' && !canal.videoCount) return 'só Shorts ou lives';
  return 'a checar';
}

export interface GrupoPlaylist {
  assunto: string;
  canais: Array<{ channelId: string; resolvedUcid?: string; name: string }>;
}

/** Um grupo por assunto, para virar playlist. Canal em "Para tirar" fica de fora. */
export function gruposDePlaylist(canais: Channel[], classificacao: Classificacao): GrupoPlaylist[] {
  const mapa = new Map<string, GrupoPlaylist['canais']>();
  for (const { channelId, resolvedUcid, name, pendingUnsub } of canais) {
    if (pendingUnsub) continue;
    const assunto = classificacao.assuntos[channelId] ?? SEM_ASSUNTO;
    const lista = mapa.get(assunto) ?? [];
    lista.push({ channelId, resolvedUcid, name });
    mapa.set(assunto, lista);
  }
  return [...mapa.entries()]
    .map(([assunto, lista]) => ({ assunto, canais: lista }))
    .sort((a, b) => a.assunto.localeCompare(b.assunto, 'pt-BR'));
}

/** Canais ainda sem decisão que estavam em "Vou manter" no backup. Não troca decisão já tomada. */
export function mantidosDoBackup(atuais: Channel[], backup: Channel[]): string[] {
  const doBackup = new Set(backup.filter((c) => c.mantido).map((c) => c.channelId));
  return atuais
    .filter((c) => doBackup.has(c.channelId) && estadoDe(c) === 'conferir')
    .map((c) => c.channelId);
}
