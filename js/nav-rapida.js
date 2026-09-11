// Menu do usuario no topbar. Mostra nome + cargo (em destaque, como um
// selo), e as acoes:
// - "Trocar de perfil": para quem tem mais de UMA tela disponivel. Leva
//   para a tela escolhida, com a MESMA conta logada - nao muda permissao
//   nenhuma, so troca qual tela/sidebar aparece.
//     - Administrador: ve as 3 telas (Administrador, Supervisor, Recepcao).
//     - Supervisor: ve 2 telas (Conferencia de caixa = supervisor.html, e
//       Meus atendimentos = recepcao.html) - o supervisor tambem lanca
//       atendimentos avulsos, entao precisa ir e voltar entre as duas.
//     - Recepcao: tem UMA tela so, entao nao ve essa opcao.
// - Tema claro/escuro: um interruptor, salvo no navegador da pessoa.
// - "Alterar senha": pede a senha atual (reautenticacao exigida pelo
//   Firebase para operacoes sensiveis) e troca para uma nova.
// - "Sair".
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { aplicarTema, temaAtualEhEscuro, alternarTema } from "./tema.js";

const TELA_DO_PERFIL = {
    admin: { href: 'admin.html', rotulo: 'Administrador' },
    supervisor: { href: 'supervisor.html', rotulo: 'Conferência de caixa' },
    recepcao: { href: 'recepcao.html', rotulo: 'Meus atendimentos' }
};

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

export function montarNavRapida({ perfil, nome, paginaAtual }) {
    aplicarTema();

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
            <div class="nav-rapida-tema">
                <span>&#127769; Modo escuro</span>
                <button type="button" class="interruptor-tema ${temaAtualEhEscuro() ? 'ativo' : ''}" id="botaoInterruptorTema" aria-label="Alternar modo escuro"></button>
            </div>
            <div class="nav-rapida-separador"></div>
            <button type="button" class="nav-rapida-item" id="navRapidaAlterarSenha">
                <span class="icone">&#128273;</span> Alterar senha
            </button>
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

    document.getElementById('botaoInterruptorTema').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const escuroAgora = alternarTema();
        ev.currentTarget.classList.toggle('ativo', escuroAgora);
    });

    document.getElementById('navRapidaAlterarSenha').addEventListener('click', () => {
        menu.classList.remove('aberto');
        toggle.setAttribute('aria-expanded', 'false');
        abrirModalAlterarSenha();
    });

    document.getElementById('navRapidaSair').addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('nav-rapida-sair'));
    });

    montarModalAlterarSenha();
}

// ---------- Alterar senha (auto-atendimento) ----------
// Autocontido aqui dentro para nao precisar duplicar HTML/logica nas 3
// telas que usam este componente. O Firebase exige reautenticacao recente
// para trocar a senha - por isso pede a senha atual antes da nova.
let modalSenhaMontado = false;

function montarModalAlterarSenha() {
    if (modalSenhaMontado) return;
    modalSenhaMontado = true;

    const div = document.createElement('div');
    div.innerHTML = `
        <div class="modal-overlay" id="modalAlterarSenha" style="display:none">
            <div class="modal-caixa" style="max-width:420px">
                <h2 style="margin-top:0">Alterar senha</h2>
                <p class="texto-apoio">Informe sua senha atual e a nova senha (mínimo 6 caracteres).</p>
                <div class="erro" id="msgErroSenha"></div>
                <div class="mensagem-ok" id="msgOkSenha"></div>
                <form id="formAlterarSenha">
                    <div class="campo"><label>Senha atual</label><input type="password" id="senhaAtual" required></div>
                    <div class="campo"><label>Nova senha</label><input type="password" id="senhaNova" required minlength="6"></div>
                    <div class="campo"><label>Confirmar nova senha</label><input type="password" id="senhaNovaConfirmar" required minlength="6"></div>
                    <div style="display:flex; gap:10px; margin-top:18px">
                        <button type="submit" class="botao">Salvar nova senha</button>
                        <button type="button" class="botao secundario" id="btnCancelarAlterarSenha">Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(div.firstElementChild);

    const modal = document.getElementById('modalAlterarSenha');
    const form = document.getElementById('formAlterarSenha');

    document.getElementById('btnCancelarAlterarSenha').addEventListener('click', fecharModalAlterarSenha);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) fecharModalAlterarSenha();
    });

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const senhaAtual = document.getElementById('senhaAtual').value;
        const senhaNova = document.getElementById('senhaNova').value;
        const senhaNovaConfirmar = document.getElementById('senhaNovaConfirmar').value;
        const msgErro = document.getElementById('msgErroSenha');
        const msgOk = document.getElementById('msgOkSenha');
        msgErro.classList.remove('mostrar');
        msgOk.classList.remove('mostrar');

        if (senhaNova !== senhaNovaConfirmar) {
            msgErro.textContent = 'A confirmação não é igual à nova senha.';
            msgErro.classList.add('mostrar');
            return;
        }

        try {
            const usuario = auth.currentUser;
            const credencial = EmailAuthProvider.credential(usuario.email, senhaAtual);
            await reauthenticateWithCredential(usuario, credencial);
            await updatePassword(usuario, senhaNova);
            msgOk.textContent = 'Senha alterada com sucesso.';
            msgOk.classList.add('mostrar');
            form.reset();
            setTimeout(fecharModalAlterarSenha, 1500);
        } catch (e) {
            const mapa = {
                'auth/wrong-password': 'Senha atual incorreta.',
                'auth/invalid-credential': 'Senha atual incorreta.',
                'auth/weak-password': 'A nova senha precisa ter pelo menos 6 caracteres.',
                'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.'
            };
            msgErro.textContent = mapa[e.code] || ('Não foi possível alterar a senha: ' + e.message);
            msgErro.classList.add('mostrar');
        }
    });
}

function abrirModalAlterarSenha() {
    document.getElementById('formAlterarSenha').reset();
    document.getElementById('msgErroSenha').classList.remove('mostrar');
    document.getElementById('msgOkSenha').classList.remove('mostrar');
    document.getElementById('modalAlterarSenha').style.display = 'flex';
}

function fecharModalAlterarSenha() {
    document.getElementById('modalAlterarSenha').style.display = 'none';
}
