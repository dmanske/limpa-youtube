import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../shared/db';
import { linkDaPlaylist } from '../shared/playlist';
import type { Channel } from '../shared/types';
import dadosAssuntos from './assuntos.json';
import { BarraOperacao } from './BarraOperacao';
import { ConfirmarCancelamento } from './ConfirmarCancelamento';
import { ConfirmarPlaylist } from './ConfirmarPlaylist';
import { ConfirmarZerar } from './ConfirmarZerar';
import { ExportarBackups } from './ExportarBackups';
import { useOperacoes } from './useOperacoes';
import {
  camposDoEstado,
  canaisAtivos,
  canaisForaDaListaNoPainel,
  canaisNaLista,
  estadoDe,
  falaDeIA,
  filtrarCanais,
  gruposDePlaylist,
  inicialDoCanal,
  mantidosDoBackup,
  resumoAssuntos,
  textoInscritos,
  textoUltimoVideo,
  vistosDoCanal,
  type Classificacao,
  type Estado,
  type Ordem,
  type Visao,
} from './logica';

const CLASSIFICACAO: Classificacao = dadosAssuntos;

const OPCOES_PARADO = [
  { dias: 0, rotulo: 'Qualquer data' },
  { dias: 180, rotulo: 'Parado há 6 meses' },
  { dias: 365, rotulo: 'Parado há 1 ano' },
  { dias: 730, rotulo: 'Parado há 2 anos' },
  { dias: 1095, rotulo: 'Parado há 3 anos' },
  { dias: 1825, rotulo: 'Parado há 5 anos' },
];

const OPCOES_ORDEM: Array<{ valor: Ordem; rotulo: string }> = [
  { valor: 'inscritos-maior', rotulo: 'Mais inscritos' },
  { valor: 'inscritos-menor', rotulo: 'Menos inscritos' },
  { valor: 'nome', rotulo: 'Nome de A a Z' },
  { valor: 'video-antigo', rotulo: 'Vídeo mais antigo' },
  { valor: 'mais-vistos', rotulo: 'Mais assistidos' },
];

interface UltimaAcao {
  texto: string;
  anteriores: Array<{ id: string; estado: Estado }>;
}

function igualVisao(a: Visao, b: Visao): boolean {
  if (a.tipo === 'assunto' && b.tipo === 'assunto') return a.assunto === b.assunto;
  return a.tipo === b.tipo;
}

function tituloVisao(visao: Visao): string {
  if (visao.tipo === 'assunto') return visao.assunto;
  if (visao.tipo === 'marcados') return 'Para tirar';
  if (visao.tipo === 'olhar') return 'Vale olhar';
  if (visao.tipo === 'mantidos') return 'Vou manter';
  if (visao.tipo === 'sumidos') return 'Não apareceram';
  if (visao.tipo === 'ia') return 'Tudo sobre IA';
  if (visao.tipo === 'assistidos') return 'Assisti ultimamente';
  return 'A conferir';
}

interface CartaoProps {
  canal: Channel;
  vistos: number;
  aoDecidir: (id: string, estado: Estado) => void;
  aoResolverSumido: (id: string, jaSai: boolean) => void;
  bloqueado: boolean;
}

function Foto({ canal }: { canal: Channel }): JSX.Element {
  const [falhou, setFalhou] = useState(false);
  if (!canal.avatarUrl || falhou) {
    return (
      <span className="foto inicial" aria-hidden="true">
        {inicialDoCanal(canal.name)}
      </span>
    );
  }
  return (
    <img
      className="foto"
      src={canal.avatarUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFalhou(true)}
    />
  );
}

const Cartao = memo(function Cartao({
  canal,
  vistos,
  aoDecidir,
  aoResolverSumido,
  bloqueado,
}: CartaoProps): JSX.Element {
  const estado = estadoDe(canal);
  const sumido = canal.sumiuDaListaEm !== undefined;
  return (
    <div className={`cartao ${estado}`}>
      <div className="cartao-info">
        <Foto canal={canal} />
        <span className="nome">{canal.name}</span>
        <small>Inscritos: {textoInscritos(canal)}</small>
        <small>Último vídeo: {textoUltimoVideo(canal)}</small>
        {vistos > 0 && (
          <small className="vistos">
            Assistiu {vistos} {vistos === 1 ? 'vídeo' : 'vídeos'} ultimamente
          </small>
        )}
        {sumido && <small>Não apareceu na última leitura da lista.</small>}
        <p className="descricao" title={canal.description}>
          {canal.description || 'Sem descrição.'}
        </p>
      </div>
      <div className="cartao-botoes">
        {sumido && (
          <>
            <button
              type="button"
              disabled={bloqueado}
              onClick={() => aoResolverSumido(canal.channelId, true)}
            >
              Já saí
            </button>
            <button
              type="button"
              disabled={bloqueado}
              onClick={() => aoResolverSumido(canal.channelId, false)}
            >
              Continuo inscrito
            </button>
          </>
        )}
        {!sumido && estado !== 'tirar' && (
          <button
            type="button"
            className="tirar"
            disabled={bloqueado}
            onClick={() => aoDecidir(canal.channelId, 'tirar')}
          >
            Tirar
          </button>
        )}
        {!sumido && estado !== 'manter' && (
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => aoDecidir(canal.channelId, 'manter')}
          >
            Manter
          </button>
        )}
        {!sumido && estado !== 'conferir' && (
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => aoDecidir(canal.channelId, 'conferir')}
          >
            Voltar para a lista
          </button>
        )}
      </div>
      <a
        href={canal.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Abrir ${canal.name} no YouTube`}
        title="Abrir no YouTube"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
      </a>
    </div>
  );
});

const ROTULO_DESTINO: Record<Estado, string> = {
  tirar: 'Para tirar',
  manter: 'Vou manter',
  conferir: 'A conferir',
};

export function App(): JSX.Element {
  const [canais, setCanais] = useState<Channel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState(false);
  const [erroGravar, setErroGravar] = useState(false);
  const [visao, setVisao] = useState<Visao>({ tipo: 'todos' });
  const [busca, setBusca] = useState('');
  const [paradoDias, setParadoDias] = useState(0);
  const [ordem, setOrdem] = useState<Ordem>('inscritos-maior');
  const [ultima, setUltima] = useState<UltimaAcao | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [zerando, setZerando] = useState(false);
  const [confirmaPlaylist, setConfirmaPlaylist] = useState<'uma' | 'todas' | null>(null);
  const canaisRef = useRef<Channel[]>([]);

  const recarregar = useCallback(async () => {
    try {
      const ativos = canaisAtivos(await db().channels.toArray());
      canaisRef.current = ativos;
      setCanais(ativos);
    } catch {
      setErroLeitura(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const nomeDoCanal = useCallback(
    (id: string) => canaisRef.current.find((c) => c.channelId === id)?.name ?? id,
    [],
  );
  const voltarAosFiltrosIniciais = (): void => {
    setVisao({ tipo: 'todos' });
    setBusca('');
    setParadoDias(0);
    setOrdem('inscritos-maior');
    setUltima(null);
  };
  const operacoes = useOperacoes({
    aoMudarDados: () => void recarregar(),
    nomeDoCanal,
    aoZerar: voltarAosFiltrosIniciais,
  });
  const ocupado = operacoes.andamento !== null;
  const cancelando = operacoes.andamento?.tipo === 'cancelar';
  const vistos = useMemo(() => operacoes.historico?.contagem ?? {}, [operacoes.historico]);

  /** Grava na hora: o canal sai da lista e a decisão não se perde se a aba fechar. */
  const aplicar = useCallback(
    async (mudancas: Map<string, Estado>) => {
      const novos = canaisRef.current.map((c) => {
        const estado = mudancas.get(c.channelId);
        return estado ? { ...c, ...camposDoEstado(estado) } : c;
      });
      canaisRef.current = novos;
      setCanais(novos);
      try {
        const tabela = db().channels;
        await db().transaction('rw', tabela, async () => {
          await Promise.all(
            [...mudancas].map(([id, estado]) => tabela.update(id, camposDoEstado(estado))),
          );
        });
        setErroGravar(false);
      } catch {
        setErroGravar(true);
        void recarregar();
      }
    },
    [recarregar],
  );

  const decidir = useCallback(
    (ids: string[], estado: Estado) => {
      const alvo = new Set(ids);
      const atingidos = canaisRef.current.filter((c) => alvo.has(c.channelId));
      if (atingidos.length === 0) return;
      const quantos =
        atingidos.length === 1
          ? (atingidos[0]?.name ?? '1 canal')
          : `${atingidos.length.toLocaleString('pt-BR')} canais`;
      setUltima({
        texto: `${quantos} foi para "${ROTULO_DESTINO[estado]}".`,
        anteriores: atingidos.map((c) => ({ id: c.channelId, estado: estadoDe(c) })),
      });
      void aplicar(new Map(ids.map((id) => [id, estado])));
    },
    [aplicar],
  );

  const aoDecidir = useCallback((id: string, estado: Estado) => decidir([id], estado), [decidir]);

  const desfazer = (): void => {
    if (!ultima) return;
    void aplicar(new Map(ultima.anteriores.map((a) => [a.id, a.estado])));
    setUltima(null);
  };

  /** Decide sobre um canal que sumiu da lista. Nada é cancelado no YouTube aqui. */
  const resolverSumidos = useCallback(
    async (ids: string[], jaSai: boolean) => {
      const agora = Date.now();
      try {
        const tabela = db().channels;
        await db().transaction('rw', tabela, async () => {
          await Promise.all(
            ids.map((id) =>
              tabela.update(
                id,
                jaSai
                  ? { unsubscribedAt: agora, pendingUnsub: false, sumiuDaListaEm: undefined }
                  : { sumiuDaListaEm: undefined },
              ),
            ),
          );
        });
        setErroGravar(false);
      } catch {
        setErroGravar(true);
      }
      void recarregar();
    },
    [recarregar],
  );

  const aoResolverSumido = useCallback(
    (id: string, jaSai: boolean) => void resolverSumidos([id], jaSai),
    [resolverSumidos],
  );

  const naLista = useMemo(() => canaisNaLista(canais), [canais]);
  const totalSumidos = useMemo(() => canaisForaDaListaNoPainel(canais).length, [canais]);
  const conferir = useMemo(() => naLista.filter((c) => estadoDe(c) === 'conferir'), [naLista]);
  const canaisMarcados = useMemo(() => naLista.filter((c) => estadoDe(c) === 'tirar'), [naLista]);
  const totalMantidos = useMemo(
    () => naLista.filter((c) => estadoDe(c) === 'manter').length,
    [naLista],
  );
  const assuntos = useMemo(() => resumoAssuntos(naLista, CLASSIFICACAO), [naLista]);
  const totalOlhar = useMemo(() => {
    const olhar = new Set(CLASSIFICACAO.valeOlhar);
    return conferir.filter((c) => olhar.has(c.channelId)).length;
  }, [conferir]);
  const totalIA = useMemo(
    () => conferir.filter((c) => falaDeIA(c, CLASSIFICACAO)).length,
    [conferir],
  );
  const totalAssistidos = useMemo(
    () => conferir.filter((c) => vistosDoCanal(c, vistos) > 0).length,
    [conferir, vistos],
  );
  const visiveis = useMemo(
    () => filtrarCanais(canais, { visao, busca, paradoDias, ordem }, CLASSIFICACAO, vistos),
    [canais, visao, busca, paradoDias, ordem, vistos],
  );
  const idsVisiveis = visiveis.map((c) => c.channelId);
  const assuntoAberto = visao.tipo === 'assunto' ? visao.assunto : null;
  const gruposPlaylist = useMemo(() => gruposDePlaylist(naLista, CLASSIFICACAO), [naLista]);
  const grupoAberto = gruposPlaylist.find((g) => g.assunto === assuntoAberto);
  const jaCriadas = gruposPlaylist.filter((g) => operacoes.playlists[g.assunto]).length;
  const restaurarMantidos = (backup: Channel[]): void => {
    const ids = mantidosDoBackup(canaisRef.current, backup);
    if (ids.length === 0) {
      setUltima({ texto: 'Esses canais já estão com decisão tomada.', anteriores: [] });
      return;
    }
    decidir(ids, 'manter');
  };
  const playlistCriada = assuntoAberto === null ? undefined : operacoes.playlists[assuntoAberto];
  const naListaDeDecididos = visao.tipo === 'marcados' || visao.tipo === 'mantidos';

  const escolherVisao = (alvo: Visao): void => {
    setVisao(alvo);
    if (alvo.tipo === 'assistidos') setOrdem('mais-vistos');
    else if (ordem === 'mais-vistos') setOrdem('inscritos-maior');
  };

  const botaoVisao = (
    alvo: Visao,
    rotulo: string,
    total: number,
    marcadosAqui?: number,
  ): JSX.Element => (
    <button
      type="button"
      className={igualVisao(visao, alvo) ? 'ativo' : ''}
      aria-current={igualVisao(visao, alvo) ? 'true' : undefined}
      onClick={() => escolherVisao(alvo)}
    >
      <span>{rotulo}</span>
      <span className="numeros">
        {marcadosAqui ? <em>{marcadosAqui}</em> : null}
        {total}
      </span>
    </button>
  );

  return (
    <div className="painel">
      <header className="topo">
        <h1>Limpa YouTube</h1>
        <label className="busca">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="search"
            placeholder="Buscar por nome ou descrição"
            aria-label="Buscar canal"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <div className="acoes-topo">
          <button type="button" onClick={operacoes.escanear} disabled={ocupado}>
            Escanear inscrições
          </button>
          <button type="button" onClick={() => setZerando(true)} disabled={ocupado}>
            Começar do zero
          </button>
          <button
            type="button"
            onClick={operacoes.checar}
            disabled={ocupado || operacoes.pendentes === 0}
            title={operacoes.pendentes === 0 ? 'Todos os canais já foram checados' : undefined}
          >
            Checar atividade
            {operacoes.pendentes > 0 ? ` (${operacoes.pendentes.toLocaleString('pt-BR')})` : ''}
          </button>
          <button type="button" onClick={operacoes.lerHistorico} disabled={ocupado}>
            Ler meu histórico
          </button>
          <button
            type="button"
            onClick={() => setConfirmaPlaylist('todas')}
            disabled={ocupado || gruposPlaylist.length === 0}
          >
            {jaCriadas >= gruposPlaylist.length
              ? 'Atualizar todas as playlists'
              : 'Fazer todas as playlists'}
          </button>
        </div>
      </header>

      <BarraOperacao
        andamento={operacoes.andamento}
        aviso={operacoes.aviso}
        aoParar={operacoes.parar}
        aoFecharAviso={operacoes.fecharAviso}
        aoRetomar={operacoes.cancelarInscricoes}
      />

      <div className="corpo">
        <aside aria-label="Assuntos">
          <nav>
            {botaoVisao({ tipo: 'todos' }, 'A conferir', conferir.length)}
            {botaoVisao({ tipo: 'assistidos' }, 'Assisti ultimamente', totalAssistidos)}
            {botaoVisao({ tipo: 'ia' }, 'Tudo sobre IA', totalIA)}
            {botaoVisao({ tipo: 'olhar' }, 'Vale olhar', totalOlhar)}
            <hr />
            {botaoVisao({ tipo: 'marcados' }, 'Para tirar', canaisMarcados.length)}
            {botaoVisao({ tipo: 'mantidos' }, 'Vou manter', totalMantidos)}
            {totalSumidos > 0 && botaoVisao({ tipo: 'sumidos' }, 'Não apareceram', totalSumidos)}
            <hr />
            {assuntos.map((a) => (
              <span key={a.assunto} className="linha">
                {botaoVisao(
                  { tipo: 'assunto', assunto: a.assunto },
                  a.assunto,
                  a.total,
                  a.marcados,
                )}
              </span>
            ))}
          </nav>
          <details className="como-usar">
            <summary>Como usar</summary>
            <ol>
              <li>
                Escolha um assunto ou um filtro. &quot;Assisti ultimamente&quot; aparece depois de
                clicar em &quot;Ler meu histórico&quot;.
              </li>
              <li>
                Em cada canal, clique em &quot;Tirar&quot; ou &quot;Manter&quot;. Ele sai da lista,
                fica salvo na hora e vai para o filtro certo, para você não conferir de novo.
              </li>
              <li>
                Errou? Use &quot;Desfazer&quot;, no rodapé, ou &quot;Voltar para a lista&quot;, no
                filtro onde o canal está.
              </li>
              <li>
                Clique em &quot;Cancelar inscrições&quot;, confira e digite CANCELAR. O Chrome vai
                para a aba do YouTube e volta para cá no fim.
              </li>
              <li>
                &quot;Checar atividade&quot; traz a foto e a data do último vídeo de cada canal.
              </li>
              <li>
                &quot;Fazer todas as playlists&quot; cria uma playlist privada por assunto, com o
                vídeo mais recente de cada canal, menos os de &quot;Para tirar&quot;. Depois, o
                mesmo botão acrescenta o que for novo, sem repetir vídeo. Num assunto aberto, o
                botão faz só aquele. Nada se atualiza sozinho.
              </li>
              <li>
                &quot;Começar do zero&quot; lê a lista inteira e troca a lista salva pelo que veio
                do YouTube, sem cancelar nada. Você perde as marcações, com backup salvo antes, e as
                fotos e datas são buscadas de novo.
              </li>
              <li>
                &quot;Escanear inscrições&quot; recarrega a aba do YouTube e lê a lista até o fim.
                Deixe essa aba na frente. Canal que ficou de fora vai para &quot;Não
                apareceram&quot;: abra no YouTube e escolha &quot;Já saí&quot; ou &quot;Continuo
                inscrito&quot;. Nada é cancelado sozinho.
              </li>
            </ol>
          </details>
          <ExportarBackups aoRestaurar={restaurarMantidos} />
        </aside>

        <main>
          <div className="cabecalho">
            <div>
              <h2>{tituloVisao(visao)}</h2>
              <p>
                {visiveis.length.toLocaleString('pt-BR')}{' '}
                {visiveis.length === 1 ? 'canal' : 'canais'}
                {visao.tipo === 'assistidos' && operacoes.historico
                  ? `, nos últimos ${operacoes.historico.videos.toLocaleString('pt-BR')} vídeos do histórico`
                  : ''}
              </p>
            </div>
            <div className="controles">
              <label>
                <span>Último vídeo</span>
                <select value={paradoDias} onChange={(e) => setParadoDias(Number(e.target.value))}>
                  {OPCOES_PARADO.map((o) => (
                    <option key={o.dias} value={o.dias}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Ordenar por</span>
                <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
                  {OPCOES_ORDEM.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              {playlistCriada && (
                <button
                  type="button"
                  onClick={() =>
                    void chrome.tabs.create({ url: linkDaPlaylist(playlistCriada.id) })
                  }
                >
                  Abrir playlist
                </button>
              )}
              {assuntoAberto !== null && (
                <button
                  type="button"
                  onClick={() => setConfirmaPlaylist('uma')}
                  disabled={!grupoAberto || ocupado}
                >
                  {playlistCriada ? 'Atualizar playlist' : 'Criar playlist no YouTube'}
                </button>
              )}
              {visao.tipo === 'sumidos' ? (
                <button
                  type="button"
                  onClick={() => void resolverSumidos(idsVisiveis, true)}
                  disabled={visiveis.length === 0 || cancelando}
                >
                  Já saí de todos
                </button>
              ) : naListaDeDecididos ? (
                <button
                  type="button"
                  onClick={() => decidir(idsVisiveis, 'conferir')}
                  disabled={visiveis.length === 0 || cancelando}
                >
                  Voltar todos para a lista
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => decidir(idsVisiveis, 'tirar')}
                    disabled={visiveis.length === 0 || cancelando}
                  >
                    Tirar todos daqui
                  </button>
                  <button
                    type="button"
                    onClick={() => decidir(idsVisiveis, 'manter')}
                    disabled={visiveis.length === 0 || cancelando}
                  >
                    Manter todos daqui
                  </button>
                </>
              )}
            </div>
          </div>

          {carregando ? (
            <div className="vazio" role="status">
              <h3>Carregando seus canais</h3>
            </div>
          ) : erroLeitura ? (
            <div className="vazio" role="alert">
              <h3>Não consegui ler a lista salva</h3>
              <p>Recarregue esta página. Se continuar, escaneie suas inscrições de novo.</p>
            </div>
          ) : canais.length === 0 ? (
            <div className="vazio">
              <h3>Nenhum canal salvo ainda</h3>
              <p>Clique em &quot;Escanear inscrições&quot;, no topo desta tela.</p>
            </div>
          ) : visiveis.length === 0 ? (
            <div className="vazio">
              <h3>Nenhum canal aqui</h3>
              <p>
                {paradoDias > 0
                  ? 'Este filtro precisa da data do último vídeo. Rode "Checar atividade" ou escolha "Qualquer data".'
                  : visao.tipo === 'assistidos' && !operacoes.historico
                    ? 'Clique em "Ler meu histórico", no topo desta tela.'
                    : 'Nada por aqui. Se buscou um canal, ele pode estar em "Para tirar" ou "Vou manter".'}
              </p>
            </div>
          ) : (
            <div className="grade">
              {visiveis.map((canal) => (
                <Cartao
                  key={canal.channelId}
                  canal={canal}
                  vistos={vistosDoCanal(canal, vistos)}
                  aoDecidir={aoDecidir}
                  aoResolverSumido={aoResolverSumido}
                  bloqueado={cancelando}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <footer className="rodape">
        <strong>{canaisMarcados.length.toLocaleString('pt-BR')} para tirar</strong>
        <span>
          {totalMantidos.toLocaleString('pt-BR')} para manter,{' '}
          {conferir.length.toLocaleString('pt-BR')} a conferir
        </span>
        <span className={`estado ${erroGravar ? 'erro' : ''}`} role="status">
          {erroGravar ? 'Não consegui salvar a última decisão. Tente de novo.' : ultima?.texto}
        </span>
        {ultima && !erroGravar && (
          <button type="button" className="desfazer" onClick={desfazer} disabled={cancelando}>
            Desfazer
          </button>
        )}
        <div className="rodape-botoes">
          <button
            type="button"
            className="perigo"
            onClick={() => setConfirmando(true)}
            disabled={canaisMarcados.length === 0 || ocupado}
          >
            Cancelar inscrições
          </button>
        </div>
      </footer>

      {confirmaPlaylist === 'uma' && grupoAberto && (
        <ConfirmarPlaylist
          titulo={
            playlistCriada
              ? `Atualizar a playlist "${grupoAberto.assunto}"?`
              : `Criar a playlist "${grupoAberto.assunto}"?`
          }
          textos={[
            `Vou buscar o vídeo mais recente de ${grupoAberto.canais.length.toLocaleString('pt-BR')} ${grupoAberto.canais.length === 1 ? 'canal' : 'canais'}.`,
            playlistCriada
              ? 'Entra só o que ainda não está na playlist. Nada é tirado dela.'
              : 'A playlist fica privada na sua conta. Suas outras playlists e suas inscrições não mudam.',
          ]}
          rotulo={playlistCriada ? 'Atualizar' : 'Criar playlist'}
          aoVoltar={() => setConfirmaPlaylist(null)}
          aoConfirmar={() => {
            setConfirmaPlaylist(null);
            operacoes.sincronizarPlaylists([grupoAberto]);
          }}
        />
      )}

      {confirmaPlaylist === 'todas' && (
        <ConfirmarPlaylist
          titulo="Fazer todas as playlists?"
          textos={[
            `São ${gruposPlaylist.length.toLocaleString('pt-BR')} assuntos e ${gruposPlaylist.reduce((soma, g) => soma + g.canais.length, 0).toLocaleString('pt-BR')} canais: ${(gruposPlaylist.length - jaCriadas).toLocaleString('pt-BR')} playlists novas e ${jaCriadas.toLocaleString('pt-BR')} para atualizar. Leva alguns minutos.`,
            'Cada uma recebe o vídeo mais recente de cada canal e fica privada. Nada é apagado, e suas inscrições não mudam.',
            'Se o YouTube recusar alguma, eu paro ali. O que já foi feito fica pronto.',
          ]}
          rotulo="Fazer todas"
          aoVoltar={() => setConfirmaPlaylist(null)}
          aoConfirmar={() => {
            setConfirmaPlaylist(null);
            operacoes.sincronizarPlaylists(gruposPlaylist);
          }}
        />
      )}

      {zerando && (
        <ConfirmarZerar
          mantidos={totalMantidos}
          paraTirar={canaisMarcados.length}
          aoVoltar={() => setZerando(false)}
          aoConfirmar={() => {
            setZerando(false);
            operacoes.escanearDoZero();
          }}
        />
      )}

      {confirmando && (
        <ConfirmarCancelamento
          canais={canaisMarcados}
          aoVoltar={() => setConfirmando(false)}
          aoConfirmar={() => {
            setConfirmando(false);
            setUltima(null);
            operacoes.cancelarInscricoes(canaisMarcados.map((c) => c.channelId));
          }}
        />
      )}
    </div>
  );
}
