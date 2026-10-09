# Testes automatizados — Cerdil Caixa

Suíte de testes deste repositório. Cobre os cálculos que decidem quanto
dinheiro aparece em cada resumo e cartão (débito, crédito, espécie, pix,
sugestão de depósito), o agrupamento de exames do mesmo atendimento, a
regra dos 3 dias de edição da recepção, a exportação de planilha por
período e o log de auditoria de edições/exclusões.

## Por que existe

Antes desta suíte, toda validação de mudança no sistema era manual: abrir a
tela, clicar, olhar o número, repetir para cada perfil. Isso funciona uma
vez, mas não protege contra uma regressão introduzida meses depois por uma
mudança aparentemente não relacionada — e esse sistema lida com dinheiro de
verdade, todo santo dia.

## Como rodar

```bash
node tests/run.js
```

Isso builda o harness de teste (a partir dos HTMLs reais do app — ver
abaixo), sobe um servidor estático local e roda a suíte inteira num
Chromium headless. Não precisa de `npm install`: o único pré-requisito é o
Playwright (`playwright`, não `@playwright/test`) instalado globalmente no
ambiente — este repositório não tem `node_modules` nem `package.json` de
propósito, para continuar sendo um site estático simples de publicar.

Se `playwright` não estiver instalado:

```bash
npm install -g playwright
npx playwright install chromium
```

## Como funciona (sem depender de um projeto Firebase de teste)

Os arquivos em `tests/mocks/` são um SDK do Firebase "de mentira": guardam
tudo em memória (`window.__db`), simulam `onSnapshot`, `getDoc(s)`,
`setDoc`, `updateDoc`, `deleteDoc`, `addDoc`, `query`/`where`/`orderBy`/
`limit`. Isso evita precisar de um segundo projeto Firebase só para rodar
testes, e evita qualquer teste acidentalmente escrever no banco de dados
real da clínica.

`tests/build-harness.js` gera, a cada execução, uma cópia de `admin.html`,
`supervisor.html` e `recepcao.html` com:

1. O SDK do Firebase remapeado para os mocks, via `<script type="importmap">`;
2. Um `<script>` inline que semeia `window.__db` com usuários e lançamentos
   de teste (datas relativas a "hoje" — nunca datas fixas, que fariam a
   suíte parar de fazer sentido conforme o tempo passa, por causa da regra
   dos 3 dias de edição);
3. O mesmo `<body>` da página real — extraído diretamente do HTML que está
   no repositório, não reescrito à mão. Isso é o que garante que o teste
   nunca fica testando uma versão desatualizada da tela: qualquer mudança em
   `admin.html`/`supervisor.html`/`recepcao.html` já entra automaticamente
   na próxima execução.

O resultado fica em `tests/harness/` (gerado, não deve ser editado à mão —
é sobrescrito a cada `node tests/run.js`).

## O que a suíte cobre

- **Cálculos puros** (`caixa-compartilhado.js`, testados isoladamente):
  soma por forma de pagamento, Espécie pura vs. Espécie+Pix (usada na
  sugestão de depósito), totais por atendente, subtotal por grupo de
  exames, ordenação de tabela, e que a planilha exportada usa exatamente os
  mesmos totais que aparecem na tela.
- **Painel administrativo** (`admin.html`): o cartão de resumo reflete o
  dia selecionado; a linha de subtotal aparece para atendimentos com mais
  de um exame; editar e excluir um lançamento gravam um registro de
  auditoria correto (quem, valor antes/depois); a aba Auditoria lista esses
  registros; a exportação por período gera o arquivo certo.
- **Recepção** (`recepcao.html`): cada atendente só vê os próprios
  lançamentos; um dia fora da janela de 3 dias fica somente para consulta
  (sem botão de editar); editar um exame próprio grava auditoria com a
  autoria correta; a forma de pagamento começa em branco e o lançamento não
  salva sem escolher; o total do atendimento aparece ao vivo.
- **Fechamento** (admin e supervisor): despesas digitadas entram no Total
  líquido e abatem o depósito sugerido (além dos testes puros de
  `totalLiquido`, `sugerirDeposito` e `rotuloForma`).
- **Interface**: tamanho da tela (sugestão na primeira visita, gravado, e não anulado pelo zoom do navegador), menu em gaveta no celular, nenhuma tela com rolagem
  horizontal em 390px, tema escuro/claro seguindo o sistema, contraste mínimo
  de 4,5:1 do texto secundário e rótulos de formulário ligados aos campos.

## Manutenção

- **Ao adicionar um campo novo em `lancamentos`** que deveria ser
  auditado, adicione o nome do campo em `CAMPOS_AUDITADOS` (em
  `js/caixa-compartilhado.js`) e em `NOMES_CAMPO_AUDITORIA` (em
  `js/admin.js` e `js/supervisor.js`, para o rótulo aparecer certo na tela
  de Auditoria).
- **Ao mudar `firestore.rules`**, não existe (ainda) um teste automatizado
  contra as regras de segurança em si (isso exigiria o Firestore Emulator,
  que não está configurado neste ambiente) — os mocks aqui simulam o
  comportamento esperado do app, não impõem as regras do servidor. Uma
  mudança nas regras precisa continuar sendo revisada manualmente e
  publicada no Firebase Console (ver `README.md` na raiz do repositório).
- **`tests/vendor/xlsx.full.min.js`** é uma cópia local da biblioteca
  SheetJS usada para gerar `.xlsx`, para os testes não dependerem de acesso
  à internet. Se a versão usada no `<script src=...>` dos HTMLs mudar,
  atualize este arquivo também (`npm pack xlsx@<versão> --silent` e copie
  `package/dist/xlsx.full.min.js`).
