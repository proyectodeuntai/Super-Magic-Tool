// ═══════════════════════════════════════════════════════════
// MAGIC CARD MATCHER — script.js
// ═══════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
let groupCollections = {};
let groupWishlists = {};
let unsubCol = null;
let unsubWl = null;
let unsubPlayers = null;
let unsubGroup = null;
let groupDataReady = { col: false, wl: false };
let currentGroup = null;   // snapshot de groups/{groupId} (solo si estás en un grupo)
let groupPlayers = {};     // uid -> datos de jugadores (reglas: solo tú + tu grupo)
// Código de invitación recibido por URL (?invite=ABC123) para unirse con un clic
const INVITE_CODE = (new URLSearchParams(window.location.search).get('invite') || '').trim() || null;
let inviteHandled = false;
// ── FIREBASE GUARD ─────────────────────────────────────────
if (typeof FIREBASE_CONFIG === 'undefined') {
  document.body.innerHTML = `
    <div class="firebase-error">
      <h2>Falta config.js</h2>
      <p>Copia config.example.js a config.js y rellena tus credenciales.</p>
    </div>`;
  throw new Error('config.js no encontrado.');
}

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

let currentPlayer = null;
let isRegistering = false;

let myCollections = { "Mi colección": [] };
let activeColList = "Mi colección";
let myWishlists = { "Mi wishlist": [] };
let activeWlList = "Mi wishlist";

// Debounce timers para autoguardado
let saveTimers = { col: null, wl: null };
let syncStatusTimers = { col: null, wl: null };

const authModal = $('authModalContainer');

// ── TOAST ──────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  const shadows = { err: 'var(--primary)', inf: 'var(--accent-blue)', success: 'var(--accent-yellow)' };
  t.style.boxShadow = `6px 6px 0px ${shadows[type] || shadows.success}`;
  t.classList.add('show');
  // Un toast nuevo cancela el timeout del anterior para que no lo apague antes de tiempo
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// parseCardString y normalizeCardName viven en card-utils.js (cargado antes).

// ── MODAL BAUHAUS (prompt / confirm / alert) ───────────────
const bModal = (() => {
  const backdrop = document.createElement('div');
  backdrop.id = 'bModalBackdrop';
  backdrop.className = 'b-modal-backdrop';
  backdrop.innerHTML = `
    <div class="b-modal-box" role="dialog" aria-modal="true" aria-labelledby="bModalMsg">
      <p id="bModalMsg" class="b-modal-msg"></p>
      <input id="bModalInput" class="inp b-modal-input" type="text" placeholder="">
      <div class="b-modal-actions">
        <button id="bModalCancel" class="btn btn-ghost btn-sm">Cancelar</button>
        <button id="bModalOk" class="btn btn-gold btn-sm">Aceptar</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const msg = () => backdrop.querySelector('#bModalMsg');
  const input = () => backdrop.querySelector('#bModalInput');
  const ok = () => backdrop.querySelector('#bModalOk');
  const cancel = () => backdrop.querySelector('#bModalCancel');

  function open() { backdrop.classList.add('open'); }
  function close() {
    backdrop.classList.remove('open');
    input().style.display = 'none';
    input().value = '';
    cancel().style.display = 'none';
  }

  function alert(text) {
    return new Promise(resolve => {
      msg().textContent = text;
      cancel().style.display = 'none';
      open();
      ok().onclick = () => { close(); resolve(); };
    });
  }

  function confirm(text) {
    return new Promise(resolve => {
      msg().textContent = text;
      cancel().style.display = 'inline-flex';
      open();
      ok().onclick = () => { close(); resolve(true); };
      cancel().onclick = () => { close(); resolve(false); };
    });
  }

  function prompt(text, placeholder = '', isPassword = false) {
    return new Promise(resolve => {
      msg().textContent = text;
      input().type = isPassword ? 'password' : 'text';
      input().placeholder = placeholder;
      input().style.display = 'block';
      cancel().style.display = 'inline-flex';
      open();
      setTimeout(() => input().focus(), 50);
      ok().onclick = () => { const v = input().value.trim(); close(); resolve(v || null); };
      cancel().onclick = () => { close(); resolve(null); };
      input().onkeydown = e => {
        if (e.key === 'Enter') ok().click();
        if (e.key === 'Escape') cancel().click();
      };
    });
  }

  return { alert, confirm, prompt };
})();

// ── AUTH FEEDBACK ──────────────────────────────────────────
function showAuthFeedback(msg, type = 'error') {
  const fb = $('authFeedback');
  if (!fb) return;
  fb.innerHTML = msg;
  fb.className = `auth-feedback ${type}`;
}
function clearAuthFeedback() {
  const fb = $('authFeedback');
  if (fb) { fb.textContent = ''; fb.className = 'auth-feedback'; }
}
function setAuthState(state) {
  clearAuthFeedback();
  if (authModal) authModal.setAttribute('data-state', state);
}

$('linkToRegister').addEventListener('click', e => { e.preventDefault(); setAuthState('register'); });
$('linkToForgot').addEventListener('click', e => { e.preventDefault(); setAuthState('forgot'); });
$('backFromRegister').addEventListener('click', () => setAuthState('login'));
$('backFromForgot').addEventListener('click', () => setAuthState('login'));

// ── APP TABS ───────────────────────────────────────────────
function switchTab(tabName) {
  const TABS = ['Home', 'Collection', 'Wishlist', 'Group', 'Admin'];
  TABS.forEach(t => {
    $(`panel${t}`)?.classList.remove('active');
    $(`tab${t}Btn`)?.classList.remove('active');
  });
  $(`panel${tabName}`)?.classList.add('active');
  $(`tab${tabName}Btn`)?.classList.add('active');
  if (tabName === 'Admin') loadAdminPanel();
  if (tabName === 'Home') runMatches();
}

['Home', 'Collection', 'Wishlist', 'Group', 'Admin'].forEach(tab => {
  const btn = $(`tab${tab}Btn`);
  if (btn) btn.addEventListener('click', () => switchTab(tab));
});

// ── SYNC STATUS INDICATOR ──────────────────────────────────
function setSyncStatus(prefix, state) {
  // state: 'saving' | 'saved' | ''
  const el = $(`${prefix}SyncStatus`);
  if (!el) return;
  el.className = `sync-status sync-${state}`;
  el.textContent = state === 'saving' ? 'Guardando…' : state === 'saved' ? '✓ Guardado' : '';
  // Un timeout antiguo no debe borrar un estado "Guardando…" más reciente
  clearTimeout(syncStatusTimers[prefix]);
  if (state === 'saved') syncStatusTimers[prefix] = setTimeout(() => setSyncStatus(prefix, ''), 2000);
}

// ── AUTH STATE OBSERVER ────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (isRegistering) return;

  if (user && user.emailVerified) {
    try {
      const doc = await db.collection('players').doc(user.uid).get();
      let username = user.email.split('@')[0];
      let isAdmin = false;

      if (doc.exists) {
        const d = doc.data();
        username = d.name || username;
        isAdmin = !!d.isAdmin;
      } else {
        await db.collection('players').doc(user.uid).set({
          name: username, nameLower: username.toLowerCase(), isAdmin: false, groupId: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      currentPlayer = {
        uid: user.uid, name: username, isAdmin,
        groupId: doc.exists ? (doc.data().groupId || null) : null
      };
      $('authPillText').textContent = username;
      $('userMenuBtn').classList.add('active');

      const adminBtn = $('tabAdminBtn');
      if (adminBtn) isAdmin ? adminBtn.classList.remove('hidden') : adminBtn.classList.add('hidden');

      $('loginScreen').classList.add('hidden');
      $('mainApp').classList.remove('hidden');
      hideLoader();

      // Reclama tu nombre en la colección usernames (best-effort para cuentas antiguas)
      ensureUsernameClaim(username.toLowerCase(), user.uid);

      await loadCloudData();
      subscribeCloudData();
      subscribeGroupData();
      // Si llegaste por un enlace de invitación, únete automáticamente al grupo
      handleInviteLink();
      toast(`Bienvenido, ${username}`);

    } catch (e) {
      console.error(e);
      toast('Error al cargar tu perfil. Recarga la página.', 'err');
    }

  } else {
    if (user && !user.emailVerified) { await auth.signOut(); return; }
    if (unsubCol) { unsubCol(); unsubCol = null; }
    if (unsubWl) { unsubWl(); unsubWl = null; }
    if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
    if (unsubGroup) { unsubGroup(); unsubGroup = null; }
    groupCollections = {};
    groupWishlists = {};
    groupPlayers = {};
    currentGroup = null;
    groupDataReady = { col: false, wl: false };
    currentPlayer = null;
    hideLoader();
    $('authPillText').textContent = 'Sin sesión';
    $('userMenuBtn').classList.remove('active');
    $('tabAdminBtn')?.classList.add('hidden');

    switchTab('Home');
    myCollections = { "Mi colección": [] };
    myWishlists = { "Mi wishlist": [] };
    activeColList = "Mi colección";
    activeWlList = "Mi wishlist";

    $('mainApp').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    setAuthState('login');
  }
});

// ── AUTH ERRORS ────────────────────────────────────────────
const AUTH_ERRORS = {
  'auth/user-not-found': 'El correo o la contraseña no son correctos.',
  'auth/wrong-password': 'El correo o la contraseña no son correctos.',
  'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
  'auth/invalid-login-credentials': 'El correo o la contraseña no son correctos.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/email-already-in-use': 'Ese correo ya está registrado.',
  'auth/invalid-email': 'El formato del correo no es válido.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/network-request-failed': 'Sin conexión. Comprueba tu red.',
};

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearAuthFeedback();

  const state = authModal.getAttribute('data-state');
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const username = $('authUsername').value.trim();

  if (!email) return showAuthFeedback('Introduce tu correo electrónico.');

  try {
    if (state === 'login') {
      if (!password) return showAuthFeedback('Introduce tu contraseña.');
      const cred = await auth.signInWithEmailAndPassword(email, password);
      if (!cred.user.emailVerified) {
        await auth.signOut();
        showAuthFeedback('Debes verificar tu correo antes de entrar. Revisa tu bandeja de entrada o SPAM.');
      }

    } else if (state === 'register') {
      if (!username) return showAuthFeedback('Elige un nombre de jugador.');
      if (!password || password.length < 6) return showAuthFeedback('La contraseña debe tener al menos 6 caracteres.');

      isRegistering = true;
      try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const nameLower = username.toLowerCase();

        try {
          // Reclamación ATÓMICA del nombre: usernames/{nameLower} es la clave única.
          // Si dos personas se registran a la vez con el mismo nombre, solo una
          // consigue crear el documento y la transacción de la otra falla.
          await db.runTransaction(async t => {
            const uRef = db.collection('usernames').doc(nameLower);
            const uSnap = await t.get(uRef);
            if (uSnap.exists) throw new Error('USERNAME_TAKEN');
            const now = firebase.firestore.FieldValue.serverTimestamp();
            t.set(uRef, { uid: cred.user.uid, createdAt: now });
            t.set(db.collection('players').doc(cred.user.uid), {
              name: username, nameLower, isAdmin: false, groupId: null, createdAt: now
            });
          });
        } catch (txErr) {
          await cred.user.delete().catch(() => {});
          await auth.signOut();
          isRegistering = false;
          return showAuthFeedback(
            txErr && txErr.message === 'USERNAME_TAKEN'
              ? 'Ese nombre de jugador ya está en uso. Elige otro.'
              : 'No se pudo crear la cuenta. Inténtalo de nuevo.'
          );
        }

        await cred.user.sendEmailVerification();
        await auth.signOut();
      } finally { isRegistering = false; }

      setAuthState('login');
      showAuthFeedback(
        `¡Cuenta creada! Hemos enviado un enlace de verificación a <strong>${escapeHtml(email)}</strong>. Haz clic en él y luego inicia sesión.`,
        'success'
      );

    } else if (state === 'forgot') {
      await auth.sendPasswordResetEmail(email);
      showAuthFeedback('Enlace enviado. Revisa tu correo y la carpeta de SPAM.', 'success');
    }

  } catch (err) {
    const friendly = AUTH_ERRORS[err.code];
    if (friendly) showAuthFeedback(friendly);
    else { console.error('[Auth]', err); showAuthFeedback('Algo salió mal. Inténtalo de nuevo.'); }
  }
});

// ── ACCOUNT MODAL ──────────────────────────────────────────
const accModal = $('accountModal');

$('userMenuBtn')?.addEventListener('click', () => {
  if (!currentPlayer) return;
  $('usernameChangeStatus').classList.add('hidden');
  $('newUsernameInput').value = currentPlayer.name;
  accModal.classList.remove('hidden');
});

$('closeAccountModalBtn')?.addEventListener('click', () => accModal.classList.add('hidden'));

// Cerrar modal al hacer clic en el fondo
accModal?.addEventListener('click', e => { if (e.target === accModal) accModal.classList.add('hidden'); });

$('modalLogoutBtn')?.addEventListener('click', async () => {
  accModal.classList.add('hidden');
  await auth.signOut();
  toast('Sesión cerrada.', 'inf');
});

$('saveNewUsernameBtn')?.addEventListener('click', async () => {
  const input = $('newUsernameInput');
  const status = $('usernameChangeStatus');
  const newName = input.value.trim();

  if (!newName) {
    status.classList.remove('hidden');
    status.className = 'username-status err';
    status.textContent = 'El nombre no puede estar vacío.';
    return;
  }
  if (newName.toLowerCase() === currentPlayer.name.toLowerCase()) {
    accModal.classList.add('hidden');
    return;
  }

  status.classList.remove('hidden');
  status.className = 'username-status inf';
  status.textContent = 'Comprobando…';

  const newLower = newName.toLowerCase();
  const oldLower = currentPlayer.name.toLowerCase();

  try {
    // Reclamación atómica del nuevo nombre + actualización del perfil en una transacción
    await db.runTransaction(async t => {
      const uRef = db.collection('usernames').doc(newLower);
      const uSnap = await t.get(uRef);
      if (uSnap.exists && uSnap.data().uid !== currentPlayer.uid) throw new Error('USERNAME_TAKEN');
      if (!uSnap.exists) t.set(uRef, { uid: currentPlayer.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      t.update(db.collection('players').doc(currentPlayer.uid), { name: newName, nameLower: newLower });
    });
    // Libera el nombre antiguo si era tuyo (best-effort: puede no existir en cuentas antiguas)
    if (oldLower !== newLower) {
      db.collection('usernames').doc(oldLower).get()
        .then(snap => { if (snap.exists && snap.data().uid === currentPlayer.uid) return snap.ref.delete(); })
        .catch(() => {});
    }
    // Propaga el nuevo nombre a tus documentos de colección/wishlist
    // para que el resto del grupo vea el cambio en los cruces sin esperar a un nuevo guardado
    const nameUpdate = { name: newName };
    await Promise.all([
      db.collection('collections').doc(currentPlayer.uid).update(nameUpdate).catch(() => {}),
      db.collection('wishlists').doc(currentPlayer.uid).update(nameUpdate).catch(() => {})
    ]);
    currentPlayer.name = newName;
    $('authPillText').textContent = newName;
    status.className = 'username-status ok';
    status.textContent = '¡Nombre actualizado!';
    toast('Nombre guardado.');
    setTimeout(() => accModal.classList.add('hidden'), 1200);
  } catch (e) {
    status.className = 'username-status err';
    status.textContent = 'Error al guardar. Inténtalo de nuevo.';
  }
});

$('modalDeleteBtn')?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;

  const ok = await bModal.confirm('¿Eliminar tu cuenta? Se borrarán tu perfil, colección y wishlist de forma permanente.');
  if (!ok) return;

  const pwd = await bModal.prompt('Introduce tu contraseña para confirmar:', '••••••••', true);
  if (!pwd) return;

  try {
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, pwd);
    await user.reauthenticateWithCredential(credential);
    toast('Verificado. Borrando datos…', 'inf');
    await db.collection('collections').doc(user.uid).delete().catch(() => { });
    await db.collection('wishlists').doc(user.uid).delete().catch(() => { });
    await db.collection('players').doc(user.uid).delete().catch(() => { });
    await db.collection('usernames').doc(currentPlayer.name.toLowerCase()).delete().catch(() => { });
    accModal.classList.add('hidden');
    await user.delete();
    toast('Cuenta eliminada.', 'inf');
  } catch (err) {
    const wrongPwd = ['auth/wrong-password', 'auth/invalid-login-credentials', 'auth/internal-error'];
    if (wrongPwd.includes(err.code)) await bModal.alert('Contraseña incorrecta. Acción cancelada.');
    else await bModal.alert('Error al eliminar. Inténtalo de nuevo.');
  }
});

// ── CLOUD DATA ─────────────────────────────────────────────
async function loadCloudData() {
  if (!currentPlayer) return;

  try {
    const colDoc = await db.collection('collections').doc(currentPlayer.uid).get();
    if (colDoc.exists) {
      const d = colDoc.data();
      myCollections = d.lists ? d.lists : { "Mi colección": d.cards || [] };
    }
  } catch (e) { console.warn('Colección:', e); }

  if (!myCollections[activeColList]) activeColList = Object.keys(myCollections)[0] || "Mi colección";
  updateListUI('col');

  try {
    const wlDoc = await db.collection('wishlists').doc(currentPlayer.uid).get();
    if (wlDoc.exists) {
      const d = wlDoc.data();
      myWishlists = d.lists ? d.lists : { "Mi wishlist": d.cards || [] };
    }
  } catch (e) { console.warn('Wishlist:', e); }

  if (!myWishlists[activeWlList]) activeWlList = Object.keys(myWishlists)[0] || "Mi wishlist";
  updateListUI('wl');
  renderWishlistMatchSelector();
}

// ── AUTOSAVE CON DEBOUNCE ──────────────────────────────────
function scheduleSave(prefix) {
  clearTimeout(saveTimers[prefix]);
  setSyncStatus(prefix, 'saving');
  saveTimers[prefix] = setTimeout(() => saveFullDictToCloud(prefix), 1200);
}

async function saveFullDictToCloud(prefix) {
  if (!currentPlayer) return;
  const colName = prefix === 'col' ? 'collections' : 'wishlists';
  const dict = prefix === 'col' ? myCollections : myWishlists;
  try {
    await db.collection(colName).doc(currentPlayer.uid).set({
      name: currentPlayer.name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lists: dict
    });
    setSyncStatus(prefix, 'saved');
  } catch (e) {
    setSyncStatus(prefix, '');
    toast('Error al sincronizar.', 'err');
  }
}

// ── LIST UI ────────────────────────────────────────────────
function updateListUI(prefix) {
  const isCol = prefix === 'col';
  const dict = isCol ? myCollections : myWishlists;
  const active = isCol ? activeColList : activeWlList;
  const selectEl = $(`${prefix}ListSelect`);
  const textarea = $(isCol ? 'collectionInput' : 'wishlistInput');

  selectEl.innerHTML = '';
  Object.keys(dict).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${dict[name].length})`;
    if (name === active) opt.selected = true;
    selectEl.appendChild(opt);
  });

  const arr = dict[active] || [];
  textarea.value = arr.join('\n');
  updateCardCount(prefix, arr.length);
  renderVisualList(prefix, $(`${prefix}SearchInput`).value);
  renderOnboarding(prefix, arr.length);
}

function updateCardCount(prefix, n) {
  const el = $(`${prefix}CardCount`);
  if (el) el.textContent = n > 0 ? `${n} carta${n !== 1 ? 's' : ''}` : '';
}

function renderOnboarding(prefix, count) {
  const el = $(`${prefix}Onboarding`);
  if (!el) return;
  el.classList.toggle('hidden', count > 0);
}

function switchToList(prefix, name) {
  if (prefix === 'col') activeColList = name; else activeWlList = name;
  // El filtro de búsqueda de la lista anterior no debe quedar aplicado a la nueva
  const inp = $(`${prefix}SearchInput`);
  if (inp) inp.value = '';
  updateListUI(prefix);
}

$('colListSelect').addEventListener('change', e => switchToList('col', e.target.value));
$('wlListSelect').addEventListener('change', e => switchToList('wl', e.target.value));

// ── LIST MANAGEMENT ────────────────────────────────────────
async function handleNewList(prefix) {
  const name = await bModal.prompt('Nombre de la nueva lista:', 'Ej: Mazo moderno');
  if (!name) return;
  const dict = prefix === 'col' ? myCollections : myWishlists;
  if (dict[name]) { await bModal.alert('Ya existe una lista con ese nombre.'); return; }
  dict[name] = [];
  switchToList(prefix, name);
  saveFullDictToCloud(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();
}

async function handleDeleteList(prefix) {
  const dict = prefix === 'col' ? myCollections : myWishlists;
  const active = prefix === 'col' ? activeColList : activeWlList;
  if (Object.keys(dict).length <= 1) { await bModal.alert('No puedes eliminar la única lista.'); return; }
  const ok = await bModal.confirm(`¿Eliminar "${active}" y todas sus cartas? No se puede deshacer.`);
  if (!ok) return;
  delete dict[active];
  switchToList(prefix, Object.keys(dict)[0]);
  saveFullDictToCloud(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();
  toast('Lista eliminada.');
}

async function handleClearList(prefix) {
  const active = prefix === 'col' ? activeColList : activeWlList;
  const ok = await bModal.confirm(`¿Vaciar todas las cartas de "${active}"?`);
  if (!ok) return;
  if (prefix === 'col') myCollections[activeColList] = [];
  else myWishlists[activeWlList] = [];
  updateListUI(prefix);
  saveFullDictToCloud(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();
  toast('Lista vaciada.');
}

$('colNewListBtn').addEventListener('click', () => handleNewList('col'));
$('wlNewListBtn').addEventListener('click', () => handleNewList('wl'));
$('colDelListBtn').addEventListener('click', () => handleDeleteList('col'));
$('wlDelListBtn').addEventListener('click', () => handleDeleteList('wl'));
$('colClearListBtn').addEventListener('click', () => handleClearList('col'));
$('wlClearListBtn').addEventListener('click', () => handleClearList('wl'));

// ── AÑADIR CARTA CON INPUT RÁPIDO ─────────────────────────
function setupQuickAdd(prefix) {
  const input = $(`${prefix}QuickAddInput`);
  const button = $(`${prefix}QuickAddBtn`);
  if (!input || !button) return;

  function addCard() {
    const raw = input.value.trim();
    if (!raw) return;
    const dict = prefix === 'col' ? myCollections : myWishlists;
    const active = prefix === 'col' ? activeColList : activeWlList;
    // Acepta "4 Lightning Bolt", "4x Lightning Bolt", "SB: 3 …" o solo "Lightning Bolt" (asume 1x)
    const { qty, name } = parseCardString(raw);
    const entry = `${qty} ${name}`;
    dict[active].push(entry);
    input.value = '';
    updateListUI(prefix);
    scheduleSave(prefix);
    if (prefix === 'wl') renderWishlistMatchSelector();
  }

  button.addEventListener('click', addCard);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCard(); } });
}
setupQuickAdd('col');
setupQuickAdd('wl');

// ── TEXTAREA AUTOSAVE ──────────────────────────────────────
function setupTextareaAutosave(prefix) {
  const textarea = $(prefix === 'col' ? 'collectionInput' : 'wishlistInput');
  if (!textarea) return;

  textarea.addEventListener('input', () => {
    const dict = prefix === 'col' ? myCollections : myWishlists;
    const active = prefix === 'col' ? activeColList : activeWlList;
    const cards = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    dict[active] = cards;
    updateCardCount(prefix, cards.length);
    renderOnboarding(prefix, cards.length);
    scheduleSave(prefix);
    if (prefix === 'wl') renderWishlistMatchSelector();
  });

  textarea.addEventListener('blur', () => {
    // Al salir del textarea renderizar la vista lista
    updateListUI(prefix);
  });
}
setupTextareaAutosave('col');
setupTextareaAutosave('wl');

// ── VISUAL LIST — paginada ───────────────
const PAGE_SIZE = 15;
const listPage = { col: 0, wl: 0 };

function renderVisualList(prefix, filterText = '', keepPage = false) {
  const container = $(`${prefix}ListView`);
  if (!container) return;
  const dict = prefix === 'col' ? myCollections : myWishlists;
  const active = prefix === 'col' ? activeColList : activeWlList;
  const arr = dict[active] || [];

  if (!keepPage) listPage[prefix] = 0;

  const clearBtn = $(`${prefix}ClearSearchBtn`);
  if (clearBtn) clearBtn.style.display = filterText ? 'block' : 'none';

  if (!arr.length) { container.innerHTML = ''; return; }

  const filtered = arr.map((s, i) => ({ s, i })).filter(({ s }) => {
    if (!filterText) return true;
    const { name } = parseCardString(s);
    return name.toLowerCase().includes(filterText.toLowerCase());
  });

  if (!filtered.length) {
    container.innerHTML = '<p class="text-muted">No se encontraron cartas.</p>';
    return;
  }

  const page = listPage[prefix];
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, filtered.length);
  const pageItems = filtered.slice(start, end);

  container.innerHTML = '';

  // Barra superior
  const bar = document.createElement('div');
  bar.className = 'list-page-bar';
  bar.innerHTML =
    `<span class="list-page-info">${filtered.length} carta${filtered.length !== 1 ? 's' : ''}` +
    (filterText ? ' encontradas' : '') +
    (totalPages > 1 ? ` &mdash; p. ${page + 1}/${totalPages}` : '') +
    `</span>` +
    (totalPages > 1 ? `<div class="list-page-btns">` +
      `<button class="btn btn-sm btn-ghost page-prev" ${page === 0 ? 'disabled' : ''}>&#8249; Ant.</button>` +
      `<button class="btn btn-sm btn-ghost page-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Sig. &#8250;</button>` +
      `</div>` : '');
  container.appendChild(bar);

  // Filas
  pageItems.forEach(({ s, i }) => {
    const { qty, name } = parseCardString(s);
    const row = document.createElement('div');
    row.className = 'visual-card-row';
    row.innerHTML =
      `<div class="card-info">` +
      `<span class="qty-badge">${qty}x</span>` +
      `<span class="card-name">${escapeHtml(name)}</span>` +
      `</div>` +
      `<button class="card-delete-btn" title="Eliminar carta">&times;</button>`;
    row.querySelector('.card-delete-btn').addEventListener('click', () => {
      arr.splice(i, 1);
      if (prefix === 'col') myCollections[activeColList] = arr;
      else myWishlists[activeWlList] = arr;
      updateListUI(prefix);
      scheduleSave(prefix);
      if (prefix === 'wl') renderWishlistMatchSelector();
    });
    container.appendChild(row);
  });

  // Barra inferior (solo si hay varias páginas)
  if (totalPages > 1) {
    const bar2 = document.createElement('div');
    bar2.className = 'list-page-bar';
    bar2.innerHTML =
      `<span class="list-page-info">Mostrando ${start + 1}&ndash;${end} de ${filtered.length}</span>` +
      `<div class="list-page-btns">` +
      `<button class="btn btn-sm btn-ghost page-prev" ${page === 0 ? 'disabled' : ''}>&#8249; Anterior</button>` +
      `<button class="btn btn-sm btn-ghost page-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Siguiente &#8250;</button>` +
      `</div>`;
    container.appendChild(bar2);
  }

  // Listeners paginación
  container.querySelectorAll('.page-prev').forEach(btn => {
    btn.addEventListener('click', () => {
      if (listPage[prefix] > 0) {
        listPage[prefix]--;
        renderVisualList(prefix, filterText, true);
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
  container.querySelectorAll('.page-next').forEach(btn => {
    btn.addEventListener('click', () => {
      if (listPage[prefix] < totalPages - 1) {
        listPage[prefix]++;
        renderVisualList(prefix, filterText, true);
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

['col', 'wl'].forEach(prefix => {
  const inp = $(`${prefix}SearchInput`);
  const btn = $(`${prefix}ClearSearchBtn`);
  if (inp) inp.addEventListener('input', e => renderVisualList(prefix, e.target.value));
  if (btn) btn.addEventListener('click', () => { inp.value = ''; renderVisualList(prefix, ''); });
});

// ── IMPORT TABS ────────────────────────────────────────────
document.querySelectorAll('.imp-mode-tabs').forEach(tabGroup => {
  tabGroup.querySelectorAll('.imp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tabGroup.querySelectorAll('.imp-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.target;
      tabGroup.parentElement.querySelectorAll('.imp-panel').forEach(p => {
        p.classList.toggle('active', p.id === target);
      });
    });
  });
});

// ── MERGE CARDS (tras importación) ────────────────────────
function mergeAndSave(textareaId, newCards) {
  const existing = $(textareaId).value.split('\n').map(l => l.trim()).filter(l => l);
  // Suma cantidades de cartas duplicadas en vez de duplicar la línea
  const merged = mergeCardLists(existing, newCards);
  $(textareaId).value = merged.join('\n');

  const prefix = textareaId.includes('collection') ? 'col' : 'wl';
  if (prefix === 'col') myCollections[activeColList] = merged;
  else myWishlists[activeWlList] = merged;

  updateListUI(prefix);
  scheduleSave(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();

  // Volver a la vista lista tras importar
  const panel = prefix === 'col' ? $('panelCollection') : $('panelWishlist');
  const tg = panel.querySelector('.imp-mode-tabs');
  const viewId = `${prefix}-view`;
  tg.querySelectorAll('.imp-tab').forEach(b => b.classList.toggle('active', b.dataset.target === viewId));
  panel.querySelectorAll('.imp-panel').forEach(p => p.classList.toggle('active', p.id === viewId));
}

// ── URL IMPORT ─────────────────────────────────────────────
// Proxies CORS en orden de preferencia (fallback automático si uno falla)
// const CORS_PROXIES = [
//   url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
//   url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
//   url => `https://corsproxy.io/?${encodeURIComponent(url)}`
// ];

// async function fetchWithProxy(targetUrl) {
//   let lastErr;
//   for (const proxyFn of CORS_PROXIES) {
//     try {
//       const resp = await fetch(proxyFn(targetUrl), { signal: AbortSignal.timeout(8000) });
//       if (!resp.ok) { lastErr = new Error(`HTTP ${resp.status}`); continue; }
//       const text = await resp.text();
//       try {
//         return JSON.parse(text);
//       } catch (e) {
//         // Si el proxy falla y devuelve HTML en lugar del JSON, forzamos que pruebe el siguiente
//         throw new Error('Respuesta inválida (posible bloqueo de proxy)');
//       }
//     } catch (e) { lastErr = e; }
//   }
//   throw lastErr || new Error('No se pudo conectar con ningún proxy CORS.');
// }



// $('colFetchUrlBtn').addEventListener('click', () => {
//   const url = $('colUrlInput').value.trim();
//   if (!url) { $('colUrlStatus').textContent = 'Introduce una URL primero.'; $('colUrlStatus').className = 'imp-status err'; return; }
//   fetchDeckFromUrl(url, 'colUrlStatus', 'collectionInput');
// });
// $('wlFetchUrlBtn').addEventListener('click', () => {
//   const url = $('wlUrlInput').value.trim();
//   if (!url) { $('wlUrlStatus').textContent = 'Introduce una URL primero.'; $('wlUrlStatus').className = 'imp-status err'; return; }
//   fetchDeckFromUrl(url, 'wlUrlStatus', 'wishlistInput');
// });

// ── CSV IMPORT ─────────────────────────────────────────────
// parseCSV vive en card-utils.js (cargado antes).

function setupCSVDrop(dropZoneId, fileInputId, statusId, textareaId) {
  const zone = $(dropZoneId);
  const input = $(fileInputId);
  const status = $(statusId);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => handleFile(input.files[0]));

  function handleFile(file) {
    if (!file) return;
    if (!file.name.match(/\.(csv|txt)$/i)) {
      status.textContent = '⚠ Formato no válido. Usa .csv o .txt';
      status.className = 'imp-status err';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const cards = parseCSV(ev.target.result);
      if (!cards.length) {
        status.textContent = 'El archivo no tiene cartas reconocibles.';
        status.className = 'imp-status err';
        return;
      }
      mergeAndSave(textareaId, cards);
      status.textContent = `✓ ${cards.length} cartas importadas.`;
      status.className = 'imp-status ok';
    };
    reader.readAsText(file);
  }
}
setupCSVDrop('colDropZone', 'colFileInput', 'colCsvStatus', 'collectionInput');
setupCSVDrop('wlDropZone', 'wlFileInput', 'wlCsvStatus', 'wishlistInput');

// ── WISHLIST MATCH SELECTOR ────────────────────────────────
function renderWishlistMatchSelector() {
  const container = $('wishlistMatchSelector');
  const box = $('wishlistMatchSelectorBox');
  if (!container || !box) return;
  container.innerHTML = '';
  const keys = Object.keys(myWishlists);
  if (!keys.length) {
    box.style.display = 'block';
    container.innerHTML = '<p class="text-xs text-muted">Todavía no tienes wishlists. Añade cartas en la pestaña «Mi Wishlist».</p>';
    return;
  }
  // Con una sola wishlist no hay nada que elegir: ocultamos el selector.
  if (keys.length === 1) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  keys.forEach(listName => {
    const lbl = document.createElement('label');
    lbl.className = 'wl-checkbox-label';
    lbl.innerHTML = `
      <input type="checkbox" value="${escapeHtml(listName)}" class="wl-match-cb" checked>
      ${escapeHtml(listName)} <span class="text-xs text-muted">(${myWishlists[listName].length})</span>`;
    container.appendChild(lbl);
  });
}

// ── MATCHER (3 columnas colapsables) ──────────────────────
function runMatches() {
  if (!currentPlayer) return;

  const iWantEl = $('matchesIWant');
  const theyWantEl = $('matchesTheyWant');
  const iHaveEl = $('matchesIHave');
  if (!iWantEl) return;

  [iWantEl, theyWantEl, iHaveEl].forEach(el => { if (el) el.innerHTML = '<p class="text-muted">Buscando…</p>'; });

  // Aviso si aún no estás en ningún grupo
  const noGroupHint = $('noGroupHint');
  if (noGroupHint) noGroupHint.style.display = currentPlayer.groupId ? 'none' : 'block';

  // Cálculo puro de cruces (definido en card-utils.js, cubierto por tests)
  const selectedWl = Array.from(document.querySelectorAll('.wl-match-cb:checked')).map(cb => cb.value);
  const effectiveSelected = selectedWl.length ? selectedWl : Object.keys(myWishlists);
  const { owned, partial, iWant, theyWant, hasWanted } = computeMatches({
    myWishlists,
    selectedLists: effectiveSelected,
    myCollections,
    groupCollections,
    groupWishlists,
    myUid: currentPlayer.uid
  });

  // 3. Cartas de mi wishlist que YA tengo
  if (iHaveEl) {
    if (!hasWanted) {
      iHaveEl.innerHTML = '<p class="text-muted">Añade cartas a tu wishlist primero.</p>';
    } else {
      const sections = [];
      if (owned.length) {
        sections.push(renderCollapsibleGroup('Tu colección', owned.map(o =>
          `<li><span class="qty-badge qty-mine">${o.have}</span><strong>${escapeHtml(o.name)}</strong><span class="match-meta">buscas ${o.want}</span></li>`
        ).join(''), owned.length));
      }
      if (partial.length) {
        sections.push(renderCollapsibleGroup('Parcial — te faltan cartas', partial.map(o =>
          `<li><span class="qty-badge qty-partial">${o.have}/${o.want}</span><strong>${escapeHtml(o.name)}</strong><span class="match-meta">te faltan ${Math.max(0, o.want - o.have)}</span></li>`
        ).join(''), partial.length));
      }
      iHaveEl.innerHTML = sections.length
        ? sections.join('')
        : '<p class="text-muted">No tienes ninguna de tus cartas buscadas en tu colección.</p>';
    }
  }

  // 4. Procesar datos del GRUPO (cálculo puro + renderizado)
  if (!groupDataReady.col || !groupDataReady.wl) {
    if (iWantEl) iWantEl.innerHTML = '<p class="text-muted">Cargando datos del grupo… vuelve a intentarlo en un momento.</p>';
    if (theyWantEl) theyWantEl.innerHTML = '';
    return;
  }

  iWantEl.innerHTML = iWant.length
    ? iWant.map(g => renderCollapsibleGroup(g.name, g.hits.map(h =>
      `<li><span class="qty-badge qty-available">${h.available}</span><strong>${escapeHtml(h.name)}</strong><span class="match-meta">buscas ${h.qty}</span></li>`
    ).join(''), g.hits.length, g.lines)).join('')
    : '<p class="text-muted">Nadie del grupo tiene lo que buscas.</p>';

  if (theyWantEl) theyWantEl.innerHTML = theyWant.length
    ? theyWant.map(g => renderCollapsibleGroup(g.name, g.hits.map(h =>
      `<li><span class="qty-badge qty-mine">${h.mine}</span><strong>${escapeHtml(h.name)}</strong><span class="match-meta">ellos buscan ${h.want}</span></li>`
    ).join(''), g.hits.length)).join('')
    : '<p class="text-muted">Nadie del grupo busca lo que tienes.</p>';

  // Activar colapsables
  document.querySelectorAll('.collapsible-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const open = body.classList.toggle('collapsed');
      btn.querySelector('.collapse-arrow').textContent = open ? '▸' : '▾';
    });
  });

  // Botón copiar mensaje WhatsApp
  document.querySelectorAll('.btn-copy-msg').forEach(btn => {
    btn.addEventListener('click', () => {
      const playerName = btn.dataset.player;
      const cardLines = JSON.parse(btn.dataset.cards);
      const msg = buildWhatsAppMessage(playerName, cardLines);
      navigator.clipboard.writeText(msg).then(() => {
        toast('Mensaje copiado al portapapeles');
      }).catch(() => {
        // Fallback para navegadores sin clipboard API
        const ta = document.createElement('textarea');
        ta.value = msg;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Mensaje copiado al portapapeles');
      });
    });
  });
}

function renderCollapsibleGroup(playerName, itemsHtml, count, cardLines = []) {
  const groupId = 'cg-' + Math.random().toString(36).slice(2, 8);
  return `
    <div class="match-card" id="${groupId}">
      <button class="collapsible-toggle">
        <span class="collapse-arrow">▸</span> <!-- CAMBIO 1: Flecha hacia la derecha -->
        <span class="collapse-name">${escapeHtml(playerName)}</span>
        <span class="collapse-count">${count} carta${count !== 1 ? 's' : ''}</span>
      </button>
      <div class="collapsible-body collapsed"> <!-- CAMBIO 2: Añadida la clase 'collapsed' -->
        <ul class="match-item-list">${itemsHtml}</ul>
        ${cardLines.length ? `<button class="btn-copy-msg btn btn-sm btn-ghost" data-player="${escapeHtml(playerName)}" data-cards="${escapeHtml(JSON.stringify(cardLines))}">Copiar mensaje</button>` : ''}
      </div>
    </div>`;
}

function buildWhatsAppMessage(playerName, cardLines) {
  const list = cardLines.map(c => `  - ${c}`).join('\n');
  return `Hola ${playerName}, me interesan estas cartas de tu colección:\n${list}\n¡Gracias!`;
}
$('refreshMatchesBtn')?.addEventListener('click', runMatches);
$('hintCreateGroupBtn')?.addEventListener('click', handleCreateGroup);
$('hintJoinGroupBtn')?.addEventListener('click', handleJoinGroup);

// ── GRUPO (crear / unirse / salir) ─────────────────────────
function generateGroupCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para evitar confusiones
  let code = '';
  for (let i = 0; i < len; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function hideLoader() {
  const loader = $('appLoader');
  if (loader) loader.classList.add('hidden');
}

// Reclama tu nombre en la colección usernames si aún no existe (cuentas antiguas)
async function ensureUsernameClaim(nameLower, uid) {
  try {
    const ref = db.collection('usernames').doc(nameLower);
    const snap = await ref.get();
    if (!snap.exists) await ref.set({ uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (e) { console.warn('ensureUsernameClaim:', e); }
}

// Suscribe colecciones + wishlists. Las reglas de Firestore filtran a tu grupo,
// así que aquí solo llegan tus documentos y los de tu gente.
function subscribeCloudData() {
  if (unsubCol) { unsubCol(); unsubCol = null; }
  if (unsubWl) { unsubWl(); unsubWl = null; }
  groupDataReady = { col: false, wl: false };

  unsubCol = db.collection('collections').onSnapshot(snap => {
    const data = {};
    snap.forEach(doc => { data[doc.id] = doc.data(); });
    groupCollections = data;
    groupDataReady.col = true;
    if (groupDataReady.col && groupDataReady.wl) runMatches();
  }, err => {
    console.error('Snapshot collections:', err);
    groupDataReady.col = true;
    if (groupDataReady.col && groupDataReady.wl) runMatches();
    toast('Error al sincronizar las colecciones del grupo.', 'err');
  });

  unsubWl = db.collection('wishlists').onSnapshot(snap => {
    const data = {};
    snap.forEach(doc => { data[doc.id] = doc.data(); });
    groupWishlists = data;
    groupDataReady.wl = true;
    if (groupDataReady.col && groupDataReady.wl) runMatches();
  }, err => {
    console.error('Snapshot wishlists:', err);
    groupDataReady.wl = true;
    if (groupDataReady.col && groupDataReady.wl) runMatches();
    toast('Error al sincronizar las wishlists del grupo.', 'err');
  });
}

// Escucha a los jugadores (solo tú + tu grupo, según reglas) y al documento del grupo
function subscribeGroupData() {
  if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
  if (unsubGroup) { unsubGroup(); unsubGroup = null; }
  groupPlayers = {};

  unsubPlayers = db.collection('players').onSnapshot(snap => {
    const data = {};
    snap.forEach(doc => { data[doc.id] = doc.data(); });
    groupPlayers = data;
    renderGroupPanel();
  }, err => console.error('Snapshot players:', err));

  if (currentPlayer?.groupId) {
    unsubGroup = db.collection('groups').doc(currentPlayer.groupId).onSnapshot(snap => {
      currentGroup = snap.exists ? snap.data() : null;
      renderGroupPanel();
    }, err => console.error('Snapshot group:', err));
  } else {
    currentGroup = null;
  }
  renderGroupPanel();
}

function renderGroupPanel() {
  const panel = $('groupInfo');
  if (!panel) return;
  const gid = currentPlayer?.groupId;

  if (!gid) {
    panel.innerHTML = `
      <p class="text-muted mb-4">Aún no estás en ningún grupo. Crea uno y comparte el código, o únete con el código de un amigo.</p>
      <div class="group-actions">
        <button class="btn btn-sm btn-gold" id="btnCreateGroup">+ Crear grupo</button>
        <button class="btn btn-sm btn-blue" id="btnJoinGroup">Unirme con código</button>
      </div>`;
    $('btnCreateGroup')?.addEventListener('click', handleCreateGroup);
    $('btnJoinGroup')?.addEventListener('click', handleJoinGroup);
    return;
  }

  const members = Object.values(groupPlayers)
    .filter(p => p.groupId === gid)
    .map(p => escapeHtml(p.name));
  const g = currentGroup;

  panel.innerHTML = `
    <div class="group-card">
      <div class="group-card-head">
        <strong>${g && g.name ? escapeHtml(g.name) : 'Tu grupo'}</strong>
        <span class="text-xs text-muted">${members.length} miembro${members.length !== 1 ? 's' : ''}</span>
      </div>
      ${g && g.joinCode ? `
      <p class="group-code">Código del grupo:
        <code id="groupCodeValue">${escapeHtml(g.joinCode)}</code>
        <button class="btn btn-sm btn-ghost" id="btnCopyGroupCode">Copiar</button>
        <button class="btn btn-sm btn-ghost" id="btnCopyInviteLink">Copiar enlace</button>
      </p>` : ''}
      <ul class="group-members">
        ${members.length ? members.map(m => `<li>${m}</li>`).join('') : '<li class="text-muted">Cargando miembros…</li>'}
      </ul>
      <button class="btn btn-sm btn-ghost btn-danger" id="btnLeaveGroup">Salir del grupo</button>
    </div>`;

  $('btnCopyGroupCode')?.addEventListener('click', () => {
    const code = $('groupCodeValue')?.textContent || '';
    navigator.clipboard.writeText(code).then(() => toast('Código copiado.'))
      .catch(() => toast('No se pudo copiar.', 'err'));
  });
  $('btnCopyInviteLink')?.addEventListener('click', () => {
    const code = $('groupCodeValue')?.textContent || '';
    const url = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(url).then(() => toast('Enlace de invitación copiado.'))
      .catch(() => toast('No se pudo copiar.', 'err'));
  });
  $('btnLeaveGroup')?.addEventListener('click', handleLeaveGroup);
}

async function handleCreateGroup() {
  if (!currentPlayer) return;
  if (currentPlayer.groupId) { await bModal.alert('Ya estás en un grupo. Sal primero para crear otro.'); return; }
  const name = await bModal.prompt('Nombre del grupo:', 'Ej: Mi playgroup');
  if (!name) return;
  const code = generateGroupCode();
  try {
    const groupId = db.collection('groups').doc().id;
    await db.runTransaction(async t => {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      t.set(db.collection('groups').doc(groupId), {
        name, ownerUid: currentPlayer.uid, memberUids: [currentPlayer.uid],
        joinCode: code, createdAt: now, updatedAt: now
      });
      t.set(db.collection('invites').doc(code), {
        groupId, createdBy: currentPlayer.uid, createdAt: now
      });
      t.update(db.collection('players').doc(currentPlayer.uid), { groupId });
    });
    currentPlayer.groupId = groupId;
    toast('Grupo creado. Comparte el código con tus amigos.');
    subscribeCloudData();
    subscribeGroupData();
    runMatches();
  } catch (e) {
    console.error(e);
    toast('No se pudo crear el grupo.', 'err');
  }
}

// Une al usuario actual al grupo del código. Devuelve { ok } o { ok:false, error }.
async function joinGroupByCode(code) {
  if (!currentPlayer) return { ok: false, error: 'NO_SESSION' };
  if (currentPlayer.groupId) return { ok: false, error: 'ALREADY_IN_GROUP' };
  try {
    let groupId = null;
    await db.runTransaction(async t => {
      const inv = await t.get(db.collection('invites').doc(code));
      if (!inv.exists) throw new Error('NO_CODE');
      groupId = inv.data().groupId;
      const gRef = db.collection('groups').doc(groupId);
      // Ojo: NO se puede leer el grupo antes de unirte (las reglas de Firestore
      // solo permiten leer grupos a sus miembros). El update de abajo fallará
      // solo si el grupo no existe, así que no hace falta leerlo.
      t.update(db.collection('players').doc(currentPlayer.uid), { groupId });
      t.update(gRef, { memberUids: firebase.firestore.FieldValue.arrayUnion(currentPlayer.uid) });
    });
    currentPlayer.groupId = groupId;
    toast('¡Te has unido al grupo!', 'inf');
    subscribeCloudData();
    subscribeGroupData();
    runMatches();
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message };
  }
}

async function handleJoinGroup() {
  if (!currentPlayer) return;
  if (currentPlayer.groupId) { await bModal.alert('Ya estás en un grupo. Sal primero para unirte a otro.'); return; }
  const raw = await bModal.prompt('Código del grupo:', 'Ej: ABC123');
  const code = (raw || '').trim().toUpperCase();
  if (!code) return;
  const res = await joinGroupByCode(code);
  if (!res.ok) toast(res.error === 'NO_CODE' ? 'Ese código no existe.' : 'No se pudo unir al grupo.', 'err');
}

// ── INVITACIÓN POR ENLACE (?invite=ABC123) ────────────────
function clearInviteParam() {
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  }
}

// Si llegaste con un enlace de invitación, únete automáticamente al grupo
async function handleInviteLink() {
  if (inviteHandled || !INVITE_CODE || !currentPlayer) return;
  inviteHandled = true;
  const code = INVITE_CODE.trim().toUpperCase();
  clearInviteParam();
  if (currentPlayer.groupId) {
    await bModal.alert('Ya estás en un grupo. Sal de él para poder unirte a otro con un enlace.');
    return;
  }
  const res = await joinGroupByCode(code);
  if (!res.ok) {
    await bModal.alert(res.error === 'NO_CODE' ? 'Ese enlace de invitación no es válido.' : 'No se pudo unir al grupo.');
  }
}

async function handleLeaveGroup() {
  if (!currentPlayer?.groupId) return;
  const ok = await bModal.confirm('¿Salir del grupo? Dejarás de ver los cruces de sus miembros.');
  if (!ok) return;
  try {
    await db.collection('players').doc(currentPlayer.uid).update({ groupId: null });
    currentPlayer.groupId = null;
    toast('Has salido del grupo.', 'inf');
    subscribeCloudData();
    subscribeGroupData();
    runMatches();
  } catch (e) {
    console.error(e);
    toast('No se pudo salir del grupo.', 'err');
  }
}

// ── ADMIN PANEL ────────────────────────────────────────────
async function loadAdminPanel() {
  if (!currentPlayer?.isAdmin) return;
  const list = $('adminPlayerList');
  list.innerHTML = '<p class="text-muted">Cargando…</p>';

  try {
    const snap = await db.collection('players').orderBy('nameLower').get();
    if (snap.empty) { list.innerHTML = '<p class="text-muted">No hay jugadores registrados.</p>'; return; }

    list.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const uid = doc.id;
      const isMe = uid === currentPlayer.uid;
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <div class="player-info">
          <span class="player-name">${escapeHtml(d.name)}</span>
          ${d.isAdmin ? '<span class="badge-admin">Admin</span>' : ''}
          ${isMe ? '<span class="player-meta">(tú)</span>' : ''}
        </div>
        <div class="player-actions">
          ${!isMe ? `
            <button class="btn btn-sm ${d.isAdmin ? 'btn-ghost' : 'btn-blue'}"
              data-action="toggle" data-uid="${uid}" data-admin="${d.isAdmin}">
              ${d.isAdmin ? 'Quitar admin' : 'Dar admin'}
            </button>
            <button class="btn btn-sm btn-primary" data-action="delete" data-uid="${uid}" data-name="${escapeHtml(d.name)}">
              Eliminar
            </button>
          ` : ''}
        </div>`;
      list.appendChild(row);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { uid } = btn.dataset;
        const wasAdmin = btn.dataset.admin === 'true';
        const ok = await bModal.confirm(wasAdmin ? '¿Quitar permisos de admin?' : '¿Dar permisos de admin?');
        if (!ok) return;
        btn.disabled = true;
        try {
          await db.collection('players').doc(uid).update({ isAdmin: !wasAdmin });
          toast('Permisos actualizados.');
          loadAdminPanel();
        } catch (e) { toast('Error al actualizar permisos.', 'err'); btn.disabled = false; }
      });
    });

    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { uid, name } = btn.dataset;
        const ok = await bModal.confirm(`¿Eliminar todos los datos de "${name}"? No se puede deshacer.`);
        if (!ok) return;
        btn.disabled = true;
        try {
          const batch = db.batch();
          batch.delete(db.collection('players').doc(uid));
          batch.delete(db.collection('collections').doc(uid));
          batch.delete(db.collection('wishlists').doc(uid));
          await batch.commit();
          toast(`Datos de "${name}" eliminados.`, 'inf');
          loadAdminPanel();
        } catch (e) { toast('Error al eliminar.', 'err'); btn.disabled = false; }
      });
    });

  } catch (e) {
    console.error(e);
    list.innerHTML = '<p class="match-error">Error al cargar jugadores.</p>';
  }
}