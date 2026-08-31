import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configuracaoFirebase } from "./firebase-config.js";

// App principal: usado para tudo (login, leitura e escrita de dados)
export const app = initializeApp(configuracaoFirebase);
export const auth = getAuth(app);
export const db = getFirestore(app);

// App secundario: usado SOMENTE na hora de cadastrar um novo usuario.
// Isso evita um comportamento padrao do Firebase em que criar uma conta
// pelo navegador automaticamente troca a sessao logada para essa conta
// nova. Com um app separado, o administrador continua logado no app
// principal enquanto a conta nova e criada no app secundario.
export const appSecundario = initializeApp(configuracaoFirebase, "secundario");
export const authSecundario = getAuth(appSecundario);
