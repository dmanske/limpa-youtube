import type { Andamento, Aviso } from './useOperacoes';

function textoAndamento(a: Andamento): { texto: string; feito: number; total: number } {
  const n = (v: number): string => v.toLocaleString('pt-BR');
  if (a.tipo === 'historico') {
    return { texto: `Lendo seu histórico: ${n(a.videos)} vídeos`, feito: 0, total: 0 };
  }
  if (a.tipo === 'playlist') {
    const onde = a.assuntos > 1 ? `Playlist ${n(a.indice)} de ${n(a.assuntos)}, ` : 'Playlist ';
    return a.criando
      ? { texto: `${onde}${a.assunto}: enviando ao YouTube`, feito: 0, total: 0 }
      : {
          texto: `${onde}${a.assunto}: vídeo mais recente de ${n(a.feito)} de ${n(a.total)} canais`,
          feito: a.feito,
          total: a.total,
        };
  }
  if (a.tipo === 'escanear') {
    const { loaded, total, phase } = a.progresso;
    if (phase === 'setup') return { texto: 'Preparando o escaneamento', feito: 0, total: 0 };
    if (phase === 'parsing')
      return { texto: `Lendo ${n(loaded)} canais`, feito: loaded, total: total ?? 0 };
    return { texto: `Rolando a lista: ${n(loaded)} canais`, feito: 0, total: 0 };
  }
  if (a.tipo === 'checar') {
    const { processed, total } = a.progresso;
    return { texto: `Checando atividade: ${n(processed)} de ${n(total)}`, feito: processed, total };
  }
  const p = a.progresso;
  const erros = p.error + p.halted + p.unreachable;
  return {
    texto: `Cancelando inscrições: ${n(p.processed)} de ${n(p.total)}, ${n(p.ok + p.alreadyUnsubbed)} feitas${erros ? `, ${n(erros)} com falha` : ''}`,
    feito: p.processed,
    total: p.total,
  };
}

interface Props {
  andamento: Andamento | null;
  aviso: Aviso | null;
  aoParar: () => void;
  aoFecharAviso: () => void;
  aoRetomar: (ids: string[]) => void;
}

export function BarraOperacao({
  andamento,
  aviso,
  aoParar,
  aoFecharAviso,
  aoRetomar,
}: Props): JSX.Element | null {
  if (andamento) {
    const { texto, feito, total } = textoAndamento(andamento);
    return (
      <div className="operacao" role="status" aria-live="polite">
        <div className="operacao-linha">
          <strong>{andamento.parando ? 'Parando…' : texto}</strong>
          {andamento.tipo !== 'checar' && andamento.tipo !== 'playlist' && !andamento.parando && (
            <span>Deixe a aba do YouTube aberta. Esta tela volta sozinha no fim.</span>
          )}
          <button type="button" onClick={aoParar} disabled={andamento.parando}>
            Parar
          </button>
        </div>
        <div className={`barra${total > 0 ? '' : ' indeterminada'}`}>
          <div
            style={total > 0 ? { width: `${Math.min(100, (feito / total) * 100)}%` } : undefined}
          />
        </div>
      </div>
    );
  }
  if (!aviso) return null;
  return (
    <div
      className={`operacao aviso ${aviso.nivel}`}
      role={aviso.nivel === 'erro' ? 'alert' : 'status'}
    >
      <div className="operacao-linha">
        <strong>{aviso.texto}</strong>
        {aviso.link && (
          <button type="button" onClick={() => void chrome.tabs.create({ url: aviso.link?.url })}>
            {aviso.link.rotulo}
          </button>
        )}
        {aviso.retomar && aviso.retomar.length > 0 && (
          <button type="button" onClick={() => aoRetomar(aviso.retomar ?? [])}>
            Continuar
          </button>
        )}
        <button type="button" onClick={aoFecharAviso}>
          Fechar
        </button>
      </div>
      {aviso.falhas && aviso.falhas.length > 0 && (
        <details>
          <summary>
            {aviso.link ? 'Ver os canais sem vídeo' : 'Ver os canais com falha'} (
            {aviso.falhas.length})
          </summary>
          <ul>
            {aviso.falhas.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
