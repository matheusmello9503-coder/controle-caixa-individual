// Modo escuro: guarda a escolha da pessoa no localStorage deste navegador
// (nao sincroniza entre aparelhos - e uma preferencia de tela, nao de
// conta) e aplica via atributo data-theme no <html>, que o css/style.css
// usa para trocar as variaveis de cor. Cada pagina TAMBEM roda uma copia
// minima deste calculo (ver o <script> inline no <head> de cada .html),
// de forma sincrona, antes do restante da pagina carregar - isso evita um
// "flash" da tela clara por uma fracao de segundo quando a pessoa prefere
// o modo escuro. Este modulo e o usado depois, pelo nav-rapida.js, para
// ler/trocar o tema com o menu ja montado.
const CHAVE_TEMA = 'cerdilCaixaTema';

function lerTemaSalvo() {
    try {
        return localStorage.getItem(CHAVE_TEMA);
    } catch (e) {
        return null;
    }
}

function salvarTema(valor) {
    try {
        localStorage.setItem(CHAVE_TEMA, valor);
    } catch (e) {
        // Navegador com localStorage bloqueado (modo privado restrito, por
        // exemplo) - o tema so nao persiste entre recarregamentos; nao
        // impede o uso do sistema.
    }
}

export function temaAtualEhEscuro() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function aplicarTema() {
    const salvo = lerTemaSalvo();
    if (salvo === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (salvo === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    // Sem preferencia salva: nao define o atributo, e o CSS decide sozinho
    // (por enquanto sempre claro, ja que nao ha regra @media aqui).
}

export function alternarTema() {
    const escuroAgora = !temaAtualEhEscuro();
    document.documentElement.setAttribute('data-theme', escuroAgora ? 'dark' : 'light');
    salvarTema(escuroAgora ? 'dark' : 'light');
    return escuroAgora;
}
