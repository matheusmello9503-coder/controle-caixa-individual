// Mock minimo do SDK de Firestore. Guarda tudo em memoria (window.__db)
// e simula onSnapshot/getDoc/getDocs o suficiente para popular as telas.

function garantirColecao(nome) {
    if (!window.__db) window.__db = {};
    if (!window.__db[nome]) window.__db[nome] = {};
    return window.__db[nome];
}

export function initializeFirestore(app, opts) {
    return { _fake: true };
}
export function getFirestore(app) {
    return { _fake: true };
}
export function persistentLocalCache(opts) { return {}; }
export function persistentMultipleTabManager() { return {}; }

export function collection(db, nome) {
    return { _tipo: 'collection', nome };
}

export function doc(dbOrColecao, ...resto) {
    if (dbOrColecao._tipo === 'collection') {
        const id = resto[0] || ('auto-' + Math.random().toString(36).slice(2));
        return { _tipo: 'doc', colecao: dbOrColecao.nome, id };
    }
    // doc(db, 'colecao', 'id')
    const [colecaoNome, id] = resto;
    return { _tipo: 'doc', colecao: colecaoNome, id: id || ('auto-' + Math.random().toString(36).slice(2)) };
}

export function query(colecaoRef, ...clausulas) {
    return { _tipo: 'query', colecao: colecaoRef.nome, clausulas };
}

export function where(campo, op, valor) {
    return { _tipo: 'where', campo, op, valor };
}

export function orderBy(campo, direcao = 'asc') {
    return { _tipo: 'orderBy', campo, direcao };
}

export function limit(n) {
    return { _tipo: 'limit', n };
}

export async function getDoc(docRef) {
    const colecao = garantirColecao(docRef.colecao);
    const dados = colecao[docRef.id];
    return {
        exists: () => dados !== undefined,
        data: () => dados,
        id: docRef.id
    };
}

function aplicaClausula(dados, cl) {
    const v = dados[cl.campo];
    switch (cl.op) {
        case '==': return v === cl.valor;
        case '>=': return v >= cl.valor;
        case '<=': return v <= cl.valor;
        case '>': return v > cl.valor;
        case '<': return v < cl.valor;
        default: return v === cl.valor;
    }
}

export async function getDocs(colecaoRefOuQuery) {
    const nomeColecao = colecaoRefOuQuery.nome || colecaoRefOuQuery.colecao;
    const colecao = garantirColecao(nomeColecao);
    let entradas = Object.entries(colecao);

    if (colecaoRefOuQuery._tipo === 'query') {
        const wheres = colecaoRefOuQuery.clausulas.filter(cl => cl._tipo === 'where');
        const ordens = colecaoRefOuQuery.clausulas.filter(cl => cl._tipo === 'orderBy');
        const limites = colecaoRefOuQuery.clausulas.filter(cl => cl._tipo === 'limit');

        wheres.forEach(cl => {
            entradas = entradas.filter(([id, dados]) => aplicaClausula(dados, cl));
        });

        ordens.forEach(ord => {
            entradas.sort((a, b) => {
                const va = valorOrdenavel(a[1][ord.campo]);
                const vb = valorOrdenavel(b[1][ord.campo]);
                const cmp = va < vb ? -1 : (va > vb ? 1 : 0);
                return ord.direcao === 'desc' ? -cmp : cmp;
            });
        });

        if (limites.length) {
            const menor = Math.min(...limites.map(l => l.n));
            entradas = entradas.slice(0, menor);
        }
    }

    const docs = entradas.map(([id, dados]) => ({ id, data: () => dados }));
    return { docs };
}

// Aceita tanto numero/string quanto o "timestamp fake" usado por
// serverTimestamp() (tem toMillis()) - assim orderBy('quando', 'desc')
// funciona igual no mock e no Firestore de verdade.
function valorOrdenavel(v) {
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    return v;
}

export async function addDoc(colecaoRef, dados) {
    const colecao = garantirColecao(colecaoRef.nome);
    const id = 'auto-' + Math.random().toString(36).slice(2) + Date.now();
    colecao[id] = dados;
    disparaOuvintes(colecaoRef.nome);
    return { id };
}

export async function setDoc(docRef, dados, opts) {
    const colecao = garantirColecao(docRef.colecao);
    if (opts && opts.merge && colecao[docRef.id]) {
        colecao[docRef.id] = { ...colecao[docRef.id], ...dados };
    } else {
        colecao[docRef.id] = dados;
    }
    disparaOuvintes(docRef.colecao);
    return Promise.resolve();
}

export async function updateDoc(docRef, dados) {
    const colecao = garantirColecao(docRef.colecao);
    colecao[docRef.id] = { ...colecao[docRef.id], ...dados };
    disparaOuvintes(docRef.colecao);
    return Promise.resolve();
}

export async function deleteDoc(docRef) {
    const colecao = garantirColecao(docRef.colecao);
    delete colecao[docRef.id];
    disparaOuvintes(docRef.colecao);
    return Promise.resolve();
}

let contadorId = 0;
export function writeBatch(db) {
    const operacoes = [];
    return {
        set(docRef, dados) {
            operacoes.push(() => {
                const colecao = garantirColecao(docRef.colecao);
                colecao[docRef.id] = dados;
            });
        },
        async commit() {
            operacoes.forEach(op => op());
            disparaOuvintes('lancamentos');
            return Promise.resolve();
        }
    };
}

// Cada chamada devolve um instante um pouco mais tarde que a anterior (nunca
// o mesmo valor para duas chamadas), para que testes que criam varios
// documentos em sequencia rapida consigam ordenar por "quando" de forma
// previsivel - o Firestore de verdade tambem garante ordem de escrita.
let contadorTimestamp = 0;
export function serverTimestamp() {
    contadorTimestamp += 1;
    const millis = Date.now() + contadorTimestamp;
    return { toMillis: () => millis, _isServerTimestamp: true };
}

const ouvintesPorColecao = {};
function disparaOuvintes(nomeColecao) {
    (ouvintesPorColecao[nomeColecao] || []).forEach(fn => fn());
}

export function onSnapshot(queryOuColecao, callback, onError) {
    const nomeColecao = queryOuColecao.colecao;

    function montarSnapshotEChamar() {
        const colecao = garantirColecao(nomeColecao);
        let entradas = Object.entries(colecao);
        if (queryOuColecao._tipo === 'query') {
            queryOuColecao.clausulas.filter(cl => cl._tipo === 'where').forEach(cl => {
                entradas = entradas.filter(([id, dados]) => aplicaClausula(dados, cl));
            });
        }
        const docs = entradas.map(([id, dados]) => ({ id, data: () => dados }));
        callback({ docs });
    }

    if (!ouvintesPorColecao[nomeColecao]) ouvintesPorColecao[nomeColecao] = [];
    ouvintesPorColecao[nomeColecao].push(montarSnapshotEChamar);

    // Dispara imediatamente com o estado atual (como o Firebase real faz).
    setTimeout(montarSnapshotEChamar, 0);

    return () => {
        ouvintesPorColecao[nomeColecao] = ouvintesPorColecao[nomeColecao].filter(f => f !== montarSnapshotEChamar);
    };
}
