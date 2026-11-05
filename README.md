# Limpa YouTube

Extensão de Chrome para ver os canais em que você está inscrito, achar os que pararam de postar e cancelar vários de uma vez. O YouTube precisa estar em português.

## Instalar

1. [Baixe o zip](https://github.com/dmanske/limpa-youtube/releases/latest/download/limpa-youtube.zip) e descompacte.
2. Guarde a pasta `Limpa YouTube` num lugar fixo. Se apagar a pasta, a extensão para de funcionar.
3. No Chrome, entre em `chrome://extensions` e ligue o **Modo do desenvolvedor**, no canto de cima.
4. Clique em **Carregar sem compactação** e escolha a pasta.
5. Recarregue as abas do YouTube que estiverem abertas.

## Usar

1. Entre na sua conta do YouTube e clique no ícone da extensão.
2. Clique em **Escanear inscrições** e deixe a aba do YouTube na frente até terminar.
3. Clique em **Checar atividade** para ver a data do último vídeo de cada canal.
4. Em cada canal, escolha **Tirar** ou **Manter**.
5. Clique em **Cancelar inscrições**, no rodapé, confira a lista e digite `CANCELAR`.

**O cancelamento vale de verdade na sua conta.** Comece com 1 ou 2 canais para testar.

## O que mais tem

- **Filtros:** por data do último vídeo, por busca e por canais que falam de IA.
- **Ler meu histórico:** mostra os canais que você assistiu ultimamente.
- **Exportar e backups:** guarda sua lista e suas marcações.

Nesta versão não há assuntos prontos: todos os canais aparecem em **Outros**.

## Atualizar

Baixe o zip de novo, troque o conteúdo da pasta e clique em recarregar no cartão da extensão, em `chrome://extensions`.

## Privacidade

Sua lista e suas marcações ficam salvas no seu Chrome. A extensão só tem permissão para acessar `youtube.com`.

## Limites

- Só funciona no Chrome instalado no computador, com o YouTube em português.
- Ela lê as páginas e clica nos botões do YouTube. Se o YouTube mudar a página, alguma função pode parar até sair uma correção.
- Não é da Google nem do YouTube, e não está na Chrome Web Store.
- Se encontrar um problema, abra uma [issue](https://github.com/dmanske/limpa-youtube/issues).

## Para quem quer mexer no código

Requer Node.js 18 ou mais novo.

```bash
npx pnpm@9.12.0 install --frozen-lockfile --ignore-scripts
npm test
./node_modules/.bin/vite build
```

A extensão compilada fica na pasta `dist`.

## Créditos e licença

Baseada na [YouTube Sub Manager](https://github.com/germainelry/youtube-sub-manager), de Germaine Luah. Licença MIT, em [LICENSE](LICENSE).
