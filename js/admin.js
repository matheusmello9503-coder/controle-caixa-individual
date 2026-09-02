import { onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db, authSecundario } from "./firebase-init.js";
import { FUSO_HORARIO } from "./firebase-config.js";
import { montarNavRapida } from "./nav-rapida.js";
import { carregarHistorico, renderizarHistorico } from "./historico.js";

let cancelarOuvinteLancamentos = null;
let listaDoDia = [];

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
    const mapa = { admin: 'Administrador', supervisor: 'Supervisor', recepcao: 'Recepcao' };
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

    carregarLancamentosDoDia();
    carregarFechamento();
    carregarUsuarios();
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
    fechamento: { titulo: 'Fechamento do dia', sub: 'Visao consolidada de todos os atendentes' },
    historico: { titulo: 'Historico', sub: 'Totais e evolucao dos ultimos dias' },
    usuarios: { titulo: 'Usuarios', sub: 'Cadastro e permissoes de acesso ao sistema' }
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
    });
});

document.getElementById('dataSelecionada').addEventListener('change', () => {
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
                mostrarErro('Nao foi possivel alterar: ' + e.message, 'msgErroUsuario');
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
        // Usa o app secundario para nao derrubar a sessao do administrador
        const credencial = await createUserWithEmailAndPassword(authSecundario, email, senha);
        await setDoc(doc(db, 'usuarios', credencial.user.uid), {
            nome, email, perfil, ativo: true, criadoEm: new Date().toISOString()
        });
        await signOut(authSecundario);

        ev.target.reset();
        mostrarOk('Usuario cadastrado.', 'msgOkUsuario');
        carregarUsuarios();
    } catch (e) {
        const mapa = {
            'auth/email-already-in-use': 'Ja existe uma conta com esse e-mail.',
            'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
            'auth/invalid-email': 'E-mail invalido.'
        };
        mostrarErro(mapa[e.code] || ('Nao foi possivel cadastrar: ' + e.message), 'msgErroUsuario');
    }
});
