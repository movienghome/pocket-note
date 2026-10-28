// Firebase backend for 포켓 노트: login, Firestore storage (works offline), attachments, file saving.
const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}/`;
const $ = s => document.querySelector(s);
const gate = $('#gate');
const cfg = window.POCKET_FIREBASE;

if (!cfg || !cfg.apiKey) {
  gate.hidden = false; $('#login').hidden = true; $('#nocfg').hidden = false;
} else {
  start().catch(e => { console.error(e); gate.hidden = false; $('#gerr').textContent = '불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.'; });
}

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { fs = F.getFirestore(app); }

  /* ---------- login screen ---------- */
  let signup = false;
  const msg = $('#gmsg'), err = $('#gerr'), sub = $('#gsubmit'), mode = $('#gmode');
  const KO = {
    'auth/invalid-credential': '이메일이나 비밀번호가 맞지 않습니다.', 'auth/wrong-password': '비밀번호가 맞지 않습니다.',
    'auth/user-not-found': '이 이메일로 만든 계정이 없습니다.', 'auth/email-already-in-use': '이미 계정이 있는 이메일입니다. 로그인하세요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.', 'auth/invalid-email': '이메일 형식이 맞지 않습니다.',
    'auth/too-many-requests': '시도가 너무 많습니다. 잠시 뒤 다시 하세요.', 'auth/network-request-failed': '인터넷에 연결되어 있지 않습니다.',
    'auth/operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인이 꺼져 있습니다.', 'auth/admin-restricted-operation': '새 계정 만들기가 꺼져 있습니다.'};
  const say = e => err.textContent = KO[e && e.code] || ('오류: ' + ((e && e.code) || e));
  mode.onclick = () => { signup = !signup; sub.textContent = signup ? '계정 만들기' : '로그인'; mode.textContent = signup ? '이미 계정이 있어요' : '처음이면 계정 만들기';
    msg.textContent = signup ? '이 앱에서 쓸 이메일과 비밀번호를 정하세요.' : '이메일과 비밀번호로 로그인하세요.'; err.textContent = ''; $('#gpw').autocomplete = signup ? 'new-password' : 'current-password'; };
  $('#greset').onclick = async () => { const em = $('#gemail').value.trim(); if (!em) { err.textContent = '이메일을 먼저 적어 주세요.'; return; }
    try { await A.sendPasswordResetEmail(auth, em); err.textContent = ''; msg.textContent = '비밀번호 재설정 메일을 보냈습니다.'; } catch (e) { say(e); } };
  $('#login').onsubmit = async ev => { ev.preventDefault(); err.textContent = ''; sub.disabled = true;
    const em = $('#gemail').value.trim(), pw = $('#gpw').value;
    try { signup ? await A.createUserWithEmailAndPassword(auth, em, pw) : await A.signInWithEmailAndPassword(auth, em, pw); }
    catch (e) { say(e); } finally { sub.disabled = false; } };

  /* ---------- helpers ---------- */
  const ref = p => (p.split('/').length % 2 === 0 ? F.doc(fs, p) : null);
  const wrap = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } });
  // A write lands in the device copy at once; the server confirms later. Don't make the app wait while offline.
  let pending = 0;
  const mark = () => { window.PN_PENDING = pending > 0; };
  function fastWrite(p) {
    let done = false; pending++; mark();
    p.then(() => {}, e => { console.error(e); if (e && e.code === 'permission-denied') window.__pnSetStatus && window.__pnSetStatus('저장 권한 없음 · 보안 규칙 확인'); })
     .finally(() => { done = true; pending--; mark(); if (!pending && window.__pnSetStatus) window.__pnSetStatus('저장됨'); });
    return Promise.race([p, new Promise(r => setTimeout(r, 1200))]).catch(e => { if (!done) throw e; throw e; });
  }
  function docApi(path) {
    const r = F.doc(fs, path);
    return {
      path, id: r.id,
      collection: c => colApi(path + '/' + c),
      get: async () => { try { return wrap(await F.getDoc(r)); } catch (e) { return wrap(await F.getDocFromCache(r)); } },
      set: d => fastWrite(F.setDoc(r, d)),
      update: d => fastWrite(F.updateDoc(r, d)),
      delete: () => fastWrite(F.deleteDoc(r)),
      onSnapshot: (next, error) => F.onSnapshot(r, s => next(wrap(s)), e => error && error({ code: e.code === 'permission-denied' ? 'revoked' : 'unavailable', message: e.message }))
    };
  }
  function colApi(path, cons = []) {
    const c = F.collection(fs, path);
    const q = () => F.query(c, ...cons);
    return {
      path, doc: id => docApi(path + '/' + (id || F.doc(c).id)),
      orderBy: (f, d) => colApi(path, [...cons, F.orderBy(f, d || 'asc')]),
      where: (f, op, v) => colApi(path, [...cons, F.where(f, op, v)]),
      limit: n => colApi(path, [...cons, F.limit(n)]),
      get: async () => { const s = await F.getDocs(q()); return { docs: s.docs.map(wrap), size: s.size, empty: s.empty, metadata: s.metadata }; },
      onSnapshot: (next, error) => F.onSnapshot(q(), s => next({ docs: s.docs.map(wrap), size: s.size, empty: s.empty, metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } }),
        e => error && error({ code: e.code === 'permission-denied' ? 'revoked' : 'unavailable', message: e.message }))
    };
  }

  /* ---------- attachments: stored as ~900KB byte chunks in Firestore ---------- */
  const urls = new Map(), loading = new Map();
  const CH = 900 * 1024, MAX = 20 * 1024 * 1024;
  let uid = null;
  const bpath = id => `data/users/${uid}/blobs/${id}`;
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n / 2))].map(b => b.toString(16).padStart(2, '0')).join('');
  async function upload(blob, opt) {
    if (blob.size > MAX) throw { code: 'too_large', message: '20MB까지' };
    const type = (opt && opt.type) || blob.type || 'application/octet-stream';
    const id = hex(32); const buf = new Uint8Array(await blob.arrayBuffer()); const n = Math.max(1, Math.ceil(buf.length / CH));
    const writes = [];
    for (let i = 0; i < n; i++) writes.push(fastWrite(F.setDoc(F.doc(fs, bpath(id) + '/c/' + i), { d: F.Bytes.fromUint8Array(buf.subarray(i * CH, (i + 1) * CH)) })));
    await Promise.all(writes);
    await fastWrite(F.setDoc(F.doc(fs, bpath(id)), { type, size: buf.length, n, t: Date.now() }));
    const b = new Blob([buf], { type }); urls.set(id, URL.createObjectURL(b));
    return { id, url: urls.get(id), sizeBytes: buf.length, contentType: type };
  }
  async function getDocAny(r) { try { return await F.getDoc(r); } catch (e) { return await F.getDocFromCache(r); } }
  async function getBlob(id) {
    const m = await getDocAny(F.doc(fs, bpath(id)));
    if (!m.exists()) return null;
    const { n, type } = m.data(); const parts = [];
    for (let i = 0; i < n; i++) { const c = await getDocAny(F.doc(fs, bpath(id) + '/c/' + i)); if (!c.exists()) return null; parts.push(c.data().d.toUint8Array()); }
    return new Blob(parts, { type });
  }
  function blobUrl(id) {
    if (urls.has(id)) return Promise.resolve(urls.get(id));
    if (!loading.has(id)) loading.set(id, getBlob(id).then(b => { loading.delete(id); if (!b) return null; const u = URL.createObjectURL(b); urls.set(id, u); return u; }).catch(() => { loading.delete(id); return null; }));
    return loading.get(id);
  }

  /* ---------- file saving ---------- */
  const downloads = { save: async ({ filename, data }) => {
    const b = data instanceof Blob ? data : new Blob([data]); const u = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = u; a.download = filename; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
    setTimeout(() => URL.revokeObjectURL(u), 60000); return { status: 'saved' }; } };

  Object.assign(window.PN, { cachedUrl: id => urls.get(id) || null, account: () => auth.currentUser && { email: auth.currentUser.email } });

  let resolved = false;
  A.onAuthStateChanged(auth, async user => {
    if (user) {
      gate.hidden = true;
      if (resolved) { if (user.uid !== uid) location.reload(); return; }
      resolved = true; uid = user.uid;
      window.__pnResolve({
        db: { doc: docApi, collection: p => colApi(p) },
        user: { id: async () => uid, isOwner: () => true, canEdit: () => true, can: () => true },
        assets: { upload },
        downloads,
        getBlob, blobUrl,
        logout: async () => { await A.signOut(auth); try { await F.terminate(fs); await F.clearIndexedDbPersistence(fs); } catch (e) {} location.reload(); }
      });
    } else {
      if (resolved) { location.reload(); return; }
      gate.hidden = false; $('#login').hidden = false; $('#nocfg').hidden = true;
    }
  });
}
