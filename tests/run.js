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
        await registrarTestesInterface(browser);
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


    test('totalLiquido desconta as despesas do Total Geral', async () => {
        assertIgual(await chamar('totalLiquido', 930, 100), 830, 'Total líquido');
        assertIgual(await chamar('totalLiquido', 100, undefined), 100, 'Sem despesas, líquido = total');
        assertIgual(await chamar('totalLiquido', 50, 80), -30, 'Despesa maior que o total fica negativa (aparece, não esconde)');
    });

    test('sugerirDeposito tira as despesas da espécie e nunca sugere valor negativo', async () => {
        assertIgual(await chamar('sugerirDeposito', 80, 30), 50, 'Espécie 80 com despesa 30');
        assertIgual(await chamar('sugerirDeposito', 80, 0), 80, 'Sem despesas');
        assertIgual(await chamar('sugerirDeposito', 80, 200), 0, 'Despesa maior que a espécie');
    });

    test('rotuloForma mostra acento na tela sem mudar o valor gravado', async () => {
        assertIgual(await chamar('rotuloForma', 'Debito'), 'Débito', 'Débito');
        assertIgual(await chamar('rotuloForma', 'Credito'), 'Crédito', 'Crédito');
        assertIgual(await chamar('rotuloForma', 'Especie'), 'Espécie', 'Espécie');
        assertIgual(await chamar('rotuloForma', 'Pix'), 'Pix', 'Pix');
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


    test('admin: despesas entram no Total líquido e abatem o depósito sugerido', async () => {
        await page.click('.sidebar-link[data-aba="fechamento"]');
        await page.fill('#dataSelecionada', DATAS_SEED.HOJE);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(400);
        const lerCartao = (rotulo) => page.evaluate((r) => {
            const c = Array.from(document.querySelectorAll('#grade-resumo .cartao-resumo'))
                .find(el => el.querySelector('.rotulo').textContent.includes(r));
            return c ? c.querySelector('.valor').textContent.replace(/\u00a0/g, ' ') : null;
        }, rotulo);

        assertVerdadeiro((await lerCartao('líquido')).includes('80,00'), 'Sem despesas, líquido = total (R$ 80,00)');
        assertIgual(await page.inputValue('#deposito'), '80.00', 'Depósito sugerido sem despesas');

        await page.fill('#despesas', '30');
        assertVerdadeiro((await lerCartao('Despesas')).includes('30,00'), 'Cartão Despesas');
        assertVerdadeiro((await lerCartao('líquido')).includes('50,00'), 'Total líquido deveria cair para R$ 50,00');
        assertIgual(await page.inputValue('#deposito'), '50.00', 'Depósito deveria cair para 50,00');

        await page.fill('#despesas', '200');
        assertIgual(await page.inputValue('#deposito'), '0.00', 'Despesa maior que a espécie: depósito 0, nunca negativo');
        assertVerdadeiro((await lerCartao('líquido')).includes('120,00'), 'Líquido negativo continua visível');
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

    test('supervisor: despesas entram no Total líquido e abatem o depósito sugerido', async () => {
        await page.click('.sidebar-link[data-aba="fechamento"]');
        await page.fill('#dataSelecionada', DATAS_SEED.HOJE);
        await page.dispatchEvent('#dataSelecionada', 'change');
        await page.waitForTimeout(400);
        const lerCartao = (rotulo) => page.evaluate((r) => {
            const c = Array.from(document.querySelectorAll('#grade-resumo .cartao-resumo'))
                .find(el => el.querySelector('.rotulo').textContent.includes(r));
            return c ? c.querySelector('.valor').textContent.replace(/\u00a0/g, ' ') : null;
        }, rotulo);

        assertVerdadeiro((await lerCartao('líquido')).includes('80,00'), 'Sem despesas, líquido = total (R$ 80,00)');
        assertIgual(await page.inputValue('#deposito'), '80.00', 'Depósito sugerido sem despesas');

        await page.fill('#despesas', '30');
        assertVerdadeiro((await lerCartao('Despesas')).includes('30,00'), 'Cartão Despesas');
        assertVerdadeiro((await lerCartao('líquido')).includes('50,00'), 'Total líquido deveria cair para R$ 50,00');
        assertIgual(await page.inputValue('#deposito'), '50.00', 'Depósito deveria cair para 50,00');

        await page.fill('#despesas', '200');
        assertIgual(await page.inputValue('#deposito'), '0.00', 'Despesa maior que a espécie: depósito 0, nunca negativo');
        assertVerdadeiro((await lerCartao('líquido')).includes('120,00'), 'Líquido negativo continua visível');
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

    test('recepção: forma de pagamento começa em branco e o lançamento não salva sem escolher', async () => {
        const p = await browser.newPage();
        await p.goto(`http://localhost:${PORTA}/tests/harness/recepcao.html`);
        await p.waitForSelector('#formLancamento');
        await p.waitForTimeout(400);
        assertIgual(await p.inputValue('#forma_pagamento'), '', 'Não pode vir com Débito (ou outra forma) já marcada');
        const antes = await p.evaluate(() => Object.keys(window.__db.lancamentos || {}).length);
        await p.fill('#nome_paciente', 'Teste Sem Pagamento');
        await p.locator('.linha-exame .campo-valor').first().fill('90');
        await p.click('#btnSalvar');
        await p.waitForTimeout(300);
        const depois = await p.evaluate(() => Object.keys(window.__db.lancamentos || {}).length);
        assertIgual(depois, antes, 'Nada deveria ser gravado sem forma de pagamento');

        await p.selectOption('#forma_pagamento', 'Pix');
        await p.click('#btnSalvar');
        await p.waitForTimeout(400);
        const final = await p.evaluate(() => Object.keys(window.__db.lancamentos || {}).length);
        assertIgual(final, antes + 1, 'Com a forma escolhida, o lançamento deveria salvar');
        assertIgual(await p.inputValue('#forma_pagamento'), '', 'Depois de salvar, a forma volta para em branco (não herda a anterior)');
    });

    test('recepção: total do atendimento aparece ao vivo, antes de salvar', async () => {
        const p = await browser.newPage();
        await p.goto(`http://localhost:${PORTA}/tests/harness/recepcao.html`);
        await p.waitForSelector('#formLancamento');
        await p.waitForTimeout(400);
        const ler = async () => (await p.textContent('#valorTotalAoVivo')).replace(/\u00a0/g, ' ');
        assertVerdadeiro((await ler()).includes('0,00'), 'Começa em R$ 0,00');
        await p.locator('.linha-exame .campo-valor').first().fill('100');
        assertVerdadeiro((await ler()).includes('100,00'), 'Um exame de 100');
        await p.click('#btnAddExame');
        await p.locator('.linha-exame .campo-valor').nth(1).fill('50.5');
        assertVerdadeiro((await ler()).includes('150,50'), 'Dois exames somam 150,50');
        await p.locator('.botao-remover-exame').nth(1).click();
        assertVerdadeiro((await ler()).includes('100,00'), 'Remover o exame volta a soma para 100');
    });

    test('recepção: rótulos das linhas de exame e pagamento ficam ligados aos campos (for/id)', async () => {
        const p = await browser.newPage();
        await p.goto(`http://localhost:${PORTA}/tests/harness/recepcao.html`);
        await p.waitForSelector('#formLancamento');
        await p.click('#btnAddExame');
        const soltos = await p.evaluate(() => Array.from(document.querySelectorAll('#formLancamento label'))
            .filter(l => !l.htmlFor || !document.getElementById(l.htmlFor)).map(l => l.textContent.trim()));
        assertIgual(soltos, [], 'Todo label do formulário deve apontar para um campo existente');
    });
}

// ---------------------------------------------------------------------------
// 5) Interface: menu no celular, tema do sistema, contraste, rotulos
// ---------------------------------------------------------------------------
function luminancia(hex) {
    const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255)
        .map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
    const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
}

async function registrarTestesInterface(browser) {
    test('celular: sidebar fica escondida e o botão de menu abre e fecha a navegação (admin)', async () => {
        const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
        const p = await ctx.newPage();
        await p.goto(`http://localhost:${PORTA}/tests/harness/admin.html`);
        await p.waitForSelector('#menuMobileBotao', { timeout: 10000 });
        const caixa = async () => p.locator('.sidebar').boundingBox();
        assertVerdadeiro((await caixa()).x + (await caixa()).width <= 1, 'Sidebar deveria estar fora da tela com o menu fechado');

        await p.click('#menuMobileBotao');
        await p.waitForTimeout(350);
        assertVerdadeiro((await caixa()).x >= -1, 'Sidebar deveria aparecer com o menu aberto');
        assertIgual(await p.getAttribute('#menuMobileBotao', 'aria-expanded'), 'true', 'aria-expanded do botão');

        await p.click('.sidebar-link[data-aba="historico"]');
        await p.waitForTimeout(350);
        assertVerdadeiro(await p.isVisible('#abaHistorico'), 'A aba Histórico deveria abrir pelo menu do celular');
        assertVerdadeiro((await caixa()).x + (await caixa()).width <= 1, 'Escolher uma aba deveria fechar o menu');
        await ctx.close();
    });

    test('celular: nenhuma tela passa da largura da tela (sem rolagem horizontal da página)', async () => {
        for (const tela of ['recepcao', 'admin', 'supervisor']) {
            const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
            const p = await ctx.newPage();
            await p.goto(`http://localhost:${PORTA}/tests/harness/${tela}.html`);
            await p.waitForSelector('.topbar');
            await p.waitForTimeout(300);
            const larguras = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
            assertVerdadeiro(larguras.doc <= larguras.janela + 1, `${tela}: página com ${larguras.doc}px numa tela de ${larguras.janela}px`);
            await ctx.close();
        }
    });

    test('monitor grande: na primeira visita a escala é sugerida pela largura, sem rolagem horizontal e com a barra lateral do tamanho da janela', async () => {
        const casos = [[1366, 768, 1], [1536, 730, 1], [1920, 1080, 1.2], [2560, 1440, 1.4]];
        for (const [w, h, esperado] of casos) {
            const ctx = await browser.newContext({ viewport: { width: w, height: h } });
            const p = await ctx.newPage();
            await p.goto(`http://localhost:${PORTA}/tests/harness/recepcao.html`);
            await p.waitForSelector('.topbar');
            const m = await p.evaluate(() => ({
                escala: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')),
                largura: document.documentElement.scrollWidth,
                janela: window.innerWidth,
                sidebar: document.querySelector('.sidebar').getBoundingClientRect().height,
                alturaJanela: window.innerHeight
            }));
            assertIgual(m.escala, esperado, `Escala em ${w}px`);
            assertVerdadeiro(m.largura <= m.janela + 1, `${w}px: página com ${m.largura}px de largura`);
            assertVerdadeiro(Math.abs(m.sidebar - m.alturaJanela) <= 2, `${w}px: barra lateral com ${m.sidebar}px numa janela de ${m.alturaJanela}px`);
            await ctx.close();
        }
    });

    test('zoom do navegador não anula a escala: mudar a largura da janela depois da primeira visita não muda o tamanho', async () => {
        const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const p = await ctx.newPage();
        const url = `http://localhost:${PORTA}/tests/harness/recepcao.html`;
        const ler = async () => p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')));
        await p.goto(url);
        await p.waitForSelector('.topbar');
        assertIgual(await ler(), 1.2, 'Escala na primeira visita');
        // Zoom de 120% no navegador deixa a janela com ~1600px; 80% deixa com ~2400px.
        for (const largura of [1600, 2400]) {
            await p.setViewportSize({ width: largura, height: 1080 });
            await p.reload();
            await p.waitForSelector('.topbar');
            assertIgual(await ler(), 1.2, `Escala após o zoom do navegador deixar a janela com ${largura}px`);
        }
        await ctx.close();
    });

    test('menu do nome: botões de tamanho da tela mudam, gravam e podem voltar ao sugerido', async () => {
        const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const p = await ctx.newPage();
        const url = `http://localhost:${PORTA}/tests/harness/recepcao.html`;
        const ler = async () => p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')));
        await p.goto(url);
        await p.waitForSelector('#navRapidaToggle');
        await p.click('#navRapidaToggle');
        assertIgual((await p.textContent('#escalaValor')).trim(), '120%', 'Valor mostrado no início');
        await p.click('#escalaMais');
        assertIgual(await ler(), 1.3, 'Escala depois de +');
        assertIgual((await p.textContent('#escalaValor')).trim(), '130%', 'Valor mostrado depois de +');
        await p.reload();
        await p.waitForSelector('.topbar');
        assertIgual(await ler(), 1.3, 'Escala gravada depois de recarregar');
        await p.click('#navRapidaToggle');
        await p.click('#escalaMenos');
        await p.click('#escalaMenos');
        assertIgual(await ler(), 1.1, 'Escala depois de dois −');
        await p.click('#escalaValor');
        assertIgual(await ler(), 1.2, 'Voltar ao sugerido para 1920px');
        await ctx.close();
    });

    test('desktop: o botão de menu do celular não aparece', async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const p = await ctx.newPage();
        await p.goto(`http://localhost:${PORTA}/tests/harness/admin.html`);
        await p.waitForSelector('#menuMobileBotao', { state: 'attached', timeout: 10000 });
        assertVerdadeiro(!(await p.isVisible('#menuMobileBotao')), 'Botão só existe visualmente em tela pequena');
        await ctx.close();
    });

    test('tema: sem escolha salva, segue a preferência escura do sistema; com sistema claro, fica claro', async () => {
        const lerFundo = async (esquema) => {
            const ctx = await browser.newContext({ colorScheme: esquema });
            const p = await ctx.newPage();
            await p.goto(`http://localhost:${PORTA}/tests/harness/admin.html`);
            await p.waitForSelector('.topbar');
            const cor = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
            await ctx.close();
            return cor;
        };
        assertIgual(await lerFundo('dark'), 'rgb(15, 21, 38)', 'Fundo escuro com sistema escuro');
        assertIgual(await lerFundo('light'), 'rgb(243, 245, 250)', 'Fundo claro com sistema claro');
    });

    test('contraste: texto secundário (textos de apoio e rótulos) passa de 4,5:1 nos dois temas', async () => {
        for (const esquema of ['light', 'dark']) {
            const ctx = await browser.newContext({ colorScheme: esquema });
            const p = await ctx.newPage();
            await p.goto(`http://localhost:${PORTA}/tests/harness/admin.html`);
            await p.waitForSelector('.topbar');
            const v = await p.evaluate(() => {
                const s = getComputedStyle(document.documentElement);
                const g = (n) => s.getPropertyValue(n).trim();
                return { texto: g('--cinza-texto-suave'), fundos: [g('--branco'), g('--fundo'), g('--azul-claro')] };
            });
            for (const fundo of v.fundos) {
                const razao = contraste(v.texto, fundo);
                assertVerdadeiro(razao >= 4.5, `Tema ${esquema}: ${v.texto} sobre ${fundo} = ${razao.toFixed(2)}:1 (mínimo 4,5)`);
            }
            await ctx.close();
        }
    });

    test('acessibilidade: todo label do admin e do supervisor aponta para um campo existente', async () => {
        for (const tela of ['admin', 'supervisor']) {
            const ctx = await browser.newContext();
            const p = await ctx.newPage();
            await p.goto(`http://localhost:${PORTA}/tests/harness/${tela}.html`);
            await p.waitForSelector('.topbar');
            const soltos = await p.evaluate(() => Array.from(document.querySelectorAll('label'))
                .filter(l => !l.htmlFor || !document.getElementById(l.htmlFor)).map(l => l.textContent.trim()));
            assertIgual(soltos, [], `Labels sem campo ligado em ${tela}.html`);
            await ctx.close();
        }
    });
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
