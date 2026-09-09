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
// So e possivel LANCAR um atendimento novo no dia de hoje. Ja EDITAR/EXCLUIR
// um lancamento existente e permitido em hoje OU ontem (no maximo 1 dia
// atras) - o firestore.rules ja aplica essa mesma regra no servidor (por
// data local, nao por um numero fixo de horas); aqui a tela so espelha isso
// para ficar claro o motivo, em vez de a pessoa tentar e levar um erro de
// permissao sem entender.
function dataEstaSelecionada() {
    return document.getElementById('dataSelecionada').value;
}
function estaVendoHoje() {
    return dataEstaSelecionada() === dataLocalStr();
}
function estaVendoHojeOuOntem() {
    const hoje = new Date(dataLocalStr() + 'T00:00:00');
    const selecionada = new Date(dataEstaSelecionada() + 'T00:00:00');
    const diffDias = Math.round((hoje - selecionada) / (24 * 60 * 60 * 1000));
    return diffDias === 0 || diffDias === 1;
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
        }
    });
    listaExames.appendChild(fragmento);
}

document.getElementById('btnAddExame').addEventListener('click', adicionarLinhaExame);

function limparLinhasExame() {
    listaExames.innerHTML = '';
    adicionarLinhaExame();
}

function entrarModoNovo() {
    delete document.getElementById('formLancamento').dataset.editandoId;
    document.getElementById('btnSalvar').textContent = 'Lançar atendimento';
    document.getElementById('btnAddExame').style.display = 'inline-block';
    document.getElementById('labelModoEdicao').style.display = 'none';
    document.getElementById('numero_nf').parentElement.querySelector('label').textContent = 'N\u00ba NF (do recebimento)';
    document.getElementById('tesouraria').parentElement.querySelector('label').textContent = 'Tesouraria feita (recebimento inteiro)';
    limparLinhasExame();
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
// titulos da tela, conforme a data selecionada e ou nao o dia de hoje.
// Lancar um atendimento NOVO so e possivel hoje; editar/excluir um
// lancamento existente e permitido tambem no dia anterior (o aviso muda de
// texto para deixar essa diferenca clara).
function atualizarModoSomenteLeitura() {
    const vendoHoje = estaVendoHoje();
    const podeEditar = estaVendoHojeOuOntem();
    document.getElementById('formLancamento').style.display = vendoHoje ? 'block' : 'none';

    const aviso = document.getElementById('avisoDataPassada');
    aviso.style.display = vendoHoje ? 'none' : 'block';
    aviso.textContent = podeEditar
        ? 'Você está vendo o dia anterior. Ainda é possível editar ou excluir esses atendimentos, mas só é possível lançar um atendimento novo no dia de hoje.'
        : 'Você está vendo um dia diferente de hoje/ontem. Este período fica disponível somente para consulta.';

    const dataFormatada = new Date(dataEstaSelecionada() + 'T00:00:00').toLocaleDateString('pt-BR');
    document.getElementById('tituloTabelaAtendimentos').textContent = vendoHoje
        ? 'Meus atendimentos de hoje'
        : `Meus atendimentos de ${dataFormatada}`;
    document.getElementById('tituloTopbar').childNodes[0].textContent = vendoHoje
        ? 'Meus atendimentos '
        : 'Atendimentos de ' + dataFormatada + ' ';

    if (!vendoHoje) entrarModoNovo();
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

function renderizarTabela() {
    renderizarResumoHero();
    const corpo = document.getElementById('corpoTabela');
    corpo.innerHTML = '';
    let total = 0;
    let grupoAnterior = null;
    // So e possivel editar/excluir em hoje ou ontem (o firestore.rules
    // bloqueia o resto no servidor); em dias mais antigos a tabela fica so
    // para consulta, sem mostrar botoes que iriam falhar se clicados.
    const podeEditar = estaVendoHojeOuOntem();

    ultimaLista.forEach(l => {
        total += l.valor;
        const tr = document.createElement('tr');
        const pendente = !l.titulo || !l.tesouraria;
        if (pendente) tr.classList.add('linha-pendente');

        const mesmoGrupoDoAnterior = l.grupoId && l.grupoId === grupoAnterior;
        tr.classList.add(mesmoGrupoDoAnterior ? 'linha-mesmo-grupo' : 'linha-inicio-grupo');
        grupoAnterior = l.grupoId || null;

        tr.innerHTML = `
            <td>${mesmoGrupoDoAnterior ? '&#8618;' : l.nomePaciente}</td>
            <td>${l.exame}</td>
            <td>${formatarMoeda(l.valor)}</td>
            <td>${l.formaPagamento}</td>
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
        mostrarErro('Não foi possível excluir (' + e.code + '). Verifique se ainda está dentro do horário permitido e se o lançamento não é mais antigo que ontem.');
    }
}

function editarLancamento(id) {
    const l = ultimaLista.find(x => x.id === id);
    if (!l) return;

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
    const formaPagamento = document.getElementById('forma_pagamento').value;
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
            // exames do mesmo recebimento automaticamente).
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
            // pagamento/NF/tesouraria, agrupados por um grupoId em comum.
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
            const hoje = dataLocalStr();
            const lote = writeBatch(db);

            exames.forEach(e => {
                const novaRef = doc(collection(db, 'lancamentos'));
                lote.set(novaRef, {
                    usuarioId: usuarioAtual.uid,
                    usuarioNome: usuarioAtual.nome,
                    data: hoje,
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
        mostrarErro('Não foi possível salvar (' + e.code + '). Verifique se ainda está dentro do horário permitido e se o lançamento não é mais antigo que ontem.');
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
