import {
  channelPageUrl,
  channelVideosUrl,
  classifyEnrichment,
  classifyWithFallback,
  effectiveUcid,
  extractChannelData,
} from '../shared/enrichment';
import type {
  EnrichmentProgress,
  EnrichmentResult,
  EnrichmentStatus,
  EnrichmentTarget,
} from '../shared/types';

const CONCURRENCY = 4;
const DISPATCH_JITTER_MIN_MS = 150;
const DISPATCH_JITTER_MAX_MS = 350;
const FETCH_TIMEOUT_MS = 15_000;
const BATCH_SIZE = 25;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const jitterMs = (): number =>
  DISPATCH_JITTER_MIN_MS + Math.random() * (DISPATCH_JITTER_MAX_MS - DISPATCH_JITTER_MIN_MS);

/** Result of fetching one page. A failed fetch is classified, never thrown — except a
 *  genuine external cancel (AbortError), which propagates to stop the whole run. */
export interface PageResult {
  ok: boolean;
  status?: number;
  text?: string;
  /** failure classification when !ok: 'http-<code>' | 'timeout' | 'network-error' */
  reason?: string;
}

export type PageFetcher = (url: string, signal?: AbortSignal) => Promise<PageResult>;

async function fetchWithTimeout(
  url: string,
  ms: number,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  const onExternalAbort = (): void => ctrl.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);
  try {
    if (externalSignal?.aborted) {
      throw new DOMException('Enrichment cancelled', 'AbortError');
    }
    // Fetch anonymously (`credentials:'omit'`). The service worker sends a desktop
    // User-Agent, so an anonymous request stays on the desktop www.youtube.com site
    // (the m.youtube.com redirect is UA-driven, not auth-driven) and yields the
    // markup the parser reads. Cookies are intentionally omitted: a logged-in
    // account's locale overrides Accept-Language/hl=en and returns localized upload
    // dates ("1개월 전") the English-only parser can't read. Public channel video
    // listings need no auth.
    return await fetch(url, { credentials: 'omit', ...init, signal: ctrl.signal });
  } catch (err) {
    // Our timeout fired (not an external cancel) — surface as a distinct error so the
    // caller marks just this channel "couldn't check" instead of aborting the run.
    if (timedOut && !externalSignal?.aborted) {
      throw new DOMException('Fetch timed out', 'TimeoutError');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Force the YouTube UI language to English with `hl=en`. We fetch anonymously and send
 * `Accept-Language: en`, which YouTube honours for anonymous requests — but `hl=en` is
 * cheap belt-and-suspenders that also survives the 303 vanity redirect, guaranteeing
 * English tab titles ("Videos", not "동영상") and upload dates ("1 month ago", not
 * "1개월 전") so the English-only parser can read them.
 */
export function withEnglishLocale(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}hl=en`;
}

/**
 * Default page fetcher — runs in the service worker, so it is CORS-exempt for
 * www.youtube.com (host_permissions) and follows YouTube's 303 vanity redirects that
 * block content-script fetches. Fetches anonymously (`credentials:'omit'`) with a desktop
 * User-Agent, so it stays on the desktop www site the parser understands rather than being
 * served an account-localized page. `Accept-Language: en` + `hl=en` keep tab titles and
 * upload dates in English.
 */
export const defaultFetchPage: PageFetcher = async (url, signal) => {
  try {
    const res = await fetchWithTimeout(
      withEnglishLocale(url),
      FETCH_TIMEOUT_MS,
      { headers: { 'Accept-Language': 'en' } },
      signal,
    );
    if (!res.ok) return { ok: false, status: res.status, reason: `http-${res.status}` };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, reason: 'timeout' };
    }
    // Genuine external cancel — propagate so the run stops.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { ok: false, reason: 'network-error' };
  }
};

export interface ChannelFetchOutcome {
  status: EnrichmentStatus;
  ucid?: string;
  lastUploadAt?: number;
  videoCount?: number;
  avatarUrl?: string;
  reason?: string;
  fallbackUsed?: string;
  urlChecked?: string;
  httpStatus?: number;
}

export async function fetchChannelPage(
  channelIdOrHandle: string,
  fetchPage: PageFetcher,
  signal?: AbortSignal,
): Promise<ChannelFetchOutcome> {
  const url = channelVideosUrl(channelIdOrHandle);
  const page = await fetchPage(url, signal);
  if (!page.ok) {
    return {
      status: 'unreachable',
      reason: page.reason ?? 'fetch-error',
      urlChecked: url,
      httpStatus: page.status,
    };
  }

  const data = extractChannelData(page.text ?? '');
  let classified = classifyEnrichment(data);
  let fallbackUsed: string | undefined;

  // The page parsed cleanly but shows no long-form videos: before concluding the channel
  // is empty, check the Shorts and Live tabs so Shorts/Live-only channels aren't mislabeled
  // as "no videos posted". classifyWithFallback returns "unreachable" rather than "no-uploads"
  // when a fallback fetch failed to load.
  if (classified.reason === 'genuinely-empty') {
    const pageUrl = channelPageUrl(channelIdOrHandle);
    const shorts = await fetchPage(`${pageUrl}/shorts`, signal);
    const live = await fetchPage(`${pageUrl}/streams`, signal);
    fallbackUsed = 'shorts+streams';
    classified = classifyWithFallback(
      data,
      shorts.ok ? shorts.text : undefined,
      live.ok ? live.text : undefined,
    );
  }

  return {
    status: classified.status,
    ucid: data.ucid,
    lastUploadAt: classified.lastUploadAt,
    videoCount: classified.videoCount,
    avatarUrl: data.avatarUrl,
    reason: classified.reason,
    fallbackUsed,
    urlChecked: url,
    httpStatus: page.status,
  };
}

let debugEnabled = false;

async function loadDebugFlag(): Promise<void> {
  try {
    const v = await chrome.storage.local.get('ytcleanup:debug');
    const flag = v['ytcleanup:debug'];
    debugEnabled = flag === '1' || flag === true;
  } catch {
    debugEnabled = false;
  }
}

/** Per-channel diagnostics in the service-worker console, opt-in via
 *  `chrome.storage.local['ytcleanup:debug'] = '1'`. */
function logEnrichDiag(target: EnrichmentTarget, outcome: ChannelFetchOutcome): void {
  if (!debugEnabled) return;
  // eslint-disable-next-line no-console
  console.debug('[enrich]', {
    channelId: target.channelId,
    urlChecked: outcome.urlChecked,
    resolvedUcid: outcome.ucid,
    status: outcome.status,
    reason: outcome.reason,
    httpStatus: outcome.httpStatus,
    videoCount: outcome.videoCount,
    lastUploadAt: outcome.lastUploadAt ? new Date(outcome.lastUploadAt).toISOString() : undefined,
    fallbackUsed: outcome.fallbackUsed,
  });
}

export async function enrichOne(
  target: EnrichmentTarget,
  fetchPage: PageFetcher,
  signal?: AbortSignal,
): Promise<EnrichmentResult> {
  // Prefer the canonical /channel/UCID URL (no redirect); fall back to the handle, whose
  // 303 redirect the service-worker fetch follows transparently and whose final page
  // yields the UCID we persist for next time.
  const existingUcid = effectiveUcid(target.channelId, target.resolvedUcid);
  const lookupId = existingUcid ?? target.channelId;
  const outcome = await fetchChannelPage(lookupId, fetchPage, signal);
  logEnrichDiag(target, outcome);
  return {
    channelId: target.channelId,
    resolvedUcid: outcome.ucid,
    lastUploadAt: outcome.lastUploadAt,
    videoCount: outcome.videoCount,
    avatarUrl: outcome.avatarUrl,
    enrichmentStatus: outcome.status,
  };
}

export interface EnrichRunOptions {
  onBatch: (results: EnrichmentResult[], progress: EnrichmentProgress) => void | Promise<void>;
  onProgress?: (progress: EnrichmentProgress) => void;
  /** Caller-owned cancellation signal. When supplied, cancellation is observed immediately
   *  (in-flight fetches abort) with no polling — the service worker aborts it directly. */
  signal?: AbortSignal;
  /** Legacy/test fallback: polled every 500ms when no `signal` is provided. */
  shouldCancel?: () => boolean;
}

export async function enrichAll(
  targets: EnrichmentTarget[],
  options: EnrichRunOptions,
  fetchPage: PageFetcher = defaultFetchPage,
): Promise<EnrichmentProgress> {
  const total = targets.length;
  const progress: EnrichmentProgress = {
    processed: 0,
    total,
    ok: 0,
    noUploads: 0,
    unreachable: 0,
  };

  if (total === 0) return progress;

  await loadDebugFlag();

  const abortController = new AbortController();
  // An external signal (the service worker's) drives cancellation directly — abort the
  // instant it fires, so in-flight fetches are torn down with no polling latency. The
  // 500ms poll is only a fallback for callers (tests) that supply just `shouldCancel`.
  let cancelPoll: ReturnType<typeof setInterval> | undefined;
  if (options.signal) {
    if (options.signal.aborted) abortController.abort();
    else options.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  } else if (options.shouldCancel) {
    cancelPoll = setInterval(() => {
      if (options.shouldCancel?.()) abortController.abort();
    }, 500);
  }

  const buffer: EnrichmentResult[] = [];
  let cursor = 0;
  const pickNext = (): EnrichmentTarget | undefined => {
    if (cursor >= targets.length) return undefined;
    return targets[cursor++];
  };

  async function worker(): Promise<void> {
    for (;;) {
      if (abortController.signal.aborted || options.shouldCancel?.()) {
        throw new DOMException('Enrichment cancelled', 'AbortError');
      }
      const target = pickNext();
      if (!target) return;
      await sleep(jitterMs());
      if (abortController.signal.aborted || options.shouldCancel?.()) {
        throw new DOMException('Enrichment cancelled', 'AbortError');
      }
      const result = await enrichOne(target, fetchPage, abortController.signal);
      progress.processed++;
      if (result.enrichmentStatus === 'ok') progress.ok++;
      else if (result.enrichmentStatus === 'no-uploads') progress.noUploads++;
      else progress.unreachable++;
      progress.current = target.channelId;
      buffer.push(result);

      if (buffer.length >= BATCH_SIZE) {
        const batch = buffer.splice(0, buffer.length);
        await options.onBatch(batch, { ...progress });
      } else {
        options.onProgress?.({ ...progress });
      }
    }
  }

  try {
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
    if (buffer.length > 0) {
      const batch = buffer.splice(0, buffer.length);
      await options.onBatch(batch, { ...progress });
    }
    return progress;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (debugEnabled) {
        // eslint-disable-next-line no-console
        console.debug('[enrich] cancel observed', {
          processed: progress.processed,
          at: Date.now(),
        });
      }
      if (buffer.length > 0) {
        const batch = buffer.splice(0, buffer.length);
        try {
          await options.onBatch(batch, { ...progress });
        } catch {
          /* best effort flush */
        }
      }
      throw err;
    }
    throw err;
  } finally {
    if (cancelPoll) clearInterval(cancelPoll);
  }
}
