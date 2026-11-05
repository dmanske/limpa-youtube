import { useEffect, useRef, useState } from 'react';

const PALAVRA = 'ZERAR';

interface Props {
  mantidos: number;
  paraTirar: number;
  aoConfirmar: () => void;
  aoVoltar: () => void;
}

export function ConfirmarZerar({ mantidos, paraTirar, aoConfirmar, aoVoltar }: Props): JSX.Element {
  const [digitado, setDigitado] = useState('');
  const janela = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    janela.current?.showModal();
  }, []);

  const podeConfirmar = digitado.trim().toUpperCase() === PALAVRA;

  return (
    <dialog ref={janela} className="confirmar" aria-labelledby="zerar-titulo" onCancel={aoVoltar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (podeConfirmar) aoConfirmar();
        }}
      >
        <h2 id="zerar-titulo">Começar do zero?</h2>
        <p>
          Vou ler a lista inteira do YouTube. Se a leitura chegar ao fim, a lista salva é trocada
          pelo que veio de lá e as fotos e datas são buscadas de novo. Se parar antes, nada é
          apagado.
        </p>
        <p>
          Você perde as marcações: {mantidos.toLocaleString('pt-BR')} em &quot;Vou manter&quot; e{' '}
          {paraTirar.toLocaleString('pt-BR')} em &quot;Para tirar&quot;. Nenhuma inscrição é
          cancelada. Antes de apagar, salvo um backup em &quot;Exportar e backups&quot;.
        </p>
        <p>
          A aba &quot;Meus canais&quot; da TV continua como está, mas a próxima atualização dela só
          traz o que você marcar de novo.
        </p>
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
            Começar do zero
          </button>
        </div>
      </form>
    </dialog>
  );
}
