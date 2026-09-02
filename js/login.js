import { signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

function mostrarErro(texto) {
    const el = document.getElementById('msgErro');
    el.classList.remove('sucesso');
    el.textContent = texto;
    el.classList.add('mostrar');
}

function mostrarSucesso(texto) {
    const el = document.getElementById('msgErro');
    el.classList.add('sucesso');
    el.textContent = texto;
    el.classList.add('mostrar');
}

// Se ja existir uma sessao valida, manda direto para a tela certa
onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) return;
    const perfilDoc = await getDoc(doc(db, 'usuarios', usuario.uid));
    if (perfilDoc.exists()) {
        redirecionar(perfilDoc.data().perfil);
    }
});

function redirecionar(perfil) {
    const mapa = { admin: 'admin.html', supervisor: 'supervisor.html', recepcao: 'recepcao.html' };
    window.location.href = mapa[perfil] || 'recepcao.html';
}

function traduzirErro(codigo) {
    const mapa = {
        'auth/invalid-email': 'E-mail invalido.',
        'auth/user-disabled': 'Este usuario esta desativado.',
        'auth/user-not-found': 'E-mail ou senha invalidos.',
        'auth/wrong-password': 'E-mail ou senha invalidos.',
        'auth/invalid-credential': 'E-mail ou senha invalidos.',
        'auth/missing-email': 'Digite seu e-mail no campo acima.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
    };
    return mapa[codigo] || 'Nao foi possivel completar a acao. Tente novamente.';
}

document.getElementById('formLogin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    document.getElementById('msgErro').classList.remove('mostrar');

    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;
    const botao = document.getElementById('btnEntrar');
    botao.disabled = true;

    try {
        const credencial = await signInWithEmailAndPassword(auth, email, senha);
        const perfilDoc = await getDoc(doc(db, 'usuarios', credencial.user.uid));

        if (!perfilDoc.exists() || perfilDoc.data().ativo !== true) {
            await signOut(auth);
            mostrarErro('Sua conta ainda nao foi liberada. Fale com o responsavel pelo caixa.');
            return;
        }

        redirecionar(perfilDoc.data().perfil);
    } catch (e) {
        mostrarErro(traduzirErro(e.code));
    } finally {
        botao.disabled = false;
    }
});

// "Esqueci minha senha" usa o servico real do Firebase Authentication:
// um e-mail de redefinicao e enviado de verdade (remetente padrao
// noreply@<projeto>.firebaseapp.com) para a caixa de entrada da pessoa,
// contendo um link para criar uma nova senha. Nao ha nada para configurar
// no codigo para isso funcionar - o unico requisito e que o metodo
// E-mail/Senha esteja ativado no Firebase Authentication (Console >
// Authentication > Sign-in method), o que ja e necessario para o login
// funcionar. O e-mail as vezes cai na caixa de Spam/Lixo eletronico,
// principalmente na primeira vez.
document.getElementById('linkEsqueciSenha').addEventListener('click', async (ev) => {
    ev.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) {
        mostrarErro('Digite seu e-mail no campo acima e clique novamente em "Esqueci minha senha".');
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        mostrarSucesso('Enviamos um e-mail de redefinicao para ' + email + '. Confira a caixa de entrada (e a pasta de Spam) nos proximos minutos.');
    } catch (e) {
        mostrarErro(traduzirErro(e.code));
    }
});
