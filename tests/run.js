// Runner principal da suite de testes do Cerdil Caixa.
//
// O que cobre:
//   1. Calculos puros do modulo compartilhado (caixa-compartilhado.js):
//      resumo por forma de pagamento, agrupamento de exames do mesmo
//      atendimento, ordenacao da tabela - as mesmas contas que decidem
//      quanto vai pro deposito e quanto cada atendente fechou no dia.
//   2. Fluxos de tela ponta a ponta nos tres perfis (admin, supervisor,
//      recepcao), contra um Firestore/Auth mockado (tests/mocks) - sem
//      rede, sem precisar de um projeto Firebase de teste.
//
// Uso:
//   node tests/build-harness.js   (gera tests/harness/*.html a partir dos
//                                  HTMLs reais do app - rodar sempre que
//                                  admin.html/supervisor.html/recepcao.html
//                                  mudar antes de testar)
//   node tests/run.js             (builda o harness automaticamente se
//                                  ainda nao existir, sobe um servidor local
//                                  e roda todos os testes)
//
// Ver tests/README.md para detalhes (por que os mocks existem, como
// atualizar o xlsx.full.min.js vendorizado, etc).

const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const { test, assertIgual, assertVerdadeiro, assertProximo, rodarTudo } = require('./framework');

const RAIZ = path.join(__dirname, '..');
const PORTA = 8934;

// Em alguns ambientes (como o sandbox usado para desenvolver este projeto)
// o Chromium do Playwright fica num caminho fixo fora do padrao. Em outros
// (ex: GitHub Actions, com "npx playwright install chromium" rodado antes),
// o Playwright encontra o Chromium sozinho e nao deve receber
// executablePath nenhum. PLAYWRIGHT_CHROMIUM_PATH permite apontar para um
// caminho especifico quando necessario; se nao for definida e o caminho
// padrao deste sandbox nao existir, cai para o comportamento padrao do
// Playwright.
const CAMINHO_SANDBOX = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH
    || (fs.existsSync(CAMINHO_SANDBOX) ? CAMINHO_SANDBOX : undefined);

function servirEstatico() {
    const tiposConteudo = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
    return http.createServer((req, res) => {
        const caminhoLimpo = decodeURIComponent(req.url.split('?')[0]);
        const caminhoArquivo = path.join(RAIZ, caminhoLimpo);
        if (!caminhoArquivo.startsWith(RAIZ)) { res.writeHead(403); res.end(); return; }
        fs.readFile(caminhoArquivo, (err, conteudo) => {
            if (err) { res.writeHead(404); res.end('Não encontrado: ' + caminhoLimpo); return; }
            const ext = path.extname(caminhoArquivo);
            res.writeHead(200, { 'Content-Type': tiposConteudo[ext] || 'application/octet-stream' });
            res.end(conteudo);
        });
    }).listen(PORTA);
}

let DATAS_SEED;

async function main() {
    // Gera o harness sempre, para nunca testar contra um HTML desatualizado
    // (o build-harness.js extrai o <body> direto dos HTMLs reais a cada
    // execucao). As datas usadas no seed (relativas a "hoje") sao
    // reaproveitadas aqui, para as asserções nunca divergirem do que foi
    // realmente semeado.
    DATAS_SEED = require('./build-harness.js').DATAS_SEED;

    if (!fs.existsSync(path.join(__dirname, 'vendor', 'xlsx.full.min.js'))) {
        console.error('tests/vendor/xlsx.full.min.js não encontrado - ver tests/README.md para como obtê-lo.');
        process.exit(1);
    }

    const servidor = servirEstatico();
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

    try {
        await registrarTestesUnitarios(browser);
        await registrarTestesAdmin(browser);
        await registrarTestesSupervisor(browser);
        await registrarTestesRecepcao(browser);
        await rodarTudo();
    } finally {
        await browser.close();
        servidor.close();
    }
}

// ---------------------------------------------------------------------------
// 1) Testes unitarios puros (calculos do caixa-compartilhado.js)
// ---------------------------------------------------------------------------
async function registrarTestesUnitarios(browser) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORTA}/tests/harness/unitarios.html`);
    await page.waitForFunction('window.__prontoParaTeste === true');

    async function chamar(fnNome, ...args) {
        return page.evaluate(({ fnNome, args }) => window.__caixa[fnNome](...args), { fnNome, args });
    }

    const LANCAMENTOS_EXEMPLO = [
        { usuarioNome: 'Maria', valor: 100, formaPagamento: 'Debito' },
        { usuarioNome: 'Maria', valor: 250, formaPagamento: 'Pix' },
        { usuarioNome: 'Carla', valor: 500, formaPagamento: 'Credito' },
        { usuarioNome: 'Maria', valor: 80, formaPagamento: 'Especie' }
    ];

    test('calcularResumo soma corretamente por forma de pagamento', async () => {
        const r = await chamar('calcularResumo', LANCAMENTOS_EXEMPLO);
        assertIgual(r.mapaFormas.Debito.total, 100, 'Total Débito');
        assertIgual(r.mapaFormas.Credito.total, 500, 'Total Crédito');
        assertIgual(r.mapaFormas.Especie.total, 80, 'Total Espécie');
        assertIgual(r.mapaFormas.Pix.total, 250, 'Total Pix');
        assertIgual(r.totalGeral, 930, 'Total geral');
        assertIgual(r.totalCartao, 600, 'Total Cartão (Débito + Crédito)');
    });

    test('calcularResumo separa Especie pura (sem Pix) para a sugestão de depósito', async () => {
        const r = await chamar('calcularResumo', LANCAMENTOS_EXEMPLO);
        assertIgual(r.especiePura, 80, 'Espécie pura não deve incluir Pix');
        assertIgual(r.especieComPix, 330, 'Espécie + Pix somados (80 + 250)');
    });

    test('calcularResumo agrupa totais por atendente', async () => {
        const r = await chamar('calcularResumo', LANCAMENTOS_EXEMPLO);
        assertIgual(r.porAtendente.Maria.total, 430, 'Total de Maria (100+250+80)');
        assertIgual(r.porAtendente.Maria.qtd, 3, 'Quantidade de lançamentos de Maria');
        assertIgual(r.porAtendente.Carla.total, 500, 'Total de Carla');
    });

    test('calcularResumo ignora forma de pagamento desconhecida sem travar (dado antigo/manual)', async () => {
        const lista = [...LANCAMENTOS_EXEMPLO, { usuarioNome: 'Zeca', valor: 999, formaPagamento: 'Boleto' }];
        const r = await chamar('calcularResumo', lista);
        // Nao deve contar em nenhuma das 4 formas conhecidas, mas o total
        // geral e o total por atendente devem incluir o valor (a pessoa
        // realmente atendeu e recebeu, so a forma que e desconhecida).
        assertIgual(r.mapaFormas.Debito.total, 100, 'Débito não deve mudar com forma desconhecida');
        assertIgual(r.totalGeral, 1929, 'Total geral deve somar mesmo com forma desconhecida');
    });

    test('totaisPorGrupo soma exames do mesmo atendimento (grupoId)', async () => {
        const lista = [
            { grupoId: 'g1', valor: 60 },
            { grupoId: 'g1', valor: 40 },
            { grupoId: 'g2', valor: 999 },
            { valor: 10 } // sem grupoId, nao deve contar em nenhum grupo
        ];
        const r = await chamar('totaisPorGrupo', lista);
        assertIgual(r.somaPorGrupo.g1, 100, 'Soma do grupo g1 (60+40)');
        assertIgual(r.qtdPorGrupo.g1, 2, 'Quantidade de exames do grupo g1');
        assertIgual(r.somaPorGrupo.g2, 999, 'Grupo g2 com um único exame');
    });

    // criadoEm no Firestore de verdade e' um Timestamp com .toMillis() - uma
    // funcao nao pode ser serializada de Node para o browser via
    // page.evaluate(fn, argsSerializados), entao estes dois testes recriam o
    // objeto DENTRO do browser (a funcao passada para page.evaluate roda la),
    // usando so numeros simples (criadoEmMillis) como dado de entrada.
    test('ordenarLista usa ordem de criação por padrão', async () => {
        const r = await page.evaluate(() => {
            const lista = [
                { nomePaciente: 'B', criadoEm: { toMillis: () => 2 } },
                { nomePaciente: 'A', criadoEm: { toMillis: () => 1 } }
            ];
            return window.__caixa.ordenarLista(lista, null, 'asc');
        });
        assertIgual(r.map(l => l.nomePaciente), ['A', 'B'], 'Deve seguir a ordem de criação, não a ordem alfabética');
    });

    test('ordenarLista respeita campo e direção customizados', async () => {
        const asc = await page.evaluate(() => {
            const lista = [
                { nomePaciente: 'B', valor: 50, criadoEm: { toMillis: () => 1 } },
                { nomePaciente: 'A', valor: 200, criadoEm: { toMillis: () => 2 } }
            ];
            return window.__caixa.ordenarLista(lista, 'valor', 'asc');
        });
        assertIgual(asc.map(l => l.valor), [50, 200], 'Ordenação por valor ascendente');

        const desc = await page.evaluate(() => {
            const lista = [
                { nomePaciente: 'B', valor: 50, criadoEm: { toMillis: () => 1 } },
                { nomePaciente: 'A', valor: 200, criadoEm: { toMillis: () => 2 } }
            ];
            return window.__caixa.ordenarLista(lista, 'valor', 'desc');
        });
        assertIgual(desc.map(l => l.valor), [200, 50], 'Ordenação por valor descendente');
    });

    test('formatarMoeda formata em Real brasileiro', async () => {
        const r = await chamar('formatarMoeda', 1234.5);
        assertVerdadeiro(r.includes('1.234,50'), `Esperava formato brasileiro, recebeu "${r}"`);
    });

    test('montarResumoPlanilha usa exatamente os mesmos totais de calcularResumo (tela e planilha nunca divergem)', async () => {
        const resumoTela = await chamar('calcularResumo', LANCAMENTOS_EXEMPLO);
        const linhasPlanilha = await chamar('montarResumoPlanilha', LANCAMENTOS_EXEMPLO);
        const linhaTotalGeral = linhasPlanilha.find(l => l.Resumo === 'Total geral');
        assertIgual(linhaTotalGeral['Valor (R$)'], resumoTela.totalGeral, 'Total geral da planilha deve bater com o da tela');
    });

}

// ---------------------------------------------------------------------------
// 2) Fluxo completo no painel administrativo (admin.html)
// ---------------------------------------------------------------------------
async function registrarTestesAdmin(browser) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORTA}/tests/harness/admin.html`);
    await page.waitForSelector('#btnExportarPlanilha', { timeout: 10000 });
    await page.waitForTimeout(400); // deixa o listener de lancamentos do dia preencher a tela

    test('admin: cartão "Total Geral" reflete os lançamentos do dia selecionado (ONTEM)', async () => {
        await page.fill('#dataSelecionada', DATAS_SEED.ONTEM);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(300);
        const textoCartao = await page.textContent('.cartao-resumo.destaque .valor');
        // ONTEM tem: Pedro Lima (500) + Maria Multi grupo (60+40=100) = 600
        assertVerdadeiro(textoCartao.includes('600,00'), `Esperava R$ 600,00 no dia de ONTEM, recebeu "${textoCartao}"`);
    });

    test('admin: linha de subtotal aparece para atendimento com mais de 1 exame', async () => {
        const corpo = await page.textContent('#corpoTodos');
        assertVerdadeiro(corpo.includes('Total do atendimento (2 exames)'), 'Deveria mostrar subtotal do grupo com 2 exames');
    });

    test('admin: editar um lançamento grava um registro de auditoria', async () => {
        await page.click('[data-editar-todos="lanc-d2-1"]');
        await page.waitForSelector('#modalEditarLancamento[style*="flex"]');
        await page.fill('#editValor', '550');
        await page.click('#formEditarLancamento button[type="submit"]');
        await page.waitForTimeout(300);

        const registros = await page.evaluate(() => Object.values(window.__db.auditoria || {}));
        assertIgual(registros.length, 1, 'Deveria existir exatamente 1 registro de auditoria após a edição');
        assertIgual(registros[0].acao, 'editar', 'Ação registrada deveria ser "editar"');
        assertIgual(registros[0].mudancas.valor.de, 500, 'Valor anterior registrado incorretamente');
        assertIgual(registros[0].mudancas.valor.para, 550, 'Valor novo registrado incorretamente');
        assertIgual(registros[0].usuarioNome, 'Admin Teste', 'Autoria do registro de auditoria incorreta');
    });

    test('admin: excluir um lançamento também grava um registro de auditoria', async () => {
        await page.waitForTimeout(200);
        const idsAntes = await page.evaluate(() => Object.keys(window.__db.lancamentos || {}));
        assertVerdadeiro(idsAntes.includes('lanc-d2-1'), 'Pré-condição: lançamento ainda deve existir antes de excluir');

        page.once('dialog', d => d.accept());
        await page.click('[data-excluir-todos="lanc-d2-1"]');
        await page.waitForTimeout(300);

        const idsDepois = await page.evaluate(() => Object.keys(window.__db.lancamentos || {}));
        assertVerdadeiro(!idsDepois.includes('lanc-d2-1'), 'Lançamento deveria ter sido excluído');

        const registros = await page.evaluate(() => Object.values(window.__db.auditoria || {}));
        const registroExclusao = registros.find(r => r.acao === 'excluir');
        assertVerdadeiro(!!registroExclusao, 'Deveria existir um registro de auditoria para a exclusão');
        assertVerdadeiro(registroExclusao.lancamentoResumo.includes('Pedro Lima'), 'Resumo do lançamento excluído deveria citar o paciente');
    });

    test('admin: aba Auditoria lista os registros criados', async () => {
        await page.click('.sidebar-link[data-aba="auditoria"]');
        await page.waitForTimeout(300);
        const corpo = await page.textContent('#corpoAuditoria');
        assertVerdadeiro(corpo.includes('Editado') || corpo.includes('Excluído'), 'A tabela de auditoria deveria listar os registros criados nos testes anteriores');
    });

    test('admin: exportar planilha de um período de vários dias gera um arquivo com todas as datas', async () => {
        await page.click('.sidebar-link[data-aba="fechamento"]');
        await page.waitForTimeout(200);
        await page.click('#btnExportarPlanilha');
        await page.fill('#exportarDataInicio', DATAS_SEED.DOIS_DIAS_ATRAS);
        await page.fill('#exportarDataFim', DATAS_SEED.HOJE);

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('#btnConfirmarExportar')
        ]);
        const nomeArquivo = download.suggestedFilename();
        assertIgual(nomeArquivo, `cerdil_caixa_${DATAS_SEED.DOIS_DIAS_ATRAS}_a_${DATAS_SEED.HOJE}.xlsx`, 'Nome do arquivo deveria refletir o período escolhido');
    });

}

// ---------------------------------------------------------------------------
// 2.1) Fluxo no painel de supervisor (supervisor.html)
// ---------------------------------------------------------------------------
// admin.js e supervisor.js compartilham a mesma logica (caixa-compartilhado.js)
// e sao quase identicos na parte de fechamento/auditoria - este bloco cobre
// especificamente o que e exclusivo do supervisor: ele NAO tem a aba
// "Usuarios", mas TEM a mesma aba "Auditoria" que o admin.
async function registrarTestesSupervisor(browser) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORTA}/tests/harness/supervisor.html`);
    await page.waitForSelector('#btnExportarPlanilha', { timeout: 10000 });
    await page.waitForTimeout(400);

    test('supervisor: não tem aba "Usuários" (exclusiva do administrador)', async () => {
        const existeAbaUsuarios = await page.locator('.sidebar-link[data-aba="usuarios"]').count();
        assertIgual(existeAbaUsuarios, 0, 'A tela de supervisor não deveria ter a aba de gestão de usuários');
    });

    test('supervisor: cartão "Total Geral" reflete o dia selecionado (ONTEM)', async () => {
        await page.fill('#dataSelecionada', DATAS_SEED.ONTEM);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(300);
        const textoCartao = await page.textContent('.cartao-resumo.destaque .valor');
        assertVerdadeiro(textoCartao.includes('600,00'), `Esperava R$ 600,00 no dia de ONTEM, recebeu "${textoCartao}"`);
    });

    test('supervisor: editar um lançamento grava auditoria com o perfil correto', async () => {
        await page.click('[data-editar-todos="lanc-d2-1"]');
        await page.waitForSelector('#modalEditarLancamento[style*="flex"]');
        await page.fill('#editValor', '520');
        await page.click('#formEditarLancamento button[type="submit"]');
        await page.waitForTimeout(300);

        const registros = await page.evaluate(() => Object.values(window.__db.auditoria || {}));
        assertIgual(registros.length, 1, 'Deveria existir 1 registro de auditoria');
        assertIgual(registros[0].usuarioNome, 'Supervisor Teste', 'Autoria deveria ser o supervisor logado');
        assertIgual(registros[0].usuarioPerfil, 'supervisor', 'Perfil registrado na auditoria deveria ser "supervisor"');
    });

    test('supervisor: aba Auditoria mostra o registro recém-criado', async () => {
        await page.click('.sidebar-link[data-aba="auditoria"]');
        await page.waitForTimeout(300);
        const corpo = await page.textContent('#corpoAuditoria');
        assertVerdadeiro(corpo.includes('Supervisor Teste'), 'Deveria listar o registro criado pelo supervisor');
    });
}

// ---------------------------------------------------------------------------
// 3) Fluxo na tela de recepção (recepcao.html) - regra dos 3 dias
// ---------------------------------------------------------------------------
async function registrarTestesRecepcao(browser) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORTA}/tests/harness/recepcao.html`);
    await page.waitForSelector('#formLancamento', { timeout: 10000 });
    await page.waitForTimeout(400);

    test('recepção: só vê os próprios lançamentos, não os de outros atendentes', async () => {
        // O seed tem lancamentos de uid-teste-recepcao E de uid-teste-supervisor
        // no dia ONTEM - a tela de recepcao (logada como uid-teste-recepcao)
        // deve mostrar so os proprios ao navegar para aquele dia.
        await page.fill('#dataSelecionada', DATAS_SEED.ONTEM);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(300);
        const corpo = await page.textContent('#corpoTabela');
        assertVerdadeiro(corpo.includes('Maria Multi'), 'Deveria mostrar o atendimento próprio (Maria Multi)');
        assertVerdadeiro(!corpo.includes('Pedro Lima'), 'NÃO deveria mostrar o lançamento de outro atendente (Pedro Lima, do supervisor)');
    });

    test('recepção: dia fora da janela de 3 dias fica somente para consulta (sem botão editar)', async () => {
        await page.fill('#dataSelecionada', DATAS_SEED.FORA_DA_JANELA);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(300);
        const corpo = await page.textContent('#corpoTabela');
        assertVerdadeiro(corpo.includes('Antigo Demais'), 'Deveria listar o lançamento antigo (somente para consulta)');
        const botaoEditarExiste = await page.locator('[data-editar]').count();
        assertIgual(botaoEditarExiste, 0, 'Não deveria haver botão de editar fora da janela de 3 dias');

        // Volta para ONTEM (dentro da janela) para não afetar o teste seguinte.
        await page.fill('#dataSelecionada', DATAS_SEED.ONTEM);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(300);
    });

    test('recepção: editar um exame próprio grava auditoria com o nome de quem editou', async () => {
        await page.click('[data-editar="lanc-grupo-a"]');
        await page.waitForTimeout(200);
        const linhaValor = page.locator('.linha-exame .campo-valor').first();
        await linhaValor.fill('70');
        await page.click('#btnSalvar');
        await page.waitForTimeout(300);

        const registros = await page.evaluate(() => Object.values(window.__db.auditoria || {}));
        assertIgual(registros.length, 1, 'Deveria existir 1 registro de auditoria');
        assertIgual(registros[0].usuarioNome, 'Recepcao Teste', 'Autoria deveria ser a recepcionista logada');
        assertIgual(registros[0].mudancas.valor.de, 60, 'Valor anterior incorreto no log');
        assertIgual(registros[0].mudancas.valor.para, 70, 'Valor novo incorreto no log');
    });
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
