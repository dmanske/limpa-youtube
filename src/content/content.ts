import type { Message } from '../shared/messages';
import { KEEPALIVE_PORT } from '../shared/messages';
import type { UnsubTarget } from '../shared/types';
import { extractAll } from './extractor';
import { lerHistorico } from './historico';
import { unsubBatchOnPage } from './unsubscribe';

let extractRunning = false;
let extractAbortController: AbortController | undefined;
let lastExtractProgress: { loaded: number; total?: number } | undefined;

let unsubRunning = false;
let unsubCancelRequested = false;

let historicoRodando = false;
let pararHistorico = false;

function send(msg: Message): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* popup may be closed; service worker is the canonical sink. */
  });
}

/** Espera a extensão terminar de gravar. Usado no que precisa chegar antes de soltar a porta. */
async function enviarEEsperar(msg: Message): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* a extensão foi recarregada; não há mais quem responda */
  }
}

async function runExtraction(): Promise<void> {
  if (extractRunning) return;
  extractRunning = true;
  lastExtractProgress = { loaded: 0 };

  const abortController = new AbortController();
  extractAbortController = abortController;

  const port = chrome.runtime.connect({ name: KEEPALIVE_PORT });
  const started = Date.now();

  try {
    let lastSentAt = 0;
    const { canais, completo } = await extractAll({
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastSentAt < 400) return;
        lastSentAt = now;
        lastExtractProgress = { loaded: progress.loaded, total: progress.total };
        send({
          action: 'extract:progress',
          data: { channels: [], progress },
        });
      },
      onBatch: async (batch, progress) => {
        lastExtractProgress = { loaded: progress.loaded, total: progress.total };
        await enviarEEsperar({
          action: 'extract:progress',
          data: { channels: batch, progress },
        });
      },
      signal: abortController.signal,
    });

    if (!abortController.signal.aborted) {
      await enviarEEsperar({
        action: 'extract:complete',
        data: { total: canais.length, durationMs: Date.now() - started, completo },
      });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : String(err);
    await enviarEEsperar({ action: 'extract:error', data: { message } });
  } finally {
    extractRunning = false;
    lastExtractProgress = undefined;
    extractAbortController = undefined;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  }
}

async function runHistorico(): Promise<void> {
  if (historicoRodando) return;
  historicoRodando = true;
  pararHistorico = false;
  const port = chrome.runtime.connect({ name: KEEPALIVE_PORT });
  try {
    const resultado = await lerHistorico(
      (videos) => send({ action: 'historico:progresso', data: { videos } }),
      () => pararHistorico,
    );
    send({ action: 'historico:concluido', data: resultado });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ action: 'historico:erro', data: { message } });
  } finally {
    historicoRodando = false;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  }
}

async function runUnsubBatch(batchId: string, targets: UnsubTarget[]): Promise<void> {
  if (unsubRunning) return;
  unsubRunning = true;
  unsubCancelRequested = false;

  const port = chrome.runtime.connect({ name: KEEPALIVE_PORT });
  const started = Date.now();

  try {
    const { progress, remaining } = await unsubBatchOnPage({
      batchId,
      targets,
      onResult: async (result, snapshot) => {
        send({ action: 'unsub:progress', data: { result, progress: snapshot } });
      },
      shouldCancel: () => unsubCancelRequested,
    });

    send({
      action: 'unsub:complete',
      data: { progress, remaining, durationMs: Date.now() - started },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ action: 'unsub:error', data: { message } });
  } finally {
    unsubRunning = false;
    unsubCancelRequested = false;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as Message;
  switch (msg.action) {
    case 'extract:start':
      runExtraction();
      sendResponse({ ok: true });
      return false;

    case 'historico:ler':
      void runHistorico();
      sendResponse({ ok: true });
      return false;

    case 'historico:cancelar':
      pararHistorico = true;
      sendResponse({ ok: true });
      return false;

    case 'unsub:batch':
      runUnsubBatch(msg.data.batchId, msg.data.targets);
      sendResponse({ ok: true });
      return false;

    case 'unsub:cancel':
      unsubCancelRequested = true;
      sendResponse({ ok: true });
      return false;

    case 'extract:cancel':
      extractAbortController?.abort();
      sendResponse({ ok: true });
      return false;

    case 'extract:status':
      sendResponse({
        action: 'extract:status:reply',
        data: {
          running: extractRunning,
          status: extractRunning ? 'running' : 'idle',
          progress: lastExtractProgress,
        },
      });
      return false;

    case 'ping':
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});
