// Firebase config — progetto condiviso magazzino-edile-pos (SDK compat 8.10.1)
// Versione archiviata. Puntata al progetto igorbonfanti-screener come la v2:
// il progetto aziendale non ospita piu' i dati degli screener. Qui non c'e'
// l'accesso opzionale, quindi questa copia e' di sola consultazione.
const firebaseConfig = {
  apiKey: "AIzaSyCJK3ewMh6T8GHWbJx_WB39JYIYYifoyl8",
  authDomain: "igorbonfanti-screener.firebaseapp.com",
  projectId: "igorbonfanti-screener",
  storageBucket: "igorbonfanti-screener.firebasestorage.app",
  messagingSenderId: "1015526355462",
  appId: "1:1015526355462:web:e8c2c95edacac1c48b4987"
};

let db = null, storage = null, FIREBASE_OK = false;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  storage = firebase.storage();
  // Persistenza offline (best effort)
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  FIREBASE_OK = true;
  console.log("Firebase inizializzato (bond-screener).");
} catch (e) {
  console.warn("Firebase non inizializzato:", e);
}

// Namespacing dedicato all'app dentro il progetto condiviso
const BS_COLLECTION_SNAPSHOTS = "bond_snapshots";
const BS_COLLECTION_LADDERS   = "bond_ladders";
const BS_STORAGE_PREFIX        = "bond_screener";
