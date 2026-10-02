// Mock minimo do SDK de Auth, o suficiente para exercitar admin.js /
// supervisor.js / recepcao.js / nav-rapida.js sem rede nenhuma.
//
// O uid/email do "usuario logado" pode ser configurado pela pagina de teste
// ANTES deste modulo ser importado, definindo window.__usuarioMock = { uid,
// email } no <script> inline do HTML de teste - sem isso, cai no padrao
// (uid-teste-admin), que e o que os testes de admin.html usavam antes de
// existir suporte a mais de um perfil.
const usuarioFake = (typeof window !== 'undefined' && window.__usuarioMock) || {
    uid: 'uid-teste-admin',
    email: 'admin@teste.com'
};

let ouvintes = [];

export function getAuth(app) {
    return {
        currentUser: usuarioFake,
        _app: app
    };
}

export function onAuthStateChanged(auth, cb) {
    ouvintes.push(cb);
    // Dispara assincronamente, como o Firebase real faria.
    setTimeout(() => cb(usuarioFake), 0);
    return () => {
        ouvintes = ouvintes.filter(o => o !== cb);
    };
}

export async function signOut(auth) {
    window.__signOutChamado = true;
    return Promise.resolve();
}

export async function createUserWithEmailAndPassword(auth, email, senha) {
    return { user: { uid: 'uid-novo-' + Date.now(), email } };
}

export async function sendPasswordResetEmail(auth, email) {
    return Promise.resolve();
}

export const EmailAuthProvider = {
    credential(email, senha) {
        return { email, senha, tipo: 'password' };
    }
};

export async function reauthenticateWithCredential(usuario, credencial) {
    window.__reautenticouCom = credencial;
    if (credencial.senha === 'senhaerrada') {
        const erro = new Error('Senha incorreta');
        erro.code = 'auth/wrong-password';
        throw erro;
    }
    return Promise.resolve();
}

export async function updatePassword(usuario, novaSenha) {
    window.__novaSenhaDefinida = novaSenha;
    return Promise.resolve();
}
