// Tamanho da interface ("escala"). Em monitores grandes (22 polegadas ou mais)
// o sistema, desenhado para notebook, ficava pequeno. A escala e um zoom da
// pagina inteira (variavel CSS --escala, usada em css/style.css).
//
// Como funciona, e por que NAO e um media query de largura:
// - Na primeira visita neste navegador, sugere um valor pela largura da
//   janela (1700px ou mais: 115%; 1850px: 120%; 2200px: 140%; 2800px: 180%) e
//   GRAVA no navegador. Depois disso o valor so muda se a pessoa mudar, em
//   "Tamanho da tela", no menu do nome (topbar).
// - Se dependesse da largura da janela a cada carregamento, o zoom do
//   navegador (Ctrl + e Ctrl -) mudaria a largura e a escala compensaria, e o
//   tamanho pareceria "travado". Gravada, ela se multiplica com o zoom normal.
// Cada pagina tambem roda uma copia minima disto, de forma sincrona, no
// <head> (como o tema), para a tela nao "pular" de tamanho ao carregar.
const CHAVE_ESCALA = 'cerdilCaixaEscala';

export const PASSOS_ESCALA = [0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2];

export function escalaSugerida(larguraJanela = window.innerWidth) {
    if (larguraJanela >= 2800) return 1.8;
    if (larguraJanela >= 2200) return 1.4;
    if (larguraJanela >= 1850) return 1.2;
    if (larguraJanela >= 1700) return 1.15;
    return 1;
}

function lerEscalaSalva() {
    try {
        const v = parseFloat(localStorage.getItem(CHAVE_ESCALA));
        return v >= 0.5 && v <= 3 ? v : null;
    } catch (e) {
        return null;
    }
}

function salvarEscala(valor) {
    try {
        localStorage.setItem(CHAVE_ESCALA, String(valor));
    } catch (e) {
        // Sem localStorage (modo privado restrito): so nao persiste.
    }
}

export function aplicarEscala(valor) {
    document.documentElement.style.setProperty('--escala', String(valor));
}

export function escalaAtual() {
    const v = parseFloat(document.documentElement.style.getPropertyValue('--escala'));
    return v > 0 ? v : 1;
}

export function iniciarEscala() {
    let valor = lerEscalaSalva();
    if (valor === null) {
        valor = escalaSugerida();
        salvarEscala(valor);
    }
    aplicarEscala(valor);
    return valor;
}

export function definirEscala(valor) {
    salvarEscala(valor);
    aplicarEscala(valor);
    return valor;
}

// Passo para cima (+1) ou para baixo (-1) na lista de tamanhos.
export function passoEscala(direcao) {
    const atual = escalaAtual();
    let indice = PASSOS_ESCALA.findIndex(p => Math.abs(p - atual) < 0.005);
    if (indice === -1) {
        indice = PASSOS_ESCALA.reduce((melhor, p, i) => Math.abs(p - atual) < Math.abs(PASSOS_ESCALA[melhor] - atual) ? i : melhor, 0);
    }
    const novo = Math.min(PASSOS_ESCALA.length - 1, Math.max(0, indice + direcao));
    return definirEscala(PASSOS_ESCALA[novo]);
}

iniciarEscala();
