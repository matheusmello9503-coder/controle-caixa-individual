// Framework de teste minimo, sem dependencias externas alem do Playwright
// (que este ambiente ja tem globalmente instalado). Nao usa @playwright/test
// de proposito: o app e um site estatico sem build/npm install, e este
// arquivo mantem os testes assim tambem - "node tests/run.js" e o unico
// comando necessario, tanto localmente quanto no GitHub Actions.

let testesRegistrados = [];
let falhas = 0;
let sucessos = 0;

function test(nome, fn) {
    testesRegistrados.push({ nome, fn });
}

function assertIgual(atual, esperado, mensagem) {
    const iguais = JSON.stringify(atual) === JSON.stringify(esperado);
    if (!iguais) {
        throw new Error(`${mensagem || 'Valores diferentes'}\n  esperado: ${JSON.stringify(esperado)}\n  atual:    ${JSON.stringify(atual)}`);
    }
}

function assertVerdadeiro(valor, mensagem) {
    if (!valor) throw new Error(mensagem || 'Esperava um valor verdadeiro, recebeu ' + JSON.stringify(valor));
}

function assertProximo(atual, esperado, tolerancia, mensagem) {
    if (Math.abs(atual - esperado) > tolerancia) {
        throw new Error(`${mensagem || 'Valores não são próximos o suficiente'}\n  esperado: ~${esperado}\n  atual:    ${atual}`);
    }
}

async function rodarTudo() {
    for (const { nome, fn } of testesRegistrados) {
        try {
            await fn();
            sucessos += 1;
            console.log(`  ✓ ${nome}`);
        } catch (e) {
            falhas += 1;
            console.log(`  ✗ ${nome}`);
            console.log(`    ${e.message.split('\n').join('\n    ')}`);
        }
    }
    console.log('');
    console.log(`${sucessos} passaram, ${falhas} falharam.`);
    if (falhas > 0) process.exitCode = 1;
}

module.exports = { test, assertIgual, assertVerdadeiro, assertProximo, rodarTudo };
