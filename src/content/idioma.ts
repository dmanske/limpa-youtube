/**
 * Palavras do YouTube em inglês e em português, num só lugar.
 *
 * A extensão original só reconhecia os botões em inglês. Se o YouTube mudar um texto,
 * o ajuste é feito aqui. Tudo é comparado em minúsculas e sem acento.
 *
 * Regra de segurança: "Cancelar" sozinho NUNCA confirma nada. Na janela de confirmação
 * em português, "Cancelar" é o botão de desistir e "Cancelar inscrição" é o de confirmar.
 */

/** Minúsculas, sem acento e com espaços simples. */
export function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const ROTULOS_JA_INSCRITO = [
  'unsubscribe from',
  'subscribed to',
  'cancelar inscricao',
  'cancelar a inscricao',
  'inscrito',
  'inscrita',
  'voce se inscreveu',
  'anular subscricao',
  'subscrito',
];

const TEXTO_JA_INSCRITO = /\b(subscribed|inscrito|inscrita|subscrito|subscrita)\b/;

const ROTULOS_INSCREVER = ['subscribe to', 'inscreva-se', 'inscrever-se', 'subscrever'];

const TEXTOS_INSCREVER = ['subscribe', 'inscreva-se', 'inscrever-se', 'subscrever'];

const ITENS_CANCELAR = [
  'unsubscribe',
  'cancelar inscricao',
  'cancelar a inscricao',
  'anular subscricao',
];

const TEXTOS_CONFIRMAR = [...ITENS_CANCELAR, 'confirm', 'confirmar', 'ok'];

export const AVISOS_CAPTCHA = [
  "verify that you're not a robot",
  "verify it's you",
  'unusual traffic',
  'unusual activity',
  'recaptcha',
  'nao sou um robo',
  'voce nao e um robo',
  'confirme que e voce',
  'confirme que voce',
  'trafego incomum',
  'atividade incomum',
];

/** O botão do cartão mostra que você já está inscrito? */
export function botaoIndicaInscrito(rotulo: string | null, texto: string | null): boolean {
  const r = normalizar(rotulo);
  if (ROTULOS_JA_INSCRITO.some((inicio) => r.startsWith(inicio))) return true;
  return TEXTO_JA_INSCRITO.test(normalizar(texto));
}

/** O botão do cartão oferece se inscrever (ou seja, a inscrição já foi cancelada)? */
export function botaoIndicaInscrever(rotulo: string | null, texto: string | null): boolean {
  const r = normalizar(rotulo);
  if (ROTULOS_INSCREVER.some((inicio) => r.startsWith(inicio))) return true;
  return TEXTOS_INSCREVER.includes(normalizar(texto));
}

/** O item do menu do botão "Inscrito" é o de cancelar a inscrição? */
export function ehItemCancelarInscricao(texto: string | null): boolean {
  const t = normalizar(texto);
  return ITENS_CANCELAR.some((item) => t === item || t.startsWith(`${item} `));
}

/** O botão da janela de confirmação confirma o cancelamento? "Cancelar" sozinho não. */
export function ehBotaoConfirmar(texto: string | null): boolean {
  return TEXTOS_CONFIRMAR.includes(normalizar(texto));
}

/** Texto da página sugere captcha ou verificação de conta? */
export function textoIndicaCaptcha(texto: string | null): boolean {
  const t = normalizar(texto);
  return AVISOS_CAPTCHA.some((aviso) => t.includes(aviso));
}

/** O texto fala em inscritos, em inglês ou em português? */
export function falaDeInscritos(texto: string): boolean {
  return /subscriber|inscrit|subscritor/i.test(texto);
}

/** Texto é só um número curto, como "1.2M", "12,3 mil" ou "1,2 mi"? */
export function ehNumeroCurto(texto: string): boolean {
  return /^\d[\d.,]*\s*(?:[KMB]|mil|mi|bi|milh(?:ao|ão|oes|ões)|bilh(?:ao|ão|oes|ões))?$/i.test(
    texto.trim(),
  );
}

const CONTAGEM_PORTUGUES =
  /(\d[\d.,]*)\s*(mil|mi|bi|milh(?:ao|oes)|bilh(?:ao|oes))?\b(?:\s*de)?(?:\s*(?:inscrit|subscritor)|\s*$)/;

/**
 * Lê contagens no formato brasileiro: "950 inscritos", "12,3 mil inscritos", "1,2 mi de
 * inscritos". Vírgula é decimal; ponto é separador de milhar ("1.234 inscritos" = 1234).
 * Formatos em inglês ("1.2M") ficam com o leitor original, que devolve undefined aqui.
 */
export function lerContagemPortugues(texto: string): number | undefined {
  const t = normalizar(texto);
  const achou = t.match(CONTAGEM_PORTUGUES);
  if (!achou?.[1]) return undefined;
  const sufixo = achou[2];
  const falaPortugues = /inscrit|subscritor/.test(t);
  if (!sufixo && !falaPortugues) return undefined;

  const numero = parseFloat(achou[1].replace(/\./g, '').replace(',', '.'));
  if (!isFinite(numero)) return undefined;

  if (sufixo === 'mil') return Math.round(numero * 1_000);
  if (sufixo === 'mi' || sufixo?.startsWith('milh')) return Math.round(numero * 1_000_000);
  if (sufixo === 'bi' || sufixo?.startsWith('bilh')) return Math.round(numero * 1_000_000_000);
  return Math.round(numero);
}
