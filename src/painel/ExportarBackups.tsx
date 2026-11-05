import { useEffect, useState } from 'react';
import { listBackups } from '../shared/backup';
import { db } from '../shared/db';
import { downloadCSV, downloadJSON, triggerDownload } from '../shared/export';
import type { BackupRow, Channel } from '../shared/types';

const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

async function baixarBackup(b: BackupRow): Promise<void> {
  const conteudo = JSON.stringify(
    {
      backupId: b.id,
      createdAt: new Date(b.createdAt).toISOString(),
      channelCount: b.channelCount,
      plannedUnsubIds: b.plannedUnsubIds,
      channels: b.payload,
    },
    null,
    2,
  );
  await triggerDownload(conteudo, `backup-inscricoes-${b.createdAt}.json`, 'application/json');
}

async function todosOsCanais(): Promise<Channel[]> {
  return db().channels.toArray();
}

/** Lista exportada e backups, guardados num canto porque são usados de vez em quando. */
export function ExportarBackups({
  aoRestaurar,
}: {
  aoRestaurar: (backup: Channel[]) => void;
}): JSX.Element {
  const [backups, setBackups] = useState<BackupRow[] | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    listBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [aberto]);

  // Só o backup mais novo que tem marcações, para não trazer uma lista velha por engano.
  const comMarcacoes = backups?.findIndex((b) => b.payload.some((c) => c.mantido)) ?? -1;

  return (
    <details className="extras" onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary>Exportar e backups</summary>
      <div className="extras-botoes">
        <button type="button" onClick={() => void todosOsCanais().then(downloadCSV)}>
          Exportar CSV
        </button>
        <button type="button" onClick={() => void todosOsCanais().then(downloadJSON)}>
          Exportar JSON
        </button>
      </div>
      {backups === null ? (
        <p>Carregando backups…</p>
      ) : backups.length === 0 ? (
        <p>
          Nenhum backup ainda. A extensão cria um antes de cancelar inscrições e antes de começar do
          zero.
        </p>
      ) : (
        <ul>
          {backups.map((b, i) => (
            <li key={b.id}>
              <span>
                {formatoData.format(b.createdAt)}, {b.channelCount.toLocaleString('pt-BR')} canais
              </span>
              <button type="button" onClick={() => void baixarBackup(b)}>
                Baixar
              </button>
              {i === comMarcacoes && (
                <button type="button" onClick={() => aoRestaurar(b.payload)}>
                  Trazer {b.payload.filter((c) => c.mantido).length.toLocaleString('pt-BR')} de
                  &quot;Vou manter&quot;
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
