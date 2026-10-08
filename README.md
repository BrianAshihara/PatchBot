# Patch Bot

Um bot gratuito de Discord que posta as notas de patch dos jogos assim que elas saem.

- **Jogos:** Deadlock, Counter-Strike 2, Marvel Rivals, Grand Chase Classic (notas completas) e League of Legends (link).
- **Card de anúncio** no canal que você escolher: cor do jogo, título do patch, imagem, as próprias notas e um botão "Read on Steam". Updates grandes (como o *Old Gods, New Blood* do Deadlock) aparecem destacados como **MAJOR UPDATE**.
- **Notas longas** continuam numa thread embaixo do card, divididas em várias mensagens.
- **Fácil de ler:** nomes de heróis e itens em negrito, e mudanças de número com setas (por exemplo, "Damage increased from 65 to 70" vira "Damage, seta para cima, 65 para 70").
- **Ninguém é mencionado.**

As notas são postadas no idioma original (inglês).

Roda no **plano gratuito** do Cloudflare Workers: sem servidor para manter ligado, sem cartão de crédito, sem custo.

## Adicione ao seu servidor

[**Convidar o Patch Bot**](https://discord.com/oauth2/authorize?client_id=1557526345901150208&permissions=309237664768&integration_type=0&scope=bot+applications.commands)

O bot pede: Ver canais, Enviar mensagens, Inserir links, Criar tópicos públicos e Enviar mensagens em tópicos.

Depois, como admin do servidor (permissão **Gerenciar servidor**):

| Comando | O que faz |
|---|---|
| `/setup channel:#patch-notes` | Escolhe o canal (de texto ou de anúncios). Segue todos os jogos. |
| `/games` | Escolhe quais jogos seguir. |
| `/status` | Mostra o canal, os jogos seguidos e o último patch conhecido de cada jogo. |
| `/test game:Deadlock` | Posta agora o último patch salvo, para ver como fica. |
| `/help` | Explicação curta (qualquer pessoa pode usar). |

Se o bot perder acesso ao canal, ele fica pausado naquele servidor. Corrija as permissões dele e rode `/setup` de novo.

## Como funciona

1. **A cada 2 minutos** (Cron Trigger da Cloudflare), o bot consulta a Steam News API e o Data Dragon da Riot.
2. Cada post é identificado pelo **id do post**. Se for novo, ele é salvo no banco D1 e entra na fila de entrega de cada servidor que segue aquele jogo.
3. A entrega posta o card, depois a thread (se precisar) e depois as notas, uma mensagem por vez. Se o limite da execução acabar, ela continua de onde parou na próxima.
4. Os comandos chegam por **POST /interactions**, assinados pelo Discord. O bot confere a assinatura antes de responder.

Outros detalhes:

- Um Cloudflare Worker e um banco D1. Nenhum processo ligado o tempo todo e nenhuma conexão Gateway.
- Na primeira execução, cada jogo é **registrado em silêncio**, então patches antigos nunca viram spam.
- Cada execução usa no máximo 40 subrequisições (o plano gratuito permite 50). Se muitos servidores precisarem de um patch longo, o resto recebe nas próximas execuções: a entrega pode atrasar, mas nunca se perde.

## Desenvolvimento

Requisito: Node.js 24 (os scripts rodam TypeScript direto, o que exige Node 23.6 ou mais novo).

```sh
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply patch-bot --local
npm run dev -- --test-scheduled
```

Depois de copiar, preencha o `.dev.vars` com os valores do Discord Developer Portal. O bot local fica em http://localhost:8787.

Para conferir se está tudo certo (a definição de "pronto" para qualquer mudança):

```sh
npm run typecheck
npm test
```

Para rodar o cron uma vez (no PowerShell, use `curl.exe`):

```sh
curl "http://localhost:8787/__scheduled?cron=*/2+*+*+*+*"
```

Para testar num servidor de verdade:

1. Exponha o bot local com `cloudflared tunnel --url http://localhost:8787`.
2. No Developer Portal, coloque o endereço do túnel terminando em `/interactions` como **Interactions Endpoint URL**.
3. Registre os comandos no seu servidor de teste com `npm run register-commands -- --guild ID_DO_SERVIDOR`. Eles aparecem na hora.

Scripts:

| Script | O que faz |
|---|---|
| `npm run register-commands` | Registra os comandos globalmente. |
| `npm run register-commands -- --guild ID` | Registra só num servidor. |
| `npm run register-commands -- --guild ID --clear` | Remove os comandos daquele servidor. |
| `npm run record-fixtures` | Salva respostas reais da Steam em `test/fixtures` e mostra os títulos recentes (para ajustar os filtros de título). |
| `npm run cf-typegen` | Gera de novo o `worker-configuration.d.ts` depois de mudar o `wrangler.jsonc`. |

## Deploy (grátis)

Rode, em ordem:

```sh
npx wrangler login
npx wrangler d1 create patch-bot
npx wrangler d1 migrations apply patch-bot --remote
npx wrangler deploy
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npm run register-commands
```

- O `d1 create` mostra um `database_id`: coloque esse valor no `wrangler.jsonc`, no lugar dos zeros.
- O `deploy` mostra o endereço do bot, algo como `https://patch-bot.SEU-NOME.workers.dev`.
- Cada `secret put` pede o valor: cole o mesmo que está no seu `.dev.vars`.

Depois:

1. No Developer Portal, coloque `https://patch-bot.SEU-NOME.workers.dev/interactions` como **Interactions Endpoint URL**.
2. Se você registrou comandos num servidor de teste, remova essas cópias para não aparecerem duplicadas: `npm run register-commands -- --guild ID --clear`.
3. Rode `/setup` no seu servidor. O banco de produção começa vazio.
4. Espere uns 2 minutos pelo primeiro cron antes de usar o `/test`.

Para ver os logs: `npx wrangler tail`, ou no painel da Cloudflare em Workers & Pages, depois patch-bot, depois Logs.

### Atualizar o bot depois do deploy

Depois de mudar o código, rode:

```sh
npm run typecheck
npm test
npx wrangler d1 migrations apply patch-bot --remote
npx wrangler deploy
```

- O `migrations apply` só aplica as migrações novas da pasta `migrations` (as que já foram aplicadas são puladas). Se não houver nenhuma nova, ele avisa e não muda nada.
- Rode `npm run register-commands` só se você mudou os comandos ou a lista de jogos.
- Os dados do banco de produção (servidores configurados, patches) continuam como estavam.

Fique no plano **Free**: quando um limite gratuito é atingido, a Cloudflare bloqueia as requisições daquele dia em vez de cobrar.

## Adicionar um jogo

Um jogo da Steam é uma entrada em [src/sources/games.ts](src/sources/games.ts):

```ts
{
  key: "my-game",
  name: "My Game",
  source: { kind: "steam", appid: 123456, titleFilter: /patch notes|update/i },
  color: 0x3388ff,
  major: (title) => /season \d+/i.test(title),
},
```

- `key`: id fixo do jogo, salvo no banco.
- `titleFilter`: opcional. Use quando o jogo também posta eventos, promoções ou notícias de e-sports.
- `color`: cor do card.
- `major`: opcional. Regra para destacar o patch como MAJOR UPDATE.

Passo a passo:

1. Pegue o app id na URL da loja da Steam: `store.steampowered.com/app/APPID/nome-do-jogo`.
2. Adicione o jogo em `STEAM_GAMES` no `scripts/record-fixtures.ts`, rode `npm run record-fixtures` e veja os títulos mostrados. O bot só lê anúncios oficiais.
3. Adicione o arquivo de exemplo e alguns títulos reais em `test/fixtures.test.ts`, e rode `npm run typecheck` e `npm test`.
4. Rode `npx wrangler deploy` e `npm run register-commands` (a lista de jogos do `/test` muda).

O jogo novo é registrado em silêncio na próxima execução. Os servidores que já fizeram `/setup` **não** passam a segui-lo sozinhos: o admin liga o jogo pelo `/games`.

Uma fonte que não seja a Steam precisa de um pequeno adaptador em `src/sources` (veja o `ddragon.ts`) que devolva os patches mais recentes.

## Bom saber

- **Updates grandes do Deadlock** (*Old Gods, New Blood*, *City Never Sleeps*) são um teaser curto na Steam, com link para a página do update. O bot os anuncia como MAJOR UPDATE e mostra esse teaser e o link. As notas completas ficam numa página feita em JavaScript e num fórum protegido contra bots, então o bot não consegue lê-las.
- **League of Legends:** o Data Dragon da Riot é atualizado à mão e pode atrasar uns 2 dias em relação ao patch real.
- **Mais de 100 servidores:** o Discord passa a exigir que o dono do bot verifique a identidade (grátis, manual, no Developer Portal). Nesse momento ele também pede links de Termos de Serviço e Política de Privacidade.
