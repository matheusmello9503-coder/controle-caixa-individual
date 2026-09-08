import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { configuracaoFirebase } from "./firebase-config.js";

// App principal: usado para tudo (login, leitura e escrita de dados)
export const app = initializeApp(configuracaoFirebase);
export const auth = getAuth(app);

// Cache local persistente (guardado no navegador, via IndexedDB): ao dar
// F5 ou reabrir o sistema, a tela mostra IMEDIATAMENTE os ultimos dados
// que ja tinha visto, em vez de ficar com a tela em branco esperando uma
// ida e volta completa ate o servidor do Firebase - e atualiza sozinha,
// em tempo real, assim que a resposta do servidor chega. E o principal
// motivo de "F5 lento" em sistemas que usam so o Firestore online.
// persistentMultipleTabManager evita conflito se a pessoa abrir o
// sistema em mais de uma aba do navegador ao mesmo tempo.
// Em navegadores muito antigos ou sem suporte a IndexedDB (raro), cai de
// volta para o modo padrao (sem cache local) em vez de travar a pagina.
let db;
try {
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
} catch (e) {
    db = getFirestore(app);
}
export { db };

// App e login secundarios: usados SOMENTE na hora em que o administrador
// cadastra um novo usuario (evita o comportamento padrao do Firebase de
// trocar a sessao logada para a conta nova assim que ela e criada). Sao
// criados SOB DEMANDA (na primeira vez que forem realmente usados), em
// vez de na carga da pagina - assim, as telas que nunca cadastram
// usuario (recepcao, supervisor, e o proprio admin fora da aba
// "Usuarios") nao pagam esse custo em toda carga de pagina/F5.
let appSecundario = null;
let authSecundario = null;
export function obterAuthSecundario() {
    if (!authSecundario) {
        appSecundario = initializeApp(configuracaoFirebase, "secundario");
        authSecundario = getAuth(appSecundario);
    }
    return authSecundario;
}
