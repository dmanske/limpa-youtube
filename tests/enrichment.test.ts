import { describe, expect, it } from 'vitest';
import {
  channelPageUrl,
  channelVideosUrl,
  classifyEnrichment,
  classifyWithFallback,
  effectiveUcid,
  extractCanonicalUcid,
  extractChannelData,
  hasTabActivity,
  isFreshEnrichment,
  fotoPequena,
  precisaChecar,
  isUcid,
  needsHandleResolution,
  parseRelativeDate,
} from '../src/shared/enrichment';
import type { ChannelPageData } from '../src/shared/enrichment';

const SAMPLE_UCID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const SAMPLE_UCID_2 = 'UCq-Fj5jknLsUf-MWSy4_brA';

describe('parseRelativeDate', () => {
  const NOW = 1_700_000_000_000;

  it('parses "X days ago"', () => {
    expect(parseRelativeDate('11 days ago', NOW)).toBe(NOW - 11 * 86_400_000);
  });

  it('parses "X weeks ago"', () => {
    expect(parseRelativeDate('3 weeks ago', NOW)).toBe(NOW - 3 * 604_800_000);
  });

  it('parses "X months ago"', () => {
    expect(parseRelativeDate('1 month ago', NOW)).toBe(NOW - 2_592_000_000);
  });

  it('parses "X years ago"', () => {
    expect(parseRelativeDate('2 years ago', NOW)).toBe(NOW - 2 * 31_536_000_000);
  });

  it('parses "X hours ago"', () => {
    expect(parseRelativeDate('5 hours ago', NOW)).toBe(NOW - 5 * 3_600_000);
  });

  it('lê a data abreviada que o YouTube usa hoje', () => {
    expect(parseRelativeDate('7mo ago', NOW)).toBe(NOW - 7 * 2_592_000_000);
    expect(parseRelativeDate('2y ago', NOW)).toBe(NOW - 2 * 31_536_000_000);
    expect(parseRelativeDate('3w ago', NOW)).toBe(NOW - 3 * 604_800_000);
    expect(parseRelativeDate('5d ago', NOW)).toBe(NOW - 5 * 86_400_000);
    expect(parseRelativeDate('4h ago', NOW)).toBe(NOW - 4 * 3_600_000);
    expect(parseRelativeDate('30m ago', NOW)).toBe(NOW - 30 * 60_000);
    expect(parseRelativeDate('Streamed 1mo ago', NOW)).toBe(NOW - 2_592_000_000);
  });

  it('handles "Streamed X days ago"', () => {
    expect(parseRelativeDate('Streamed 4 days ago', NOW)).toBe(NOW - 4 * 86_400_000);
  });

  it('returns undefined for non-relative text', () => {
    expect(parseRelativeDate('71M views', NOW)).toBeUndefined();
    expect(parseRelativeDate('', NOW)).toBeUndefined();
    expect(parseRelativeDate('just now', NOW)).toBeUndefined();
  });
});

describe('extractChannelData', () => {
  function makeHtml(opts: {
    ucid?: string;
    externalId?: string;
    videos?: Array<{ published: string; type?: string }>;
    hasVideosTab?: boolean;
  }): string {
    const canonical = opts.ucid
      ? `<link rel="canonical" href="https://www.youtube.com/channel/${opts.ucid}">`
      : '';
    const metadata = opts.externalId
      ? `"metadata":{"channelMetadataRenderer":{"externalId":"${opts.externalId}"}}`
      : `"metadata":{}`;

    const videoItems = (opts.videos ?? []).map(
      (v) => `{
        "richItemRenderer":{
          "content":{
            "lockupViewModel":{
              "contentType":"${v.type ?? 'LOCKUP_CONTENT_TYPE_VIDEO'}",
              "metadata":{
                "lockupMetadataViewModel":{
                  "metadata":{
                    "contentMetadataViewModel":{
                      "metadataRows":[{
                        "metadataParts":[
                          {"text":{"content":"1M views"}},
                          {"text":{"content":"${v.published}"}}
                        ]
                      }]
                    }
                  }
                }
              }
            }
          }
        }
      }`,
    );

    const videosTab =
      opts.hasVideosTab !== false
        ? `{
        "tabRenderer":{
          "title":"Videos",
          "content":{
            "richGridRenderer":{
              "contents":[${videoItems.join(',')}]
            }
          }
        }
      }`
        : '';

    const tabParts = ['{"tabRenderer":{"title":"Home"}}'];
    if (opts.hasVideosTab !== false) tabParts.push(videosTab);
    const tabs = tabParts.join(',');

    const ytData = `{
      ${metadata},
      "contents":{
        "twoColumnBrowseResultsRenderer":{
          "tabs":[${tabs}]
        }
      }
    }`;

    return `<html><head>${canonical}</head><body><script>var ytInitialData = ${ytData};</script></body></html>`;
  }

  it('extracts UCID from canonical link', () => {
    const html = makeHtml({ ucid: SAMPLE_UCID, videos: [{ published: '3 days ago' }] });
    const data = extractChannelData(html);
    expect(data.ucid).toBe(SAMPLE_UCID);
  });

  it('extracts UCID from externalId when no canonical', () => {
    const html = makeHtml({ externalId: SAMPLE_UCID_2, videos: [{ published: '1 day ago' }] });
    const data = extractChannelData(html);
    expect(data.ucid).toBe(SAMPLE_UCID_2);
  });

  it('extracts lastUploadAt from the newest video', () => {
    const html = makeHtml({
      ucid: SAMPLE_UCID,
      videos: [
        { published: '2 days ago' },
        { published: '3 weeks ago' },
        { published: '1 month ago' },
      ],
    });
    const before = Date.now();
    const data = extractChannelData(html);
    expect(data.parsedOk).toBe(true);
    expect(data.hasVideosTab).toBe(true);
    expect(data.videoCount).toBe(3);
    expect(data.lastUploadAt).toBeDefined();
    expect(data.lastUploadAt!).toBeGreaterThan(before - 3 * 86_400_000);
  });

  it('flags a present-but-empty Videos tab as unparsed (not an empty channel)', () => {
    const html = makeHtml({ ucid: SAMPLE_UCID, videos: [] });
    const data = extractChannelData(html);
    expect(data.parsedOk).toBe(true);
    expect(data.hasVideosTab).toBe(true);
    expect(data.videosTabUnparsed).toBe(true);
    expect(data.videoCount).toBeUndefined();
  });

  it('treats a channel with no Videos tab as parsed with no videos (genuinely empty shape)', () => {
    const html = makeHtml({ ucid: SAMPLE_UCID, hasVideosTab: false });
    const data = extractChannelData(html);
    expect(data.parsedOk).toBe(true);
    expect(data.hasVideosTab).toBe(false);
    expect(data.videosTabUnparsed).toBeUndefined();
    expect(data.videoCount).toBeUndefined();
  });

  it('keeps videos with no parseable date (videoCount set, lastUploadAt undefined)', () => {
    const html = makeHtml({ ucid: SAMPLE_UCID, videos: [{ published: 'il y a 2 jours' }] });
    const data = extractChannelData(html);
    expect(data.videoCount).toBe(1);
    expect(data.lastUploadAt).toBeUndefined();
  });

  it('flags Videos tab as unparsed when only non-video items are present (shorts)', () => {
    const html = makeHtml({
      ucid: SAMPLE_UCID,
      videos: [{ published: '1 day ago', type: 'LOCKUP_CONTENT_TYPE_SHORT' }],
    });
    const data = extractChannelData(html);
    expect(data.videosTabUnparsed).toBe(true);
    expect(data.videoCount).toBeUndefined();
  });

  it('returns unparsed data when no ytInitialData', () => {
    const html = '<html><body>no data</body></html>';
    const data = extractChannelData(html);
    expect(data.ucid).toBeUndefined();
    expect(data.parsedOk).toBe(false);
    expect(data.videoCount).toBeUndefined();
  });
});

describe('hasTabActivity', () => {
  function makeTabHtml(title: string, itemCount: number): string {
    const items = Array.from(
      { length: itemCount },
      () => `{"richItemRenderer":{"content":{"shortsLockupViewModel":{}}}}`,
    ).join(',');
    const yt = `{"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"title":"${title}","content":{"richGridRenderer":{"contents":[${items}]}}}}]}}}`;
    return `<html><body><script>var ytInitialData = ${yt};</script></body></html>`;
  }

  it('detects a non-empty Shorts tab', () => {
    expect(hasTabActivity(makeTabHtml('Shorts', 5), 'Shorts')).toBe(true);
  });

  it('returns false for an empty grid', () => {
    expect(hasTabActivity(makeTabHtml('Shorts', 0), 'Shorts')).toBe(false);
  });

  it('returns false when the tab is absent', () => {
    expect(hasTabActivity(makeTabHtml('Shorts', 5), 'Live')).toBe(false);
  });

  it('returns false on unparseable html', () => {
    expect(hasTabActivity('<html>no data</html>', 'Shorts')).toBe(false);
  });
});

describe('classifyEnrichment', () => {
  const parsed = (over: Partial<ChannelPageData> = {}): ChannelPageData => ({
    ucid: SAMPLE_UCID,
    parsedOk: true,
    hasVideosTab: false,
    ...over,
  });

  it('marks a channel with long-form videos as ok', () => {
    const r = classifyEnrichment(parsed({ hasVideosTab: true, videoCount: 12, lastUploadAt: 999 }));
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('has-videos');
    expect(r.videoCount).toBe(12);
    expect(r.lastUploadAt).toBe(999);
  });

  it('marks videos-without-a-date as ok, never no-uploads', () => {
    const r = classifyEnrichment(parsed({ hasVideosTab: true, videoCount: 3 }));
    expect(r.status).toBe('ok');
    expect(r.lastUploadAt).toBeUndefined();
  });

  it('marks a missing UCID as unreachable', () => {
    const r = classifyEnrichment(parsed({ ucid: undefined }));
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('no-ucid');
  });

  it('marks an unparsed page as unreachable', () => {
    const r = classifyEnrichment(parsed({ parsedOk: false }));
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('page-unparsed');
  });

  it('marks a present-but-unparsed Videos tab as unreachable', () => {
    const r = classifyEnrichment(parsed({ hasVideosTab: true, videosTabUnparsed: true }));
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('videos-tab-unparsed');
  });

  it('marks a parsed page with no videos/shorts/live as no-uploads (FoodyTuby shape)', () => {
    const r = classifyEnrichment(parsed());
    expect(r.status).toBe('no-uploads');
    expect(r.reason).toBe('genuinely-empty');
    expect(r.videoCount).toBe(0);
  });

  it('marks a Shorts-only channel as ok', () => {
    const r = classifyEnrichment(parsed(), true, false);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('shorts-only');
    expect(r.lastUploadAt).toBeUndefined();
  });

  it('marks a Live-only channel as ok', () => {
    const r = classifyEnrichment(parsed(), false, true);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('live-only');
  });
});

describe('classifyWithFallback', () => {
  const empty = (): ChannelPageData => ({
    ucid: SAMPLE_UCID,
    parsedOk: true,
    hasVideosTab: false,
  });
  const tabHtml = (title: string, itemCount: number): string => {
    const items = Array.from(
      { length: itemCount },
      () => `{"richItemRenderer":{"content":{"shortsLockupViewModel":{}}}}`,
    ).join(',');
    const yt = `{"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"title":"${title}","content":{"richGridRenderer":{"contents":[${items}]}}}}]}}}`;
    return `<html><body><script>var ytInitialData = ${yt};</script></body></html>`;
  };
  const noActivityHtml = tabHtml('Home', 0); // a loaded page with no Shorts/Live tab

  it('passes through when the Videos page already has videos', () => {
    const videos: ChannelPageData = {
      ucid: SAMPLE_UCID,
      parsedOk: true,
      hasVideosTab: true,
      videoCount: 4,
    };
    const r = classifyWithFallback(videos, undefined, undefined);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('has-videos');
  });

  it('passes through an unparsed Videos page as unreachable', () => {
    const videos: ChannelPageData = { ucid: SAMPLE_UCID, parsedOk: false, hasVideosTab: false };
    const r = classifyWithFallback(videos, noActivityHtml, noActivityHtml);
    expect(r.reason).toBe('page-unparsed');
  });

  it('marks a Shorts-only channel ok when the Shorts page loads with shorts', () => {
    const r = classifyWithFallback(empty(), tabHtml('Shorts', 6), noActivityHtml);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('shorts-only');
  });

  it('marks a Live-only channel ok when the Live page loads with streams', () => {
    const r = classifyWithFallback(empty(), noActivityHtml, tabHtml('Live', 3));
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('live-only');
  });

  it('marks no-uploads only when both fallback pages load and confirm no activity', () => {
    const r = classifyWithFallback(empty(), noActivityHtml, noActivityHtml);
    expect(r.status).toBe('no-uploads');
    expect(r.reason).toBe('genuinely-empty');
  });

  it('marks unreachable when the Shorts page failed to load and no activity was found', () => {
    const r = classifyWithFallback(empty(), undefined, noActivityHtml);
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('fallback-unreachable');
  });

  it('marks unreachable when the Live page failed to load and no activity was found', () => {
    const r = classifyWithFallback(empty(), noActivityHtml, undefined);
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('fallback-unreachable');
  });

  it('still finds Shorts activity even if the Live page failed to load', () => {
    const r = classifyWithFallback(empty(), tabHtml('Shorts', 2), undefined);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('shorts-only');
  });
});

describe('extractCanonicalUcid', () => {
  it('extracts UCID from a canonical link tag', () => {
    const html = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${SAMPLE_UCID}"></head></html>`;
    expect(extractCanonicalUcid(html)).toBe(SAMPLE_UCID);
  });

  it('finds the first UCID even when attribute order differs', () => {
    const html = `<meta itemprop="channelId" content="${SAMPLE_UCID_2}"><div data-href="/channel/${SAMPLE_UCID_2}">x</div>`;
    expect(extractCanonicalUcid(html)).toBe(SAMPLE_UCID_2);
  });

  it('returns undefined when no UCID is present', () => {
    expect(extractCanonicalUcid('<html><body>no channel here</body></html>')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(extractCanonicalUcid('')).toBeUndefined();
  });
});

describe('isUcid', () => {
  it('accepts valid UCIDs', () => {
    expect(isUcid(SAMPLE_UCID)).toBe(true);
    expect(isUcid(SAMPLE_UCID_2)).toBe(true);
  });

  it('rejects handles and other ids', () => {
    expect(isUcid('@handle')).toBe(false);
    expect(isUcid('UCshort')).toBe(false);
    expect(isUcid(undefined)).toBe(false);
    expect(isUcid('')).toBe(false);
  });
});

describe('effectiveUcid', () => {
  it('prefers resolvedUcid when valid', () => {
    expect(effectiveUcid('@handle', SAMPLE_UCID)).toBe(SAMPLE_UCID);
  });

  it('falls back to channelId when it is itself a UCID', () => {
    expect(effectiveUcid(SAMPLE_UCID, undefined)).toBe(SAMPLE_UCID);
  });

  it('returns undefined when neither is a UCID', () => {
    expect(effectiveUcid('@handle', undefined)).toBeUndefined();
    expect(effectiveUcid('@handle', 'not-a-ucid')).toBeUndefined();
  });
});

describe('needsHandleResolution', () => {
  it('returns false when resolvedUcid is already a UCID', () => {
    expect(needsHandleResolution('@handle', SAMPLE_UCID)).toBe(false);
  });

  it('returns false when channelId is itself a UCID', () => {
    expect(needsHandleResolution(SAMPLE_UCID, undefined)).toBe(false);
  });

  it('returns true for handle without a resolution', () => {
    expect(needsHandleResolution('@handle', undefined)).toBe(true);
  });
});

describe('fotoPequena', () => {
  it('pede a foto em 96 px', () => {
    expect(fotoPequena('https://yt3.googleusercontent.com/abc=s900-c-k-c0x00ffffff-no-rj')).toBe(
      'https://yt3.googleusercontent.com/abc=s96-c-k-c0x00ffffff-no-rj',
    );
  });
});

describe('precisaChecar', () => {
  const NOW = 1_800_000_000_000;
  it('rechecha canal recente que tem vídeos mas ficou sem data', () => {
    expect(precisaChecar({ enrichedAt: NOW - 1000, videoCount: 30 }, NOW)).toBe(true);
  });
  it('não rechecha canal recente que já tem data', () => {
    expect(precisaChecar({ enrichedAt: NOW - 1000, videoCount: 30, lastUploadAt: NOW }, NOW)).toBe(
      false,
    );
  });
  it('rechecha canal já checado que ainda não tem foto', () => {
    expect(precisaChecar({ enrichedAt: NOW - 1000, enrichmentStatus: 'ok' }, NOW)).toBe(true);
    expect(
      precisaChecar(
        { enrichedAt: NOW - 1000, enrichmentStatus: 'ok', avatarUrl: 'https://x/a' },
        NOW,
      ),
    ).toBe(false);
    expect(precisaChecar({ enrichedAt: NOW - 1000, enrichmentStatus: 'unreachable' }, NOW)).toBe(
      false,
    );
  });
  it('não rechecha canal recente sem vídeos longos', () => {
    expect(precisaChecar({ enrichedAt: NOW - 1000 }, NOW)).toBe(false);
  });
  it('checa canal nunca checado', () => {
    expect(precisaChecar({}, NOW)).toBe(true);
  });
});

describe('isFreshEnrichment', () => {
  const ttl = 7 * 24 * 60 * 60 * 1000;

  it('returns false when never enriched', () => {
    expect(isFreshEnrichment(undefined)).toBe(false);
  });

  it('returns true within TTL', () => {
    const now = 10_000_000_000;
    expect(isFreshEnrichment(now - (ttl - 1000), now, ttl)).toBe(true);
  });

  it('returns false past TTL', () => {
    const now = 10_000_000_000;
    expect(isFreshEnrichment(now - (ttl + 1000), now, ttl)).toBe(false);
  });
});

describe('channelPageUrl', () => {
  it('builds a /channel/<ucid> URL', () => {
    expect(channelPageUrl(SAMPLE_UCID)).toBe(`https://www.youtube.com/channel/${SAMPLE_UCID}`);
  });

  it('builds a /@handle URL', () => {
    expect(channelPageUrl('@SomeHandle')).toBe('https://www.youtube.com/@SomeHandle');
  });
});

describe('channelVideosUrl', () => {
  it('appends /videos to a handle URL', () => {
    expect(channelVideosUrl('@SomeHandle')).toBe('https://www.youtube.com/@SomeHandle/videos');
  });

  it('appends /videos to a UCID URL', () => {
    expect(channelVideosUrl(SAMPLE_UCID)).toBe(
      `https://www.youtube.com/channel/${SAMPLE_UCID}/videos`,
    );
  });
});
