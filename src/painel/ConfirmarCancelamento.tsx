import { useEffect, useRef, useState } from 'react';
import type { Channel } from '../shared/types';

const SEGUNDOS_POR_CANAL = 5.5;
const LIMITE_POR_LOTE = 200;
const PALAVRA = 'CANCELAR';

interface Props {
  canais: Channel[];
  aoConfirmar: () => void;
  aoVoltar: () => void;
}

export function ConfirmarCancelamento({ canais, aoConfirmar, aoVoltar }: Props): JSX.Element {
  const [digitado, setDigitado] = useState('');
  const janela = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    janela.current?.showModal();
  }, []);

  const total = canais.length;
  const agora = Math.min(total, LIMITE_POR_LOTE);
  const depois = total - agora;
  const minutos = Math.max(1, Math.round((agora * SEGUNDOS_POR_CANAL) / 60));
  const amostra = canais.slice(0, 5);
  const podeConfirmar = digitado.trim().toUpperCase() === PALAVRA;

  return (
    <dialog
      ref={janela}
      className="confirmar"
      aria-labelledby="confirmar-titulo"
      onCancel={aoVoltar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (podeConfirmar) aoConfirmar();
        }}
      >
        <h2 id="confirmar-titulo">
          Cancelar {total.toLocaleString('pt-BR')} {total === 1 ? 'inscrição' : 'inscrições'}?
        </h2>
        <p>
          Leva cerca de {minutos} min. O Chrome vai para a aba do YouTube durante o cancelamento e
          volta para cá no fim. A extensão salva um backup antes de começar.
        </p>
        {depois > 0 && (
          <p>
            Agora vão {agora.toLocaleString('pt-BR')} canais. Os outros{' '}
            {depois.toLocaleString('pt-BR')} continuam marcados para a próxima rodada.
          </p>
        )}
        <ul>
          {amostra.map((c) => (
            <li key={c.channelId}>{c.name}</li>
          ))}
          {total > amostra.length && (
            <li className="mais">e mais {(total - amostra.length).toLocaleString('pt-BR')}</li>
          )}
        </ul>
        <label>
          <span>
            Digite <strong>{PALAVRA}</strong> para confirmar
          </span>
          <input
            type="text"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </label>
        <div className="confirmar-botoes">
          <button type="button" onClick={aoVoltar}>
            Voltar
          </button>
          <button type="submit" className="perigo" disabled={!podeConfirmar}>
            Cancelar inscrições
          </button>
        </div>
      </form>
    </dialog>
  );
}
