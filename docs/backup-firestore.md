# Backup automático do Firestore

Este guia configura um backup diário automático de todo o banco de dados
(`lancamentos`, `fechamentos`, `usuarios`, `auditoria`) do projeto
`cerdil-caixa`. Hoje não existe nenhuma rotina de backup: um erro humano
(exclusão em massa, uma regra malfeita) ou um problema do lado do Firebase
não tem rede de segurança nenhuma além dos próprios dados guardados uma
única vez.

Este passo a passo precisa ser feito **dentro do Google Cloud Console**,
com uma conta que tenha acesso de administrador ao projeto Firebase
`cerdil-caixa` — não é algo que pode ser configurado a partir do código do
repositório, por isso fica documentado aqui em vez de ser algo que já vem
pronto.

## Passo 1 — Criar um bucket para guardar os backups

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) e
   selecione o projeto `cerdil-caixa` (o mesmo usado no Firebase).
2. Vá em **Cloud Storage > Buckets > Criar**.
3. Nome sugerido: `cerdil-caixa-backups` (tem que ser globalmente único —
   se já existir, use algo como `cerdil-caixa-backups-2026`).
4. Região: `southamerica-east1` (São Paulo), a mesma do Firestore.
5. Classe de armazenamento: **Nearline** (mais barata para arquivos que
   raramente são lidos, como um backup).
6. Nas opções de **Controle de acesso**, mantenha "Uniforme" (padrão).
7. Em **Proteção**, ative "Prevenção contra exclusão de objetos" com uma
   retenção de pelo menos 30 dias — isso impede que um backup recente seja
   apagado por engano antes desse prazo, mesmo por alguém com acesso.

## Passo 2 — Ativar a API de exportação do Firestore

1. No Cloud Console, vá em **APIs e serviços > Biblioteca**.
2. Procure por "Cloud Firestore API" e confirme que está ativada (já deve
   estar, por ser o mesmo projeto usado pelo app).

## Passo 3 — Dar permissão ao agente de serviço do Firestore

1. Vá em **IAM e administrador > IAM**.
2. Procure a conta de serviço com o nome parecido com
   `service-<numero-do-projeto>@gcp-sa-firestore.iam.gserviceaccount.com`
   (o Firestore cria essa conta automaticamente).
3. Edite as permissões dessa conta e adicione o papel **Administrador do
   Storage** (`Storage Admin`) — ou, mais restrito, **Storage Object
   Admin** apenas no bucket criado no Passo 1.

## Passo 4 — Agendar a exportação diária (Cloud Scheduler + Cloud Functions, ou gcloud manual)

Existem duas formas de agendar. A mais simples, sem precisar escrever
nenhum código, usa o **Cloud Scheduler** chamando a API REST do Firestore
diretamente:

1. Vá em **Cloud Scheduler > Criar tarefa**.
2. Nome: `backup-diario-firestore-cerdil`.
3. Frequência (formato cron): `0 3 * * *` (todos os dias às 3h da manhã,
   horário do servidor — ajuste o fuso em "Fuso horário" para
   `America/Campo_Grande` se quiser o horário local exato).
4. Tipo de destino: **HTTP**.
5. URL:
   ```
   https://firestore.googleapis.com/v1/projects/cerdil-caixa/databases/(default):exportDocuments
   ```
6. Método HTTP: `POST`.
7. Corpo (Body):
   ```json
   {
     "outputUriPrefix": "gs://cerdil-caixa-backups/backup-$(date +%Y-%m-%d)"
   }
   ```
   (O Cloud Scheduler não expande `$(date ...)` sozinho — na prática, use
   apenas `"gs://cerdil-caixa-backups/"` sem o sufixo de data; o Firestore
   já cria uma subpasta com timestamp automaticamente a cada exportação,
   então backups de dias diferentes não se sobrescrevem.)
8. Cabeçalho de autenticação: em **Configuração de autenticação**, escolha
   "Adicionar cabeçalho OAuth" e use a conta de serviço padrão do App
   Engine do projeto (`cerdil-caixa@appspot.gserviceaccount.com`), com o
   escopo `https://www.googleapis.com/auth/datastore`.

Depois de criado, use o botão **"Forçar execução"** na própria tela do
Cloud Scheduler para testar uma vez e confirmar que um arquivo aparece no
bucket em poucos minutos.

## Passo 5 — Confirmar que os backups estão realmente sendo gerados

Uma vez por mês (colocar um lembrete recorrente), abra o bucket
`cerdil-caixa-backups` no Cloud Storage e confirme que existem pastas
recentes, uma por dia. Um backup que existe mas nunca é verificado não
serve de nada no dia em que for precisar dele.

## Como restaurar, se um dia for necessário

1. Vá em **Firestore > Importar/Exportar > Importar**.
2. Selecione a pasta do backup desejado dentro do bucket.
3. **Atenção**: uma importação não apaga dados que já existem no banco com
   IDs diferentes dos do backup — ela adiciona/sobrescreve. Se o objetivo
   for voltar para um estado anterior por completo (não só recuperar um
   documento apagado), pode ser necessário primeiro excluir as coleções
   atuais manualmente, o que é uma operação que vale a pena confirmar com
   cuidado antes de executar.

## Custo aproximado

Para o volume de dados de uma clínica deste porte (alguns milhares de
lançamentos por ano), o custo de armazenamento no Cloud Storage classe
Nearline fica tipicamente abaixo de R$ 5/mês. A própria operação de
exportação diária do Firestore tem um custo muito pequeno, cobrado por
operação de leitura/gravação envolvida no processo.
