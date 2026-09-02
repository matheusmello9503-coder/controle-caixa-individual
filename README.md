# Cerdil Caixa (versao GitHub Pages + Firebase)

Versao do sistema hospedada sem servidor proprio: o site (HTML, CSS e JS
puros, sem build) fica no GitHub Pages, e todo o login, banco de dados e
regras de acesso ficam no Firebase (Google).

O guia completo de publicacao, passo a passo, esta no documento Word
"Guia de Publicacao - GitHub e Firebase" entregue junto com este projeto.

## Antes de publicar

1. Crie um projeto no Firebase (console.firebase.google.com), ative o
   Authentication (metodo E-mail/Senha) e crie um banco Firestore na regiao
   `southamerica-east1` (Sao Paulo).
2. Publique o conteudo do arquivo `firestore.rules` nas regras do Firestore
   (aba Regras do Firestore, ou via `firebase deploy --only firestore:rules`).
3. Copie a configuracao do seu app web (Configuracoes do projeto > Geral)
   para dentro de `js/firebase-config.js`.
4. Crie manualmente, pelo Console do Firebase, o primeiro usuario
   administrador: em Authentication, adicione o e-mail e senha; em
   Firestore, crie um documento em `usuarios/{uid}` (uid = o mesmo criado no
   Authentication) com os campos `nome`, `email`, `perfil: "admin"`,
   `ativo: true`.
5. Suba os arquivos para um repositorio no GitHub e ative o GitHub Pages
   (Settings > Pages > Deploy from branch). O site continua hospedado no
   GitHub Pages; o Firebase e usado apenas como backend (login e banco de
   dados), nao como hospedagem.

## Perfis de acesso

- **Recepcao** - abre e lanca os atendimentos do dia (tela `recepcao.html`).
  Sujeita a restricao de horario (07h-19h).
- **Supervisor** - confere e fecha o caixa consolidado do dia (tela
  `supervisor.html`): ve todos os lancamentos de todos os atendentes,
  registra despesas/deposito e fecha o dia. Nao tem acesso ao cadastro de
  usuarios. Sem restricao de horario.
- **Administrador** - acesso completo (tela `admin.html`): tudo que o
  supervisor ve, mais o cadastro, ativacao/desativacao de usuarios de
  qualquer perfil.

O cadastro de um novo usuario (feito pelo administrador, aba "Usuarios") tem
um seletor de perfil com as tres opcoes.

## Navegacao rapida (topbar)

No canto superior direito de cada tela (exceto login), o nome da pessoa
logada agora e um menu: ao clicar, mostra as telas que aquele perfil ja
tem permissao de acessar (por exemplo, o administrador ve "Fechamento do
dia", "Usuarios" e "Lancar atendimento"; a recepcao ve so "Lancar
atendimento"). E so um atalho de navegacao - clicar num item leva para
aquela tela com a MESMA conta logada; ninguem consegue "virar" outro
perfil por ali. As permissoes de verdade continuam sendo aplicadas pelo
`firestore.rules`, no servidor.

## Historico (dashboard de varios dias)

As telas de administrador e supervisor tem uma aba "Historico", com um
grafico dos totais dos ultimos 7, 30 ou 90 dias, cartoes de total do
periodo/media diaria/melhor dia, e uma tabela com o detalhe de cada dia
(status, quantidade de lancamentos, total, despesas e deposito). Para nao
ficar lento com o tempo, a consulta busca so os lancamentos do periodo
selecionado (nao o historico inteiro), usando o campo `data` (formato
AAAA-MM-DD) com um filtro de intervalo, que o Firestore resolve com um
indice automatico, sem precisar criar nada manualmente no Console.

## Estrutura

- `login.html`, `recepcao.html`, `supervisor.html`, `admin.html` - as telas
  do sistema
- `img/` - logotipo, favicon e imagem de fundo da tela de login (marca
  Cerdil), ja otimizados para carregar rapido
- `js/firebase-config.js` - configuracao do seu projeto Firebase (preencher)
- `js/firebase-init.js` - inicializa o Firebase (app principal e um app
  secundario, usado so na hora de cadastrar novos usuarios)
- `js/nav-rapida.js` - monta o menu de navegacao rapida do topbar
- `js/historico.js` - consulta e desenha o dashboard de varios dias
- `js/login.js`, `js/recepcao.js`, `js/supervisor.js`, `js/admin.js` -
  logica de cada tela
- `firestore.rules` - regras de seguranca: login, perfis e a restricao de
  horario (07h-19h) aplicada pelo servidor do Firebase

## Esqueci minha senha

O link "Esqueci minha senha" da tela de login usa o servico real do
Firebase Authentication (`sendPasswordResetEmail`): um e-mail de
redefinicao e enviado de verdade, com um link para a pessoa criar uma nova
senha. Isso ja funciona sem nenhuma configuracao extra, desde que o metodo
E-mail/Senha esteja ativado no Firebase Authentication (Console >
Authentication > Sign-in method) - o que ja e necessario para o login
funcionar. O remetente padrao e algo como
`noreply@cerdil-caixa.firebaseapp.com`; o e-mail pode demorar um ou dois
minutos e, principalmente na primeira vez, pode cair na caixa de Spam/Lixo
eletronico. Para usar um remetente com a marca Cerdil (em vez do dominio
padrao do Firebase), e possivel customizar em Authentication > Templates,
mas isso e opcional.

## Atendimento com varios exames (mesmo pagamento)

Quando um paciente faz mais de um exame e paga tudo de uma vez (por
exemplo, ultrassom, ressonancia e raio-x no mesmo recebimento), a tela de
lancamento da recepcao permite preencher o nome do paciente, a forma de
pagamento, o numero da nota fiscal e a tesouraria uma unica vez, e depois
adicionar quantas linhas de exame forem necessarias (uma para cada exame,
cada uma com seu proprio valor e titulo, ja que o Tasy gera um titulo por
exame). Ao salvar, todos os exames desse atendimento ficam vinculados entre
si por um identificador de grupo interno, e aparecem visualmente agrupados
nas tabelas de conferencia. Se precisar corrigir um exame especifico depois,
a edicao afeta somente aquele exame, sem alterar os demais do mesmo grupo.

## Icone do site (favicon)

Todas as telas ja carregam `img/favicon.ico` e `img/apple-touch-icon.png`,
gerados a partir do simbolo da marca Cerdil. Ele aparece na aba do
navegador e, em celulares, como icone ao "adicionar a tela inicial".

## Dominio proprio

Registrar um dominio (por exemplo `cerdilcaixa.com.br`) e so um apontamento
de DNS para o mesmo GitHub Pages - nao muda nada no funcionamento do
sistema nem trava futuras edicoes. O fluxo continua sendo o mesmo: editar
os arquivos, subir para o GitHub, o site atualiza sozinho. Para configurar,
depois de comprar o dominio no registrador de sua preferencia: adicione um
arquivo `CNAME` na raiz do repositorio com o dominio escolhido, e crie no
DNS do registrador um registro `CNAME` apontando para
`matheusmello9503-coder.github.io` (ou os registros `A` que a documentacao
do GitHub Pages indica, se preferir usar o dominio raiz sem `www`). O
GitHub tambem emite certificado HTTPS gratuito para o dominio proprio
automaticamente, apos a verificacao do DNS.

## Performance

- As imagens da marca (icone da barra lateral, logotipo do login e o fundo
  da tela de login) foram redimensionadas e comprimidas para o tamanho
  realmente exibido na tela - o icone da barra lateral, por exemplo, caiu
  de 156 KB (2362x2362px, exibido a 30px) para 12 KB. Isso reduz bastante o
  tempo de carregamento em conexoes mais lentas, ja que essas imagens
  carregam em toda pagina do sistema.
- As paginas usam `preconnect` para os dominios do Firebase
  (`gstatic.com`, `firestore.googleapis.com`), o que adianta a conexao
  segura antes mesmo do script comecar a ser baixado.
- A aba "Historico" busca so os lancamentos do periodo escolhido (nao o
  historico inteiro), para continuar rapida mesmo com muitos meses de
  dados acumulados.
- Se algum carregamento ainda parecer lento no dia a dia, o motivo mais
  comum e a conexao de internet do local (o Firebase e o GitHub Pages sao
  servidos por CDNs globais, entao a demora normalmente esta na rede local
  ou no roteador/Wi-Fi, nao no sistema em si).

## Seguranca

- Login e senha reais, geridos pelo Firebase Authentication.
- A restricao de horario da recepcao (padrao 07h-19h, fuso de Campo Grande)
  e aplicada dentro de `firestore.rules`, usando o relogio do servidor do
  Firebase. Isso nao pode ser burlado mudando o relogio do computador de
  quem usa o sistema. O administrador nao tem essa restricao.
- Cada atendente so consegue ler e alterar os proprios lancamentos; o
  fechamento consolidado (com despesas e deposito) so pode ser visto e
  alterado pelo administrador.
- Como nao ha um servidor proprio (Admin SDK), desativar um usuario impede o
  uso do sistema (a regra bloqueia o acesso aos dados), mas nao apaga a
  conta de login em si. Trocar senha de outra pessoa nao e possivel pelo
  painel; a propria pessoa usa "Esqueci minha senha" na tela de login.
