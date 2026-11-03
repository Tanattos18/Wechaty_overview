# SaaS ChatBot (WhatsApp)

Chatbot de WhatsApp para vários clientes (negócios), inspirado na arquitetura do
[Wechaty](https://github.com/wechaty/wechaty): o **motor do bot** não conhece o WhatsApp, e um
**conector** liga cada cliente ao seu número.

## O que o bot faz

| Recurso | Como funciona |
|---|---|
| **Menu de atendimento** | Opções numeradas e configuráveis por cliente (resposta fixa, catálogo, IA ou atendente). Comandos sempre disponíveis: `menu`, `atendente`, `cancelar`. |
| **Catálogo e pedidos** | Lista de produtos → `2` ou `2 x3` adiciona ao carrinho → `finalizar` → nome → endereço (ou `retirar`) → `SIM`. O pedido aparece no painel. |
| **Conversa natural (sem IA)** | Entende saudações a qualquer momento ("oi", "bom dia, tudo bem?"), agradecimentos e despedidas; responde horário, endereço, telefone, entrega e pagamento; busca respostas no FAQ do negócio; informa preços e aceita pedidos escritos ("quero 2 calabresa e 1 refri"), tolerando erros de digitação. Regras em `src/engine/nlu.ts`. |
| **Respostas com IA** | Perguntas livres são respondidas pelo Claude **apenas** com os dados do negócio (descrição, horário, FAQ, produtos). Se não souber, ou se o cliente pedir, transfere para um atendente. |
| **Atendimento humano** | O bot pausa na conversa transferida; o atendente responde pelo painel e devolve a conversa ao bot. Se ninguém responder, o bot volta sozinho depois de N minutos. |
| **Painel do cliente** | Conexão (QR Code), Conversas, Pedidos (com status), Configuração e **Simulador** para testar o bot sem WhatsApp. |
| **Multi-cliente** | O administrador cria clientes; cada cliente entra no painel com o próprio ID e senha e só vê os próprios dados. |

## Como rodar

```bash
npm install
cp .env.example .env     # preencha ADMIN_PASSWORD, SESSION_SECRET e ANTHROPIC_API_KEY
npm start                # painel em http://localhost:3000
```

- **Admin:** entre com o ID em branco e a `ADMIN_PASSWORD` do `.env`.
- **Cliente:** o admin define a senha em *Configuração → Acesso ao painel*; o cliente entra com o ID (ex.: `demo`).
- Já existe um cliente de exemplo: **Pizzaria Demo** (`data/clients/demo.json`). Teste pelo **Simulador**.

```bash
npm test          # testes do motor (menu, pedido, transferência, IA, falhas)
npm run typecheck
```

## Estrutura

```
src/
  engine/engine.ts      motor do bot (menu, catálogo, carrinho, checkout, transferência)
  engine/nlu.ts         entendimento sem IA (intenções, produtos por nome, busca no FAQ)
  engine/ai.ts          respostas com Claude + ferramenta "transferir_para_atendente"
  channels/whatsapp.ts  conector WhatsApp via whatsapp-web.js (um bot por cliente)
  panel/server.ts       API do painel (login, config, conversas, pedidos, simulador)
  panel/auth.ts         senhas (scrypt) e sessão por cookie assinado
  panel/public/         interface do painel (HTML/CSS/JS, sem build)
  store.ts              dados em JSON (data/clients, data/runtime)
test/engine.test.ts
```

## Conector WhatsApp

Usa [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (v1.34): cada cliente roda um
WhatsApp Web em um navegador headless (Edge/Chrome de `BROWSER_PATH`). Em **Conexão → Conectar
WhatsApp**, o QR Code aparece no painel; depois de escaneado, a sessão fica salva em
`data/sessions/` e não pede QR de novo ao reiniciar.

- O bot responde só conversas individuais (ignora grupos, status e canais) e ignora mensagens
  com mais de 2 minutos sincronizadas ao conectar.
- Cada cliente conectado consome um navegador (~150–300 MB de RAM). Para muitos clientes, a
  alternativa sem navegador é o Baileys; a oficial é a WhatsApp Cloud API (Meta).
- Originalmente o projeto usava o puppet `wechaty-puppet-whatsapp`, mas ele (última versão em
  set/2022) não gera mais o QR Code com o WhatsApp Web atual.

⚠️ Conectores **não oficiais** (QR Code) violam os Termos do WhatsApp e podem levar ao banimento do
número. Para clientes pagantes, considere a API oficial.

## Visual do painel

- **Marca configurável:** `BRAND_NAME` e `BRAND_COLOR` no `.env` mudam o nome, a cor, o logo e o ícone da aba.
- **Início:** números do dia (conversas, pedidos e faturamento, quem aguarda atendente, perguntas sem resposta)
  e gráficos dos últimos 7 dias; o Super Admin vê também o resumo de todos os clientes.
- **Conversas no estilo WhatsApp:** bolhas, separador de datas, avatares, busca, filtros e **respostas rápidas** editáveis.
- **Pedidos em quadro:** colunas Novo → Confirmado → Preparando → Saiu para entrega → Concluído (arrastar ou escolher na lista)
  e **impressão** do pedido em formato de cupom (80 mm).
- **Avisos:** o sino no topo liga som e notificação do navegador para pedido novo e cliente pedindo atendente.
- **Simulador num celular desenhado**, tema **claro/escuro/automático**, menu inferior no celular, carregamento animado
  e aviso de alterações não salvas.

## Super Admin e clientes

| Perfil | Login | O que faz |
|---|---|---|
| **Super Admin** (você) | ID `admin` + `ADMIN_PASSWORD` do `.env` | Tudo: aba **Clientes**, configuração completa, base de conhecimento, pacotes, ajustes de todos os clientes |
| **Cliente** | ID do negócio + senha definida pelo admin | Conexão (QR Code), conversas e atendimento, pedidos, simulador, perguntas sem resposta e **pedir ajustes** |

Na aba **Clientes** o Super Admin define, por cliente:

- **O que o cliente pode editar:** *Informações* (horário, endereço, Pix, taxa, promoções...) e/ou *Produtos e preços*.
  Sem permissão, o cliente não altera nada da configuração — a regra vale no servidor, não só na tela.
- **Plano e ajustes por mês:** o cliente pede ajustes na aba **Ajustes** e vê "3 de 5 usados este mês";
  o admin vê os pedidos de todos os clientes, muda o status e responde.
- **⛔ Suspender / ✅ Reativar:** desliga o WhatsApp, o bot para de responder e o painel do cliente fica bloqueado
  (para mensalidade atrasada).
- **👁️ Ver como cliente:** abre o painel exatamente como o cliente vê, com um botão para voltar ao Super Admin.

## Base de conhecimento (perguntas e respostas)

O bot responde sem IA consultando um banco **SQLite** (`data/knowledge.db`, criado no primeiro início)
com **85 assuntos e ~1.700 formas de perguntar**, em 5 pacotes:

| Pacote | Assuntos | Exemplos |
|---|---|---|
| `comum` (todos os negócios) | 27 | horário, endereço, Pix, parcelamento, entrega, taxa, pedido mínimo, reclamação |
| `restaurante` | 15 | cardápio, sem glúten, tamanhos, bordas, meio a meio, reservas |
| `petshop` | 16 | banho e tosa, vacinas, veterinário, leva e traz, hotelzinho, emergência |
| `salao` | 13 | serviços, agendamento, remarcar, profissionais, noivas |
| `loja` | 14 | tamanhos, troca, devolução, frete, rastreio, atacado, cupom |

- As respostas usam campos como `{taxa_entrega}` e `{chave_pix}`, que **cada cliente preenche** na aba
  **Conhecimento** do painel. Assim o mesmo pacote serve para qualquer negócio.
- Os pacotes ficam em `knowledge/packs/*.json`. Para **levar a outra instalação**, use *Exportar* / *Importar*
  na aba Conhecimento. Ao editar um arquivo, aumente o `version` para recarregar no próximo início.
- A aba **Conhecimento** também mostra as **perguntas sem resposta** (com o motivo) e tem um campo para testar perguntas.
- Precisão medida com frases que não estão nos pacotes: 100% em 171 combinações (`test/knowledge-cases.ts`).

## Conversa com cara de atendente

- Saudação pelo horário e pelo nome, sem menu numerado a cada mensagem (o estilo antigo, com menu,
  pode ser escolhido na Configuração).
- Frases variadas, oferta de produto com continuidade ("Quer que eu anote uma?" → "sim" anota).
- No WhatsApp, o bot marca como lido e mostra **"digitando…"** por um tempo proporcional à resposta
  (`HUMAN_TYPING=true`). O Simulador do painel tem o mesmo ritmo (opção *Ritmo real*).
- **Memória curta:** "quanto custa ela?", "mais uma", "quero essa" (depois da promoção) se referem
  ao último produto falado; "já pedi" mostra o pedido anotado.
- **Várias perguntas numa mensagem:** "qual o horário e aceita pix?" responde as duas.
- **Na dúvida, pergunta:** "Você quis dizer: *1* - … *2* - …?". O número escolhido é respondido e a
  frase fica ensinada para aquele cliente.
- **Cardápio com opções:** cada produto pode ter tamanhos (`Média=49,90; Grande=59,90`) e adicionais;
  sem tamanho, o bot pergunta. Pizza meio a meio cobra o sabor mais caro, a média, ou fica desligada.
- **Sinônimos por cliente** (Configuração): `coca=refrigerante`, `4 queijos=quatro queijos`…

## Treinar e medir a qualidade

- **👎 nas Conversas:** marca uma resposta errada; a pergunta vai para *Conhecimento → Treinar o bot*,
  onde você escolhe o assunto certo (só para o cliente ou, no Super Admin, para todos).
- **Aba Qualidade:** % de mensagens entendidas por dia, o que mais falhou, quantas vezes chamou
  atendente e quantas respostas foram marcadas como erradas.
- **Bateria de testes:** frases típicas do ramo (`knowledge/qa-phrases.json`) e os fluxos básicos
  rodados com a configuração do cliente, sem mexer nas conversas reais. Mostra a nota e os assuntos
  sem informação cadastrada.
- **Conversa → teste salvo:** o ícone de salvar na conversa guarda as respostas atuais; depois de cada
  ajuste, *Rodar testes salvos* mostra o que mudou (e *Aceitar* atualiza o esperado).
- **Exportar conversas** em `.txt` ou `.json`.

## Vários clientes ao mesmo tempo

```bash
npm run test:load -- 200 http://localhost:3000
```

Simula clientes conversando em paralelo, com roteiros diferentes, e confere se as conversas e os pedidos
não se misturam. Resultado medido: **200 clientes / 1.120 mensagens em 2 s**, mediana de 185 ms por
resposta, 80 pedidos corretos (sem contar o "digitando…" proposital do WhatsApp).
⚠️ O teste grava conversas e pedidos de simulador no cliente `demo`.

## Colocar no ar

Veja o passo a passo para a VPS da Hostinger em [DEPLOY.md](DEPLOY.md).

## Observações

- **IA:** sem `ANTHROPIC_API_KEY`, o bot funciona normalmente e só responde com o menu nas perguntas livres.
  `CLAUDE_MODEL=claude-haiku-5-5` reduz bastante o custo em alto volume.
- **Navegador:** o npm 11 não executa o download do Chromium; o conector usa o Edge/Chrome de `BROWSER_PATH`.
- **OneDrive:** `node_modules`, `data/runtime` e as sessões do WhatsApp geram muitos arquivos.
  Para produção, rode fora de pasta sincronizada (servidor/VPS).
- Dados em JSON servem para o MVP; para muitos clientes, troque `store.ts` por um banco (SQLite/Postgres).
