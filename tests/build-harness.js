// Monta, a partir dos arquivos REAIS do app (admin.html, supervisor.html,
// recepcao.html), uma copia de cada um com o SDK do Firebase remapeado para
// os mocks locais (tests/mocks) via importmap, mais um seed de dados de
// teste. Isso evita ter 3 copias de HTML "de teste" mantidas manualmente e
// desatualizadas - a cada execucao, o harness e gerado de novo a partir do
// HTML que esta realmente no repositorio.
//
// Uso: node tests/build-harness.js
// Gera tests/harness/{admin,supervisor,recepcao}.html e copia os arquivos
// estaticos (css, js, xlsx) necessarios para tests/harness/.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const HARNESS = path.join(__dirname, 'harness');

function extrairBody(html) {
    const abre = html.indexOf('<body>');
    if (abre === -1) throw new Error('Não foi possível localizar <body> no HTML de origem.');
    // Corta no primeiro <script> real (o do XLSX, quando existe, ou direto o
    // <script type="module"> do proprio app quando a pagina nao usa XLSX,
    // como e o caso de recepcao.html) - assim a funcao serve para qualquer
    // uma das tres paginas sem precisar saber de antemao quais scripts cada
    // uma carrega.
    const fechaScript = html.indexOf('<script', abre);
    if (fechaScript === -1) throw new Error('Não foi possível localizar nenhum <script> após <body> no HTML de origem.');
    return html.slice(abre + '<body>'.length, fechaScript).trim();
}

function montarHead(seedJs, scriptJsRelativo) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Teste (harness)</title>
<link rel="stylesheet" href="../../css/style.css">
<script type="importmap">
{
  "imports": {
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js": "../mocks/firebase-app.js",
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js": "../mocks/firebase-auth.js",
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js": "../mocks/firebase-firestore.js"
  }
}
</script>
<script>
${seedJs}
</script>
</head>
<body>
BODY_AQUI
<script src="xlsx.full.min.js"></script>
<script type="module" src="${scriptJsRelativo}"></script>
</body>
</html>
`;
}

function gerarPagina(nomeArquivoOrigem, scriptJsRelativo, seedJs, nomeSaida) {
    const htmlOrigem = fs.readFileSync(path.join(RAIZ, nomeArquivoOrigem), 'utf8');
    const body = extrairBody(htmlOrigem);
    const pagina = montarHead(seedJs, scriptJsRelativo).replace('BODY_AQUI', body);
    fs.writeFileSync(path.join(HARNESS, nomeSaida), pagina);
    console.log('Gerado:', nomeSaida);
}

// ---------- Datas relativas a HOJE ----------
// Os testes de recepcao dependem da janela de edicao de 3 dias (ver
// js/recepcao.js) - usar datas FIXAS (ex: "2026-09-02") faz a suite
// funcionar so por um tempo e comecar a falhar sozinha mais adiante,
// quando "hoje" passar a ser mais de 3 dias depois daquela data fixa.
// Calculando a partir de "agora" a suite continua valida para sempre.
function dataDiasAtras(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}
const HOJE = dataDiasAtras(0);
const ONTEM = dataDiasAtras(1);
const DOIS_DIAS_ATRAS = dataDiasAtras(2);
const FORA_DA_JANELA = dataDiasAtras(10); // mais que os 3 dias permitidos

// ---------- Seed padrao: usuarios cadastrados ----------
const SEED_USUARIOS = `
  usuarios: {
    'uid-teste-admin': { nome: 'Admin Teste', email: 'admin@teste.com', perfil: 'admin', ativo: true },
    'uid-teste-supervisor': { nome: 'Supervisor Teste', email: 'supervisor@teste.com', perfil: 'supervisor', ativo: true },
    'uid-teste-recepcao': { nome: 'Recepcao Teste', email: 'recepcao@teste.com', perfil: 'recepcao', ativo: true }
  },`;

// ---------- Seed de lancamentos: espalhados em varios dias, varias formas ----------
// lanc-d2-* e o "dia principal" usado nos testes de admin/supervisor/
// recepcao (ONTEM: dentro da janela de 3 dias, mas nao "hoje", para exercer
// o aviso de lancamento retroativo tambem). lanc-fora-* fica de proposito
// fora da janela de edicao, para os testes conseguirem confirmar que a
// tela vira "somente consulta" la.
const SEED_LANCAMENTOS = `
  lancamentos: {
    'lanc-d1-1': { usuarioId: 'uid-teste-recepcao', usuarioNome: 'Recepcao Teste', nomePaciente: 'Joao Silva', exame: 'RX', valor: 100, formaPagamento: 'Debito', pagamentoDividido: false, titulo: '', numeroNf: '111', tesouraria: true, data: '${DOIS_DIAS_ATRAS}', criadoEm: { toMillis: () => 1 } },
    'lanc-d1-2': { usuarioId: 'uid-teste-recepcao', usuarioNome: 'Recepcao Teste', nomePaciente: 'Ana Souza', exame: 'TC', valor: 250, formaPagamento: 'Pix', pagamentoDividido: false, titulo: '', numeroNf: '112', tesouraria: false, data: '${DOIS_DIAS_ATRAS}', criadoEm: { toMillis: () => 2 } },
    'lanc-d2-1': { usuarioId: 'uid-teste-supervisor', usuarioNome: 'Supervisor Teste', nomePaciente: 'Pedro Lima', exame: 'RM', valor: 500, formaPagamento: 'Credito', pagamentoDividido: false, titulo: 'T1', numeroNf: '113', tesouraria: true, data: '${ONTEM}', criadoEm: { toMillis: () => 3 } },
    'lanc-d3-1': { usuarioId: 'uid-teste-recepcao', usuarioNome: 'Recepcao Teste', nomePaciente: 'Julia Rocha', exame: 'RX', valor: 80, formaPagamento: 'Especie', pagamentoDividido: false, titulo: '', numeroNf: '', tesouraria: false, data: '${HOJE}', criadoEm: { toMillis: () => 4 } },
    'lanc-grupo-a': { usuarioId: 'uid-teste-recepcao', usuarioNome: 'Recepcao Teste', nomePaciente: 'Maria Multi', exame: 'RX', valor: 60, formaPagamento: 'Debito', pagamentoDividido: false, titulo: 'T2', numeroNf: '', tesouraria: true, data: '${ONTEM}', grupoId: 'grupo-multi-1', criadoEm: { toMillis: () => 5 } },
    'lanc-grupo-b': { usuarioId: 'uid-teste-recepcao', usuarioNome: 'Recepcao Teste', nomePaciente: 'Maria Multi', exame: 'US', valor: 40, formaPagamento: 'Debito', pagamentoDividido: false, titulo: 'T2', numeroNf: '', tesouraria: true, data: '${ONTEM}', grupoId: 'grupo-multi-1', criadoEm: { toMillis: () => 6 } },
    'lanc-fora-janela': { usuarioId: 'uid-teste-recepcao', usuarioNome: 'Recepcao Teste', nomePaciente: 'Antigo Demais', exame: 'RX', valor: 999, formaPagamento: 'Pix', pagamentoDividido: false, titulo: '', numeroNf: '', tesouraria: false, data: '${FORA_DA_JANELA}', criadoEm: { toMillis: () => 0 } }
  },
  fechamentos: {},
  auditoria: {}`;

// Exporta as datas usadas no seed para tests/run.js poder referenciar as
// MESMAS datas ao montar as asserções (em vez de duplicar o calculo la e
// arriscar os dois lados divergirem).
module.exports.DATAS_SEED = { HOJE, ONTEM, DOIS_DIAS_ATRAS, FORA_DA_JANELA };

fs.mkdirSync(HARNESS, { recursive: true });

// xlsx.full.min.js precisa estar em tests/harness/ (baixado uma vez via npm,
// ja que o CDN pode estar bloqueado no ambiente que roda o teste - ver
// tests/README.md).
const xlsxOrigem = path.join(__dirname, 'vendor', 'xlsx.full.min.js');
if (fs.existsSync(xlsxOrigem)) {
    fs.copyFileSync(xlsxOrigem, path.join(HARNESS, 'xlsx.full.min.js'));
} else {
    console.warn('AVISO: tests/vendor/xlsx.full.min.js não encontrado. Testes de exportação de planilha vão falhar. Veja tests/README.md.');
}

gerarPagina('admin.html', '../../js/admin.js', `window.__usuarioMock = { uid: 'uid-teste-admin', email: 'admin@teste.com' };\nwindow.__db = {${SEED_USUARIOS}${SEED_LANCAMENTOS}\n};`, 'admin.html');
gerarPagina('supervisor.html', '../../js/supervisor.js', `window.__usuarioMock = { uid: 'uid-teste-supervisor', email: 'supervisor@teste.com' };\nwindow.__db = {${SEED_USUARIOS}${SEED_LANCAMENTOS}\n};`, 'supervisor.html');
gerarPagina('recepcao.html', '../../js/recepcao.js', `window.__usuarioMock = { uid: 'uid-teste-recepcao', email: 'recepcao@teste.com' };\nwindow.__db = {${SEED_USUARIOS}${SEED_LANCAMENTOS}\n};`, 'recepcao.html');

console.log('Harness gerado em tests/harness/.');
