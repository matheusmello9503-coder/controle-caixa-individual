# Controle de Caixa Diario (versao GitHub Pages + Firebase)

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
   (Settings > Pages > Deploy from branch).

## Estrutura

- `login.html`, `recepcao.html`, `admin.html` - as telas do sistema
- `js/firebase-config.js` - configuracao do seu projeto Firebase (preencher)
- `js/firebase-init.js` - inicializa o Firebase (app principal e um app
  secundario, usado so na hora de cadastrar novos usuarios)
- `js/login.js`, `js/recepcao.js`, `js/admin.js` - logica de cada tela
- `firestore.rules` - regras de seguranca: login, perfis e a restricao de
  horario (07h-19h) aplicada pelo servidor do Firebase

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
