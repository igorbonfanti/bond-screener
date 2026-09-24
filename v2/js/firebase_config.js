// Firebase config — progetto igorbonfanti-screener (SDK 8.10.1)
//
// Progetto dedicato agli screener, separato da magazzino-edile-pos: li' stavano
// insieme ai dati aziendali (anagrafica clienti, preventivi, solleciti) e ogni
// permesso concesso a queste app finiva per allargare la superficie di quelli.
// Qui non c'e' nulla di aziendale, quindi la lettura puo' restare pubblica.
//
// Lettura libera per tutti, scrittura solo a utente autenticato: vedi
// firestore.rules e storage.rules nella radice del repository.
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
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
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
