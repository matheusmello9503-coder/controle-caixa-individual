// Menu do usuario no topbar. Mostra nome + cargo, e duas acoes:
// - "Trocar de perfil": para quem tem mais de UMA tela disponivel. Leva
//   para a tela escolhida, com a MESMA conta logada - nao muda permissao
//   nenhuma, so troca qual tela/sidebar aparece.
//     - Administrador: ve as 3 telas (Administrador, Supervisor, Recepcao).
//     - Supervisor: ve 2 telas (Fechamento do dia = supervisor.html, e
//       Meus atendimentos = recepcao.html) - o supervisor tambem lanca
//       atendimentos avulsos, entao precisa ir e voltar entre as duas.
//     - Recepcao: tem UMA tela so, entao nao ve essa opcao.
// - "Sair".
const TELA_DO_PERFIL = {
    admin: { href: 'admin.html', rotulo: 'Administrador' },
    supervisor: { href: 'supervisor.html', rotulo: 'Fechamento do dia' },
    recepcao: { href: 'recepcao.html', rotulo: 'Meus atendimentos' }
};

// Quais telas cada perfil pode alternar entre si (alem da propria).
// Recepcao nao entra aqui porque so tem uma tela.
const TELAS_DISPONIVEIS_POR_PERFIL = {
    admin: ['admin', 'supervisor', 'recepcao'],
    supervisor: ['supervisor', 'recepcao']
};

const ROTULO_PERFIL = { admin: 'Administrador', supervisor: 'Supervisor', recepcao: 'Recepção' };

function iniciaisNome(nome) {
    if (!nome) return '-';
    const partes = nome.trim().split(/\s+/);
    return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase();
}

// `perfil` e o cargo real da conta logada (o que decide permissao no
// servidor). `paginaAtual` e a tela onde o script esta rodando agora
// ('admin' | 'supervisor' | 'recepcao') - só usada para nao repetir a
// tela atual dentro do submenu "Ir para".
export function montarNavRapida({ perfil, nome, paginaAtual }) {
    const alvo = document.getElementById('navRapida');
    if (!alvo) return;

    const telasDisponiveis = TELAS_DISPONIVEIS_POR_PERFIL[perfil] || [];
    const podeTrocarDePerfil = telasDisponiveis.length > 1;
    const opcoesPerfil = telasDisponiveis
        .filter((chave) => chave !== paginaAtual)
        .map((chave) => [chave, TELA_DO_PERFIL[chave]]);

    const itemTrocarPerfil = podeTrocarDePerfil ? `
        <div class="nav-rapida-submenu">
            <div class="nav-rapida-cabecalho">Ir para</div>
            ${opcoesPerfil.map(([, t]) => `
                <a href="${t.href}" class="nav-rapida-item">
                    <span class="icone">&#8644;</span> ${t.rotulo}
                </a>
            `).join('')}
        </div>
        <div class="nav-rapida-separador"></div>
    ` : '';

    alvo.innerHTML = `
        <button type="button" class="nav-rapida-toggle" id="navRapidaToggle" aria-expanded="false">
            <span class="usuario-avatar">${iniciaisNome(nome)}</span>
            <span class="usuario-nome">${nome}<span class="cargo">${ROTULO_PERFIL[perfil] || perfil}</span></span>
            <span class="seta">&#9662;</span>
        </button>
        <div class="nav-rapida-menu" id="navRapidaMenu">
            ${itemTrocarPerfil}
            <button type="button" class="nav-rapida-item" id="navRapidaSair">
                <span class="icone">&#128682;</span> Sair
            </button>
        </div>
    `;

    const toggle = document.getElementById('navRapidaToggle');
    const menu = document.getElementById('navRapidaMenu');
    toggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const aberto = menu.classList.toggle('aberto');
        toggle.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    });
    document.addEventListener('click', (ev) => {
        if (!menu.contains(ev.target) && ev.target !== toggle) {
            menu.classList.remove('aberto');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });

    document.getElementById('navRapidaSair').addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('nav-rapida-sair'));
    });
}
