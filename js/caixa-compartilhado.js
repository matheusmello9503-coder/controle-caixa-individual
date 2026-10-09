// ---------------------------------------------------------------------------
// Modulo compartilhado entre admin.js, supervisor.js e recepcao.js.
//
// Reune a logica que estava DUPLICADA nos tres arquivos (calculo de resumo
// por forma de pagamento, agrupamento de exames do mesmo atendimento,
// ordenacao da tabela, montagem da planilha e o registro de auditoria) -
// assim uma correcao feita aqui vale para as tres telas de uma vez, em vez
// de precisar lembrar de replicar manualmente em cada arquivo (o que ja
// causou divergencia entre admin.js e supervisor.js no passado).
//
// Funcoes daqui sao, propositalmente, o mais "puras" possivel (recebem
// dados, devolvem dados ou strings HTML) - isso facilita testar cada uma
// isoladamente, sem precisar montar a pagina inteira.
// ---------------------------------------------------------------------------

import { doc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- Formatacao ----------
export function formatarMoeda(valor) {
    return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function hojeInputStr(fusoHorario) {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: fusoHorario, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date());
    const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
    return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

// ---------- Acessibilidade: rotulo ligado ao campo ----------
// Linhas repetidas (varios exames, varias formas de pagamento) vem de um
// <template>, entao nao podem ter id fixo no HTML. Esta funcao da um id unico
// a cada campo e liga o <label> a ele (for/id) - sem isso, leitor de tela nao
// diz qual e o campo e clicar no texto do rotulo nao foca o campo.
let contadorRotulos = 0;
export function ligarRotulos(raiz) {
    raiz.querySelectorAll('.campo').forEach(campo => {
        const rotulo = campo.querySelector('label');
        const controle = campo.querySelector('input, select, textarea');
        if (!rotulo || !controle || rotulo.htmlFor) return;
        if (!controle.id) controle.id = `campo-auto-${++contadorRotulos}`;
        rotulo.htmlFor = controle.id;
    });
}

// ---------- Mensagens de tela (erro/sucesso) ----------
// Recebe o id do elemento (cada tela ja tem sua propria div de mensagem no
// HTML) - assim a funcao continua generica, sem precisar saber qual tela a
// chamou.
export function mostrarErro(texto, idEl = 'msgErro') {
    const el = document.getElementById(idEl);
    if (!el) return;
    el.textContent = texto;
    el.classList.add('mostrar');
    setTimeout(() => el.classList.remove('mostrar'), 6000);
}

export function mostrarOk(texto, idEl = 'msgOk') {
    const el = document.getElementById(idEl);
    if (!el) return;
    el.textContent = texto;
    el.classList.add('mostrar');
    setTimeout(() => el.classList.remove('mostrar'), 3000);
}

// ---------- Resumo por forma de pagamento / atendente ----------
// Usado tanto para popular os cartoes de resumo na tela (admin/supervisor)
// quanto para montar a aba "Resumo" da planilha exportada - mesma conta,
// um lugar so, garantindo que tela e planilha NUNCA batam numeros diferentes.
export function calcularResumo(lista) {
    const mapaFormas = { Debito: { total: 0, qtd: 0 }, Credito: { total: 0, qtd: 0 }, Especie: { total: 0, qtd: 0 }, Pix: { total: 0, qtd: 0 } };
    const porAtendente = {};
    let totalGeral = 0;

    lista.forEach(l => {
        // Protecao contra um lancamento com forma de pagamento fora das 4
        // esperadas (dado antigo, editado manualmente no console do
        // Firebase, ou uma futura forma nova ainda nao suportada aqui) - sem
        // isso, um unico lancamento assim travava a tela inteira.
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
    // "Especie" na tela mostra Especie + Pix somados, igual ao Tasy (que
    // lanca o Pix dentro de Especie) - especiePura fica disponivel separado
    // para quem precisar so da parte em dinheiro (ex: sugestao de deposito).
    const especieComPix = mapaFormas.Especie.total + mapaFormas.Pix.total;
    const especieComPixQtd = mapaFormas.Especie.qtd + mapaFormas.Pix.qtd;

    return {
        mapaFormas,
        porAtendente,
        totalGeral,
        totalCartao,
        especieComPix,
        especieComPixQtd,
        especiePura: mapaFormas.Especie.total
    };
}

// ---------- Agrupamento de exames do mesmo atendimento (grupoId) ----------
// Os valores gravados no banco ficam SEM acento ('Debito', 'Especie') - as
// regras do Firestore dependem exatamente dessas 4 palavras. So o que a
// pessoa le na tela ganha acento.
const ROTULOS_FORMA = { Debito: 'Débito', Credito: 'Crédito', Especie: 'Espécie', Pix: 'Pix' };
export function rotuloForma(forma) {
    return ROTULOS_FORMA[forma] || forma || '';
}

// ---------- Despesas do dia ----------
// Total Geral e o que entrou (todos os lancamentos). O "Total liquido" e o
// que sobra depois das despesas pagas no dia - era isso que faltava: o campo
// Despesas era so gravado, nunca entrava em conta nenhuma.
export function totalLiquido(totalGeral, despesas) {
    return (totalGeral || 0) - (despesas || 0);
}

// Deposito sugerido: as despesas do dia sao pagas com o dinheiro do caixa,
// entao saem da Especie pura (sem Pix) antes de depositar. Nunca sugere
// valor negativo (despesa maior que o dinheiro em caixa).
export function sugerirDeposito(especiePura, despesas) {
    return Math.max(0, (especiePura || 0) - (despesas || 0));
}

export function totaisPorGrupo(lista) {
    const somaPorGrupo = {};
    const qtdPorGrupo = {};
    lista.forEach(l => {
        if (!l.grupoId) return;
        somaPorGrupo[l.grupoId] = (somaPorGrupo[l.grupoId] || 0) + (l.valor || 0);
        qtdPorGrupo[l.grupoId] = (qtdPorGrupo[l.grupoId] || 0) + 1;
    });
    return { somaPorGrupo, qtdPorGrupo };
}

// ---------- Ordenacao da tabela "Todos os lancamentos" ----------
export function valorParaOrdenar(l, campo) {
    if (campo === 'valor') return l.valor || 0;
    if (campo === 'tesouraria') return l.tesouraria ? 1 : 0;
    return (l[campo] || '').toString().toLowerCase();
}

export function compararPorCampo(a, b, campo, direcao) {
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

// Ordem padrao = ordem de criacao; se um campo de ordenacao customizado for
// passado, ele tem prioridade (reaproveitada tambem na exportacao da
// planilha, para o arquivo sair na mesma ordem que a tela esta mostrando).
export function ordenarLista(lista, campo = null, direcao = 'asc') {
    let todos = [...lista].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
    if (campo) {
        todos.sort((a, b) => compararPorCampo(a, b, campo, direcao));
    }
    return todos;
}

// ---------- Planilha (.xlsx) ----------
function textoTesouraria(l) {
    return l.tesouraria ? 'Feita' : 'Pendente';
}

export function montarLinhasPlanilha(lista) {
    return lista.map(l => ({
        'Data': l.data || '',
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

export function montarResumoPlanilha(lista) {
    const { mapaFormas, porAtendente, totalGeral } = calcularResumo(lista);
    const linhas = [
        { 'Resumo': 'Total geral', 'Quantidade': lista.length, 'Valor (R$)': totalGeral },
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

export function gerarArquivoPlanilha(lista, nomeArquivo) {
    const linhasLancamentos = montarLinhasPlanilha(lista);
    const linhasResumo = montarResumoPlanilha(lista);

    const wb = XLSX.utils.book_new();
    const wsLancamentos = XLSX.utils.json_to_sheet(linhasLancamentos.length ? linhasLancamentos : [{ 'Atendente': 'Sem lançamentos neste período' }]);
    const wsResumo = XLSX.utils.json_to_sheet(linhasResumo);
    XLSX.utils.book_append_sheet(wb, wsLancamentos, 'Lançamentos');
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    XLSX.writeFile(wb, nomeArquivo);
}

// ---------- Auditoria ----------
// Registra, numa colecao separada ("auditoria"), quem editou ou excluiu um
// lancamento, com o valor de ANTES e de DEPOIS de cada campo relevante - um
// log que nao existia no sistema antes e que passa a dar rastreabilidade
// real sobre correcoes/exclusoes de lancamentos ja criados (o firestore.rules
// so controla QUEM pode mexer, nunca guardava o HISTORICO do que mudou).
//
// "quem" precisa ser passado pela tela que chama (uid + nome de quem esta
// logado no momento) - este modulo nao tem acesso direto a sessao de
// autenticacao de cada pagina.
const CAMPOS_AUDITADOS = ['nomePaciente', 'exame', 'valor', 'formaPagamento', 'titulo', 'numeroNf', 'tesouraria'];

function diffCampos(antes, depois) {
    const mudancas = {};
    CAMPOS_AUDITADOS.forEach(campo => {
        const valorAntes = antes ? (antes[campo] ?? null) : null;
        const valorDepois = depois ? (depois[campo] ?? null) : null;
        if (valorAntes !== valorDepois) {
            mudancas[campo] = { de: valorAntes, para: valorDepois };
        }
    });
    return mudancas;
}

export async function registrarAuditoria(db, { acao, lancamentoId, antes, depois, quem }) {
    try {
        await addDoc(collection(db, 'auditoria'), {
            acao, // 'editar' ou 'excluir'
            lancamentoId,
            lancamentoResumo: antes ? `${antes.nomePaciente || ''} - ${antes.exame || ''}` : '',
            mudancas: acao === 'editar' ? diffCampos(antes, depois) : diffCampos(antes, null),
            usuarioId: quem?.uid || null,
            usuarioNome: quem?.nome || null,
            usuarioPerfil: quem?.perfil || null,
            quando: serverTimestamp()
        });
    } catch (e) {
        // Auditoria nunca deve travar a operacao principal (editar/excluir o
        // lancamento em si) - se o log falhar por algum motivo, so avisamos
        // no console, sem impedir a acao real de completar.
        console.error('Não foi possível registrar a auditoria:', e);
    }
}
