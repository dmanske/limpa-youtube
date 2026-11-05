/**
 * Traduz para português as mensagens internas da extensão antes de mostrá-las na tela.
 * O código segue gerando as mensagens em inglês; a tradução fica só aqui.
 */
export function friendlyError(raw: string, actionLabel: 'Scan' | 'Check' = 'Scan'): string {
  const acao = actionLabel === 'Scan' ? 'escaneie' : 'cheque';

  const traducoes: Array<[RegExp, string]> = [
    [
      /subscriptions.*tab|subscriptions.*not open/i,
      'Abra a página de inscrições do YouTube e tente de novo.',
    ],
    [
      /navigated away|YouTube page navigated/i,
      `A página mudou. Volte para as inscrições e ${acao} de novo.`,
    ],
    [
      /Navigated to \/feed\/channels/i,
      'Abrimos a página de inscrições. Espere carregar e escaneie de novo.',
    ],
    [
      /tab was closed during extraction/i,
      'A aba do YouTube fechou durante o escaneamento. Deixe a aba aberta e escaneie de novo.',
    ],
    [/tab was closed/i, `A aba do YouTube fechou. Abra a página de inscrições e ${acao} de novo.`],
    [
      /Timed out waiting for YouTube tab/i,
      'A aba do YouTube demorou a carregar. Recarregue a aba e tente de novo.',
    ],
    [/not responding/i, 'A aba do YouTube não respondeu. Recarregue a aba e tente de novo.'],
    [
      /Extension failed to load|No content script/i,
      'A extensão não carregou na aba. Recarregue a aba e tente de novo.',
    ],
    [/Could not open a YouTube tab/i, 'Não consegui abrir uma aba do YouTube.'],
    [/already in progress/i, 'Já existe um cancelamento em andamento.'],
    [/No channels selected/i, 'Nenhum canal selecionado.'],
    [/Selected channels not found/i, 'Não encontrei os canais selecionados. Escaneie de novo.'],
    [/Failed to create backup/i, 'Não consegui criar o backup, então não cancelei nada.'],
    [/No subscribe button found/i, 'Não achei o botão de inscrição deste canal.'],
    [/Neither unsubscribe menu/i, 'O menu de cancelamento não abriu.'],
    [/Confirmation dialog did not appear/i, 'A janela de confirmação não abriu.'],
    [/Captcha/i, 'O YouTube pediu uma verificação. Resolva na aba e continue depois.'],
    [/Card not present/i, 'O canal não apareceu na página de inscrições.'],
    [
      /button state didn't update/i,
      'Confirmei, mas o botão não mudou. Confira este canal no YouTube.',
    ],
    [/Interrupted by a new scan/i, 'Interrompido por um novo escaneamento.'],
    [/Interrupted/i, 'O Chrome encerrou a extensão no meio do trabalho. Tente de novo.'],
    [/Unknown error/i, 'Erro desconhecido.'],
    [/network|fetch|connection/i, 'Sem conexão. Confira sua internet e tente de novo.'],
  ];

  const achou = traducoes.find(([padrao]) => padrao.test(raw));
  return achou ? achou[1] : raw;
}
