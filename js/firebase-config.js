// Cole aqui a configuracao do SEU projeto Firebase.
// Voce encontra esses valores em: Firebase Console > Configuracoes do projeto
// > Geral > Seus aplicativos > (icone </>) > Configuracao do SDK.
//
// Esses valores NAO sao segredo (podem ficar visiveis no navegador sem
// problema); quem protege os dados de verdade sao as regras de seguranca
// do Firestore (arquivo firestore.rules) e o login do Firebase Authentication.

export const configuracaoFirebase = {
    apiKey: "AIzaSyBhHcA0iz6O7BEASSMfVMLfhXWG2-0bAaI",
    authDomain: "cerdil-caixa.firebaseapp.com",
    projectId: "cerdil-caixa",
    storageBucket: "cerdil-caixa.firebasestorage.app",
    messagingSenderId: "869623983076",
    appId: "1:869623983076:web:923fc58c58628080edf5f1"
};

// Fuso horario da unidade, usado apenas para exibir a data no navegador.
// A restricao de horario de verdade (07h-19h) e aplicada pelo servidor do
// Firebase, de forma independente do relogio do computador de quem usa.
export const FUSO_HORARIO = "America/Campo_Grande";
export const HORA_INICIO = 7;   // mesma hora configurada em firestore.rules
export const HORA_FIM = 19;     // mesma hora configurada em firestore.rules
