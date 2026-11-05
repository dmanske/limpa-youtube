import type { EnrichmentStatus } from './types';

const UCID_REGEX = /^UC[A-Za-z0-9_-]{22}$/;
const UCID_IN_PATH_REGEX = /\/channel\/(UC[A-Za-z0-9_-]{22})/;

// O YouTube mostra a data por extenso ("7 months ago") ou abreviada ("7mo ago", "2y ago").
const RELATIVE_DATE_RE =
  /(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?|years?|yrs?|y)\s+ago/i;

/** Converte qualquer forma da unidade para o nome usado em UNIT_MS. "m" é minuto; mês é "mo". */
function unidadeCompleta(bruta: string): string | undefined {
  const u = bruta.toLowerCase();
  if (u === 'm' || u.startsWith('min')) return 'minute';
  if (u.startsWith('mo')) return 'month';
  if (u.startsWith('s')) return 'second';
  if (u.startsWith('h')) return 'hour';
  if (u.startsWith('d')) return 'day';
  if (u.startsWith('w')) return 'week';
  if (u.startsWith('y')) return 'year';
  return undefined;
}

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export function parseRelativeDate(text: string, now: number = Date.now()): number | undefined {
  const match = text.match(RELATIVE_DATE_RE);
  if (!match?.[1] || !match[2]) return undefined;
  const amount = parseInt(match[1], 10);
  const unit = unidadeCompleta(match[2]);
  const ms = unit ? UNIT_MS[unit] : undefined;
  if (!ms || !isFinite(amount)) return undefined;
  return now - amount * ms;
}

export interface ChannelPageData {
  ucid?: string;
  /** true once ytInitialData parsed into a valid channel tabs array (a real channel page). */
  parsedOk: boolean;
  /** a "Videos" tab exists on the page. */
  hasVideosTab: boolean;
  /** recognized long-form videos in the Videos tab (set only when the grid parsed). */
  videoCount?: number;
  /** Videos tab present but its grid/items were not recognized (structure change). */
  videosTabUnparsed?: boolean;
  lastUploadAt?: number;
  /** Foto do canal, em tamanho pequeno. */
  avatarUrl?: string;
}

/** O YouTube entrega a foto em 900 px; o número depois de "=s" escolhe o tamanho. */
export function fotoPequena(url: string): string {
  return url.replace(/=s\d+-/, '=s96-');
}

const YT_INITIAL_DATA_MARKER = 'var ytInitialData = ';

/** Locate, slice, and JSON.parse the ytInitialData blob. Returns undefined on any failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseYtInitialData(html: string): any {
  const marker = html.indexOf(YT_INITIAL_DATA_MARKER);
  if (marker === -1) return undefined;
  const jsonStart = marker + YT_INITIAL_DATA_MARKER.length;
  const jsonEnd = html.indexOf(';</script>', jsonStart);
  if (jsonEnd === -1) return undefined;
  try {
    return JSON.parse(html.substring(jsonStart, jsonEnd));
  } catch {
    return undefined;
  }
}

export function extractChannelData(html: string): ChannelPageData {
  const result: ChannelPageData = { parsedOk: false, hasVideosTab: false };

  result.ucid = extractCanonicalUcid(html);

  const data = parseYtInitialData(html);
  if (data === undefined) return result;

  if (!result.ucid) {
    const extId = data?.metadata?.channelMetadataRenderer?.externalId;
    if (typeof extId === 'string' && isUcid(extId)) result.ucid = extId;
  }

  const foto = data?.metadata?.channelMetadataRenderer?.avatar?.thumbnails?.[0]?.url;
  if (typeof foto === 'string' && foto.startsWith('https://')) {
    result.avatarUrl = fotoPequena(foto);
  }

  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (!Array.isArray(tabs) || tabs.length === 0) return result;

  // ytInitialData parsed into a tabs array → this is a real, reachable channel page.
  result.parsedOk = true;

  for (const tab of tabs) {
    const tr = tab?.tabRenderer;
    if (!tr || tr.title !== 'Videos') continue;
    result.hasVideosTab = true;

    const items = tr.content?.richGridRenderer?.contents;
    if (!Array.isArray(items)) {
      // A Videos tab without a recognizable grid is a structure change, not an empty channel.
      result.videosTabUnparsed = true;
      return result;
    }

    let videoCount = 0;
    let newestUpload = -Infinity;
    const now = Date.now();

    for (const item of items) {
      const lockup = item?.richItemRenderer?.content?.lockupViewModel;
      if (!lockup || lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
      videoCount++;

      const rows =
        lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
      if (!Array.isArray(rows)) continue;

      for (const row of rows) {
        if (!Array.isArray(row.metadataParts)) continue;
        for (const part of row.metadataParts) {
          const text = part?.text?.content;
          if (typeof text !== 'string' || !text.includes('ago')) continue;
          const ts = parseRelativeDate(text, now);
          if (ts !== undefined && ts > newestUpload) newestUpload = ts;
        }
      }
    }

    // YouTube only surfaces the Videos tab when long-form videos exist, so a tab
    // with zero recognized videos means the grid markup changed — treat as unparsed,
    // never as a genuinely empty channel.
    if (videoCount === 0) {
      result.videosTabUnparsed = true;
      return result;
    }

    result.videoCount = videoCount;
    if (Number.isFinite(newestUpload) && newestUpload > 0) {
      result.lastUploadAt = newestUpload;
    }
    break;
  }

  return result;
}

/**
 * Whether a tab with the given title (e.g. "Shorts", "Live") has a non-empty content grid.
 * Used by the Shorts/Live fallback to detect activity on channels with no long-form videos.
 */
export function hasTabActivity(html: string, tabTitle: string): boolean {
  const data = parseYtInitialData(html);
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (!Array.isArray(tabs)) return false;
  for (const tab of tabs) {
    const tr = tab?.tabRenderer;
    if (!tr || tr.title !== tabTitle) continue;
    const items = tr.content?.richGridRenderer?.contents;
    return Array.isArray(items) && items.length > 0;
  }
  return false;
}

export type EnrichmentReason =
  | 'no-ucid'
  | 'page-unparsed'
  | 'videos-tab-unparsed'
  | 'has-videos'
  | 'shorts-only'
  | 'live-only'
  | 'genuinely-empty'
  | 'fallback-unreachable';

export interface ClassifiedEnrichment {
  status: EnrichmentStatus;
  videoCount?: number;
  lastUploadAt?: number;
  reason: EnrichmentReason;
}

/**
 * Decide a channel's activity status from its parsed Videos page, plus optional
 * Shorts/Live activity signals. Only a parsed page with no long-form videos, no
 * Shorts, and no Live activity is classified as "no-uploads"; every ambiguous or
 * failed case becomes "unreachable" so it is retried and never mislabeled.
 */
export function classifyEnrichment(
  videos: ChannelPageData,
  shortsActive = false,
  liveActive = false,
): ClassifiedEnrichment {
  if (!videos.ucid) return { status: 'unreachable', reason: 'no-ucid' };
  if (!videos.parsedOk) return { status: 'unreachable', reason: 'page-unparsed' };
  if (videos.videosTabUnparsed) return { status: 'unreachable', reason: 'videos-tab-unparsed' };

  if (videos.videoCount !== undefined && videos.videoCount > 0) {
    return {
      status: 'ok',
      reason: 'has-videos',
      videoCount: videos.videoCount,
      lastUploadAt: videos.lastUploadAt,
    };
  }

  if (shortsActive) return { status: 'ok', reason: 'shorts-only' };
  if (liveActive) return { status: 'ok', reason: 'live-only' };
  return { status: 'no-uploads', reason: 'genuinely-empty', videoCount: 0 };
}

/**
 * Classify using the Videos page plus the raw HTML of the Shorts and Live tabs
 * (each `undefined` if that fallback fetch failed to load). Tab presence only means
 * "has content" when the page actually loaded — so we conclude "no-uploads" ONLY when
 * both fallback pages loaded and confirmed no Shorts/Live tab. If a fallback fetch
 * failed and no activity was found, we cannot confirm emptiness → "unreachable".
 */
export function classifyWithFallback(
  videos: ChannelPageData,
  shortsHtml: string | undefined,
  liveHtml: string | undefined,
): ClassifiedEnrichment {
  const base = classifyEnrichment(videos);
  if (base.reason !== 'genuinely-empty') return base;

  const shortsActive = shortsHtml !== undefined && hasTabActivity(shortsHtml, 'Shorts');
  if (shortsActive) return classifyEnrichment(videos, true, false);

  const liveActive = liveHtml !== undefined && hasTabActivity(liveHtml, 'Live');
  if (liveActive) return classifyEnrichment(videos, false, true);

  if (shortsHtml === undefined || liveHtml === undefined) {
    return { status: 'unreachable', reason: 'fallback-unreachable' };
  }
  return classifyEnrichment(videos, false, false);
}

export function extractCanonicalUcid(html: string): string | undefined {
  if (!html) return undefined;
  const match = html.match(UCID_IN_PATH_REGEX);
  return match?.[1];
}

export function isUcid(value: string | undefined): boolean {
  return !!value && UCID_REGEX.test(value);
}

export function effectiveUcid(
  channelId: string,
  resolvedUcid: string | undefined,
): string | undefined {
  if (isUcid(resolvedUcid)) return resolvedUcid;
  if (isUcid(channelId)) return channelId;
  return undefined;
}

export function needsHandleResolution(
  channelId: string,
  resolvedUcid: string | undefined,
): boolean {
  if (isUcid(resolvedUcid)) return false;
  return !isUcid(channelId);
}

export const ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * O canal precisa de uma nova checagem? Além do prazo normal, volta para a fila o canal que
 * tem vídeos mas ficou sem data, como os checados antes de lermos o formato "7mo ago", e o
 * canal que ainda não tem foto salva.
 */
export function precisaChecar(
  canal: {
    enrichedAt?: number;
    videoCount?: number;
    lastUploadAt?: number;
    avatarUrl?: string;
    enrichmentStatus?: EnrichmentStatus;
  },
  now: number = Date.now(),
): boolean {
  if (!isFreshEnrichment(canal.enrichedAt, now)) return true;
  if ((canal.videoCount ?? 0) > 0 && canal.lastUploadAt === undefined) return true;
  return (
    canal.enrichmentStatus !== undefined &&
    canal.enrichmentStatus !== 'unreachable' &&
    !canal.avatarUrl
  );
}

export function isFreshEnrichment(
  enrichedAt: number | undefined,
  now: number = Date.now(),
  ttlMs: number = ENRICHMENT_TTL_MS,
): boolean {
  if (!enrichedAt) return false;
  return now - enrichedAt < ttlMs;
}

export function channelPageUrl(channelIdOrHandle: string): string {
  if (channelIdOrHandle.startsWith('@')) {
    return `https://www.youtube.com/${channelIdOrHandle}`;
  }
  if (isUcid(channelIdOrHandle)) {
    return `https://www.youtube.com/channel/${channelIdOrHandle}`;
  }
  return `https://www.youtube.com/${channelIdOrHandle}`;
}

export function channelVideosUrl(channelIdOrHandle: string): string {
  return `${channelPageUrl(channelIdOrHandle)}/videos`;
}
