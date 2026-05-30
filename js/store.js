/* ============================================================
   store.js — Persistenza Firebase
   - Snapshot giornalieri: dati bond normalizzati (JSON) + file grezzo
     su Firebase Storage; metadati su Firestore (bond_snapshots).
   - Bond ladder salvati: Firestore (bond_ladders).
   Tutto namespacato dentro il progetto condiviso magazzino-edile-pos.
   ============================================================ */
const BSStore = (() => {

  function ensure() {
    if (!FIREBASE_OK || !db || !storage) throw new Error('Firebase non disponibile (offline o config mancante).');
  }
  const nowISO = () => new Date().toISOString();

  /* ---------------- SNAPSHOT ---------------- */

  // meta: { name, referenceDate, columns, bonds, file? }
  async function saveSnapshot(meta) {
    ensure();
    const id = (meta.referenceDate || nowISO().slice(0, 10)) + '_' + Date.now();
    const basePath = `${BS_STORAGE_PREFIX}/snapshots/${id}`;

    // 1) dati normalizzati in JSON (fonte per il ricaricamento)
    const json = JSON.stringify({ bonds: BSData.serializeBonds(meta.bonds), columns: meta.columns });
    const jsonRef = storage.ref(`${basePath}/data.json`);
    await jsonRef.putString(json, 'raw', { contentType: 'application/json' });
    const jsonUrl = await jsonRef.getDownloadURL();

    // 2) file grezzo originale (provenienza), best-effort
    let rawPath = null;
    if (meta.file) {
      try {
        const rawRef = storage.ref(`${basePath}/${meta.file.name}`);
        await rawRef.put(meta.file);
        rawPath = `${basePath}/${meta.file.name}`;
      } catch (e) { console.warn('Upload file grezzo fallito:', e); }
    }

    // 3) documento metadati
    const doc = {
      name: meta.name || meta.referenceDate || id,
      referenceDate: meta.referenceDate || null,
      uploadedAt: nowISO(),
      rowCount: meta.bonds.length,
      columns: meta.columns || [],
      jsonPath: `${basePath}/data.json`,
      jsonUrl,
      rawPath,
      fileName: meta.file ? meta.file.name : null
    };
    await db.collection(BS_COLLECTION_SNAPSHOTS).doc(id).set(doc);
    return { id, ...doc };
  }

  async function listSnapshots() {
    ensure();
    const snap = await db.collection(BS_COLLECTION_SNAPSHOTS).get();
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // ordina per referenceDate (poi uploadedAt) desc
    arr.sort((a, b) => (b.referenceDate || b.uploadedAt || '').localeCompare(a.referenceDate || a.uploadedAt || ''));
    return arr;
  }

  async function loadSnapshotBonds(snapMeta) {
    ensure();
    const url = snapMeta.jsonUrl || await storage.ref(snapMeta.jsonPath).getDownloadURL();
    const res = await fetch(url);
    if (!res.ok) throw new Error('Download snapshot fallito');
    const payload = await res.json();
    return { bonds: BSData.reviveBonds(payload.bonds), columns: payload.columns || [] };
  }

  async function deleteSnapshot(snapMeta) {
    ensure();
    await db.collection(BS_COLLECTION_SNAPSHOTS).doc(snapMeta.id).delete();
    const tryDel = async (p) => { try { await storage.ref(p).delete(); } catch (e) {} };
    if (snapMeta.jsonPath) await tryDel(snapMeta.jsonPath);
    if (snapMeta.rawPath) await tryDel(snapMeta.rawPath);
  }

  /* ---------------- LADDER ---------------- */

  function slimSlots(slots) {
    return slots.map(s => ({
      step: s.step,
      target: s.target instanceof Date ? s.target.toISOString() : s.target,
      bond: s.bond ? {
        isincode: s.bond.isincode, description: s.bond.description,
        redemptiondate: s.bond.redemptiondate instanceof Date ? s.bond.redemptiondate.toISOString() : s.bond.redemptiondate,
        issuercode: s.bond.issuercode, _country: s.bond._country,
        grossytm: s.bond.grossytm, grossduration: s.bond.grossduration,
        currentcouponrate: s.bond.currentcouponrate, ratingsp: s.bond.ratingsp,
        price: s.bond.price
      } : null
    }));
  }

  // l: { name, type, snapshotId, referenceDate, params, filters, slots, metrics }
  async function saveLadder(l) {
    ensure();
    const doc = {
      name: l.name || `Ladder ${new Date().toLocaleDateString('it-IT')}`,
      type: l.type || 'manuale',
      snapshotId: l.snapshotId || null,
      referenceDate: l.referenceDate || null,
      createdAt: nowISO(),
      params: l.params || {},
      filters: l.filters || {},
      metrics: l.metrics || {},
      slots: slimSlots(l.slots || [])
    };
    const ref = await db.collection(BS_COLLECTION_LADDERS).add(doc);
    return { id: ref.id, ...doc };
  }

  async function listLadders() {
    ensure();
    const snap = await db.collection(BS_COLLECTION_LADDERS).get();
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return arr;
  }

  async function deleteLadder(id) { ensure(); await db.collection(BS_COLLECTION_LADDERS).doc(id).delete(); }

  return {
    saveSnapshot, listSnapshots, loadSnapshotBonds, deleteSnapshot,
    saveLadder, listLadders, deleteLadder
  };
})();
