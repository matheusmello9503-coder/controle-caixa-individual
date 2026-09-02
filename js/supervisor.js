import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { FUSO_HORARIO } from "./firebase-config.js";

let cancelarOuvinteLancamentos = null;
let listaDoDia = [];

function formatarMoeda(valor) {
    return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function iniciais(nome) {
    if (!nome) return '-';
    const partes = nome.trim().split(/\s+/);
    return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase();
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

// ---------- Autenticacao ----------
// O painel de fechamento serve tanto para o perfil supervisor quanto para
// o admin (que tambem pode conferir o fechamento por aqui). Quem nao for
// nenhum dos dois volta para a tela de lancamento.
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
    if (perfil !== 'supervisor' && perfil !== 'admin') {
        window.location.href = 'recepcao.html';
        return;
    }

    document.getElementById('nomeUsuario').textContent = perfilDoc.data().nome;
    document.getElementById('avatarUsuario').textContent = iniciais(perfilDoc.data().nome);
    document.getElementById('dataSelecionada').value = hojeInputStr();

    carregarLancamentosDoDia();
    carregarFechamento();
});

document.getElementById('btnSair').addEventListener('click', async () => {
    if (cancelarOuvinteLancamentos) cancelarOuvinteLancamentos();
    await signOut(auth);
    window.location.href = 'login.html';
});

document.getElementById('dataSelecionada').addEventListener('change', () => {
    carregarLancamentosDoDia();
    carregarFechamento();
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
        mostrarErro('Nao foi possivel carregar os lancamentos: ' + erro.message);
    });
}

function renderizarResumo() {
    const mapaFormas = { Debito: { total: 0, qtd: 0 }, Credito: { total: 0, qtd: 0 }, Especie: { total: 0, qtd: 0 }, Pix: { total: 0, qtd: 0 } };
    const porAtendente = {};
    let totalGeral = 0;

    listaDoDia.forEach(l => {
        mapaFormas[l.formaPagamento].total += l.valor;
        mapaFormas[l.formaPagamento].qtd += 1;
        totalGeral += l.valor;

        if (!porAtendente[l.usuarioNome]) porAtendente[l.usuarioNome] = { total: 0, qtd: 0 };
        porAtendente[l.usuarioNome].total += l.valor;
        porAtendente[l.usuarioNome].qtd += 1;
    });

    const totalCartao = mapaFormas.Debito.total + mapaFormas.Credito.total;

    const grade = document.getElementById('grade-resumo');
    grade.innerHTML = `
        ${cartaoResumo('Debito', mapaFormas.Debito.total, mapaFormas.Debito.qtd)}
        ${cartaoResumo('Credito', mapaFormas.Credito.total, mapaFormas.Credito.qtd)}
        ${cartaoResumo('Especie', mapaFormas.Especie.total, mapaFormas.Especie.qtd)}
        ${cartaoResumo('Pix', mapaFormas.Pix.total, mapaFormas.Pix.qtd)}
        ${cartaoResumo('Total Cartao', totalCartao)}
        ${cartaoResumo('Total Especie', mapaFormas.Especie.total)}
        ${cartaoResumo('Total Pix', mapaFormas.Pix.total)}
        ${cartaoResumo('Total Geral', totalGeral, listaDoDia.length, true)}
    `;

    const pendencias = listaDoDia.filter(l => !l.titulo || !l.tesouraria);
    document.getElementById('corpoPendencias').innerHTML = pendencias.length
        ? pendencias.map(l => `
            <tr class="linha-pendente">
                <td>${l.usuarioNome}</td><td>${l.nomePaciente}</td><td>${l.exame}</td>
                <td>${formatarMoeda(l.valor)}</td><td>${l.formaPagamento}</td>
                <td>${l.titulo || '<span class="selo pendente">Sem titulo</span>'}</td>
                <td>${l.tesouraria ? '<span class="selo ok">Feita</span>' : '<span class="selo pendente">Pendente</span>'}</td>
            </tr>`).join('')
        : '<tr><td colspan="7" style="color:var(--cinza-texto)">Nenhuma pendencia.</td></tr>';

    document.getElementById('corpoAtendentes').innerHTML = Object.entries(porAtendente).map(([nome, v]) => `
        <tr><td>${nome}</td><td>${v.qtd}</td><td>${formatarMoeda(v.total)}</td></tr>
    `).join('') || '<tr><td colspan="3" style="color:var(--cinza-texto)">Sem lancamentos.</td></tr>';

    const todos = [...listaDoDia].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
    let grupoAnteriorTodos = null;
    document.getElementById('corpoTodos').innerHTML = todos.map(l => {
        const mesmoGrupo = l.grupoId && l.grupoId === grupoAnteriorTodos;
        grupoAnteriorTodos = l.grupoId || null;
        return `
        <tr class="${(!l.titulo || !l.tesouraria) ? 'linha-pendente' : ''} ${mesmoGrupo ? 'linha-mesmo-grupo' : 'linha-inicio-grupo'}">
            <td>${l.usuarioNome}</td><td>${mesmoGrupo ? '&#8618;' : l.nomePaciente}</td><td>${l.exame}</td>
            <td>${formatarMoeda(l.valor)}</td><td>${l.formaPagamento}</td>
            <td>${l.titulo || '-'}</td><td>${l.numeroNf || '-'}</td>
            <td>${l.tesouraria ? '<span class="selo ok">Feita</span>' : '<span class="selo pendente">Pendente</span>'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="8" style="color:var(--cinza-texto)">Sem lancamentos.</td></tr>';
}

function cartaoResumo(rotulo, valor, quantidade, destaque = false) {
    return `
        <div class="cartao-resumo ${destaque ? 'destaque' : ''}">
            <div class="rotulo">${rotulo}</div>
            <div class="valor">${formatarMoeda(valor)}</div>
            ${quantidade !== undefined ? `<div class="qtd">${quantidade} lancamento(s)</div>` : ''}
        </div>
    `;
}

// ---------- Fechamento diario ----------
async function carregarFechamento() {
    const data = document.getElementById('dataSelecionada').value;
    const refFechamento = doc(db, 'fechamentos', data);
    const snap = await getDoc(refFechamento);
    const fechamento = snap.exists() ? snap.data() : { despesas: 0, despesasObs: '', deposito: null, observacoes: '', status: 'aberto' };

    document.getElementById('despesas').value = fechamento.despesas || '';
    document.getElementById('despesas_obs').value = fechamento.despesasObs || '';
    document.getElementById('deposito').value = fechamento.deposito ?? '';
    document.getElementById('observacoes').value = fechamento.observacoes || '';

    const status = fechamento.status || 'aberto';
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
        mostrarErro('Nao foi possivel salvar: ' + e.message);
    }
});

document.getElementById('btnFecharCaixa').addEventListener('click', async () => {
    if (!confirm('Fechar o caixa deste dia e liberar para deposito?')) return;
    const data = document.getElementById('dataSelecionada').value;
    try {
        await setDoc(doc(db, 'fechamentos', data), {
            status: 'fechado',
            fechadoPor: auth.currentUser.uid,
            fechadoEm: new Date().toISOString()
        }, { merge: true });
        mostrarOk('Caixa fechado.');
        carregarFechamento();
    } catch (e) {
        mostrarErro('Nao foi possivel fechar: ' + e.message);
    }
});

document.getElementById('btnReabrir').addEventListener('click', async () => {
    const data = document.getElementById('dataSelecionada').value;
    try {
        await setDoc(doc(db, 'fechamentos', data), { status: 'aberto' }, { merge: true });
        mostrarOk('Dia reaberto.');
        carregarFechamento();
    } catch (e) {
        mostrarErro('Nao foi possivel reabrir: ' + e.message);
    }
});
