import { useEffect, useRef } from 'react';

interface Props {
  titulo: string;
  textos: string[];
  rotulo: string;
  aoConfirmar: () => void;
  aoVoltar: () => void;
}

export function ConfirmarPlaylist({
  titulo,
  textos,
  rotulo,
  aoConfirmar,
  aoVoltar,
}: Props): JSX.Element {
  const janela = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    janela.current?.showModal();
  }, []);

  return (
    <dialog
      ref={janela}
      className="confirmar"
      aria-labelledby="playlist-titulo"
      onCancel={aoVoltar}
    >
      <h2 id="playlist-titulo">{titulo}</h2>
      {textos.map((texto) => (
        <p key={texto}>{texto}</p>
      ))}
      <div className="confirmar-botoes">
        <button type="button" onClick={aoVoltar}>
          Voltar
        </button>
        <button type="button" onClick={aoConfirmar}>
          {rotulo}
        </button>
      </div>
    </dialog>
  );
}
