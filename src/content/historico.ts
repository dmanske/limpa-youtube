import { pageHeight } from './scroll';
import { removeOverlay, setOverlayComplete, showOverlay, updateOverlay } from './progress-overlay';

/** Quantos vídeos recentes contam como "ultimamente". */
const LIMITE_DE_VIDEOS = 300;
const MAXIMO_DE_ROLAGENS = 60;
const ROLAGENS_SEM_NOVIDADE = 4;
const ESPERA_ENTRE_ROLAGENS_MS = 900;

const ITENS_DE_VIDEO = 'ytd-video-renderer, yt-lockup-view-model';
const LINKS_DE_CANAL = 'a[href^="/@"], a[href^="/channel/"]';

/** Transforma "/@Canal/videos" em "@canal" e "/channel/UC123" em "uc123". */
export function chaveDoLink(href: string): string | undefined {
  const partes = href.split(/[?#]/)[0]?.split('/').filter(Boolean) ?? [];
  const bruta = partes[0] === 'channel' ? partes[1] : partes[0];
  if (!bruta) return undefined;
  try {
    return decodeURIComponent(bruta).toLowerCase();
  } catch {
    return bruta.toLowerCase();
  }
}

export interface ContagemHistorico {
  contagem: Record<string, number>;
  videos: number;
  semCanal: number;
  /** Textos de cada vídeo sem link de canal. O canal é achado depois, pelo nome. */
  textosSemCanal: string[][];
}

const MAXIMO_DE_LINHAS_POR_VIDEO = 8;

/** Desde 11/2026 os vídeos do histórico só têm link para /watch; o canal aparece só como texto. */
function linhasDoVideo(item: Element): string[] {
  const texto = (item as HTMLElement).innerText ?? item.textContent ?? '';
  return texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean)
    .slice(0, MAXIMO_DE_LINHAS_POR_VIDEO);
}

export function contarCanais(raiz: ParentNode, limite = LIMITE_DE_VIDEOS): ContagemHistorico {
  const contagem: Record<string, number> = {};
  let videos = 0;
  let semCanal = 0;
  const textosSemCanal: string[][] = [];
  for (const item of Array.from(raiz.querySelectorAll(ITENS_DE_VIDEO)).slice(0, limite)) {
    const href = item.querySelector(LINKS_DE_CANAL)?.getAttribute('href');
    const chave = href ? chaveDoLink(href) : undefined;
    if (!chave) {
      semCanal += 1;
      textosSemCanal.push(linhasDoVideo(item));
      continue;
    }
    videos += 1;
    contagem[chave] = (contagem[chave] ?? 0) + 1;
  }
  return { contagem, videos, semCanal, textosSemCanal };
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Rola o histórico até o limite e devolve quantos vídeos de cada canal apareceram. */
export async function lerHistorico(
  aoProgredir: (videos: number) => void,
  deveParar: () => boolean,
): Promise<ContagemHistorico> {
  await showOverlay('Lendo seu histórico');
  try {
    let anterior = -1;
    let semNovidade = 0;
    for (let i = 0; i < MAXIMO_DE_ROLAGENS && !deveParar(); i++) {
      const total = document.querySelectorAll(ITENS_DE_VIDEO).length;
      aoProgredir(Math.min(total, LIMITE_DE_VIDEOS));
      updateOverlay(Math.min(total, LIMITE_DE_VIDEOS), 'Rolando a lista…');
      if (total >= LIMITE_DE_VIDEOS) break;
      semNovidade = total === anterior ? semNovidade + 1 : 0;
      if (semNovidade >= ROLAGENS_SEM_NOVIDADE) break;
      anterior = total;
      window.scrollTo(0, pageHeight());
      await esperar(ESPERA_ENTRE_ROLAGENS_MS);
    }
    const resultado = contarCanais(document);
    setOverlayComplete(resultado.videos, 0);
    return resultado;
  } catch (erro) {
    removeOverlay();
    throw erro;
  }
}
