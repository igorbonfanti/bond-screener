// Firebase config — progetto condiviso magazzino-edile-pos (SDK compat 8.10.1)
const firebaseConfig = {
  apiKey: "AIzaSyCLdOfp4z3FUJX2xt-xBZciyjxJZWeoh7A",
  authDomain: "magazzino-edile-pos.firebaseapp.com",
  projectId: "magazzino-edile-pos",
  storageBucket: "magazzino-edile-pos.firebasestorage.app",
  messagingSenderId: "696561179056",
  appId: "1:696561179056:web:fc6b1db62ed256fd3fde75"
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
