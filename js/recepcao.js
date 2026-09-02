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
        mostrarErro(`Fora do horario permitido (${String(HORA_INICIO).padStart(2, '0')}h as ${String(HORA_FIM).padStart(2, '0')}h). Novos lancamentos ficam bloqueados pelo servidor.`);
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
    document.getElementById('btnSalvar').textContent = 'Lancar atendimento';
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

    montarNavRapida({ perfil: usuarioAtual.perfil, nome: usuarioAtual.nome, paginaAtual: 'recepcao' });

    atualizarAvisoHorario();
    setInterval(atualizarAvisoHorario, 60000);

    iniciarOuvintedeLancamentos();
});

function iniciarOuvintedeLancamentos() {
    if (cancelarOuvinte) cancelarOuvinte();

    const hoje = dataLocalStr();
    const q = query(
        collection(db, 'lancamentos'),
        where('usuarioId', '==', usuarioAtual.uid),
        where('data', '==', hoje)
    );

    cancelarOuvinte = onSnapshot(q, (snapshot) => {
        ultimaLista = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        ultimaLista.sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
        renderizarTabela();
    }, (erro) => {
        mostrarErro('Nao foi possivel carregar os atendimentos: ' + erro.message);
    });
}

function renderizarTabela() {
    const corpo = document.getElementById('corpoTabela');
    corpo.innerHTML = '';
    let total = 0;
    let grupoAnterior = null;

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
                <button class="botao secundario pequeno" data-editar="${l.id}">Editar</button>
                <button class="botao perigo pequeno" data-excluir="${l.id}">Excluir</button>
            </td>
        `;
        corpo.appendChild(tr);
    });

    document.getElementById('totalDia').textContent = formatarMoeda(total);

    corpo.querySelectorAll('[data-excluir]').forEach(btn => {
        btn.addEventListener('click', () => excluirLancamento(btn.dataset.excluir));
    });
    corpo.querySelectorAll('[data-editar]').forEach(btn => {
        btn.addEventListener('click', () => editarLancamento(btn.dataset.editar));
    });
}

async function excluirLancamento(id) {
    if (!confirm('Excluir este exame do atendimento? (Isso nao apaga os outros exames do mesmo recebimento, se houver.)')) return;
    try {
        await deleteDoc(doc(db, 'lancamentos', id));
    } catch (e) {
        mostrarErro('Nao foi possivel excluir (' + e.code + '). Verifique se ainda esta dentro do horario permitido.');
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
    document.getElementById('btnSalvar').textContent = 'Salvar edicao deste exame';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('formLancamento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;

    const temHorarioLivre = usuarioAtual.perfil === 'admin' || usuarioAtual.perfil === 'supervisor';
    if (!temHorarioLivre && !dentroDoHorario()) {
        mostrarErro('Fora do horario permitido para lancamentos.');
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
            mostrarOk(exames.length > 1 ? 'Atendimento lancado (' + exames.length + ' exames).' : 'Atendimento lancado.');
            entrarModoNovo();
        }
    } catch (e) {
        mostrarErro('Nao foi possivel salvar (' + e.code + '). Verifique se ainda esta dentro do horario permitido.');
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
