import { onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db, obterAuthSecundario } from "./firebase-init.js";
import { FUSO_HORARIO } from "./firebase-config.js";
import { montarNavRapida } from "./nav-rapida.js";
import { carregarHistorico, renderizarHistorico } from "./historico.js";
import {
    formatarMoeda, hojeInputStr, mostrarErro, mostrarOk,
    calcularResumo, totaisPorGrupo, ordenarLista,
    gerarArquivoPlanilha, registrarAuditoria
} from "./caixa-compartilhado.js";

let cancelarOuvinteLancamentos = null;
let listaDoDia = [];
// Guarda o total de Especie "pura" (sem Pix) do dia carregado, para poder
// sugerir o Deposito assim que o documento de fechamento tambem estiver
// carregado - os dois vem de fontes assincronas diferentes (listener de
// lancamentos e leitura do fechamento), entao cada um chama
// atualizarSugestaoDeposito() por conta propria quando termina.
let ultimoTotalEspeciePura = 0;
let depositoJaSalvo = false;
let caixaDoDiaFechado = false;

// Quem esta logado agora - usado para assinar os registros de auditoria
// (editar/excluir lancamento) em nome de quem realmente fez a acao.
let usuarioAtual = null;

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

    usuarioAtual = { uid: usuario.uid, perfil: 'admin', nome: perfilDoc.data().nome };
    montarNavRapida({ perfil: 'admin', nome: perfilDoc.data().nome, paginaAtual: 'admin' });
    document.getElementById('dataSelecionada').value = hojeInputStr(FUSO_HORARIO);

    // So busca lancamentos e fechamento do dia (o que a tela abre mostrando).
    // Usuarios, Historico e Auditoria ficam para quando a pessoa realmente
    // abrir aquela aba - evita leituras desnecessarias e deixa a primeira
    // tela pronta mais rapido.
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
    fechamento: { titulo: 'Conferência de caixa', sub: 'Visão consolidada de todos os atendentes' },
    historico: { titulo: 'Histórico', sub: 'Totais e evolução dos últimos dias' },
    auditoria: { titulo: 'Auditoria', sub: 'Quem editou ou excluiu cada lançamento' },
    usuarios: { titulo: 'Usuários', sub: 'Cadastro e permissões de acesso ao sistema' }
};

document.querySelectorAll('.sidebar-link[data-aba]').forEach(aba => {
    aba.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-link[data-aba]').forEach(a => a.classList.remove('ativo'));
        aba.classList.add('ativo');
        const alvo = aba.dataset.aba;
        document.getElementById('abaFechamento').style.display = alvo === 'fechamento' ? 'block' : 'none';
        document.getElementById('abaHistorico').style.display = alvo === 'historico' ? 'block' : 'none';
        document.getElementById('abaAuditoria').style.display = alvo === 'auditoria' ? 'block' : 'none';
        document.getElementById('abaUsuarios').style.display = alvo === 'usuarios' ? 'block' : 'none';
        const info = titulosAba[alvo];
        if (info && tituloAbaEl) {
            tituloAbaEl.innerHTML = `${info.titulo}<span class="sub">${info.sub}</span>`;
        }
        if (alvo === 'historico') {
            atualizarHistorico();
        }
        if (alvo === 'auditoria') {
            carregarAuditoria();
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
    const { mapaFormas, porAtendente, totalGeral, totalCartao, especieComPix, especieComPixQtd, especiePura } = calcularResumo(listaDoDia);
    ultimoTotalEspeciePura = especiePura;

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

// Mesma ordenacao usada na tabela na tela - reaproveitada tambem na
// exportacao da planilha, para o arquivo sair na mesma ordem que a pessoa
// esta vendo no momento.
function obterListaTodosOrdenada() {
    return ordenarLista(listaDoDia, ordenacaoTodosCampo, ordenacaoTodosDirecao);
}

function renderizarTabelaTodos() {
    const todos = obterListaTodosOrdenada();

    // O agrupamento visual (seta "->" para o mesmo atendimento) so faz
    // sentido quando a ordem e a de criacao - com ordenacao customizada, os
    // lancamentos do mesmo grupoId podem nao ficar mais adjacentes.
    const agruparVisualmente = !ordenacaoTodosCampo;
    let grupoAnteriorTodos = null;
    const { somaPorGrupo, qtdPorGrupo } = totaisPorGrupo(todos);

    document.getElementById('corpoTodos').innerHTML = todos.map((l, indice) => {
        const mesmoGrupo = agruparVisualmente && l.grupoId && l.grupoId === grupoAnteriorTodos;
        grupoAnteriorTodos = l.grupoId || null;

        const linha = `
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

        // ANEXO 1: ao fechar o grupo (proximo lancamento e de outro
        // atendimento, ou este e o ultimo), soma tudo numa linha de
        // subtotal - so quando a lista segue na ordem de criacao (mesma
        // condicao do agrupamento visual) e o grupo teve mais de 1 exame.
        const proximo = todos[indice + 1];
        const fechandoGrupo = agruparVisualmente && l.grupoId && (!proximo || proximo.grupoId !== l.grupoId);
        const linhaSubtotal = (fechandoGrupo && qtdPorGrupo[l.grupoId] > 1) ? `
        <tr class="linha-subtotal-grupo">
            <td colspan="3" class="rotulo-subtotal-grupo">Total do atendimento (${qtdPorGrupo[l.grupoId]} exames)</td>
            <td colspan="6">${formatarMoeda(somaPorGrupo[l.grupoId])}</td>
        </tr>` : '';

        return linha + linhaSubtotal;
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
// ser qualquer data, passada ou futura). Toda edicao/exclusao feita aqui
// grava tambem um registro de auditoria (quem, quando, o que mudou).
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
    const antes = listaDoDia.find(x => x.id === id);

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

    const depois = { nomePaciente, exame, valor, formaPagamento, titulo, numeroNf, tesouraria };
    try {
        await updateDoc(doc(db, 'lancamentos', id), depois);
        await registrarAuditoria(db, { acao: 'editar', lancamentoId: id, antes, depois, quem: usuarioAtual });
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
        await registrarAuditoria(db, { acao: 'excluir', lancamentoId: id, antes: l, depois: null, quem: usuarioAtual });
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
// O usuario escolhe um periodo (data inicial e final) no modal de exportar;
// buscamos todos os lancamentos desse intervalo direto no Firestore (sem
// depender do listener do dia unico que alimenta o resto da tela) e usamos
// o gerador compartilhado (caixa-compartilhado.js) para montar o arquivo.
const modalExportarPlanilha = document.getElementById('modalExportarPlanilha');
const formExportarPlanilha = document.getElementById('formExportarPlanilha');
const msgErroExportar = document.getElementById('msgErroExportar');
const btnConfirmarExportar = document.getElementById('btnConfirmarExportar');

function abrirModalExportar() {
    if (typeof XLSX === 'undefined') {
        mostrarErro('Não foi possível carregar a ferramenta de planilha (verifique sua conexão com a internet e tente novamente).');
        return;
    }
    const data = document.getElementById('dataSelecionada').value;
    document.getElementById('exportarDataInicio').value = data;
    document.getElementById('exportarDataFim').value = data;
    msgErroExportar.textContent = '';
    modalExportarPlanilha.style.display = 'flex';
}

function fecharModalExportar() {
    modalExportarPlanilha.style.display = 'none';
}

document.getElementById('btnExportarPlanilha').addEventListener('click', abrirModalExportar);
document.getElementById('btnCancelarExportar').addEventListener('click', fecharModalExportar);
modalExportarPlanilha.addEventListener('click', (ev) => {
    if (ev.target === modalExportarPlanilha) fecharModalExportar();
});

formExportarPlanilha.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msgErroExportar.textContent = '';

    const inicio = document.getElementById('exportarDataInicio').value;
    const fim = document.getElementById('exportarDataFim').value;

    if (!inicio || !fim) {
        msgErroExportar.textContent = 'Escolha as duas datas.';
        return;
    }
    if (inicio > fim) {
        msgErroExportar.textContent = 'A data inicial não pode ser depois da data final.';
        return;
    }

    btnConfirmarExportar.disabled = true;
    btnConfirmarExportar.textContent = 'Gerando...';
    try {
        const qPeriodo = query(
            collection(db, 'lancamentos'),
            where('data', '>=', inicio),
            where('data', '<=', fim)
        );
        const snap = await getDocs(qPeriodo);
        const lista = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
                if (a.data !== b.data) return a.data < b.data ? -1 : 1;
                const ta = a.criadoEm?.toMillis ? a.criadoEm.toMillis() : 0;
                const tb = b.criadoEm?.toMillis ? b.criadoEm.toMillis() : 0;
                return ta - tb;
            });

        const nomeArquivo = inicio === fim
            ? `cerdil_caixa_${inicio}.xlsx`
            : `cerdil_caixa_${inicio}_a_${fim}.xlsx`;
        gerarArquivoPlanilha(lista, nomeArquivo);
        fecharModalExportar();
    } catch (erro) {
        console.error('Erro ao exportar planilha do período:', erro);
        msgErroExportar.textContent = 'Não foi possível gerar a planilha. Tente novamente.';
    } finally {
        btnConfirmarExportar.disabled = false;
        btnConfirmarExportar.textContent = 'Gerar planilha (.xlsx)';
    }
});

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

// ---------- Auditoria ----------
// Mostra os ultimos registros de edicao/exclusao de lancamentos, mais
// recentes primeiro. So carrega quando a aba e aberta (a mesma logica ja
// usada para Historico e Usuarios), para nao pagar essa leitura em toda
// carga de pagina.
const NOMES_CAMPO_AUDITORIA = {
    nomePaciente: 'Paciente', exame: 'Exame', valor: 'Valor', formaPagamento: 'Pagamento',
    titulo: 'Título', numeroNf: 'Nº NF', tesouraria: 'Tesouraria'
};

function formatarValorAuditoria(campo, valor) {
    if (valor === null || valor === undefined || valor === '') return '-';
    if (campo === 'valor') return formatarMoeda(valor);
    if (campo === 'tesouraria') return valor ? 'Feita' : 'Pendente';
    return String(valor);
}

function formatarMudancas(mudancas) {
    const entradas = Object.entries(mudancas || {});
    if (!entradas.length) return '<span style="color:var(--cinza-texto)">-</span>';
    return entradas.map(([campo, { de, para }]) => {
        const rotulo = NOMES_CAMPO_AUDITORIA[campo] || campo;
        return `<div><strong>${rotulo}:</strong> ${formatarValorAuditoria(campo, de)} &rarr; ${formatarValorAuditoria(campo, para)}</div>`;
    }).join('');
}

function formatarQuandoAuditoria(registro) {
    const millis = registro.quando?.toMillis ? registro.quando.toMillis() : null;
    if (!millis) return '-';
    return new Date(millis).toLocaleString('pt-BR', { timeZone: FUSO_HORARIO });
}

async function carregarAuditoria() {
    const corpo = document.getElementById('corpoAuditoria');
    corpo.innerHTML = '<tr><td colspan="5" style="color:var(--cinza-texto)">Carregando...</td></tr>';
    try {
        const q = query(collection(db, 'auditoria'), orderBy('quando', 'desc'), limit(100));
        const snap = await getDocs(q);
        const registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        corpo.innerHTML = registros.length ? registros.map(r => `
            <tr>
                <td>${formatarQuandoAuditoria(r)}</td>
                <td>${r.usuarioNome || '-'} <span class="selo" style="font-size:10px">${rotuloPerfil(r.usuarioPerfil)}</span></td>
                <td>${r.acao === 'excluir' ? '<span class="selo pendente">Excluído</span>' : '<span class="selo ok">Editado</span>'}</td>
                <td>${r.lancamentoResumo || '-'}</td>
                <td>${formatarMudancas(r.mudancas)}</td>
            </tr>
        `).join('') : '<tr><td colspan="5" style="color:var(--cinza-texto)">Nenhum registro de auditoria ainda.</td></tr>';
    } catch (e) {
        corpo.innerHTML = `<tr><td colspan="5" class="erro mostrar" style="position:static">Não foi possível carregar a auditoria: ${e.message}</td></tr>`;
    }
}

document.getElementById('btnAtualizarAuditoria').addEventListener('click', carregarAuditoria);

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
