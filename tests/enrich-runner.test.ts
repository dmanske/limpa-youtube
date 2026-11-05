import { describe, expect, it } from 'vitest';
import {
  enrichAll,
  enrichOne,
  fetchChannelPage,
  withEnglishLocale,
  type PageFetcher,
  type PageResult,
} from '../src/background/enrich-runner';
import type { EnrichmentResult } from '../src/shared/types';

const UCID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

// --- minimal ytInitialData page builders (mirror the real markup the parser reads) ---
function page(ucid: string, tabsJson: string): string {
  const canonical = `<link rel="canonical" href="https://www.youtube.com/channel/${ucid}">`;
  const yt = `{"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[${tabsJson}]}}}`;
  return `<html><head>${canonical}</head><body><script>var ytInitialData = ${yt};</script></body></html>`;
}
const HOME_TAB = `{"tabRenderer":{"title":"Home"}}`;
function videoItem(published: string): string {
  return `{"richItemRenderer":{"content":{"lockupViewModel":{"contentType":"LOCKUP_CONTENT_TYPE_VIDEO","metadata":{"lockupMetadataViewModel":{"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"${published}"}}]}]}}}}}}}}`;
}
function videosTab(items: string[]): string {
  return `{"tabRenderer":{"title":"Videos","content":{"richGridRenderer":{"contents":[${items.join(',')}]}}}}`;
}
function shortsTab(n: number): string {
  const items = Array.from(
    { length: n },
    () => `{"richItemRenderer":{"content":{"shortsLockupViewModel":{}}}}`,
  ).join(',');
  return `{"tabRenderer":{"title":"Shorts","content":{"richGridRenderer":{"contents":[${items}]}}}}`;
}
const videosPage = (ucid = UCID): string => page(ucid, `${HOME_TAB},${videosTab([videoItem('2 days ago')])}`);
const emptyPage = (ucid = UCID): string => page(ucid, HOME_TAB);
const shortsPage = (ucid = UCID): string => page(ucid, `${HOME_TAB},${shortsTab(5)}`);

function fetcherFrom(map: Record<string, PageResult>): { fn: PageFetcher; calls: string[] } {
  const calls: string[] = [];
  const fn: PageFetcher = async (url) => {
    calls.push(url);
    for (const key of Object.keys(map)) {
      if (url.includes(key)) return map[key]!;
    }
    return { ok: false, status: 404, reason: 'http-404' };
  };
  return { fn, calls };
}
const ok = (text: string): PageResult => ({ ok: true, status: 200, text });

describe('withEnglishLocale', () => {
  it('appends ?hl=en to a bare URL', () => {
    expect(withEnglishLocale('https://www.youtube.com/@x/videos')).toBe(
      'https://www.youtube.com/@x/videos?hl=en',
    );
  });

  it('appends &hl=en when the URL already has a query', () => {
    expect(withEnglishLocale('https://www.youtube.com/@x/videos?foo=1')).toBe(
      'https://www.youtube.com/@x/videos?foo=1&hl=en',
    );
  });
});

describe('fetchChannelPage', () => {
  it('marks a channel with videos as ok', async () => {
    const { fn } = fetcherFrom({ '/videos': ok(videosPage()) });
    const r = await fetchChannelPage(UCID, fn);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('has-videos');
    expect(r.ucid).toBe(UCID);
    expect(r.lastUploadAt).toBeDefined();
  });

  it('maps HTTP 404 to unreachable (never no-uploads)', async () => {
    const { fn } = fetcherFrom({ '/videos': { ok: false, status: 404, reason: 'http-404' } });
    const r = await fetchChannelPage(UCID, fn);
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('http-404');
    expect(r.httpStatus).toBe(404);
  });

  it('maps a network error to unreachable', async () => {
    const fn: PageFetcher = async () => ({ ok: false, reason: 'network-error' });
    const r = await fetchChannelPage(UCID, fn);
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('network-error');
  });

  it('finds Shorts-only activity via the fallback', async () => {
    const { fn, calls } = fetcherFrom({
      '/shorts': ok(shortsPage()),
      '/streams': ok(emptyPage()),
      '/videos': ok(emptyPage()),
    });
    const r = await fetchChannelPage('@Foo', fn);
    expect(r.status).toBe('ok');
    expect(r.reason).toBe('shorts-only');
    expect(calls.some((u) => u.endsWith('/shorts'))).toBe(true);
  });

  it('marks a genuinely empty channel as no-uploads', async () => {
    const { fn } = fetcherFrom({
      '/videos': ok(emptyPage()),
      '/shorts': ok(emptyPage()),
      '/streams': ok(emptyPage()),
    });
    const r = await fetchChannelPage('@Foo', fn);
    expect(r.status).toBe('no-uploads');
    expect(r.reason).toBe('genuinely-empty');
  });

  it('marks unreachable when a fallback page fails to load', async () => {
    const { fn } = fetcherFrom({
      '/videos': ok(emptyPage()),
      '/shorts': { ok: false, reason: 'network-error' },
      '/streams': ok(emptyPage()),
    });
    const r = await fetchChannelPage('@Foo', fn);
    expect(r.status).toBe('unreachable');
    expect(r.reason).toBe('fallback-unreachable');
  });
});

describe('enrichOne URL selection', () => {
  it('uses the canonical /channel/UCID URL when a UCID is known', async () => {
    const { fn, calls } = fetcherFrom({ '/videos': ok(videosPage()) });
    const result = await enrichOne({ channelId: '@Foo', resolvedUcid: UCID }, fn);
    expect(calls[0]).toBe(`https://www.youtube.com/channel/${UCID}/videos`);
    expect(result.enrichmentStatus).toBe('ok');
    expect(result.resolvedUcid).toBe(UCID);
  });

  it('falls back to the handle URL when no UCID is known, and persists the resolved UCID', async () => {
    const { fn, calls } = fetcherFrom({ '/videos': ok(videosPage()) });
    const result = await enrichOne({ channelId: '@Foo' }, fn);
    expect(calls[0]).toBe('https://www.youtube.com/@Foo/videos');
    expect(result.resolvedUcid).toBe(UCID);
  });
});

describe('enrichAll', () => {
  it('processes all targets and reports progress', async () => {
    const { fn } = fetcherFrom({ '/videos': ok(videosPage()) });
    const batches: EnrichmentResult[][] = [];
    const progress = await enrichAll(
      [{ channelId: '@A' }, { channelId: '@B' }],
      { onBatch: (r) => void batches.push(r), onProgress: () => {} },
      fn,
    );
    expect(progress.processed).toBe(2);
    expect(progress.ok).toBe(2);
    expect(batches.flat()).toHaveLength(2);
  });

  it('stops immediately without fetching when the signal is already aborted', async () => {
    const { fn, calls } = fetcherFrom({ '/videos': ok(videosPage()) });
    const controller = new AbortController();
    controller.abort();
    await expect(
      enrichAll(
        [{ channelId: '@A' }, { channelId: '@B' }],
        { onBatch: () => {}, signal: controller.signal },
        fn,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });

  it('flushes the partial batch and throws AbortError when cancelled mid-run', async () => {
    const controller = new AbortController();
    const batches: EnrichmentResult[][] = [];
    // Abort the moment the first fetch fires: results gathered before the workers observe the
    // abort must still be flushed via onBatch (so progress is saved on cancel).
    const fn: PageFetcher = async () => {
      controller.abort();
      return ok(videosPage());
    };
    await expect(
      enrichAll(
        [{ channelId: '@A' }, { channelId: '@B' }, { channelId: '@C' }],
        { onBatch: (r) => void batches.push(r), signal: controller.signal },
        fn,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(batches.flat().length).toBeGreaterThanOrEqual(1);
  });
});
