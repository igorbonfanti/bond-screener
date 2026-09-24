/* Salvataggio e condivisione su Firebase (progetto igorbonfanti-screener, collezione bond_ladders).
   Lettura pubblica, scrittura solo con accesso (vedi firestore.rules e auth-opzionale.js).
   Firebase è facoltativo: senza rete o senza SDK l'app funziona, solo senza salvataggi. */

const COLL = 'bond_ladders';

export function cloudReady() {
  return typeof window.firebase !== 'undefined' && window.firebase.apps && window.firebase.apps.length > 0 && typeof window.firebase.firestore === 'function';
}
function db() { if (!cloudReady()) throw new Error('Cloud non disponibile (offline?).'); return window.firebase.firestore(); }

export function currentUser() { return window.Accesso && window.Accesso.utente ? window.Accesso.utente() : null; }
export function openLogin() { const b = document.getElementById('accessoPulsante'); if (b) b.click(); }

export async function listLadders() {
  const snap = await db().collection(COLL).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getLadder(id) {
  const d = await db().collection(COLL).doc(id).get();
  return d.exists ? { id: d.id, ...d.data() } : null;
}

export async function saveLadder(doc) {
  if (!currentUser()) { openLogin(); throw new Error('Accedi per salvare (la consultazione resta libera).'); }
  const ref = await db().collection(COLL).add(doc);
  return ref.id;
}

export async function deleteLadder(id) {
  if (!currentUser()) { openLogin(); throw new Error('Accedi per eliminare.'); }
  await db().collection(COLL).doc(id).delete();
}

export function shareUrl(id) { return `${location.origin}${location.pathname}#/l/${encodeURIComponent(id)}`; }
