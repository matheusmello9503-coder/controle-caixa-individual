// Modulo compartilhado do "Historico" (dashboard de varios dias), usado
// tanto pelo painel do administrador quanto pelo do supervisor.
//
// Performance: em vez de carregar TODOS os lancamentos de todos os dias
// (o que ficaria cada vez mais pesado com o tempo), fazemos uma unica
// consulta por periodo, filtrando o campo "data" (string "AAAA-MM-DD") por
// intervalo - o Firestore usa esse filtro com um indice simples e
// automatico, e o volume de dados trafegado fica limitado ao periodo
// escolhido (7/30/90 dias), nao ao historico inteiro.
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { FUSO_HORARIO } from "./firebase-config.js";

function formatarMoeda(valor) {
    return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarMoedaCompacta(valor) {
    const v = valor || 0;
    if (v >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    return formatarMoeda(v);
}

function dataLocalStr(offsetDias = 0) {
    const agora = new Date();
    agora.setDate(agora.getDate() + offsetDias);
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_HORARIO, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(agora);
    const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function formatarDataCurta(dataStr) {
    const [, m, d] = dataStr.split('-');
    return `${d}/${m}`;
}

let cacheHistorico = { dias: null, dados: null };

// Carrega o periodo (quantidade de dias) pedido: uma unica query de
// lancamentos no intervalo + os documentos de fechamento de cada dia
// (rapidos, feitos em paralelo, ja que sao poucos - no maximo 90 leituras
// pequenas por doc, bem mais leve que reler todos os lancamentos).
export async function carregarHistorico(dias) {
    if (cacheHistorico.dias === dias) return cacheHistorico.dados;

    const dataInicio = dataLocalStr(-(dias - 1));
    const dataFim = dataLocalStr(0);

    const q = query(
        collection(db, 'lancamentos'),
        where('data', '>=', dataInicio),
        where('data', '<=', dataFim)
    );
    const snap = await getDocs(q);

    const porDia = {};
    for (let i = 0; i < dias; i++) {
        const d = dataLocalStr(-(dias - 1 - i));
        porDia[d] = { data: d, total: 0, qtd: 0, status: 'aberto', despesas: 0, deposito: null };
    }

    snap.forEach(docSnap => {
        const l = docSnap.data();
        if (porDia[l.data]) {
            porDia[l.data].total += l.valor || 0;
            porDia[l.data].qtd += 1;
        }
    });

    // Fechamentos: busca so os dias que tiveram algum lancamento OU podem
    // estar fechados sem lancamento nenhum (caso raro, mas a consulta e
    // barata pois sao poucos documentos, um por dia do periodo).
    const diasArr = Object.keys(porDia);
    await Promise.all(diasArr.map(async (d) => {
        const snapFechamento = await getDoc(doc(db, 'fechamentos', d));
        if (snapFechamento.exists()) {
            const f = snapFechamento.data();
            porDia[d].status = f.status || 'aberto';
            porDia[d].despesas = f.despesas || 0;
            porDia[d].deposito = f.deposito ?? null;
        }
    }));

    const dados = diasArr.map(d => porDia[d]);
    cacheHistorico = { dias, dados };
    return dados;
}

export function limparCacheHistorico() {
    cacheHistorico = { dias: null, dados: null };
}

export function renderizarHistorico(dados, { idGrade, idGrafico, idTabela }) {
    const totalPeriodo = dados.reduce((s, d) => s + d.total, 0);
    const qtdPeriodo = dados.reduce((s, d) => s + d.qtd, 0);
    const mediaDiaria = dados.length ? totalPeriodo / dados.length : 0;
    const diasFechados = dados.filter(d => d.status === 'fechado').length;
    const melhorDia = dados.reduce((max, d) => d.total > (max?.total || 0) ? d : max, null);

    const grade = document.getElementById(idGrade);
    if (grade) {
        grade.innerHTML = `
            <div class="cartao-resumo destaque">
                <div class="rotulo">Total do per&iacute;odo</div>
                <div class="valor">${formatarMoeda(totalPeriodo)}</div>
                <div class="qtd">${qtdPeriodo} lancamento(s)</div>
            </div>
            <div class="cartao-resumo">
                <div class="rotulo">M&eacute;dia di&aacute;ria</div>
                <div class="valor">${formatarMoeda(mediaDiaria)}</div>
            </div>
            <div class="cartao-resumo">
                <div class="rotulo">Melhor dia</div>
                <div class="valor">${melhorDia ? formatarMoeda(melhorDia.total) : '-'}</div>
                <div class="qtd">${melhorDia ? formatarDataCurta(melhorDia.data) : ''}</div>
            </div>
            <div class="cartao-resumo">
                <div class="rotulo">Dias fechados</div>
                <div class="valor">${diasFechados} / ${dados.length}</div>
            </div>
        `;
    }

    const grafico = document.getElementById(idGrafico);
    if (grafico) {
        const maiorValor = Math.max(...dados.map(d => d.total), 1);
        grafico.innerHTML = dados.map(d => {
            const alturaPct = Math.max((d.total / maiorValor) * 100, 2);
            return `
                <div class="barra-dia" title="${formatarDataCurta(d.data)}: ${formatarMoeda(d.total)} (${d.qtd} lancamento(s))">
                    <span class="valor-dia">${d.total > 0 ? formatarMoedaCompacta(d.total) : ''}</span>
                    <div class="coluna ${d.status === 'fechado' ? 'fechado' : ''}" style="height:${alturaPct}%"></div>
                    <span class="rotulo-dia">${formatarDataCurta(d.data)}</span>
                </div>
            `;
        }).join('');
    }

    const tabela = document.getElementById(idTabela);
    if (tabela) {
        const linhas = [...dados].reverse();
        tabela.innerHTML = linhas.map(d => `
            <tr>
                <td>${formatarDataCurta(d.data)}</td>
                <td>${d.status === 'fechado' ? '<span class="selo ok">Fechado</span>' : '<span class="selo pendente">Aberto</span>'}</td>
                <td>${d.qtd}</td>
                <td>${formatarMoeda(d.total)}</td>
                <td>${d.despesas ? formatarMoeda(d.despesas) : '-'}</td>
                <td>${d.deposito != null ? formatarMoeda(d.deposito) : '-'}</td>
            </tr>
        `).join('') || '<tr><td colspan="6" style="color:var(--cinza-texto)">Sem dados no periodo.</td></tr>';
    }
}
