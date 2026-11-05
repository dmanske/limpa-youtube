import type { Channel, ExtractionProgress } from '../shared/types';
import { ehNumeroCurto, falaDeInscritos, lerContagemPortugues } from './idioma';
import { SELECTORS, URLS } from './selectors';
import {
  removeOverlay,
  setOverlayComplete,
  setOverlayError,
  showOverlay,
  updateOverlay,
} from './progress-overlay';
import { autoScrollSubscriptionsFeed, pageScrollTop } from './scroll';

const BATCH_SIZE = 50;

const SUBSCRIBER_SELECTORS = [
  '#subscribers',
  '#video-count',
  '#metadata',
  '#metadata-line',
] as const;

export function parseSubscriberCount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('@')) return undefined;

  const contagemPortugues = lerContagemPortugues(trimmed);
  if (contagemPortugues !== undefined) return contagemPortugues;

  const looksLikeCount = /(?:^|\s)\d[\d.,]*\s*[KMB]?\s*(subscriber|sub)/i.test(trimmed);
  const pureUnitNumber = /^\d[\d.,]*\s*[KMB]?$/i.test(trimmed);
  if (!looksLikeCount && !pureUnitNumber) return undefined;

  const match = trimmed.match(/([\d.,]+)\s*([KMB])\b/i) ?? trimmed.match(/([\d.,]+)/);
  if (!match) return undefined;

  const numStr = match[1]?.replace(/,/g, '');
  if (!numStr) return undefined;
  const num = parseFloat(numStr);
  if (!isFinite(num)) return undefined;
  const suffix = match[2]?.toUpperCase();
  switch (suffix) {
    case 'K':
      return Math.round(num * 1_000);
    case 'M':
      return Math.round(num * 1_000_000);
    case 'B':
      return Math.round(num * 1_000_000_000);
    default:
      return Math.round(num);
  }
}

export function channelIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, location.origin);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return undefined;
    return segments[segments.length - 1];
  } catch {
    return undefined;
  }
}

function textOf(el: Element | null | undefined): string | undefined {
  return el?.textContent?.trim() || undefined;
}

export function findSubscriberText(card: Element): string | undefined {
  for (const sel of SUBSCRIBER_SELECTORS) {
    const text = textOf(card.querySelector(sel));
    if (text && falaDeInscritos(text)) return text;
  }
  for (const sel of SUBSCRIBER_SELECTORS) {
    const text = textOf(card.querySelector(sel));
    if (text && ehNumeroCurto(text)) return text;
  }
  const ariaLabel = (card as HTMLElement).getAttribute('aria-label');
  if (ariaLabel && falaDeInscritos(ariaLabel)) return ariaLabel;
  return undefined;
}

function cleanDescription(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.replace(/\s+/g, ' ').trim() || undefined;
}

export function parseCard(card: Element): Channel | null {
  const linkEl = card.querySelector<HTMLAnchorElement>(SELECTORS.channelLink);
  const url = linkEl?.href;
  const channelId = channelIdFromUrl(url);
  if (!channelId || !url) return null;

  const nameEl = card.querySelector(SELECTORS.channelName);
  const name = textOf(nameEl) ?? channelId;

  const avatarEl = card.querySelector<HTMLImageElement>(SELECTORS.channelAvatar);
  const avatarUrl = avatarEl?.src || undefined;

  const subsText = findSubscriberText(card);
  const subscriberCountRaw = parseSubscriberCount(subsText);

  const descEl = card.querySelector(SELECTORS.description);
  const description = cleanDescription(textOf(descEl));

  return {
    channelId,
    name,
    url,
    avatarUrl,
    subscriberCountText: subsText,
    subscriberCountRaw,
    description,
    extractedAt: Date.now(),
  };
}

async function saveDebugDump(): Promise<void> {
  try {
    const firstCard = document.querySelector(SELECTORS.channelCard);
    if (!firstCard) return;
    const html = firstCard.outerHTML.slice(0, 8000);
    const sampleSubs: Record<string, string | null> = {};
    for (const sel of SUBSCRIBER_SELECTORS) {
      sampleSubs[sel] = firstCard.querySelector(sel)?.textContent?.trim() ?? null;
    }
    await chrome.storage.local.set({
      lastDebugDump: {
        capturedAt: Date.now(),
        url: location.href,
        cardCount: document.querySelectorAll(SELECTORS.channelCard).length,
        firstCardOuterHTML: html,
        subscriberCandidates: sampleSubs,
        pickedSubscriberText: findSubscriberText(firstCard) ?? null,
      },
    });
  } catch {
    /* never let the debug dump break extraction */
  }
}

export interface ExtractOptions {
  onProgress?: (progress: ExtractionProgress) => void | Promise<void>;
  onBatch?: (channels: Channel[], progress: ExtractionProgress) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface ResultadoLeitura {
  canais: Channel[];
  /** A rolagem chegou ao fim da lista. */
  completo: boolean;
}

export async function extractAll(options: ExtractOptions = {}): Promise<ResultadoLeitura> {
  if (!location.pathname.startsWith('/feed/channels')) {
    location.href = URLS.subscriptionsFeed;
    throw new Error('Navigated to /feed/channels. Re-run extraction after page loads.');
  }

  const start = Date.now();
  const startScroll = pageScrollTop();
  await showOverlay();
  updateOverlay(0, 'Rolando a lista…');

  try {
    const completo = await autoScrollSubscriptionsFeed((tick) => {
      const label = tick.isLoading ? 'Carregando mais…' : 'Rolando a lista…';
      updateOverlay(tick.count, label);
      void options.onProgress?.({
        loaded: tick.count,
        phase: 'scrolling',
      });
    }, options.signal);

    if (options.signal?.aborted) {
      removeOverlay();
      throw new DOMException('Extraction cancelled', 'AbortError');
    }

    updateOverlay(0, 'Lendo os canais…');
    void options.onProgress?.({ loaded: 0, phase: 'parsing' });
    await saveDebugDump();

    const cards = Array.from(document.querySelectorAll(SELECTORS.channelCard));
    const totalCards = cards.length;
    const all: Channel[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < cards.length; i++) {
      if (options.signal?.aborted) break;
      const card = cards[i];
      if (!card) continue;
      const channel = parseCard(card);
      if (!channel || seen.has(channel.channelId)) continue;
      seen.add(channel.channelId);
      all.push(channel);

      if (all.length % BATCH_SIZE === 0) {
        const batch = all.slice(all.length - BATCH_SIZE);
        const progress: ExtractionProgress = {
          loaded: all.length,
          total: totalCards,
          current: channel.name,
          phase: 'parsing',
        };
        updateOverlay(all.length, `Lendo ${all.length} de ${totalCards}`);
        await options.onBatch?.(batch, progress);
      }
    }

    const remainder = all.length % BATCH_SIZE;
    if (remainder > 0) {
      const batch = all.slice(all.length - remainder);
      await options.onBatch?.(batch, {
        loaded: all.length,
        total: totalCards,
        phase: 'parsing',
      });
    }

    setOverlayComplete(all.length, Date.now() - start);
    window.scrollTo(0, startScroll);
    return { canais: all, completo };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      removeOverlay();
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    setOverlayError(msg);
    throw err;
  } finally {
    setTimeout(removeOverlay, 6000);
  }
}
