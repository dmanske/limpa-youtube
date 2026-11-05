import { createBackup } from '../shared/backup';
import { getSetting, setSetting, db } from '../shared/db';
import { enrichAll } from './enrich-runner';
import { coletarVideos, criarOuAtualizar, pedirNaAba } from './playlist-runner';
import { canaisForaDaLista, contarPorNome, mesclarCanal, zerarCanais } from '../shared/canais';
import { friendlyError } from '../shared/errors';
import { precisaChecar } from '../shared/enrichment';
import { CHAVE_PLAYLISTS, linkTemporario, type PlaylistsCriadas } from '../shared/playlist';
import { downloadCSV, downloadJSON } from '../shared/export';
import {
  KEEPALIVE_PORT,
  type ItemPlaylist,
  type Message,
  type ResultadoAssunto,
} from '../shared/messages';
import type {
  Channel,
  EnrichmentProgress,
  EnrichmentResult,
  EnrichmentTarget,
  ExtractionProgress,
  OperationStatus,
  UnsubLogRow,
  UnsubProgress,
  UnsubResult,
  UnsubTarget,
} from '../shared/types';

const SUBSCRIPTIONS_URL = 'https://www.youtube.com/feed/channels';

const UNSUB_BATCH_CAP = 200;

let currentRunId: number | undefined;
let currentProgress: ExtractionProgress | undefined;
let currentExtractTabId: number | undefined;
let extractStatus: OperationStatus = 'idle';
let extractOpId: string | undefined;

interface EnrichOperation {
  id: string;
  status: OperationStatus;
  progress: EnrichmentProgress;
}
let enrichOp: EnrichOperation | undefined;
let enrichAbort: AbortController | undefined;

let opCounter = 0;
function nextOpId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++opCounter}`;
}

// Opt-in operation diagnostics, gated on chrome.storage.local['ytcleanup:debug'] (the same
// flag the enrich runner uses). Logs cancel-requested / observed / final-state with op IDs.
let swDebugEnabled = false;
void chrome.storage.local
  .get('ytcleanup:debug')
  .then((v) => {
    const flag = v['ytcleanup:debug'];
    swDebugEnabled = flag === '1' || flag === true;
  })
  .catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['ytcleanup:debug']) {
    const flag = changes['ytcleanup:debug'].newValue;
    swDebugEnabled = flag === '1' || flag === true;
  }
});
function opLog(...args: unknown[]): void {
  if (!swDebugEnabled) return;
  // eslint-disable-next-line no-console
  console.debug('[op]', ...args);
}

let unsubRunning = false;
let unsubStatus: OperationStatus = 'idle';
let unsubOpId: string | undefined;
let unsubProgress: UnsubProgress | undefined;
let unsubBatchId: string | undefined;
let unsubTabId: number | undefined;
let unsubOverflow: string[] = [];
let unsubTargetIds: string[] = [];

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== KEEPALIVE_PORT) return;
  port.onDisconnect.addListener(() => {
    if (currentRunId !== undefined && currentExtractTabId !== undefined) {
      void handleExtractTabClosed();
    }
    if (unsubRunning && unsubTabId !== undefined) {
      void handleUnsubTabClosed();
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (currentExtractTabId !== undefined && tabId === currentExtractTabId) {
    void handleExtractTabClosed();
  }
  if (unsubTabId !== undefined && tabId === unsubTabId) {
    void handleUnsubTabClosed();
  }
});

async function hasSubscriptionsTab(): Promise<boolean> {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/feed/channels*' });
  return tabs.length > 0;
}

async function findOrOpenSubscriptionsTab(activate = true): Promise<chrome.tabs.Tab> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && active.url?.startsWith('https://www.youtube.com/feed/channels')) {
    return active;
  }

  const existing = await chrome.tabs.query({ url: 'https://www.youtube.com/feed/channels*' });
  if (existing[0]?.id !== undefined) {
    if (!activate) return existing[0];
    const focused = await chrome.tabs.update(existing[0].id, { active: true });
    if (focused) return focused;
    return existing[0];
  }

  if (active?.id && active.url && /^https?:\/\/[^/]*youtube\.com/.test(active.url)) {
    const updated = await chrome.tabs.update(active.id, { url: SUBSCRIPTIONS_URL });
    if (updated) return updated;
    return { ...active, url: SUBSCRIPTIONS_URL };
  }

  return chrome.tabs.create({ url: SUBSCRIPTIONS_URL, active: activate });
}

async function sendToTabWithRetry(tabId: number, msg: Message, retries = 4): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, { action: 'ping' } satisfies Message)) as
      | { ok?: boolean }
      | undefined;
    return reply?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScriptInjected(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  // Content script may be missing because the YouTube tab was open before the
  // extension was installed/reloaded. Re-inject using the paths the manifest
  // already declares so this stays correct across builds.
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files || files.length === 0) {
    throw new Error('No content script declared in manifest.');
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Extension failed to load. Refresh and retry. (${detail})`);
  }

  await new Promise((r) => setTimeout(r, 200));

  if (!(await pingContentScript(tabId))) {
    throw new Error('YouTube tab not responding. Refresh and retry.');
  }
}

async function assertTabIsSubscriptions(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error('YouTube tab was closed.');
  }
  if (!tab.url?.startsWith(SUBSCRIPTIONS_URL)) {
    throw new Error('YouTube page navigated away from subscriptions.');
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 60_000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for YouTube tab to load.'));
    }, timeoutMs);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Recarrega a aba e espera terminar. Evita reler uma lista antiga que ficou aberta. */
async function recarregarAba(tabId: number, timeoutMs = 60_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for YouTube tab to load.'));
    }, timeoutMs);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.reload(tabId).catch((err: unknown) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

async function dispatchExtractStart(doZero = false): Promise<void> {
  // Recarregar a aba no meio de um cancelamento derrubaria o cancelamento.
  if (unsubRunning) throw new Error('Espere o cancelamento terminar antes de escanear.');

  // Mark the operation running synchronously (before the first await) so a cancel arriving
  // during tab setup is honored, not dropped. `myOpId` lets the awaited steps below bail if
  // a cancel (which sets extractStatus away from 'running') landed mid-setup.
  if (currentRunId !== undefined) {
    const staleRunId = currentRunId;
    currentRunId = undefined;
    currentProgress = undefined;
    currentExtractTabId = undefined;
    await db()
      .extractions.update(staleRunId, {
        completedAt: Date.now(),
        status: 'error',
        errorMessage: 'Interrupted by a new scan.',
      })
      .catch(() => {});
  }

  const myOpId = nextOpId('extract');
  extractOpId = myOpId;
  extractStatus = 'running';
  opLog('extract start', myOpId, Date.now());

  const tab = await findOrOpenSubscriptionsTab();
  if (extractStatus !== 'running' || extractOpId !== myOpId) return;
  if (tab.id === undefined) throw new Error('Could not open a YouTube tab.');

  currentExtractTabId = tab.id;

  const run = await db().extractions.add({
    startedAt: Date.now(),
    channelCount: 0,
    status: 'running',
    doZero,
  });
  if (extractStatus !== 'running' || extractOpId !== myOpId) return;
  currentRunId = typeof run === 'number' ? run : Number(run);
  currentProgress = { loaded: 0, phase: 'setup' };

  chrome.runtime
    .sendMessage({
      action: 'extract:progress',
      data: { channels: [], progress: { loaded: 0, phase: 'setup' } },
    } satisfies Message)
    .catch(() => {});

  if (tab.status === 'complete' && tab.url?.startsWith(SUBSCRIPTIONS_URL)) {
    await recarregarAba(tab.id);
  } else {
    await waitForTabComplete(tab.id);
  }
  if (currentRunId === undefined || extractStatus !== 'running') return;
  await assertTabIsSubscriptions(tab.id);

  await ensureContentScriptInjected(tab.id);
  if (currentRunId === undefined || extractStatus !== 'running') return;
  await assertTabIsSubscriptions(tab.id);

  await sendToTabWithRetry(tab.id, { action: 'extract:start' });
}

function emptyEnrichProgress(): EnrichmentProgress {
  return { processed: 0, total: 0, ok: 0, noUploads: 0, unreachable: 0 };
}

/** Mark the run completed, broadcast the summary, and clear the operation. */
function finishEnrichCompleted(progress: EnrichmentProgress, durationMs: number): void {
  const id = enrichOp?.id;
  enrichOp = undefined;
  enrichAbort = undefined;
  opLog('enrich completed', id, Date.now());
  chrome.runtime
    .sendMessage({ action: 'enrich:complete', data: { progress, durationMs } } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
}

/** Mark the run cancelled, broadcast the cancelled summary (progress already persisted by
 *  the buffer flush in enrichAll), and clear the operation. */
function finishEnrichCancelled(): void {
  const op = enrichOp;
  enrichOp = undefined;
  enrichAbort = undefined;
  if (!op) return;
  op.status = 'cancelled';
  opLog('enrich cancelled — final state written', op.id, Date.now());
  chrome.runtime
    .sendMessage({
      action: 'enrich:cancelled',
      data: { operationId: op.id, progress: op.progress },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
}

async function dispatchEnrichStart(): Promise<void> {
  // Establish the operation synchronously — before the first await — so a cancel that
  // arrives while we enumerate targets is honored instead of dropped (the bug that left
  // the dashboard hung and the popup needing a second click).
  const id = nextOpId('enrich');
  enrichAbort = new AbortController();
  enrichOp = { id, status: 'running', progress: emptyEnrichProgress() };
  opLog('enrich start', id, Date.now());
  const started = Date.now();

  try {
    const all = await db().channels.toArray();
    const targets: EnrichmentTarget[] = all
      .filter((c) => !c.unsubscribedAt && precisaChecar(c))
      .map((c) => ({ channelId: c.channelId, resolvedUcid: c.resolvedUcid }));

    // A cancel may have landed during enumeration.
    if (enrichAbort.signal.aborted || enrichOp.status !== 'running') {
      finishEnrichCancelled();
      return;
    }

    if (targets.length === 0) {
      enrichOp = undefined;
      enrichAbort = undefined;
      chrome.runtime
        .sendMessage({
          action: 'enrich:complete',
          data: { progress: emptyEnrichProgress(), durationMs: 0 },
        } satisfies Message)
        .catch(() => {
          /* popup closed */
        });
      return;
    }

    // Enrichment runs entirely in the service worker: its fetch is CORS-exempt for hosts in
    // host_permissions and follows YouTube's vanity 303 redirects that block content-script
    // fetches. No YouTube tab is needed; the dashboard holds a keepalive port for the run.
    enrichOp.progress = { ...emptyEnrichProgress(), total: targets.length };

    const finalProgress = await enrichAll(targets, {
      onBatch: async (results, progress) => {
        if (enrichOp) enrichOp.progress = progress;
        await applyEnrichmentResults(results);
        relayEnrichProgress(progress);
      },
      onProgress: (progress) => {
        if (enrichOp) enrichOp.progress = progress;
        relayEnrichProgress(progress);
      },
      signal: enrichAbort.signal,
    });

    finishEnrichCompleted(finalProgress, Date.now() - started);
  } catch (err) {
    // A cancel surfaces as AbortError — report it as cancelled, not an error.
    if (err instanceof DOMException && err.name === 'AbortError') {
      finishEnrichCancelled();
      return;
    }
    // Genuine failure: surfaced to the UI via handleEnrichError (message-handler catch).
    throw err;
  }
}

function relayEnrichProgress(progress: EnrichmentProgress): void {
  chrome.runtime
    .sendMessage({
      action: 'enrich:progress',
      data: { results: [], progress },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleExtractProgress(
  payload: Extract<Message, { action: 'extract:progress' }>['data'],
): Promise<void> {
  currentProgress = payload.progress;
  const tabela = db().channels;
  await db().transaction('rw', tabela, async () => {
    const atuais = await tabela.bulkGet(payload.channels.map((c) => c.channelId));
    await tabela.bulkPut(payload.channels.map((c, i) => mesclarCanal(atuais[i], c)));
  });

  chrome.runtime
    .sendMessage({
      action: 'extract:progress',
      data: { channels: [], progress: payload.progress },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleExtractComplete(
  payload: Extract<Message, { action: 'extract:complete' }>['data'],
): Promise<void> {
  // Limpa antes do primeiro await: a aba solta a porta logo depois de avisar que terminou, e
  // isso não pode ser confundido com "aba fechada".
  const runId = currentRunId;
  extractStatus = 'completed';
  extractOpId = undefined;
  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;

  let sumiram = 0;
  let doZero = false;
  if (runId !== undefined) {
    const run = await db().extractions.get(runId);
    await db().extractions.update(runId, {
      completedAt: Date.now(),
      channelCount: payload.total,
      status: 'completed',
      completo: payload.completo,
    });
    doZero = run?.doZero === true;
    if (run && payload.completo && payload.total > 0) {
      if (doZero) {
        try {
          await trocarListaSalva(run.startedAt);
        } catch {
          await handleExtractError('Não consegui salvar o backup. Nada foi apagado.');
          return;
        }
      } else {
        sumiram = await marcarForaDaLista(run.startedAt);
      }
    }
  }

  chrome.runtime
    .sendMessage({
      action: 'extract:complete',
      data: { ...payload, runId, sumiram, doZero },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

/** Salva o backup e só então troca a lista. Se o backup falhar, nada é apagado. */
async function trocarListaSalva(inicio: number): Promise<void> {
  await createBackup([]);
  const tabela = db().channels;
  await db().transaction('rw', tabela, async () => {
    const { manter, apagar } = zerarCanais(await tabela.toArray(), inicio);
    await tabela.bulkDelete(apagar);
    await tabela.bulkPut(manter);
  });
}

/** Só marca: não cancela nem apaga. O canal volta ao normal se aparecer na próxima leitura. */
async function marcarForaDaLista(inicio: number): Promise<number> {
  const tabela = db().channels;
  return db().transaction('rw', tabela, async () => {
    const agora = Date.now();
    const fora = canaisForaDaLista(await tabela.toArray(), inicio);
    await tabela.bulkPut(fora.map((c) => ({ ...c, sumiuDaListaEm: c.sumiuDaListaEm ?? agora })));
    return fora.length;
  });
}

async function handleExtractError(message: string): Promise<void> {
  const runId = currentRunId;
  extractStatus = 'failed';
  extractOpId = undefined;
  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;
  if (runId !== undefined) {
    await db().extractions.update(runId, {
      completedAt: Date.now(),
      status: 'error',
      errorMessage: message,
    });
  }

  chrome.runtime
    .sendMessage({ action: 'extract:error', data: { message } } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

/** Idempotent cancel. Safe to call repeatedly: a second call sees status !== 'running' and
 *  no-ops. Tells the content script to abort (immediate via its AbortController), persists
 *  the run as cancelled, and broadcasts the cancelled summary. */
async function handleExtractCancel(operationId?: string): Promise<void> {
  if (extractStatus !== 'running') return;
  if (operationId && operationId !== extractOpId) return; // stale cancel for an old run

  extractStatus = 'stopping';
  opLog('extract cancel requested', extractOpId, Date.now());
  const progress: ExtractionProgress = currentProgress ?? { loaded: 0 };
  chrome.runtime
    .sendMessage({
      action: 'extract:stopping',
      data: { operationId: extractOpId ?? '', progress },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });

  const runId = currentRunId;
  const tabId = currentExtractTabId;

  // Clear run globals so the port onDisconnect and tabs.onRemoved handlers skip; keep
  // extractStatus at 'stopping' until the cancelled summary is written.
  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;

  if (tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'extract:cancel' } satisfies Message);
    } catch {
      /* tab may already be closed */
    }
  }

  if (runId !== undefined) {
    await db().extractions.update(runId, {
      completedAt: Date.now(),
      status: 'cancelled',
    });
  }

  const id = extractOpId;
  extractStatus = 'cancelled';
  extractOpId = undefined;
  opLog('extract cancelled — final state written', id, Date.now());
  chrome.runtime
    .sendMessage({
      action: 'extract:cancelled',
      data: { operationId: id ?? '', progress },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function handleExtractTabClosed(): Promise<void> {
  if (currentRunId === undefined) return;

  await db().extractions.update(currentRunId, {
    completedAt: Date.now(),
    status: 'error',
    errorMessage: 'YouTube tab was closed during extraction.',
  });

  extractStatus = 'failed';
  extractOpId = undefined;
  currentRunId = undefined;
  currentProgress = undefined;
  currentExtractTabId = undefined;

  chrome.runtime
    .sendMessage({
      action: 'extract:error',
      data: { message: 'YouTube tab was closed during extraction.' },
    } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

async function applyEnrichmentResults(results: EnrichmentResult[]): Promise<void> {
  if (results.length === 0) return;
  const ids = results.map((r) => r.channelId);
  const tabela = db().channels;
  await db().transaction('rw', tabela, async () => {
    const existingRows = await tabela.bulkGet(ids);
    const now = Date.now();
    const updates: Channel[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const existing = existingRows[i];
      if (!r || !existing) continue;
      updates.push({
        ...existing,
        resolvedUcid: r.resolvedUcid ?? existing.resolvedUcid,
        lastUploadAt: r.lastUploadAt ?? existing.lastUploadAt,
        videoCount: r.videoCount ?? existing.videoCount,
        avatarUrl: r.avatarUrl ?? existing.avatarUrl,
        enrichmentStatus: r.enrichmentStatus,
        enrichedAt: r.enrichmentStatus === 'unreachable' ? existing.enrichedAt : now,
      });
    }
    if (updates.length > 0) {
      await tabela.bulkPut(updates);
    }
  });
}

async function handleEnrichError(message: string): Promise<void> {
  if (enrichOp) enrichOp.status = 'failed';
  enrichOp = undefined;
  enrichAbort = undefined;
  chrome.runtime
    .sendMessage({ action: 'enrich:error', data: { message } } satisfies Message)
    .catch(() => {
      /* popup closed */
    });
}

/** Idempotent cancel. Aborts the service-worker-owned controller directly, so in-flight
 *  fetches tear down immediately (no polling latency). Safe to call repeatedly: a second
 *  call sees status !== 'running' and no-ops. The cancelled summary is emitted by
 *  dispatchEnrichStart once the loop unwinds. */
function handleEnrichCancel(operationId?: string): void {
  if (!enrichOp || enrichOp.status !== 'running') return;
  if (operationId && operationId !== enrichOp.id) return; // stale cancel for an old run
  enrichOp.status = 'stopping';
  opLog('enrich cancel requested', enrichOp.id, Date.now());
  chrome.runtime
    .sendMessage({
      action: 'enrich:stopping',
      data: { operationId: enrichOp.id, progress: enrichOp.progress },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
  enrichAbort?.abort();
}

async function applyUnsubResultFromContent(result: UnsubResult): Promise<void> {
  if (!unsubBatchId) return;
  const existing = await db().channels.get(result.channelId);
  const channelName = existing?.name;

  const updates: Partial<Channel> = {};
  if (result.outcome === 'ok' || result.outcome === 'already-unsubbed') {
    updates.unsubscribedAt = result.attemptedAt;
    updates.pendingUnsub = false;
  } else if (result.outcome === 'unreachable') {
    updates.pendingUnsub = false;
  }
  if (Object.keys(updates).length > 0) {
    try {
      await db().channels.update(result.channelId, updates);
    } catch {
      /* row may have been deleted concurrently; ignore */
    }
  }

  const logRow: UnsubLogRow = {
    batchId: unsubBatchId,
    channelId: result.channelId,
    channelName,
    outcome: result.outcome,
    detail: result.detail,
    attemptedAt: result.attemptedAt,
  };
  await db().unsubLog.add(logRow);
}

async function handleUnsubProgress(
  payload: Extract<Message, { action: 'unsub:progress' }>['data'],
): Promise<void> {
  unsubProgress = payload.progress;
  if (payload.result) {
    await applyUnsubResultFromContent(payload.result);
  }

  if (!unsubRunning) return;

  chrome.runtime
    .sendMessage({
      action: 'unsub:progress',
      data: { result: payload.result, progress: payload.progress },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
}

function emptyUnsubProgress(): UnsubProgress {
  return {
    processed: 0,
    total: 0,
    ok: 0,
    alreadyUnsubbed: 0,
    unreachable: 0,
    error: 0,
    halted: 0,
  };
}

function clearUnsubState(): void {
  unsubRunning = false;
  unsubProgress = undefined;
  unsubBatchId = undefined;
  unsubTabId = undefined;
  unsubOverflow = [];
  unsubTargetIds = [];
}

/** Mark the run cancelled and broadcast the cancelled summary (with the resumable remainder).
 *  Clears all run state. */
function finishUnsubCancelled(progress: UnsubProgress, remaining: string[]): void {
  const id = unsubOpId;
  clearUnsubState();
  unsubStatus = 'cancelled';
  unsubOpId = undefined;
  opLog('unsub cancelled — final state written', id, Date.now());
  chrome.runtime
    .sendMessage({
      action: 'unsub:cancelled',
      data: { operationId: id ?? '', progress, remaining },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
}

async function handleUnsubComplete(
  payload: Extract<Message, { action: 'unsub:complete' }>['data'],
): Promise<void> {
  const allRemaining = [...payload.remaining, ...unsubOverflow];
  const seen = new Set<string>();
  const deduped = allRemaining.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // The content loop returns here on both a natural finish and a Stop. The service worker —
  // the single source of truth — decides which it was from its own status.
  if (unsubStatus === 'stopping') {
    finishUnsubCancelled(payload.progress, deduped);
    return;
  }

  chrome.runtime
    .sendMessage({
      action: 'unsub:complete',
      data: {
        progress: payload.progress,
        durationMs: payload.durationMs,
        remaining: deduped,
      },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });

  unsubStatus = 'completed';
  unsubOpId = undefined;
  clearUnsubState();
}

async function handleUnsubError(message: string): Promise<void> {
  chrome.runtime
    .sendMessage({ action: 'unsub:error', data: { message } } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
  unsubStatus = 'failed';
  unsubOpId = undefined;
  clearUnsubState();
}

async function handleUnsubTabClosed(): Promise<void> {
  if (!unsubRunning) return;

  const remaining: string[] = [];
  if (unsubBatchId) {
    const loggedIds = new Set(
      (await db().unsubLog.where('batchId').equals(unsubBatchId).toArray()).map(
        (row) => row.channelId,
      ),
    );
    const seen = new Set<string>();
    for (const id of unsubTargetIds) {
      if (!loggedIds.has(id) && !seen.has(id)) {
        seen.add(id);
        remaining.push(id);
      }
    }
    for (const id of unsubOverflow) {
      if (!seen.has(id)) {
        seen.add(id);
        remaining.push(id);
      }
    }
  }

  const savedProgress = unsubProgress ? { ...unsubProgress } : undefined;

  clearUnsubState();
  unsubStatus = 'idle';
  unsubOpId = undefined;

  chrome.runtime
    .sendMessage({
      action: 'unsub:paused',
      data: {
        progress: savedProgress ?? emptyUnsubProgress(),
        remaining,
      },
    } satisfies Message)
    .catch(() => {
      /* dashboard may be closed */
    });
}

async function dispatchUnsubStart(channelIds: string[]): Promise<void> {
  if (unsubStatus === 'running' || unsubStatus === 'stopping') {
    throw new Error('An unsubscribe run is already in progress.');
  }
  if (channelIds.length === 0) throw new Error('No channels selected.');

  // Establish the operation synchronously so a cancel arriving during setup (backup, tab
  // open, content-script injection) is honored rather than dropped. `myOpId` lets the
  // awaited steps below bail if a cancel landed mid-setup.
  const myOpId = nextOpId('unsub');
  unsubOpId = myOpId;
  unsubStatus = 'running';
  opLog('unsub start', myOpId, Date.now());

  try {
    const rows = await db().channels.bulkGet(channelIds);
    const targets: UnsubTarget[] = [];
    for (let i = 0; i < channelIds.length; i++) {
      const id = channelIds[i];
      const row = rows[i];
      if (!id || !row) continue;
      targets.push({ channelId: id, name: row.name });
    }
    if (targets.length === 0) throw new Error('Selected channels not found in storage.');

    const capped = targets.slice(0, UNSUB_BATCH_CAP);
    const overflowIds = targets.slice(UNSUB_BATCH_CAP).map((t) => t.channelId);
    const cappedIds = capped.map((t) => t.channelId);

    let backupId: number;
    try {
      backupId = await createBackup(cappedIds);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create backup before unsubscribing: ${detail}`);
    }
    if (unsubStatus !== 'running' || unsubOpId !== myOpId) {
      finishUnsubCancelled(emptyUnsubProgress(), [...cappedIds, ...overflowIds]);
      return;
    }
    chrome.runtime
      .sendMessage({ action: 'backup:created', data: { backupId } } satisfies Message)
      .catch(() => {});

    const tab = await findOrOpenSubscriptionsTab();
    if (unsubStatus !== 'running' || unsubOpId !== myOpId) {
      finishUnsubCancelled(emptyUnsubProgress(), [...cappedIds, ...overflowIds]);
      return;
    }
    if (tab.id === undefined) throw new Error('Could not open a YouTube tab.');
    await waitForTabComplete(tab.id);
    await ensureContentScriptInjected(tab.id);
    if (unsubStatus !== 'running' || unsubOpId !== myOpId) {
      finishUnsubCancelled(emptyUnsubProgress(), [...cappedIds, ...overflowIds]);
      return;
    }

    const batchId = `unsub-${Date.now()}`;
    unsubRunning = true;
    unsubBatchId = batchId;
    unsubTabId = tab.id;
    unsubOverflow = overflowIds;
    unsubTargetIds = cappedIds;
    unsubProgress = { ...emptyUnsubProgress(), total: capped.length };

    await sendToTabWithRetry(tab.id, {
      action: 'unsub:batch',
      data: { batchId, targets: capped },
    });
  } catch (err) {
    // Surface to the dashboard via the {ok:false} reply; reset status so the next run starts.
    unsubStatus = 'failed';
    unsubOpId = undefined;
    clearUnsubState();
    throw err;
  }
}

/** Idempotent cancel. Sets 'stopping' and tells the content loop to stop (observed within a
 *  card now that the inter-card waits are interruptible). If the loop is running, the
 *  cancelled summary is emitted by handleUnsubComplete; if cancel lands during setup,
 *  dispatchUnsubStart's checkpoint finalizes it. */
function forwardUnsubCancel(operationId?: string): void {
  if (unsubStatus !== 'running') return;
  if (operationId && operationId !== unsubOpId) return; // stale cancel for an old run
  unsubStatus = 'stopping';
  opLog('unsub cancel requested', unsubOpId, Date.now());
  chrome.runtime
    .sendMessage({
      action: 'unsub:stopping',
      data: { operationId: unsubOpId ?? '', progress: unsubProgress ?? emptyUnsubProgress() },
    } satisfies Message)
    .catch(() => {
      /* popup/dashboard closed */
    });
  if (unsubTabId !== undefined) {
    chrome.tabs.sendMessage(unsubTabId, { action: 'unsub:cancel' } satisfies Message).catch(() => {
      void handleUnsubTabClosed();
    });
  }
  // else: still in setup — dispatchUnsubStart's checkpoint will finalize as cancelled.
}

async function handleExportCSV(): Promise<void> {
  const channels = await db().channels.toArray();
  await downloadCSV(channels);
}

async function handleExportJSON(): Promise<void> {
  const channels = await db().channels.toArray();
  await downloadJSON(channels);
}

const URL_HISTORICO = 'https://www.youtube.com/feed/history';
let abaHistorico: { id: number; criadaAgora: boolean } | undefined;

function avisarErroHistorico(message: string): void {
  chrome.runtime
    .sendMessage({ action: 'historico:erro', data: { message } } satisfies Message)
    .catch(() => {});
}

async function fecharAbaHistorico(): Promise<void> {
  const aba = abaHistorico;
  abaHistorico = undefined;
  if (aba?.criadaAgora) await chrome.tabs.remove(aba.id).catch(() => {});
}

async function iniciarHistorico(): Promise<void> {
  if (abaHistorico) throw new Error('Já estou lendo o histórico.');
  const [existente] = await chrome.tabs.query({ url: `${URL_HISTORICO}*` });
  const aba =
    existente?.id !== undefined
      ? await chrome.tabs.update(existente.id, { active: true })
      : await chrome.tabs.create({ url: URL_HISTORICO, active: true });
  if (aba?.id === undefined) throw new Error('Could not open a YouTube tab.');
  abaHistorico = { id: aba.id, criadaAgora: existente?.id === undefined };
  await waitForTabComplete(aba.id);
  await ensureContentScriptInjected(aba.id);
  await sendToTabWithRetry(aba.id, { action: 'historico:ler' });
}

async function concluirHistorico(
  dados: Extract<Message, { action: 'historico:concluido' }>['data'],
): Promise<void> {
  await fecharAbaHistorico();
  const canais = await db().channels.toArray();
  const porNome = contarPorNome(dados.textosSemCanal, canais);
  const contagem = { ...dados.contagem };
  for (const [chave, total] of Object.entries(porNome.contagem)) {
    contagem[chave] = (contagem[chave] ?? 0) + total;
  }
  const videos = dados.videos + porNome.reconhecidos;
  if (videos === 0) {
    avisarErroHistorico(
      dados.semCanal > 0
        ? `Li ${dados.semCanal} vídeos do histórico, mas nenhum é de um canal da sua lista.`
        : 'Não achei vídeos no histórico. Confira se você está logado no YouTube e se o histórico está ligado.',
    );
    return;
  }
  const salvo = { contagem, videos, lidoEm: Date.now() };
  await setSetting('historicoVistos', salvo);
  chrome.runtime
    .sendMessage({ action: 'historico:salvo', data: salvo } satisfies Message)
    .catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (abaHistorico?.id !== tabId) return;
  abaHistorico = undefined;
  avisarErroHistorico('A aba do histórico fechou antes de terminar. Tente de novo.');
});

const PAUSA_ENTRE_PLAYLISTS_MS = 2000;
let pararPlaylist: AbortController | undefined;

function avisarPainel(msg: Message): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* painel fechado */
  });
}

/** Qualquer aba do YouTube serve. Só abre uma nova, em segundo plano, se não houver nenhuma. */
async function abaDoYouTube(): Promise<{ id: number; nova: boolean }> {
  const abas = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  const pronta = abas.find((a) => a.status === 'complete' && a.id !== undefined);
  if (pronta?.id !== undefined) return { id: pronta.id, nova: false };
  const aba = await chrome.tabs.create({
    url: 'https://www.youtube.com/feed/playlists',
    active: false,
  });
  if (aba.id === undefined) throw new Error('Could not open a YouTube tab.');
  await waitForTabComplete(aba.id);
  return { id: aba.id, nova: true };
}

async function sincronizarPlaylists(itens: ItemPlaylist[]): Promise<void> {
  if (pararPlaylist) throw new Error('Já estou cuidando das playlists.');
  const parada = new AbortController();
  pararPlaylist = parada;
  let aba: { id: number; nova: boolean } | undefined;
  try {
    const resultados: ResultadoAssunto[] = [];
    const semVideo: string[] = [];

    for (const [i, { assunto, canais }] of itens.entries()) {
      const base = { assunto, indice: i + 1, assuntos: itens.length, total: canais.length };
      const coletados = await coletarVideos(
        canais,
        (feito) =>
          avisarPainel({ action: 'playlist:progresso', data: { ...base, feito, criando: false } }),
        parada.signal,
      );
      semVideo.push(...coletados.semVideo);
      if (coletados.ids.length === 0) continue;
      parada.signal.throwIfAborted();
      avisarPainel({
        action: 'playlist:progresso',
        data: { ...base, feito: canais.length, criando: true },
      });

      try {
        aba ??= await abaDoYouTube();
        const salvas = await getSetting<PlaylistsCriadas>(CHAVE_PLAYLISTS, {});
        const r = await criarOuAtualizar(
          pedirNaAba(aba.id),
          assunto,
          coletados.ids,
          salvas[assunto],
        );
        await setSetting(CHAVE_PLAYLISTS, {
          ...salvas,
          [assunto]: {
            id: r.playlistId,
            criadaEm: r.criada ? Date.now() : (salvas[assunto]?.criadaEm ?? Date.now()),
            videos: r.videoIds.length,
            videoIds: r.videoIds,
          },
        });
        resultados.push({ assunto, playlistId: r.playlistId, novos: r.novos, criada: r.criada });
      } catch (err) {
        // Recusou uma vez: para aqui, para não insistir com o YouTube. O que já foi feito fica.
        avisarPainel({
          action: 'playlist:temporaria',
          data: {
            assunto,
            url: linkTemporario(coletados.ids),
            videos: coletados.ids.length,
            semVideo,
            motivo: err instanceof Error ? err.message : String(err),
            feitos: resultados.length,
          },
        });
        return;
      }
      if (i < itens.length - 1) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_PLAYLISTS_MS));
    }

    if (resultados.length === 0) throw new Error('Não achei vídeo nos canais deste assunto.');
    avisarPainel({ action: 'playlist:concluida', data: { resultados, semVideo } });
  } finally {
    pararPlaylist = undefined;
    if (aba?.nova) await chrome.tabs.remove(aba.id).catch(() => {});
  }
}

/** Abre o painel ou volta para a aba dele, se já estiver aberta. */
async function openDashboard(): Promise<void> {
  const url = chrome.runtime.getURL('src/painel/painel.html');
  const [aberta] = await chrome.tabs.query({ url });
  if (aberta?.id !== undefined) {
    await chrome.tabs.update(aberta.id, { active: true });
    if (aberta.windowId !== undefined)
      await chrome.windows.update(aberta.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

chrome.action.onClicked.addListener(() => {
  void openDashboard();
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as Message;
  switch (msg.action) {
    case 'extract:start':
      dispatchExtractStart(msg.data?.doZero === true).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        handleExtractError(message);
      });
      sendResponse({ ok: true });
      return false;

    case 'extract:progress':
      handleExtractProgress(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'extract:complete':
      handleExtractComplete(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'extract:error':
      handleExtractError(msg.data.message).then(() => sendResponse({ ok: true }));
      return true;

    case 'extract:cancel':
      handleExtractCancel(msg.data?.operationId).catch(() => {});
      sendResponse({ ok: true });
      return false;

    case 'extract:status':
      sendResponse({
        action: 'extract:status:reply',
        data: {
          running: extractStatus === 'running' || extractStatus === 'stopping',
          status: extractStatus,
          operationId: extractOpId,
          progress: currentProgress,
        },
      } satisfies Message);
      return false;

    case 'enrich:start':
      dispatchEnrichStart().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        void handleEnrichError(message);
      });
      sendResponse({ ok: true });
      return false;

    case 'enrich:cancel':
      handleEnrichCancel(msg.data?.operationId);
      sendResponse({ ok: true });
      return false;

    case 'enrich:status':
      void (async () => {
        try {
          const rows = await db().channels.toArray();
          const pendingCount = rows.filter((c) => !c.unsubscribedAt && precisaChecar(c)).length;
          sendResponse({
            action: 'enrich:status:reply',
            data: {
              running: enrichOp?.status === 'running' || enrichOp?.status === 'stopping',
              status: enrichOp?.status ?? 'idle',
              operationId: enrichOp?.id,
              progress: enrichOp?.progress,
              pendingCount,
            },
          } satisfies Message);
        } catch {
          sendResponse({
            action: 'enrich:status:reply',
            data: { running: false, status: 'idle', progress: undefined, pendingCount: 0 },
          } satisfies Message);
        }
      })();
      return true;

    case 'unsub:start':
      dispatchUnsubStart(msg.data.channelIds)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: message });
        });
      return true;

    case 'unsub:progress':
      handleUnsubProgress(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'unsub:complete':
      handleUnsubComplete(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'unsub:error':
      handleUnsubError(msg.data.message).then(() => sendResponse({ ok: true }));
      return true;

    case 'unsub:cancel':
      forwardUnsubCancel(msg.data?.operationId);
      sendResponse({ ok: true });
      return false;

    case 'unsub:status':
      sendResponse({
        action: 'unsub:status:reply',
        data: {
          running: unsubStatus === 'running' || unsubStatus === 'stopping',
          status: unsubStatus,
          operationId: unsubOpId,
          progress: unsubProgress,
        },
      } satisfies Message);
      return false;

    case 'historico:iniciar':
      iniciarHistorico().catch((err: unknown) => {
        void fecharAbaHistorico();
        avisarErroHistorico(friendlyError(err instanceof Error ? err.message : String(err)));
      });
      sendResponse({ ok: true });
      return false;

    case 'historico:cancelar':
      if (abaHistorico) void chrome.tabs.sendMessage(abaHistorico.id, msg).catch(() => {});
      sendResponse({ ok: true });
      return false;

    case 'historico:concluido':
      void concluirHistorico(msg.data).then(() => sendResponse({ ok: true }));
      return true;

    case 'historico:erro':
      void fecharAbaHistorico();
      return false;

    case 'playlist:sincronizar':
      sincronizarPlaylists(msg.data.itens).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          avisarPainel({ action: 'playlist:cancelada' });
          return;
        }
        avisarPainel({
          action: 'playlist:erro',
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      });
      sendResponse({ ok: true });
      return false;

    case 'playlist:cancelar':
      pararPlaylist?.abort();
      sendResponse({ ok: true });
      return false;

    case 'dashboard:open':
      void openDashboard();
      sendResponse({ ok: true });
      return false;

    case 'export:csv':
      handleExportCSV()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: message });
        });
      return true;

    case 'export:json':
      handleExportJSON()
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error: message });
        });
      return true;

    case 'tab:check':
      void hasSubscriptionsTab()
        .then((found) => {
          sendResponse({ action: 'tab:check:reply', data: { found } } satisfies Message);
        })
        .catch(() => {
          sendResponse({ action: 'tab:check:reply', data: { found: false } } satisfies Message);
        });
      return true;

    case 'tab:open-subscriptions':
      void findOrOpenSubscriptionsTab(false)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'clear:data':
      void (async () => {
        try {
          await handleExtractCancel().catch(() => {});
          handleEnrichCancel();
          enrichAbort?.abort();
          currentRunId = undefined;
          currentProgress = undefined;
          currentExtractTabId = undefined;
          extractStatus = 'idle';
          extractOpId = undefined;
          enrichOp = undefined;
          enrichAbort = undefined;
          clearUnsubState();
          unsubStatus = 'idle';
          unsubOpId = undefined;
          await db().channels.clear();
          await db().extractions.clear();
        } catch {
          /* best effort */
        }
        sendResponse({ ok: true });
      })();
      return true;

    default:
      return false;
  }
});

async function cleanupStaleExtractions(): Promise<void> {
  try {
    const staleRuns = await db().extractions.where('status').equals('running').toArray();
    for (const run of staleRuns) {
      if (run.id !== undefined) {
        await db().extractions.update(run.id, {
          completedAt: Date.now(),
          status: 'error',
          errorMessage: 'Interrupted — browser ended the background process.',
        });
      }
    }
  } catch {
    /* best effort */
  }
}

void cleanupStaleExtractions();

chrome.runtime.onInstalled.addListener(() => {
  /* placeholder for first-run setup */
});
