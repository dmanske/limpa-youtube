import { SELECTORS } from './selectors';

const SCROLL_DELAY_MS = 800;
const STABLE_MS = 2000;
const MAX_NO_PROGRESS_MS = 30_000;
const BOTTOM_THRESHOLD_PX = 300;
const MAX_SCROLL_ITERATIONS = 1200;
const NUDGE_AFTER_STALLS = 3;
const CONTINUACAO_SELECTOR = 'ytd-continuation-item-renderer';
const SPINNER_SELECTOR =
  'ytd-continuation-item-renderer, tp-yt-paper-spinner, tp-yt-paper-spinner-lite';

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function pageScrollTop(): number {
  return window.scrollY ?? document.documentElement.scrollTop ?? 0;
}

export function pageHeight(): number {
  return Math.max(document.documentElement.scrollHeight ?? 0, document.body?.scrollHeight ?? 0);
}

export function atBottom(thresholdPx = BOTTOM_THRESHOLD_PX): boolean {
  return window.scrollY + window.innerHeight >= pageHeight() - thresholdPx;
}

export function spinnerVisible(): boolean {
  const elements = document.querySelectorAll(SPINNER_SELECTOR);
  for (const el of elements) {
    const html = el as HTMLElement;
    if (html.offsetParent === null) continue;
    const rect = html.getBoundingClientRect();
    if (rect.height > 0 && rect.width > 0) return true;
  }
  return false;
}

/** Enquanto este item existe na tela, o YouTube ainda tem mais canais para entregar. */
export function aindaTemMais(): boolean {
  for (const el of document.querySelectorAll(CONTINUACAO_SELECTOR)) {
    const html = el as HTMLElement;
    if (html.offsetParent !== null && html.getBoundingClientRect().height > 0) return true;
  }
  return false;
}

export interface ScrollTickInfo {
  count: number;
  isLoading: boolean;
}

export type DecisaoRolagem = 'continuar' | 'completo' | 'incompleto';

/**
 * Decide quando parar de rolar. Só é "completo" com a prova de que a lista acabou: nenhum canal
 * novo, página no fim e o YouTube sem nada para entregar. O número no título da aba não entra
 * na conta, porque "(3)" são notificações, não inscrições.
 */
export function decidirRolagem(info: {
  cartoes: number;
  semNovidadeMs: number;
  noFim: boolean;
  temMais: boolean;
}): DecisaoRolagem {
  if (info.cartoes > 0 && info.noFim && !info.temMais && info.semNovidadeMs >= STABLE_MS) {
    return 'completo';
  }
  return info.semNovidadeMs >= MAX_NO_PROGRESS_MS ? 'incompleto' : 'continuar';
}

/** Rola até o fim da lista. Devolve se chegou mesmo ao fim. */
export async function autoScrollSubscriptionsFeed(
  onTick: (info: ScrollTickInfo) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  let lastCardCount = -1;
  let lastNewChannelAt = Date.now();
  let nudgeCount = 0;

  window.scrollTo(0, pageHeight());
  await abortableSleep(SCROLL_DELAY_MS, signal);

  for (let i = 0; i < MAX_SCROLL_ITERATIONS; i++) {
    if (signal?.aborted) return false;

    const cardsNow = document.querySelectorAll(SELECTORS.channelCard).length;
    const isLoading = spinnerVisible();
    onTick({ count: cardsNow, isLoading });

    if (cardsNow > lastCardCount) {
      lastNewChannelAt = Date.now();
      nudgeCount = 0;
      lastCardCount = cardsNow;
    } else {
      const decisao = decidirRolagem({
        cartoes: cardsNow,
        semNovidadeMs: Date.now() - lastNewChannelAt,
        noFim: atBottom(),
        temMais: aindaTemMais(),
      });
      if (decisao !== 'continuar') return decisao === 'completo';

      nudgeCount++;
      if (nudgeCount > 0 && nudgeCount % NUDGE_AFTER_STALLS === 0) {
        const h = pageHeight();
        const offset = nudgeCount >= NUDGE_AFTER_STALLS * 2 ? 1600 : 600;
        window.scrollTo(0, Math.max(0, h - offset));
        await abortableSleep(400, signal);
      }
    }

    window.scrollTo(0, pageHeight());
    await abortableSleep(SCROLL_DELAY_MS, signal);
  }
  return false;
}
