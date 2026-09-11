import { onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db, obterAuthSecundario } from "./firebase-init.js";
import { FUSO_HORARIO } from "./firebase-config.js";
import { montarNavRapida } from "./nav-rapida.js";
import { carregarHistorico, renderizarHistorico } from "./historico.js";

let cancelarOuvinteLancamentos = null;
let listaDoDia = [];
// Guarda o total de Especie "pura" (sem Pix) do dia carregado, para poder
// sugerir o Deposito assim que o documento de fechamento tambem estiver
// carregado - os dois vem de fontes assincronas diferentes (listener de
// lancamentos e leitura do fechamento), entao cada um chama
// atualizarSugestaoDeposito() por conta propria quando termina.
let ultimoTotalEspeciePura = 0;
let depositoJaSalvo = false;

function formatarMoeda(valor) {
    return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function hojeInputStr() {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_HORARIO, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date());
    const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function mostrarErro(texto, idEl = 'msgErro') {
    const el = document.getElementById(idEl);
    el.textContent = texto;
    el.classList.add('mostrar');
    setTimeout(() => el.classList.remove('mostrar'), 6000);
}
function mostrarOk(texto, idEl = 'msgOk') {
    const el = document.getElementById(idEl);
    el.textContent = texto;
    el.classList.add('mostrar');
    setTimeout(() => el.classList.remove('mostrar'), 3000);
}

function rotuloPerfil(perfil) {
    const mapa = { admin: 'Administrador', supervisor: 'Supervisor', recepcao: 'Recepção' };
    return mapa[perfil] || perfil;
}

// ---------- Autenticacao ----------
onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
        window.location.href = 'login.html';
        return;
    }
    const perfilDoc = await getDoc(doc(db, 'usuarios', usuario.uid));
    if (!perfilDoc.exists() || perfilDoc.data().ativo !== true) {
        await signOut(auth);
        window.location.href = 'login.html';
        return;
    }
    const perfil = perfilDoc.data().perfil;
    if (perfil === 'supervisor') {
        window.location.href = 'supervisor.html';
        return;
    }
    if (perfil !== 'admin') {
        window.location.href = 'recepcao.html';
        return;
    }

    montarNavRapida({ perfil: 'admin', nome: perfilDoc.data().nome, paginaAtual: 'admin' });
    document.getElementById('dataSelecionada').value = hojeInputStr();

    // So busca lancamentos e fechamento do dia (o que a tela abre mostrando).
    // Usuarios e Historico ficam para quando a pessoa realmente abrir
    // aquela aba - evita leituras desnecessarias e deixa a primeira tela
    // pronta mais rapido.
    carregarLancamentosDoDia();
    carregarFechamento();
});

async function sair() {
    if (cancelarOuvinteLancamentos) cancelarOuvinteLancamentos();
    await signOut(auth);
    window.location.href = 'login.html';
}

// Registrado uma unica vez, em escopo de modulo (nao dentro do
// onAuthStateChanged, que o Firebase pode disparar mais de uma vez por
// pagina) - evita acumular listeners duplicados no mesmo evento.
document.getElementById('btnSair').addEventListener('click', sair);
document.addEventListener('nav-rapida-sair', sair);

// ---------- Abas (agora como itens da sidebar) ----------
const tituloAbaEl = document.getElementById('tituloAba');
const titulosAba = {
    fechamento: { titulo: 'Fechamento do dia', sub: 'Visão consolidada de todos os atendentes' },
    historico: { titulo: 'Histórico', sub: 'Totais e evolução dos últimos dias' },
    usuarios: { titulo: 'Usuários', sub: 'Cadastro e permissões de acesso ao sistema' }
};

document.querySelectorAll('.sidebar-link[data-aba]').forEach(aba => {
    aba.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-link[data-aba]').forEach(a => a.classList.remove('ativo'));
        aba.classList.add('ativo');
        const alvo = aba.dataset.aba;
        document.getElementById('abaFechamento').style.display = alvo === 'fechamento' ? 'block' : 'none';
        document.getElementById('abaHistorico').style.display = alvo === 'historico' ? 'block' : 'none';
        document.getElementById('abaUsuarios').style.display = alvo === 'usuarios' ? 'block' : 'none';
        const info = titulosAba[alvo];
        if (info && tituloAbaEl) {
            tituloAbaEl.innerHTML = `${info.titulo}<span class="sub">${info.sub}</span>`;
        }
        if (alvo === 'historico') {
            atualizarHistorico();
        }
        if (alvo === 'usuarios') {
            carregarUsuarios();
        }
    });
});

document.getElementById('dataSelecionada').addEventListener('change', () => {
    // Zera antes de trocar de dia: evita, por uma fracao de segundo, mostrar
    // a sugestao de Deposito calculada com os lancamentos do dia anterior
    // enquanto os lancamentos do novo dia ainda nao chegaram do Firestore.
    ultimoTotalEspeciePura = 0;
    carregarLancamentosDoDia();
    carregarFechamento();
});

// ---------- Historico (varios dias) ----------
let diasHistoricoAtual = 7;
async function atualizarHistorico() {
    const dados = await carregarHistorico(diasHistoricoAtual);
    renderizarHistorico(dados, {
        idGrade: 'grade-resumo-historico',
        idGrafico: 'graficoHistorico',
        idTabela: 'corpoHistorico'
    });
}
document.querySelectorAll('.periodo-botao').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.periodo-botao').forEach(b => b.classList.remove('ativo'));
        btn.classList.add('ativo');
        diasHistoricoAtual = parseInt(btn.dataset.dias, 10);
        atualizarHistorico();
    });
});

// ---------- Lancamentos do dia (tempo real) ----------
function carregarLancamentosDoDia() {
    if (cancelarOuvinteLancamentos) cancelarOuvinteLancamentos();

    const data = document.getElementById('dataSelecionada').value;
    const q = query(collection(db, 'lancamentos'), where('data', '==', data));

    cancelarOuvinteLancamentos = onSnapshot(q, (snapshot) => {
        listaDoDia = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderizarResumo();
    }, (erro) => {
        mostrarErro('Não foi possível carregar os lançamentos: ' + erro.message);
    });
}

function renderizarResumo() {
    const mapaFormas = { Debito: { total: 0, qtd: 0 }, Credito: { total: 0, qtd: 0 }, Especie: { total: 0, qtd: 0 }, Pix: { total: 0, qtd: 0 } };
    const porAtendente = {};
    let totalGeral = 0;

    listaDoDia.forEach(l => {
        // Protecao contra um lancamento com forma de pagamento fora das 4
        // esperadas (dado antigo, editado manualmente no console do
        // Firebase, ou uma futura forma nova ainda nao suportada aqui) -
        // sem isso, um unico lancamento assim travava a tela inteira.
        if (mapaFormas[l.formaPagamento]) {
            mapaFormas[l.formaPagamento].total += l.valor;
            mapaFormas[l.formaPagamento].qtd += 1;
        }
        totalGeral += l.valor;

        if (!porAtendente[l.usuarioNome]) porAtendente[l.usuarioNome] = { total: 0, qtd: 0 };
        porAtendente[l.usuarioNome].total += l.valor;
        porAtendente[l.usuarioNome].qtd += 1;
    });

    const totalCartao = mapaFormas.Debito.total + mapaFormas.Credito.total;

    // O cartao "Especie" mostra Especie + Pix somados, igual ao Tasy (que
    // lanca o Pix dentro de Especie) - assim o numero bate na hora de
    // conferir os dois sistemas lado a lado. O cartao "Pix" ao lado mostra
    // a parte que e so Pix, para quem quiser ver o detalhe. O calculo do
    // Deposito (mais abaixo) usa a Especie PURA (sem Pix), guardada em
    // ultimoTotalEspeciePura - e a mesma conta que voces ja fazem por fora
    // (Especie do Tasy menos o Pix), so que automatica.
    const especieComPix = mapaFormas.Especie.total + mapaFormas.Pix.total;
    const especieComPixQtd = mapaFormas.Especie.qtd + mapaFormas.Pix.qtd;
    ultimoTotalEspeciePura = mapaFormas.Especie.total;

    // Hero (Total Geral) primeiro, seguido do detalhamento por forma de
    // pagamento. "Total Cartao" fica junto por ser uma soma que nao esta
    // em nenhum outro lugar (Debito + Credito); "Total Pix" foi removido
    // daqui por ser repeticao exata do cartao "Pix" ao lado.
    const grade = document.getElementById('grade-resumo');
    grade.innerHTML = `
        ${cartaoResumo('Total Geral', totalGeral, listaDoDia.length, true)}
        <div class="grupo-rotulo">Por forma de pagamento</div>
        ${cartaoResumo('Debito', mapaFormas.Debito.total, mapaFormas.Debito.qtd)}
        ${cartaoResumo('Credito', mapaFormas.Credito.total, mapaFormas.Credito.qtd)}
        ${cartaoResumo('Especie (+ Pix)', especieComPix, especieComPixQtd)}
        ${cartaoResumo('Pix', mapaFormas.Pix.total, mapaFormas.Pix.qtd)}
        ${cartaoResumo('Total Cartao', totalCartao)}
    `;

    atualizarSugestaoDeposito();

    const pendencias = listaDoDia.filter(l => !l.titulo || !l.tesouraria);
    document.getElementById('corpoPendencias').innerHTML = pendencias.length
        ? pendencias.map(l => `
            <tr class="linha-pendente">
                <td>${l.usuarioNome}</td><td>${l.nomePaciente}</td><td>${l.exame}</td>
                <td>${formatarMoeda(l.valor)}</td><td>${l.formaPagamento}</td>
                <td>${l.titulo || '<span class="selo pendente">Sem t&iacute;tulo</span>'}</td>
                <td>${l.tesouraria ? '<span class="selo ok">Feita</span>' : '<span class="selo pendente">Pendente</span>'}</td>
            </tr>`).join('')
        : '<tr><td colspan="7" style="color:var(--cinza-texto)">Nenhuma pendencia.</td></tr>';

    document.getElementById('corpoAtendentes').innerHTML = Object.entries(porAtendente).map(([nome, v]) => `
        <tr><td>${nome}</td><td>${v.qtd}</td><td>${formatarMoeda(v.total)}</td></tr>
    `).join('') || '<tr><td colspan="3" style="color:var(--cinza-texto)">Sem lançamentos.</td></tr>';

    renderizarTabelaTodos();
}

// ---------- Ordenacao da tabela "Todos os lancamentos do dia" ----------
// Por padrao a tabela segue a ordem de criacao (e agrupa visualmente os
// lancamentos do mesmo atendimento com a seta "->"). Quando a pessoa clica
// num titulo de coluna, a lista passa a seguir aquele criterio (clicar de
// novo no mesmo titulo inverte a ordem) - nesse caso o agrupamento visual
// fica desligado, porque lancamentos do mesmo atendimento podem nao ficar
// mais lado a lado.
let ordenacaoTodosCampo = null;
let ordenacaoTodosDirecao = 'asc';

function valorParaOrdenar(l, campo) {
    if (campo === 'valor') return l.valor || 0;
    if (campo === 'tesouraria') return l.tesouraria ? 1 : 0;
    return (l[campo] || '').toString().toLowerCase();
}

function compararPorCampo(a, b, campo, direcao) {
    const va = valorParaOrdenar(a, campo);
    const vb = valorParaOrdenar(b, campo);
    let cmp;
    if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
    } else {
        cmp = va.localeCompare(vb, 'pt-BR');
    }
    return direcao === 'asc' ? cmp : -cmp;
}

// Mesma ordenacao usada na tabela na tela - reaproveitada tambem na
// exportacao da planilha, para o arquivo sair na mesma ordem que a pessoa
// esta vendo no momento.
function obterListaTodosOrdenada() {
    let todos = [...listaDoDia].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
    if (ordenacaoTodosCampo) {
        todos.sort((a, b) => compararPorCampo(a, b, ordenacaoTodosCampo, ordenacaoTodosDirecao));
    }
    return todos;
}

function renderizarTabelaTodos() {
    const todos = obterListaTodosOrdenada();

    // O agrupamento visual (seta "->" para o mesmo atendimento) so faz
    // sentido quando a ordem e a de criacao - com ordenacao customizada, os
    // lancamentos do mesmo grupoId podem nao ficar mais adjacentes.
    const agruparVisualmente = !ordenacaoTodosCampo;
    let grupoAnteriorTodos = null;

    document.getElementById('corpoTodos').innerHTML = todos.map(l => {
        const mesmoGrupo = agruparVisualmente && l.grupoId && l.grupoId === grupoAnteriorTodos;
        grupoAnteriorTodos = l.grupoId || null;
        return `
        <tr class="${(!l.titulo || !l.tesouraria) ? 'linha-pendente' : ''} ${mesmoGrupo ? 'linha-mesmo-grupo' : 'linha-inicio-grupo'}">
            <td>${l.usuarioNome}</td><td>${mesmoGrupo ? '&#8618;' : l.nomePaciente}</td><td>${l.exame}</td>
            <td>${formatarMoeda(l.valor)}</td><td>${l.formaPagamento}${l.pagamentoDividido ? ' <span class="selo" style="font-size:10px">dividido</span>' : ''}</td>
            <td>${l.titulo || '-'}</td><td>${l.numeroNf || '-'}</td>
            <td>${l.tesouraria ? '<span class="selo ok">Feita</span>' : '<span class="selo pendente">Pendente</span>'}</td>
            <td>
                <button class="botao secundario pequeno" data-editar-todos="${l.id}">Editar</button>
                <button class="botao perigo pequeno" data-excluir-todos="${l.id}">Excluir</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="9" style="color:var(--cinza-texto)">Sem lançamentos.</td></tr>';

    document.querySelectorAll('[data-editar-todos]').forEach(btn => {
        btn.addEventListener('click', () => abrirModalEdicao(btn.dataset.editarTodos));
    });
    document.querySelectorAll('[data-excluir-todos]').forEach(btn => {
        btn.addEventListener('click', () => excluirLancamentoTodos(btn.dataset.excluirTodos));
    });
}

// ---------- Editar/excluir qualquer lancamento (admin/supervisor) ----------
// Como admin e supervisor nao tem nenhuma restricao de dia, horario ou
// atendente nas regras do Firestore para lancamentos (ver firestore.rules),
// esta tela permite corrigir ou remover QUALQUER lancamento de QUALQUER
// atendente, na data que estiver selecionada acima (que por sua vez pode
// ser qualquer data, passada ou futura).
const modalEditarLancamento = document.getElementById('modalEditarLancamento');
const formEditarLancamento = document.getElementById('formEditarLancamento');

function abrirModalEdicao(id) {
    const l = listaDoDia.find(x => x.id === id);
    if (!l) return;
    document.getElementById('editNomePaciente').value = l.nomePaciente;
    document.getElementById('editExame').value = l.exame;
    document.getElementById('editValor').value = l.valor;
    document.getElementById('editFormaPagamento').value = l.formaPagamento;
    document.getElementById('editTitulo').value = l.titulo || '';
    document.getElementById('editNumeroNf').value = l.numeroNf || '';
    document.getElementById('editTesouraria').checked = !!l.tesouraria;
    formEditarLancamento.dataset.editandoId = id;
    document.getElementById('msgErroModal').classList.remove('mostrar');
    modalEditarLancamento.style.display = 'flex';
}

function fecharModalEdicao() {
    modalEditarLancamento.style.display = 'none';
    delete formEditarLancamento.dataset.editandoId;
}

document.getElementById('btnCancelarEdicaoModal').addEventListener('click', fecharModalEdicao);
modalEditarLancamento.addEventListener('click', (ev) => {
    if (ev.target === modalEditarLancamento) fecharModalEdicao();
});

formEditarLancamento.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = formEditarLancamento.dataset.editandoId;
    if (!id) return;

    const nomePaciente = document.getElementById('editNomePaciente').value.trim();
    const exame = document.getElementById('editExame').value;
    const valor = parseFloat(document.getElementById('editValor').value);
    const formaPagamento = document.getElementById('editFormaPagamento').value;
    const titulo = document.getElementById('editTitulo').value.trim();
    const numeroNf = document.getElementById('editNumeroNf').value.trim();
    const tesouraria = document.getElementById('editTesouraria').checked;

    if (!nomePaciente || !exame || isNaN(valor) || valor <= 0) {
        mostrarErro('Preencha paciente, exame e valor corretamente.', 'msgErroModal');
        return;
    }

    try {
        await updateDoc(doc(db, 'lancamentos', id), {
            nomePaciente, exame, valor, formaPagamento, titulo, numeroNf, tesouraria
        });
        fecharModalEdicao();
        mostrarOk('Lançamento atualizado.');
    } catch (e) {
        mostrarErro('Não foi possível salvar: ' + e.message, 'msgErroModal');
    }
});

async function excluirLancamentoTodos(id) {
    const l = listaDoDia.find(x => x.id === id);
    const descricao = l ? `${l.nomePaciente} - ${l.exame} - ${formatarMoeda(l.valor)}` : 'este lançamento';
    if (!confirm(`Excluir ${descricao}? Essa ação não pode ser desfeita.`)) return;
    try {
        await deleteDoc(doc(db, 'lancamentos', id));
        mostrarOk('Lançamento excluído.');
    } catch (e) {
        mostrarErro('Não foi possível excluir: ' + e.message);
    }
}

document.querySelectorAll('#tabelaTodos .th-ordenavel').forEach(th => {
    th.addEventListener('click', () => {
        const campo = th.dataset.ordenar;
        if (ordenacaoTodosCampo === campo) {
            ordenacaoTodosDirecao = ordenacaoTodosDirecao === 'asc' ? 'desc' : 'asc';
        } else {
            ordenacaoTodosCampo = campo;
            ordenacaoTodosDirecao = 'asc';
        }
        document.querySelectorAll('#tabelaTodos .th-ordenavel').forEach(outro => {
            outro.classList.remove('ordenado-asc', 'ordenado-desc');
        });
        th.classList.add(ordenacaoTodosDirecao === 'asc' ? 'ordenado-asc' : 'ordenado-desc');
        renderizarTabelaTodos();
    });
});

// ---------- Exportar planilha (.xlsx) ----------
// Usa a biblioteca SheetJS (carregada via CDN no HTML) para gerar um
// arquivo .xlsx de verdade no proprio navegador, sem precisar de nenhum
// servidor. A planilha sai com duas abas: os lancamentos (na mesma ordem
// que a tela esta mostrando no momento) e um resumo com os totais, iguais
// aos que aparecem nos cartoes acima.
function textoTesouraria(l) {
    return l.tesouraria ? 'Feita' : 'Pendente';
}

function montarLinhasPlanilha() {
    return obterListaTodosOrdenada().map(l => ({
        'Atendente': l.usuarioNome,
        'Paciente': l.nomePaciente,
        'Exame': l.exame,
        'Valor (R$)': l.valor || 0,
        'Pagamento': l.formaPagamento,
        'Pagamento dividido': l.pagamentoDividido ? 'Sim' : 'Não',
        'Título': l.titulo || '',
        'Nº NF': l.numeroNf || '',
        'Tesouraria': textoTesouraria(l)
    }));
}

function montarResumoPlanilha() {
    const mapaFormas = { Debito: { total: 0, qtd: 0 }, Credito: { total: 0, qtd: 0 }, Especie: { total: 0, qtd: 0 }, Pix: { total: 0, qtd: 0 } };
    const porAtendente = {};
    let totalGeral = 0;

    listaDoDia.forEach(l => {
        if (mapaFormas[l.formaPagamento]) {
            mapaFormas[l.formaPagamento].total += l.valor;
            mapaFormas[l.formaPagamento].qtd += 1;
        }
        totalGeral += l.valor;
        if (!porAtendente[l.usuarioNome]) porAtendente[l.usuarioNome] = { total: 0, qtd: 0 };
        porAtendente[l.usuarioNome].total += l.valor;
        porAtendente[l.usuarioNome].qtd += 1;
    });

    const linhas = [
        { 'Resumo': 'Total geral', 'Quantidade': listaDoDia.length, 'Valor (R$)': totalGeral },
        { 'Resumo': 'Débito', 'Quantidade': mapaFormas.Debito.qtd, 'Valor (R$)': mapaFormas.Debito.total },
        { 'Resumo': 'Crédito', 'Quantidade': mapaFormas.Credito.qtd, 'Valor (R$)': mapaFormas.Credito.total },
        { 'Resumo': 'Espécie (+ Pix)', 'Quantidade': mapaFormas.Especie.qtd + mapaFormas.Pix.qtd, 'Valor (R$)': mapaFormas.Especie.total + mapaFormas.Pix.total },
        { 'Resumo': 'Pix', 'Quantidade': mapaFormas.Pix.qtd, 'Valor (R$)': mapaFormas.Pix.total },
        { 'Resumo': 'Total Cartão (Débito + Crédito)', 'Quantidade': mapaFormas.Debito.qtd + mapaFormas.Credito.qtd, 'Valor (R$)': mapaFormas.Debito.total + mapaFormas.Credito.total },
        { 'Resumo': '', 'Quantidade': '', 'Valor (R$)': '' },
        { 'Resumo': 'Por atendente', 'Quantidade': '', 'Valor (R$)': '' },
        ...Object.entries(porAtendente).map(([nome, v]) => ({ 'Resumo': nome, 'Quantidade': v.qtd, 'Valor (R$)': v.total }))
    ];
    return linhas;
}

function exportarPlanilha() {
    if (typeof XLSX === 'undefined') {
        mostrarErro('Não foi possível carregar a ferramenta de planilha (verifique sua conexão com a internet e tente novamente).');
        return;
    }
    const data = document.getElementById('dataSelecionada').value;

    const linhasLancamentos = montarLinhasPlanilha();
    const linhasResumo = montarResumoPlanilha();

    const wb = XLSX.utils.book_new();
    const wsLancamentos = XLSX.utils.json_to_sheet(linhasLancamentos.length ? linhasLancamentos : [{ 'Atendente': 'Sem lançamentos neste dia' }]);
    const wsResumo = XLSX.utils.json_to_sheet(linhasResumo);
    XLSX.utils.book_append_sheet(wb, wsLancamentos, 'Lançamentos');
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    XLSX.writeFile(wb, `cerdil_caixa_${data}.xlsx`);
}

document.getElementById('btnExportarPlanilha').addEventListener('click', exportarPlanilha);

function cartaoResumo(rotulo, valor, quantidade, destaque = false) {
    return `
        <div class="cartao-resumo ${destaque ? 'destaque' : ''}">
            <div class="rotulo">${rotulo}</div>
            <div class="valor">${formatarMoeda(valor)}</div>
            ${quantidade !== undefined ? `<div class="qtd">${quantidade} lançamento(s)</div>` : ''}
        </div>
    `;
}

// ---------- Fechamento diario ----------
// Sugere o Deposito automaticamente (Especie pura, sem Pix - a mesma
// conta que ja era feita manualmente por fora) enquanto ninguem tiver
// salvo um valor de Deposito para este dia ainda. Assim que existir um
// valor salvo (mesmo que seja zero), ou o dia estiver fechado, o sistema
// nunca mais sobrescreve sozinho - quem fecha o caixa sempre pode ajustar
// manualmente antes de salvar/fechar.
let caixaDoDiaFechado = false;

function atualizarSugestaoDeposito() {
    if (depositoJaSalvo || caixaDoDiaFechado) return;
    document.getElementById('deposito').value = ultimoTotalEspeciePura.toFixed(2);
}

async function carregarFechamento() {
    const data = document.getElementById('dataSelecionada').value;
    const refFechamento = doc(db, 'fechamentos', data);
    const snap = await getDoc(refFechamento);
    const fechamento = snap.exists() ? snap.data() : { despesas: 0, despesasObs: '', deposito: null, observacoes: '', status: 'aberto' };

    document.getElementById('despesas').value = fechamento.despesas || '';
    document.getElementById('despesas_obs').value = fechamento.despesasObs || '';
    document.getElementById('observacoes').value = fechamento.observacoes || '';

    const status = fechamento.status || 'aberto';
    caixaDoDiaFechado = status === 'fechado';

    depositoJaSalvo = fechamento.deposito != null;
    if (depositoJaSalvo) {
        document.getElementById('deposito').value = fechamento.deposito;
    } else {
        atualizarSugestaoDeposito();
    }

    const selo = document.getElementById('statusFechamento');
    selo.textContent = status === 'fechado' ? 'Fechado' : 'Aberto';
    selo.className = `status-fechamento ${status}`;
    document.getElementById('btnReabrir').style.display = status === 'fechado' ? 'inline-block' : 'none';
    document.getElementById('btnFecharCaixa').style.display = status === 'fechado' ? 'none' : 'inline-block';
}

document.getElementById('btnSalvarFechamento').addEventListener('click', async () => {
    const data = document.getElementById('dataSelecionada').value;
    try {
        await setDoc(doc(db, 'fechamentos', data), {
            despesas: parseFloat(document.getElementById('despesas').value) || 0,
            despesasObs: document.getElementById('despesas_obs').value.trim(),
            deposito: document.getElementById('deposito').value ? parseFloat(document.getElementById('deposito').value) : null,
            observacoes: document.getElementById('observacoes').value.trim()
        }, { merge: true });
        mostrarOk('Fechamento salvo.');
    } catch (e) {
        mostrarErro('Não foi possível salvar: ' + e.message);
    }
});

document.getElementById('btnFecharCaixa').addEventListener('click', async () => {
    if (!confirm('Fechar o caixa deste dia e liberar para depósito?')) return;
    const data = document.getElementById('dataSelecionada').value;
    try {
        // Salva tambem despesas/deposito/observacoes junto com o fechamento -
        // assim, mesmo que a pessoa nao tenha clicado em "Salvar" antes, o
        // valor de Deposito mostrado na tela (que pode ser so a sugestao
        // automatica, ainda nao salva) fica registrado de verdade.
        await setDoc(doc(db, 'fechamentos', data), {
            despesas: parseFloat(document.getElementById('despesas').value) || 0,
            despesasObs: document.getElementById('despesas_obs').value.trim(),
            deposito: document.getElementById('deposito').value ? parseFloat(document.getElementById('deposito').value) : null,
            observacoes: document.getElementById('observacoes').value.trim(),
            status: 'fechado',
            fechadoPor: auth.currentUser.uid,
            fechadoEm: new Date().toISOString()
        }, { merge: true });
        mostrarOk('Caixa fechado.');
        carregarFechamento();
    } catch (e) {
        mostrarErro('Não foi possível fechar: ' + e.message);
    }
});

document.getElementById('btnReabrir').addEventListener('click', async () => {
    const data = document.getElementById('dataSelecionada').value;
    try {
        await setDoc(doc(db, 'fechamentos', data), { status: 'aberto' }, { merge: true });
        mostrarOk('Dia reaberto.');
        carregarFechamento();
    } catch (e) {
        mostrarErro('Não foi possível reabrir: ' + e.message);
    }
});

// ---------- Usuarios ----------
async function carregarUsuarios() {
    const snap = await getDocs(collection(db, 'usuarios'));
    const usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    document.getElementById('corpoUsuarios').innerHTML = usuarios.map(u => `
        <tr>
            <td>${u.nome}</td>
            <td>${u.email || '-'}</td>
            <td>${rotuloPerfil(u.perfil)}</td>
            <td>${u.ativo ? '<span class="selo ok">Ativo</span>' : '<span class="selo pendente">Inativo</span>'}</td>
            <td>
                <button class="botao secundario pequeno" data-alternar="${u.id}" data-ativo="${u.ativo}">
                    ${u.ativo ? 'Desativar' : 'Ativar'}
                </button>
            </td>
        </tr>
    `).join('');

    document.querySelectorAll('[data-alternar]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const ativo = btn.dataset.ativo === 'true';
            try {
                await updateDoc(doc(db, 'usuarios', btn.dataset.alternar), { ativo: !ativo });
                carregarUsuarios();
            } catch (e) {
                mostrarErro('Não foi possível alterar: ' + e.message, 'msgErroUsuario');
            }
        });
    });
}

document.getElementById('formUsuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = document.getElementById('novoNome').value.trim();
    const email = document.getElementById('novoEmail').value.trim();
    const senha = document.getElementById('novaSenha').value;
    const perfil = document.getElementById('novoPerfil').value;

    try {
        // Usa o app secundario (criado agora, na hora do uso) para nao
        // derrubar a sessao do administrador.
        const authSecundario = obterAuthSecundario();
        const credencial = await createUserWithEmailAndPassword(authSecundario, email, senha);
        await setDoc(doc(db, 'usuarios', credencial.user.uid), {
            nome, email, perfil, ativo: true, criadoEm: new Date().toISOString()
        });
        await signOut(authSecundario);

        ev.target.reset();
        mostrarOk('Usuário cadastrado.', 'msgOkUsuario');
        carregarUsuarios();
    } catch (e) {
        const mapa = {
            'auth/email-already-in-use': 'Já existe uma conta com esse e-mail.',
            'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
            'auth/invalid-email': 'E-mail inválido.'
        };
        mostrarErro(mapa[e.code] || ('Não foi possível cadastrar: ' + e.message), 'msgErroUsuario');
    }
});
