// Menu do usuario no topbar. Mostra nome + cargo, e duas acoes:
// - "Trocar de perfil": SO para quem e Administrador (unica conta que,
//   no fluxo atual, precisa alternar entre as 3 visoes do sistema). Leva
//   para a tela daquele setor, com a MESMA conta logada - nao muda
//   permissao nenhuma, so troca qual tela/sidebar aparece. Quem e
//   Supervisor ou Recepcao nao ve essa opcao, porque tem um unico perfil.
// - "Sair".
const TELA_DO_PERFIL = {
    admin: { href: 'admin.html', rotulo: 'Administrador' },
    supervisor: { href: 'supervisor.html', rotulo: 'Supervisor' },
    recepcao: { href: 'recepcao.html', rotulo: 'Recepção' }
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
// tela atual dentro do submenu "Trocar de perfil".
export function montarNavRapida({ perfil, nome, paginaAtual }) {
    const alvo = document.getElementById('navRapida');
    if (!alvo) return;

    const podeTrocarDePerfil = perfil === 'admin';
    const opcoesPerfil = Object.entries(TELA_DO_PERFIL).filter(([chave]) => chave !== paginaAtual);

    const itemTrocarPerfil = podeTrocarDePerfil ? `
        <div class="nav-rapida-submenu">
            <div class="nav-rapida-cabecalho">Trocar de perfil</div>
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
