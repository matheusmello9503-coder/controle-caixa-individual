import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, collection, query, where, onSnapshot,
    writeBatch, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { FUSO_HORARIO, HORA_INICIO, HORA_FIM } from "./firebase-config.js";
import { montarNavRapida } from "./nav-rapida.js";

let usuarioAtual = null;
let cancelarOuvinte = null;
let ultimaLista = [];

function formatarMoeda(valor) {
    return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataLocalStr() {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_HORARIO, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date());
    const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

// Data que a tela esta exibindo no momento (segue o campo "Data" no topo).
// Tanto LANCAR um atendimento novo quanto EDITAR/EXCLUIR um existente sao
// permitidos dentro da mesma janela: hoje ou ate 3 dias atras (nunca no
// futuro) - o firestore.rules ja aplica essa mesma regra no servidor (por
// data local, nao por um numero fixo de horas); aqui a tela so espelha isso
// para ficar claro o motivo, em vez de a pessoa tentar e levar um erro de
// permissao sem entender. Essa janela existe para cobrir situacoes como uma
// queda de energia que impede fechar os lancamentos no dia certo.
const JANELA_DIAS_LANCAMENTO = 3;

function dataEstaSelecionada() {
    return document.getElementById('dataSelecionada').value;
}
function diferencaDiasDaSelecionada() {
    const hoje = new Date(dataLocalStr() + 'T00:00:00');
    const selecionada = new Date(dataEstaSelecionada() + 'T00:00:00');
    return Math.round((hoje - selecionada) / (24 * 60 * 60 * 1000));
}
function estaVendoHoje() {
    return dataEstaSelecionada() === dataLocalStr();
}
function dentroDaJanelaDeLancamento() {
    const diffDias = diferencaDiasDaSelecionada();
    return diffDias >= 0 && diffDias <= JANELA_DIAS_LANCAMENTO;
}

function horaLocalAtual() {
    const texto = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_HORARIO, hour: '2-digit', hour12: false }).format(new Date());
    return parseInt(texto, 10) % 24;
}

function dentroDoHorario() {
    const h = horaLocalAtual();
    return h >= HORA_INICIO && h < HORA_FIM;
}

function mostrarErro(texto) {
    const el = document.getElementById('msgErro');
    el.textContent = texto;
    el.classList.add('mostrar');
    setTimeout(() => el.classList.remove('mostrar'), 6000);
}
function mostrarOk(texto) {
    const el = document.getElementById('msgOk');
    el.textContent = texto;
    el.classList.add('mostrar');
    setTimeout(() => el.classList.remove('mostrar'), 3000);
}

function atualizarAvisoHorario() {
    if (usuarioAtual && (usuarioAtual.perfil === 'admin' || usuarioAtual.perfil === 'supervisor')) return;
    const btn = document.getElementById('btnSalvar');
    if (!dentroDoHorario()) {
        btn.disabled = true;
        mostrarErro(`Fora do horário permitido (${String(HORA_INICIO).padStart(2, '0')}h às ${String(HORA_FIM).padStart(2, '0')}h). Novos lançamentos ficam bloqueados pelo servidor.`);
    } else {
        btn.disabled = false;
    }
}

// ---------- Linhas de exame (formulario de novo atendimento) ----------
const listaExames = document.getElementById('listaExames');
const modeloLinhaExame = document.getElementById('modeloLinhaExame');

function adicionarLinhaExame() {
    const fragmento = modeloLinhaExame.content.cloneNode(true);
    const linha = fragmento.querySelector('.linha-exame');
    linha.querySelector('.botao-remover-exame').addEventListener('click', () => {
        if (listaExames.querySelectorAll('.linha-exame').length > 1) {
            linha.remove();
            atualizarResumoPagamentoDividido();
        }
    });
    linha.querySelector('.campo-valor').addEventListener('input', atualizarResumoPagamentoDividido);
    listaExames.appendChild(fragmento);
}

document.getElementById('btnAddExame').addEventListener('click', () => {
    adicionarLinhaExame();
    atualizarResumoPagamentoDividido();
});

function limparLinhasExame() {
    listaExames.innerHTML = '';
    adicionarLinhaExame();
}

// ---------- Pagamento dividido (mais de uma forma no mesmo atendimento) ----------
// Em vez de escolher UMA forma de pagamento para o atendimento inteiro, a
// pessoa pode abrir este modo e informar varias formas com seus respectivos
// valores (ex: R$150 em Especie + R$150 no Debito). A soma precisa bater
// com o total dos exames antes de deixar salvar. Ao salvar, isso vira mais
// de um lancamento no banco (um por forma de pagamento), todos com o mesmo
// grupoId - o mesmo mecanismo ja usado para "varios exames no mesmo
// atendimento" - assim o fechamento do dia (admin/supervisor) soma cada
// parte na sua forma automaticamente, sem precisar de nenhuma mudanca la.
const listaPagamentosDivididos = document.getElementById('listaPagamentosDivididos');
const modeloLinhaPagamento = document.getElementById('modeloLinhaPagamento');
const painelPagamentoDividido = document.getElementById('painelPagamentoDividido');
const campoFormaPagamentoUnica = document.getElementById('forma_pagamento');

function pagamentoEstaDividido() {
    return painelPagamentoDividido.style.display !== 'none';
}

function adicionarLinhaPagamento(forma, valor) {
    const fragmento = modeloLinhaPagamento.content.cloneNode(true);
    const linha = fragmento.querySelector('.linha-pagamento-dividido');
    if (forma) linha.querySelector('.campo-forma-dividida').value = forma;
    if (valor !== undefined) linha.querySelector('.campo-valor-dividido').value = valor;
    linha.querySelector('.campo-valor-dividido').addEventListener('input', atualizarResumoPagamentoDividido);
    linha.querySelector('.campo-forma-dividida').addEventListener('change', atualizarResumoPagamentoDividido);
    linha.querySelector('.botao-remover-pagamento').addEventListener('click', () => {
        if (listaPagamentosDivididos.querySelectorAll('.linha-pagamento-dividido').length > 1) {
            linha.remove();
            atualizarResumoPagamentoDividido();
        }
    });
    listaPagamentosDivididos.appendChild(fragmento);
}

function totalDosExames() {
    return Array.from(listaExames.querySelectorAll('.campo-valor'))
        .reduce((s, input) => s + (parseFloat(input.value) || 0), 0);
}

function totalDosPagamentosDivididos() {
    return Array.from(listaPagamentosDivididos.querySelectorAll('.campo-valor-dividido'))
        .reduce((s, input) => s + (parseFloat(input.value) || 0), 0);
}

// Retorna null se a soma bater com o total dos exames (dentro de 1 centavo,
// por causa de arredondamento de ponto flutuante); senao, a diferenca (>0
// significa que falta, <0 significa que passou), para a mensagem saber o
// que dizer.
function diferencaPagamentoDividido() {
    const diff = totalDosExames() - totalDosPagamentosDivididos();
    if (Math.abs(diff) < 0.01) return null;
    return diff;
}

function atualizarResumoPagamentoDividido() {
    if (!pagamentoEstaDividido()) return;
    const resumo = document.getElementById('resumoPagamentoDividido');
    const diff = diferencaPagamentoDividido();
    if (diff === null) {
        resumo.textContent = 'Soma confere com o total dos exames.';
        resumo.classList.remove('resumo-pagamento-dividido-erro');
        resumo.classList.add('resumo-pagamento-dividido-ok');
    } else if (diff > 0) {
        resumo.textContent = `Falta ${formatarMoeda(diff)} para completar o total dos exames.`;
        resumo.classList.remove('resumo-pagamento-dividido-ok');
        resumo.classList.add('resumo-pagamento-dividido-erro');
    } else {
        resumo.textContent = `A soma está passando o total dos exames em ${formatarMoeda(-diff)}.`;
        resumo.classList.remove('resumo-pagamento-dividido-ok');
        resumo.classList.add('resumo-pagamento-dividido-erro');
    }
}

function entrarModoPagamentoDividido() {
    painelPagamentoDividido.style.display = 'block';
    document.getElementById('btnPagamentoDividido').style.display = 'none';
    campoFormaPagamentoUnica.parentElement.style.display = 'none';
    campoFormaPagamentoUnica.required = false;
    listaPagamentosDivididos.innerHTML = '';
    adicionarLinhaPagamento();
    atualizarResumoPagamentoDividido();
}

function sairModoPagamentoDividido() {
    painelPagamentoDividido.style.display = 'none';
    document.getElementById('btnPagamentoDividido').style.display = 'inline-block';
    campoFormaPagamentoUnica.parentElement.style.display = '';
    campoFormaPagamentoUnica.required = true;
    listaPagamentosDivididos.innerHTML = '';
}

document.getElementById('btnPagamentoDividido').addEventListener('click', entrarModoPagamentoDividido);
document.getElementById('btnCancelarPagamentoDividido').addEventListener('click', sairModoPagamentoDividido);
document.getElementById('btnAddPagamento').addEventListener('click', () => {
    adicionarLinhaPagamento();
    atualizarResumoPagamentoDividido();
});

function entrarModoNovo() {
    delete document.getElementById('formLancamento').dataset.editandoId;
    document.getElementById('btnSalvar').textContent = 'Lançar atendimento';
    document.getElementById('btnAddExame').style.display = 'inline-block';
    document.getElementById('btnPagamentoDividido').style.display = pagamentoEstaDividido() ? 'none' : 'inline-block';
    document.getElementById('labelModoEdicao').style.display = 'none';
    document.getElementById('numero_nf').parentElement.querySelector('label').textContent = 'N\u00ba NF (do recebimento)';
    document.getElementById('tesouraria').parentElement.querySelector('label').textContent = 'Tesouraria feita (recebimento inteiro)';
    limparLinhasExame();
    sairModoPagamentoDividido();
    document.getElementById('formLancamento').reset();
}

limparLinhasExame();

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
    // Admin pode usar esta tela tambem (para lancar atendimentos pessoalmente),
    // alem do painel administrativo. A recepcao inativa ja foi barrada acima.

    usuarioAtual = { uid: usuario.uid, ...perfilDoc.data() };
    document.getElementById('dataHoje').textContent = new Date().toLocaleDateString('pt-BR', { timeZone: FUSO_HORARIO });
    document.getElementById('dataSelecionada').value = dataLocalStr();

    montarNavRapida({ perfil: usuarioAtual.perfil, nome: usuarioAtual.nome, paginaAtual: 'recepcao' });

    atualizarAvisoHorario();
    atualizarModoSomenteLeitura();
    setInterval(atualizarAvisoHorario, 60000);

    iniciarOuvintedeLancamentos();
});

document.getElementById('dataSelecionada').addEventListener('change', () => {
    atualizarModoSomenteLeitura();
    iniciarOuvintedeLancamentos();
});

document.getElementById('btnDataHoje').addEventListener('click', () => {
    document.getElementById('dataSelecionada').value = dataLocalStr();
    atualizarModoSomenteLeitura();
    iniciarOuvintedeLancamentos();
});

// Mostra/esconde o formulario de novo atendimento e o aviso, e ajusta os
// titulos da tela, conforme a data selecionada. Lancar um atendimento novo
// e editar/excluir um existente seguem a MESMA janela agora (hoje ou ate 3
// dias atras) - pensada para casos como uma queda de energia que impede
// fechar os lancamentos no dia certo. Fora dessa janela, a tela vira
// somente consulta.
function atualizarModoSomenteLeitura() {
    const vendoHoje = estaVendoHoje();
    const dentroDaJanela = dentroDaJanelaDeLancamento();
    document.getElementById('formLancamento').style.display = dentroDaJanela ? 'block' : 'none';

    const aviso = document.getElementById('avisoDataPassada');
    aviso.style.display = vendoHoje ? 'none' : 'block';
    if (dentroDaJanela) {
        const diffDias = diferencaDiasDaSelecionada();
        aviso.textContent = `Você está lançando um atendimento com data retroativa (${diffDias} dia(s) atrás). Use isso apenas para regularizar atendimentos que não puderam ser lançados no dia certo (ex.: queda de energia). Também é possível editar ou excluir os lançamentos já existentes deste dia.`;
    } else {
        aviso.textContent = `Você está vendo um dia fora da janela de lançamento (mais de ${JANELA_DIAS_LANCAMENTO} dias atrás, ou uma data futura). Este período fica disponível somente para consulta.`;
    }

    const dataFormatada = new Date(dataEstaSelecionada() + 'T00:00:00').toLocaleDateString('pt-BR');
    document.getElementById('tituloTabelaAtendimentos').textContent = vendoHoje
        ? 'Meus atendimentos de hoje'
        : `Meus atendimentos de ${dataFormatada}`;
    document.getElementById('tituloTopbar').childNodes[0].textContent = vendoHoje
        ? 'Meus atendimentos '
        : 'Atendimentos de ' + dataFormatada + ' ';

    entrarModoNovo();
}

function iniciarOuvintedeLancamentos() {
    if (cancelarOuvinte) cancelarOuvinte();

    const dataAlvo = dataEstaSelecionada();
    const q = query(
        collection(db, 'lancamentos'),
        where('usuarioId', '==', usuarioAtual.uid),
        where('data', '==', dataAlvo)
    );

    cancelarOuvinte = onSnapshot(q, (snapshot) => {
        ultimaLista = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        ultimaLista.sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
        renderizarTabela();
    }, (erro) => {
        mostrarErro('Não foi possível carregar os atendimentos: ' + erro.message);
    });
}

function renderizarResumoHero() {
    const grade = document.getElementById('grade-resumo-recepcao');
    if (!grade) return;
    const total = ultimaLista.reduce((s, l) => s + (l.valor || 0), 0);
    const rotulo = estaVendoHoje() ? 'Total lan&ccedil;ado hoje' : 'Total lan&ccedil;ado neste dia';
    grade.innerHTML = `
        <div class="cartao-resumo destaque">
            <div class="rotulo">${rotulo}</div>
            <div class="valor">${formatarMoeda(total)}</div>
            <div class="qtd">${ultimaLista.length} lan&ccedil;amento(s)</div>
        </div>
    `;
}

// ANEXO 1: quando um atendimento tem mais de um exame (mesmo grupoId em
// mais de um lancamento), soma o valor de todas as linhas daquele grupo -
// para mostrar, junto do nome do paciente, o total daquele atendimento
// inteiro. So compensa mostrar quando ha mais de 1 lancamento no grupo;
// com exame unico o valor da propria linha ja E o total.
function totaisPorGrupo(lista) {
    const somaPorGrupo = {};
    const qtdPorGrupo = {};
    lista.forEach(l => {
        if (!l.grupoId) return;
        somaPorGrupo[l.grupoId] = (somaPorGrupo[l.grupoId] || 0) + (l.valor || 0);
        qtdPorGrupo[l.grupoId] = (qtdPorGrupo[l.grupoId] || 0) + 1;
    });
    return { somaPorGrupo, qtdPorGrupo };
}

function renderizarTabela() {
    renderizarResumoHero();
    const corpo = document.getElementById('corpoTabela');
    corpo.innerHTML = '';
    let total = 0;
    let grupoAnterior = null;
    // So e possivel editar/excluir dentro da janela de lancamento (hoje ou
    // ate 3 dias atras - o firestore.rules bloqueia o resto no servidor);
    // fora dela a tabela fica so para consulta, sem mostrar botoes que
    // iriam falhar se clicados.
    const podeEditar = dentroDaJanelaDeLancamento();
    const { somaPorGrupo, qtdPorGrupo } = totaisPorGrupo(ultimaLista);

    ultimaLista.forEach(l => {
        total += l.valor;
        const tr = document.createElement('tr');
        const pendente = !l.titulo || !l.tesouraria;
        if (pendente) tr.classList.add('linha-pendente');

        const mesmoGrupoDoAnterior = l.grupoId && l.grupoId === grupoAnterior;
        tr.classList.add(mesmoGrupoDoAnterior ? 'linha-mesmo-grupo' : 'linha-inicio-grupo');
        grupoAnterior = l.grupoId || null;

        const temMaisDeUmExame = l.grupoId && qtdPorGrupo[l.grupoId] > 1;
        const seloTotalGrupo = (!mesmoGrupoDoAnterior && temMaisDeUmExame)
            ? `<span class="selo-total-grupo" title="Total deste atendimento (${qtdPorGrupo[l.grupoId]} exames)">Total: ${formatarMoeda(somaPorGrupo[l.grupoId])}</span>`
            : '';

        tr.innerHTML = `
            <td>${mesmoGrupoDoAnterior ? '&#8618;' : l.nomePaciente}${seloTotalGrupo}</td>
            <td>${l.exame}</td>
            <td>${formatarMoeda(l.valor)}</td>
            <td>${l.formaPagamento}${l.pagamentoDividido ? ' <span class="selo" style="font-size:10px">dividido</span>' : ''}</td>
            <td>${l.titulo || '-'}</td>
            <td>${l.numeroNf || '-'}</td>
            <td>${l.tesouraria ? '<span class="selo ok">Feita</span>' : '<span class="selo pendente">Pendente</span>'}</td>
            <td>
                ${podeEditar ? `
                    <button class="botao secundario pequeno" data-editar="${l.id}">Editar</button>
                    <button class="botao perigo pequeno" data-excluir="${l.id}">Excluir</button>
                ` : ''}
            </td>
        `;
        corpo.appendChild(tr);
    });

    if (ultimaLista.length === 0) {
        corpo.innerHTML = '<tr><td colspan="8" style="color:var(--cinza-texto)">Nenhum atendimento neste dia.</td></tr>';
    }

    document.getElementById('totalDia').textContent = formatarMoeda(total);

    corpo.querySelectorAll('[data-excluir]').forEach(btn => {
        btn.addEventListener('click', () => excluirLancamento(btn.dataset.excluir));
    });
    corpo.querySelectorAll('[data-editar]').forEach(btn => {
        btn.addEventListener('click', () => editarLancamento(btn.dataset.editar));
    });
}

async function excluirLancamento(id) {
    if (!confirm('Excluir este exame do atendimento? (Isso não apaga os outros exames do mesmo recebimento, se houver.)')) return;
    try {
        await deleteDoc(doc(db, 'lancamentos', id));
    } catch (e) {
        mostrarErro('Não foi possível excluir (' + e.code + '). Verifique se ainda está dentro do horário permitido e se o lançamento não é mais antigo que 3 dias.');
    }
}

function editarLancamento(id) {
    const l = ultimaLista.find(x => x.id === id);
    if (!l) return;

    // Edicao sempre mexe em UM lancamento por vez (um exame, uma forma de
    // pagamento) - por isso o modo de pagamento dividido fica indisponivel
    // aqui, mesmo que o lancamento faca parte de um grupo criado com
    // pagamento dividido.
    sairModoPagamentoDividido();
    document.getElementById('btnPagamentoDividido').style.display = 'none';

    document.getElementById('nome_paciente').value = l.nomePaciente;
    document.getElementById('forma_pagamento').value = l.formaPagamento;
    document.getElementById('numero_nf').value = l.numeroNf || '';
    document.getElementById('tesouraria').checked = !!l.tesouraria;
    document.getElementById('numero_nf').parentElement.querySelector('label').textContent = 'N\u00ba NF';
    document.getElementById('tesouraria').parentElement.querySelector('label').textContent = 'Tesouraria feita';

    listaExames.innerHTML = '';
    adicionarLinhaExame();
    const linha = listaExames.querySelector('.linha-exame');
    linha.querySelector('.campo-exame').value = l.exame;
    linha.querySelector('.campo-valor').value = l.valor;
    linha.querySelector('.campo-titulo').value = l.titulo || '';

    document.getElementById('btnAddExame').style.display = 'none';
    document.getElementById('labelModoEdicao').style.display = 'inline';
    document.getElementById('formLancamento').dataset.editandoId = id;
    document.getElementById('btnSalvar').textContent = 'Salvar edição deste exame';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('formLancamento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;

    const temHorarioLivre = usuarioAtual.perfil === 'admin' || usuarioAtual.perfil === 'supervisor';
    if (!temHorarioLivre && !dentroDoHorario()) {
        mostrarErro('Fora do horário permitido para lançamentos.');
        return;
    }

    const nomePaciente = document.getElementById('nome_paciente').value.trim();
    const numeroNf = document.getElementById('numero_nf').value.trim();
    const tesouraria = document.getElementById('tesouraria').checked;

    if (!nomePaciente) {
        mostrarErro('Informe o nome do paciente.');
        return;
    }

    const editandoId = form.dataset.editandoId;

    try {
        if (editandoId) {
            // Edicao afeta somente o exame desta linha (nao propaga para outros
            // exames do mesmo recebimento automaticamente). Pagamento dividido
            // nao se aplica aqui (o botao fica escondido em modo edicao).
            const formaPagamento = document.getElementById('forma_pagamento').value;
            const linha = listaExames.querySelector('.linha-exame');
            const exame = linha.querySelector('.campo-exame').value;
            const valor = parseFloat(linha.querySelector('.campo-valor').value);
            const titulo = linha.querySelector('.campo-titulo').value.trim();

            if (!exame || isNaN(valor) || valor <= 0) {
                mostrarErro('Preencha exame e valor corretamente.');
                return;
            }

            await updateDoc(doc(db, 'lancamentos', editandoId), {
                nomePaciente, exame, valor, formaPagamento, titulo, numeroNf, tesouraria,
                editadoEm: serverTimestamp()
            });
            mostrarOk('Exame atualizado.');
            entrarModoNovo();
        } else {
            // Novo atendimento: pode ter varios exames, todos com o mesmo
            // pagamento/NF/tesouraria, agrupados por um grupoId em comum -
            // a menos que o pagamento esteja dividido (ver abaixo).
            const linhas = Array.from(listaExames.querySelectorAll('.linha-exame'));
            const exames = linhas.map(linha => ({
                exame: linha.querySelector('.campo-exame').value,
                valor: parseFloat(linha.querySelector('.campo-valor').value),
                titulo: linha.querySelector('.campo-titulo').value.trim()
            }));

            for (const e of exames) {
                if (!e.exame || isNaN(e.valor) || e.valor <= 0) {
                    mostrarErro('Preencha exame e valor em todas as linhas.');
                    return;
                }
            }

            const grupoId = doc(collection(db, 'lancamentos')).id;
            // Usa a data SELECIONADA na tela (nao necessariamente hoje) - e o
            // que permite lancar um atendimento retroativo, dentro da janela
            // de ate 3 dias, quando algo impediu o lancamento no dia certo.
            const dataDoLancamento = dataEstaSelecionada();
            const lote = writeBatch(db);

            if (pagamentoEstaDividido()) {
                // Pagamento dividido: a divisao vale para o atendimento
                // INTEIRO (soma de todos os exames), nao exame por exame - por
                // isso aqui os lancamentos gravados sao, um por forma de
                // pagamento (nao um por exame). O tipo de exame e o titulo de
                // cada lancamento viram a juncao de todos os exames deste
                // atendimento, ja que o valor de cada forma nao corresponde a
                // um exame especifico. O fechamento do dia (admin/supervisor)
                // continua somando certo, porque cada parte entra com sua
                // propria forma de pagamento.
                const linhasPagamento = Array.from(listaPagamentosDivididos.querySelectorAll('.linha-pagamento-dividido'));
                const pagamentos = linhasPagamento.map(linha => ({
                    forma: linha.querySelector('.campo-forma-dividida').value,
                    valor: parseFloat(linha.querySelector('.campo-valor-dividido').value)
                }));

                for (const p of pagamentos) {
                    if (!p.forma || isNaN(p.valor) || p.valor <= 0) {
                        mostrarErro('Preencha a forma e o valor em todas as linhas de pagamento.');
                        return;
                    }
                }

                if (diferencaPagamentoDividido() !== null) {
                    mostrarErro('A soma das formas de pagamento precisa ser igual ao total dos exames antes de salvar.');
                    return;
                }

                const exameConjunto = exames.map(e => e.exame).join(' + ');
                const tituloConjunto = exames.map(e => e.titulo).filter(Boolean).join(' + ');

                pagamentos.forEach(p => {
                    const novaRef = doc(collection(db, 'lancamentos'));
                    lote.set(novaRef, {
                        usuarioId: usuarioAtual.uid,
                        usuarioNome: usuarioAtual.nome,
                        data: dataDoLancamento,
                        nomePaciente,
                        exame: exameConjunto,
                        valor: p.valor,
                        formaPagamento: p.forma,
                        titulo: tituloConjunto,
                        numeroNf,
                        tesouraria,
                        grupoId,
                        pagamentoDividido: true,
                        criadoEm: serverTimestamp(),
                        editadoEm: null
                    });
                });

                await lote.commit();
                mostrarOk('Atendimento lançado (pagamento em ' + pagamentos.length + ' formas).');
                entrarModoNovo();
                return;
            }

            const formaPagamento = document.getElementById('forma_pagamento').value;

            exames.forEach(e => {
                const novaRef = doc(collection(db, 'lancamentos'));
                lote.set(novaRef, {
                    usuarioId: usuarioAtual.uid,
                    usuarioNome: usuarioAtual.nome,
                    data: dataDoLancamento,
                    nomePaciente,
                    exame: e.exame,
                    valor: e.valor,
                    formaPagamento,
                    titulo: e.titulo,
                    numeroNf,
                    tesouraria,
                    grupoId: exames.length > 1 ? grupoId : null,
                    criadoEm: serverTimestamp(),
                    editadoEm: null
                });
            });

            await lote.commit();
            mostrarOk(exames.length > 1 ? 'Atendimento lançado (' + exames.length + ' exames).' : 'Atendimento lançado.');
            entrarModoNovo();
        }
    } catch (e) {
        mostrarErro('Não foi possível salvar (' + e.code + '). Verifique se ainda está dentro do horário permitido e se o lançamento não é mais antigo que 3 dias.');
    }
});

async function sair() {
    if (cancelarOuvinte) cancelarOuvinte();
    await signOut(auth);
    window.location.href = 'login.html';
}

// Registrado uma unica vez, em escopo de modulo (nao dentro do
// onAuthStateChanged, que o Firebase pode disparar mais de uma vez por
// pagina) - evita acumular listeners duplicados no mesmo evento.
document.getElementById('btnSair').addEventListener('click', sair);
document.addEventListener('nav-rapida-sair', sair);
