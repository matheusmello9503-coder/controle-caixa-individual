// Seletor de navegacao rapida (menu no topbar). Mostra, para o usuario
// logado, APENAS as telas que o perfil dele ja tem permissao de acessar -
// nao troca de conta nem de permissao, e um atalho de navegacao. A lista
// de telas por perfil espelha o que o firestore.rules permite no servidor.
const TELAS_POR_PERFIL = {
    admin: [
        { href: 'admin.html#fechamento', pagina: 'admin', icone: '&#128202;', rotulo: 'Fechamento do dia' },
        { href: 'admin.html#usuarios', pagina: 'admin', icone: '&#128101;', rotulo: 'Usuários' },
        { href: 'recepcao.html', pagina: 'recepcao', icone: '&#128203;', rotulo: 'Lançar atendimento' }
    ],
    supervisor: [
        { href: 'supervisor.html', pagina: 'supervisor', icone: '&#128202;', rotulo: 'Fechamento do dia' },
        { href: 'recepcao.html', pagina: 'recepcao', icone: '&#128203;', rotulo: 'Lançar atendimento' }
    ],
    recepcao: [
        { href: 'recepcao.html', pagina: 'recepcao', icone: '&#128203;', rotulo: 'Lançar atendimento' }
    ]
};

const ROTULO_PERFIL = { admin: 'Administrador', supervisor: 'Supervisor', recepcao: 'Recepção' };

function iniciaisNome(nome) {
    if (!nome) return '-';
    const partes = nome.trim().split(/\s+/);
    return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase();
}

// Monta o dropdown de navegacao no topbar. `paginaAtual` identifica a tela
// onde o script esta rodando ('admin' | 'supervisor' | 'recepcao'), usado
// so para destacar o item correspondente.
export function montarNavRapida({ perfil, nome, paginaAtual }) {
    const alvo = document.getElementById('navRapida');
    if (!alvo) return;

    const telas = TELAS_POR_PERFIL[perfil] || TELAS_POR_PERFIL.recepcao;

    const itensHtml = telas.map(t => `
        <a href="${t.href}" class="nav-rapida-item ${t.pagina === paginaAtual ? 'atual' : ''}">
            <span class="icone">${t.icone}</span> ${t.rotulo}
        </a>
    `).join('');

    alvo.innerHTML = `
        <button type="button" class="nav-rapida-toggle" id="navRapidaToggle" aria-expanded="false">
            <span class="usuario-avatar">${iniciaisNome(nome)}</span>
            <span class="usuario-nome">${nome}<span class="cargo">${ROTULO_PERFIL[perfil] || perfil}</span></span>
            <span class="seta">&#9662;</span>
        </button>
        <div class="nav-rapida-menu" id="navRapidaMenu">
            <div class="nav-rapida-cabecalho">Navegar para</div>
            ${itensHtml}
            <div class="nav-rapida-separador"></div>
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
