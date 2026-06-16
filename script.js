const $ = id => document.getElementById(id);

// ── FIREBASE GUARD ─────────────────────────────────────────
if (typeof FIREBASE_CONFIG === 'undefined') {
  document.body.innerHTML = `
    <div style="font-family:monospace;padding:2rem;color:#f4697a;background:#111;min-height:100vh;">
      <h2>Falta config.js</h2>
      <p style="margin-top:1rem;color:#aaa;">Copia config.example.js a config.js y rellena tus credenciales.</p>
    </div>`;
  throw new Error('config.js no encontrado.');
}

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

let currentPlayer = null;
let isRegistering = false;

let myCollections = { "Principal": [] };
let activeColList = "Principal";
let myWishlists = { "Principal": [] };
let activeWlList = "Principal";

const authModal = $('authModalContainer');

// ── TOAST ──────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  const shadows = { err: 'var(--primary)', inf: 'var(--accent-blue)', success: 'var(--accent-yellow)' };
  t.style.boxShadow = `6px 6px 0px ${shadows[type] || shadows.success}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseCardString(cardStr) {
  const match = cardStr.match(/^(\d+)\s+(.*)$/);
  if (match) return { qty: parseInt(match[1], 10), name: match[2] };
  return { qty: 1, name: cardStr };
}

// ── MODAL BAUHAUS ──
const bModal = (() => {
  const backdrop = document.createElement('div');
  backdrop.id = 'bModalBackdrop';
  backdrop.style.cssText = `
    position:fixed;inset:0;z-index:5000;
    background:rgba(0,0,0,0.65);
    display:none;align-items:center;justify-content:center;
  `;
  backdrop.innerHTML = `
    <div style="
      background:var(--surface);border:4px solid var(--border);
      padding:2rem;max-width:420px;width:calc(100% - 2rem);
      position:relative;box-shadow:10px 10px 0px var(--border);
    ">
      <p id="bModalMsg" style="font-weight:700;font-size:1rem;margin-bottom:1.25rem;line-height:1.4;"></p>
      <input id="bModalInput" class="inp" type="password" style="display:none;margin-bottom:1rem;" placeholder="">
      <div style="display:flex;justify-content:flex-end;gap:.75rem;">
        <button id="bModalCancel" class="btn btn-ghost btn-sm" style="display:none;">Cancelar</button>
        <button id="bModalOk"     class="btn btn-gold  btn-sm">Aceptar</button>
      </div>
    </div>`;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(backdrop));

  const msg = () => backdrop.querySelector('#bModalMsg');
  const input = () => backdrop.querySelector('#bModalInput');
  const ok = () => backdrop.querySelector('#bModalOk');
  const cancel = () => backdrop.querySelector('#bModalCancel');

  function open() { backdrop.style.display = 'flex'; }
  function close() {
    backdrop.style.display = 'none';
    input().style.display = 'none';
    input().value = '';
    cancel().style.display = 'none';
  }

  function alert(text) {
    return new Promise(resolve => {
      msg().textContent = text;
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

  function prompt(text, placeholder = '') {
    return new Promise(resolve => {
      msg().textContent = text;
      input().style.display = 'block';
      input().placeholder = placeholder;
      cancel().style.display = 'inline-flex';
      open();
      setTimeout(() => input().focus(), 50);
      ok().onclick = () => { const v = input().value.trim(); close(); resolve(v || null); };
      cancel().onclick = () => { close(); resolve(null); };
      input().onkeydown = e => { if (e.key === 'Enter') ok().click(); if (e.key === 'Escape') cancel().click(); };
    });
  }

  return { alert, confirm, prompt };
})();

// ── AUTH FEEDBACK Y NAVEGACIÓN ─────────────────────────────
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
const TABS = ['Home', 'Collection', 'Wishlist', 'Admin'];
TABS.forEach(tab => {
  const btn = $(`tab${tab}Btn`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    TABS.forEach(t => { $(`panel${t}`)?.classList.remove('active'); $(`tab${t}Btn`)?.classList.remove('active'); });
    $(`panel${tab}`)?.classList.add('active');
    btn.classList.add('active');
    if (tab === 'Admin') loadAdminPanel();
  });
});

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
          name: username, nameLower: username.toLowerCase(), isAdmin: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      currentPlayer = { uid: user.uid, name: username, isAdmin };
      $('authPillText').textContent = username;
      $('userMenuBtn').classList.add('active');

      if ($('tabAdminBtn')) {
        if (isAdmin) $('tabAdminBtn').classList.remove('hidden');
        else $('tabAdminBtn').classList.add('hidden');
      }

      $('loginScreen').classList.add('hidden');
      $('mainApp').classList.remove('hidden');

      await loadCloudData();
      toast(`Bienvenido, ${username}`);
    } catch (e) {
      console.error(e);
      toast('Error de permisos al cargar tu perfil en Firestore.', 'err');
    }

  } else {
    if (user && !user.emailVerified) {
      await auth.signOut();
      return;
    }

    currentPlayer = null;
    $('authPillText').textContent = 'Sin sesión';
    $('userMenuBtn').classList.remove('active');

    if ($('tabAdminBtn')) $('tabAdminBtn').classList.add('hidden');

    TABS.forEach(t => { $(`panel${t}`)?.classList.remove('active'); $(`tab${t}Btn`)?.classList.remove('active'); });
    $('panelHome')?.classList.add('active');
    $('tabHomeBtn')?.classList.add('active');

    myCollections = { "Principal": [] };
    myWishlists = { "Principal": [] };
    activeColList = "Principal";
    activeWlList = "Principal";

    $('mainApp').classList.add('hidden');
    $('loginScreen').classList.remove('hidden');
    setAuthState('login');
  }
});

// ── AUTH FORM ──────────────────────────────────────────────
const AUTH_ERRORS = {
  'auth/user-not-found': 'El correo o la contraseña no son correctos.',
  'auth/wrong-password': 'El correo o la contraseña no son correctos.',
  'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
  'auth/invalid-login-credentials': 'El correo o la contraseña no son correctos.',
  'auth/too-many-requests': 'Demasiados intentos fallidos. Espera unos minutos.',
  'auth/email-already-in-use': 'Ese correo electrónico ya está registrado.',
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

  if (!email) return showAuthFeedback('Introduzca el correo electrónico.');

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
      let cred;
      try {
        cred = await auth.createUserWithEmailAndPassword(email, password);

        const nameLower = username.toLowerCase();
        const existing = await db.collection('players').where('nameLower', '==', nameLower).limit(1).get();

        if (!existing.empty) {
          await cred.user.delete();
          await auth.signOut();
          isRegistering = false;
          return showAuthFeedback('Ese nombre de jugador ya está en uso. Elige otro.');
        }

        await db.collection('players').doc(cred.user.uid).set({
          name: username, nameLower, isAdmin: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await cred.user.sendEmailVerification();
        await auth.signOut();
      } finally {
        isRegistering = false;
      }

      setAuthState('login');
      showAuthFeedback(
        `¡Cuenta creada! Hemos enviado un correo de verificación a <strong>${escapeHtml(email)}</strong>. Haz clic en el enlace y luego inicia sesión.`,
        'success'
      );

    } else if (state === 'forgot') {
      await auth.sendPasswordResetEmail(email);
      showAuthFeedback('Enlace enviado. Revisa tu correo (y la carpeta de SPAM).', 'success');
    }

  } catch (err) {
    const friendly = AUTH_ERRORS[err.code];
    if (friendly) {
      showAuthFeedback(friendly);
    } else {
      console.error('[Auth error]', err);
      showAuthFeedback('Algo salió mal. Inténtalo de nuevo.');
    }
  }
});

// ── USER MODAL PANEL & ACTIONS ─────────────────────────────
const accModal = $('accountModal');

if ($('userMenuBtn')) {
  $('userMenuBtn').addEventListener('click', () => {
    if (!currentPlayer) return;
    $('usernameChangeStatus').classList.add('hidden');
    $('newUsernameInput').value = currentPlayer.name;
    accModal.classList.remove('hidden');
  });
}

if ($('closeAccountModalBtn')) {
  $('closeAccountModalBtn').addEventListener('click', () => accModal.classList.add('hidden'));
}

if ($('modalLogoutBtn')) {
  $('modalLogoutBtn').addEventListener('click', async () => {
    accModal.classList.add('hidden');
    await auth.signOut();
    toast('Sesión cerrada.', 'inf');
  });
}

// Lógica de liberación y cambio de nombre
if ($('saveNewUsernameBtn')) {
  $('saveNewUsernameBtn').addEventListener('click', async () => {
    const input = $('newUsernameInput');
    const status = $('usernameChangeStatus');
    const newName = input.value.trim();

    if (!newName) {
      status.classList.remove('hidden'); status.style.color = 'var(--primary)';
      status.textContent = 'El nombre no puede estar vacío.';
      return;
    }
    if (newName.toLowerCase() === currentPlayer.name.toLowerCase()) {
      accModal.classList.add('hidden');
      return;
    }

    status.classList.remove('hidden'); status.style.color = 'var(--muted)';
    status.textContent = 'Comprobando disponibilidad...';

    try {
      const existing = await db.collection('players').where('nameLower', '==', newName.toLowerCase()).limit(1).get();
      if (!existing.empty && existing.docs[0].id !== currentPlayer.uid) {
        status.textContent = 'Ese nombre ya está en uso. Prueba otro.';
        status.style.color = 'var(--rose)';
        return;
      }

      await db.collection('players').doc(currentPlayer.uid).update({
        name: newName, nameLower: newName.toLowerCase()
      });

      currentPlayer.name = newName;
      $('authPillText').textContent = newName;

      status.style.color = 'var(--emerald)';
      status.textContent = '¡Nombre actualizado correctamente!';
      toast('Nombre guardado.');
      setTimeout(() => { accModal.classList.add('hidden'); }, 1200);
    } catch (e) {
      status.style.color = 'var(--primary)';
      status.textContent = 'Error al verificar o guardar. Comprueba tus permisos.';
    }
  });
}

// Borrado seguro sin dejar datos huérfanos
if ($('modalDeleteBtn')) {
  $('modalDeleteBtn').addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;

    const ok = await bModal.confirm('¿Confirmas que deseas eliminar tu cuenta? Se borrará todo tu inventario y el nombre quedará libre en el acto.');
    if (!ok) return;

    const pwd = await bModal.prompt('Por seguridad, reintroduce tu contraseña para confirmar la baja:');
    if (!pwd) return;

    try {
      const credAuth = firebase.auth.EmailAuthProvider.credential(user.email, pwd);
      await user.reauthenticateWithCredential(credAuth);

      toast('Autenticación correcta. Purgando datos...', 'inf');

      await db.collection('collections').doc(user.uid).delete().catch(() => { });
      await db.collection('wishlists').doc(user.uid).delete().catch(() => { });
      await db.collection('players').doc(user.uid).delete().catch(() => { });

      accModal.classList.add('hidden');
      await user.delete();

      currentPlayer = null;
      toast('Tu cuenta ha sido eliminada por completo.', 'inf');
    } catch (err) {
      console.error("Detalle del error de baja:", err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-login-credentials' || err.code === 'auth/internal-error') {
        await bModal.alert('La contraseña introducida es incorrecta. Acción abortada.');
      } else {
        await bModal.alert('Error de sincronización con el servidor. Inténtalo de nuevo.');
      }
    }
  });
}

// ── NAVIGATION HELPERS ─────────────────────────────────────
function switchTab(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const activePanel = $(panelId);
  if (activePanel) activePanel.classList.add('active');

  const btnMap = { panelHome: 'tabHomeBtn', panelCollection: 'tabCollectionBtn', panelWishlist: 'tabWishlistBtn', panelAdmin: 'tabAdminBtn' };
  const targetBtn = $(btnMap[panelId]);
  if (targetBtn) targetBtn.classList.add('active');

  if (panelId === 'panelHome') calculateMatches();
  if (panelId === 'panelAdmin') loadAdminPanel();
}

// ── DATA LOADING & UI SYNC ─────────────────────────────────
async function loadCloudData() {
  if (!currentPlayer) return;

  try {
    const colDoc = await db.collection('collections').doc(currentPlayer.uid).get();
    if (colDoc.exists) {
      const data = colDoc.data();
      if (data.lists) myCollections = data.lists;
      else if (data.cards) myCollections = { "Principal": data.cards };
    }
  } catch (e) { console.warn("Aviso permisos carga colección:", e); }

  if (!myCollections[activeColList]) activeColList = Object.keys(myCollections)[0] || "Principal";
  updateListUI('col');

  try {
    const wlDoc = await db.collection('wishlists').doc(currentPlayer.uid).get();
    if (wlDoc.exists) {
      const data = wlDoc.data();
      if (data.lists) myWishlists = data.lists;
      else if (data.cards) myWishlists = { "Principal": data.cards };
    }
  } catch (e) { console.warn("Aviso permisos carga wishlist:", e); }

  if (!myWishlists[activeWlList]) activeWlList = Object.keys(myWishlists)[0] || "Principal";
  updateListUI('wl');
  renderWishlistMatchSelector();
}

function updateListUI(prefix) {
  const isCol = prefix === 'col';
  const dict = isCol ? myCollections : myWishlists;
  const active = isCol ? activeColList : activeWlList;
  const selectEl = $(`${prefix}ListSelect`);
  const textareaId = isCol ? 'collectionInput' : 'wishlistInput';

  selectEl.innerHTML = '';
  Object.keys(dict).forEach(listName => {
    const opt = document.createElement('option');
    opt.value = listName;
    opt.textContent = `${listName} (${dict[listName].length})`;
    if (listName === active) opt.selected = true;
    selectEl.appendChild(opt);
  });

  const currentArray = dict[active] || [];
  $(textareaId).value = currentArray.join('\n');
  updateCardCount(prefix, currentArray.length);
  renderVisualList(prefix, $(`${prefix}SearchInput`).value);
}

$('colListSelect').addEventListener('change', e => { activeColList = e.target.value; updateListUI('col'); });
$('wlListSelect').addEventListener('change', e => { activeWlList = e.target.value; updateListUI('wl'); });

async function handleNewList(prefix) {
  const name = await bModal.prompt('Nombre de la nueva lista:', 'Ej: Mazo Pececillo');
  if (!name) return;
  const isCol = prefix === 'col';
  const dict = isCol ? myCollections : myWishlists;
  if (dict[name]) return bModal.alert('Ya existe una lista con ese nombre.');
  dict[name] = [];
  if (isCol) activeColList = name; else activeWlList = name;
  updateListUI(prefix);
  saveFullDictToCloud(prefix);
  if (!isCol) renderWishlistMatchSelector();
}
$('colNewListBtn').addEventListener('click', () => handleNewList('col'));
$('wlNewListBtn').addEventListener('click', () => handleNewList('wl'));

async function handleDeleteList(prefix) {
  const isCol = prefix === 'col';
  const dict = isCol ? myCollections : myWishlists;
  const active = isCol ? activeColList : activeWlList;
  const ok = await bModal.confirm(`¿Eliminar la lista "${active}" y todas sus cartas? Esta acción no se puede deshacer.`);
  if (!ok) return;
  delete dict[active];
  if (Object.keys(dict).length === 0) dict["Principal"] = [];
  if (isCol) activeColList = Object.keys(dict)[0]; else activeWlList = Object.keys(dict)[0];
  updateListUI(prefix);
  saveFullDictToCloud(prefix);
  if (!isCol) renderWishlistMatchSelector();
  toast('Lista eliminada.');
}
$('colDelListBtn').addEventListener('click', () => handleDeleteList('col'));
$('wlDelListBtn').addEventListener('click', () => handleDeleteList('wl'));

async function handleClearList(prefix) {
  const isCol = prefix === 'col';
  const active = isCol ? activeColList : activeWlList;
  const ok = await bModal.confirm(`¿Vaciar todas las cartas de "${active}"?`);
  if (!ok) return;
  if (isCol) myCollections[activeColList] = []; else myWishlists[activeWlList] = [];
  updateListUI(prefix);
  saveFullDictToCloud(prefix);
  if (!isCol) renderWishlistMatchSelector();
  toast('Lista vaciada.');
}
$('colClearListBtn').addEventListener('click', () => handleClearList('col'));
$('wlClearListBtn').addEventListener('click', () => handleClearList('wl'));

// ── CLOUD SAVING ───────────────────────────────────────────
async function saveFullDictToCloud(prefix) {
  if (!currentPlayer) return;
  const collectionName = prefix === 'col' ? 'collections' : 'wishlists';
  const dict = prefix === 'col' ? myCollections : myWishlists;
  try {
    await db.collection(collectionName).doc(currentPlayer.uid).set({
      name: currentPlayer.name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lists: dict
    });
  } catch (e) {
    toast('Error al sincronizar con la nube.', 'err');
  }
}

async function saveCurrentActiveList(prefix) {
  if (!currentPlayer) return;
  const isCol = prefix === 'col';
  const textareaId = isCol ? 'collectionInput' : 'wishlistInput';
  const active = isCol ? activeColList : activeWlList;
  const cards = $(textareaId).value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (isCol) myCollections[active] = cards; else myWishlists[active] = cards;
  updateListUI(prefix);
  await saveFullDictToCloud(prefix);
  if (!isCol) renderWishlistMatchSelector(); // Refresco en tiempo real del Matcher
  toast(`"${active}" guardada.`);
}
$('saveCollectionBtn').addEventListener('click', () => saveCurrentActiveList('col'));
$('saveWishlistBtn').addEventListener('click', () => saveCurrentActiveList('wl'));

function updateCardCount(prefix, n) {
  const el = $(`${prefix}CardCount`);
  if (el) el.textContent = n > 0 ? `${n} carta${n !== 1 ? 's' : ''}` : '';
}

// ── VISUAL LIST MANAGER ────────────────────────────────────
function renderVisualList(prefix, filterText = '') {
  const container = $(`${prefix}ListView`);
  const isCol = prefix === 'col';
  const active = isCol ? activeColList : activeWlList;
  const dict = isCol ? myCollections : myWishlists;
  const arr = dict[active] || [];

  const clearBtn = $(`${prefix}ClearSearchBtn`);
  if (clearBtn) clearBtn.style.display = filterText.length > 0 ? 'block' : 'none';

  if (!arr.length) {
    container.innerHTML = '<p class="text-muted">Esta lista está vacía.</p>';
    return;
  }

  container.innerHTML = '';
  let rendered = 0;

  arr.forEach((cardStr, index) => {
    const { qty, name } = parseCardString(cardStr);
    if (filterText && !name.toLowerCase().includes(filterText.toLowerCase())) return;
    rendered++;
    const row = document.createElement('div');
    row.className = 'visual-card-row';
    row.innerHTML = `
      <div class="card-info">
        <span class="qty-badge">${qty}x</span>
        <span class="card-name">${escapeHtml(name)}</span>
      </div>
      <button title="Eliminar carta">✕</button>`;
    row.querySelector('button').addEventListener('click', () => {
      arr.splice(index, 1);
      if (isCol) myCollections[activeColList] = arr; else myWishlists[activeWlList] = arr;
      updateListUI(prefix);
      saveFullDictToCloud(prefix);
      if (!isCol) renderWishlistMatchSelector(); // Refresco si se borra visualmente
      toast('Carta eliminada.', 'inf');
    });
    container.appendChild(row);
  });

  if (rendered === 0) {
    container.innerHTML = '<p class="text-muted">No se encontraron cartas con esa búsqueda.</p>';
  }
}

['col', 'wl'].forEach(prefix => {
  const inp = $(`${prefix}SearchInput`);
  const btn = $(`${prefix}ClearSearchBtn`);
  if (inp) inp.addEventListener('input', e => renderVisualList(prefix, e.target.value));
  if (btn) btn.addEventListener('click', () => { inp.value = ''; renderVisualList(prefix, ''); });
});

// ── IMPORT MODULE ──────────────────────────────────────────
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

function mergeCards(textareaId, newCards) {
  const existing = $(textareaId).value.split('\n').map(l => l.trim()).filter(l => l);
  const merged = [...new Set([...existing, ...newCards])];
  $(textareaId).value = merged.join('\n');
  const prefix = textareaId.includes('collection') ? 'col' : 'wl';
  if (prefix === 'col') myCollections[activeColList] = merged;
  else myWishlists[activeWlList] = merged;
  updateListUI(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();

  const panel = prefix === 'col' ? $('panelCollection') : $('panelWishlist');
  const tabGroup = panel.querySelector('.imp-mode-tabs');
  tabGroup.querySelectorAll('.imp-tab').forEach(b => b.classList.toggle('active', b.dataset.target === `${prefix}-text`));
  panel.querySelectorAll('.imp-panel').forEach(p => p.classList.toggle('active', p.id === `${prefix}-text`));
}

async function fetchDeckFromUrl(rawUrl, statusId, textareaId) {
  const status = $(statusId);
  status.textContent = 'Obteniendo lista…';
  status.className = 'imp-status inf';
  let cards = [];
  try {
    const moxMatch = rawUrl.match(/moxfield\.com\/decks\/([\w-]+)/);
    if (moxMatch) {
      const resp = await fetch(`https://corsproxy.io/?${encodeURIComponent(`https://api2.moxfield.com/v2/decks/all/${moxMatch[1]}`)}`);
      if (!resp.ok) throw new Error(`Error HTTP ${resp.status}`);
      const data = await resp.json();
      for (const section of ['mainboard', 'sideboard', 'commanders', 'companions', 'maybeboard']) {
        if (!data[section]) continue;
        for (const [, card] of Object.entries(data[section])) cards.push(`${card.quantity} ${card.card.name}`);
      }
      if (!cards.length) throw new Error('Sin cartas en la respuesta de Moxfield.');
      mergeCards(textareaId, cards);
      status.textContent = `✓ ${cards.length} cartas importadas. (Pulsa Guardar para subir a la nube)`;
      status.className = 'imp-status ok';
      return;
    }

    const archiMatch = rawUrl.match(/archidekt\.com\/decks\/(\d+)/);
    if (archiMatch) {
      const resp = await fetch(`https://corsproxy.io/?${encodeURIComponent(`https://archidekt.com/api/decks/${archiMatch[1]}/`)}`);
      if (!resp.ok) throw new Error(`Error HTTP ${resp.status}`);
      const data = await resp.json();
      for (const card of data.cards) {
        if (card.category !== 'Maybeboard') cards.push(`${card.quantity} ${card.card.oracleCard.name}`);
      }
      if (!cards.length) throw new Error('Sin cartas en la respuesta de Archidekt.');
      mergeCards(textareaId, cards);
      status.textContent = `✓ ${cards.length} cartas importadas. (Pulsa Guardar para subir a la nube)`;
      status.className = 'imp-status ok';
      return;
    }

    throw new Error('URL no reconocida. Pega un enlace de Moxfield o Archidekt.');
  } catch (err) {
    status.textContent = `⚠ ${err.message}`;
    status.className = 'imp-status err';
  }
}

$('colFetchUrlBtn').addEventListener('click', () => {
  const url = $('colUrlInput').value.trim();
  if (!url) { $('colUrlStatus').textContent = 'Introduce una URL primero.'; $('colUrlStatus').className = 'imp-status err'; return; }
  fetchDeckFromUrl(url, 'colUrlStatus', 'collectionInput');
});
$('wlFetchUrlBtn').addEventListener('click', () => {
  const url = $('wlUrlInput').value.trim();
  if (!url) { $('wlUrlStatus').textContent = 'Introduce una URL primero.'; $('wlUrlStatus').className = 'imp-status err'; return; }
  fetchDeckFromUrl(url, 'wlUrlStatus', 'wishlistInput');
});

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  if (header.includes('name')) {
    const cols = lines[0].split(',').map(c => c.trim().toLowerCase());
    const nameIdx = cols.findIndex(c => c === 'name' || c === 'card name' || c === 'cardname');
    const qtyIdx = cols.findIndex(c => c === 'count' || c === 'qty' || c === 'quantity' || c === 'amount');
    return lines.slice(1).flatMap(line => {
      let cur = '', inQ = false, parts = [];
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      parts.push(cur);
      const name = parts[nameIdx]?.trim();
      if (!name) return [];
      const qty = qtyIdx >= 0 ? parseInt(parts[qtyIdx]) || 1 : 1;
      return [`${qty} ${name}`];
    });
  }
  return lines.map(l => l.trim()).filter(l => l.length > 0);
}

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
        status.textContent = 'Archivo vacío o sin cartas reconocibles.';
        status.className = 'imp-status err';
        return;
      }
      mergeCards(textareaId, cards);
      status.textContent = `✓ ${cards.length} cartas importadas. (Pulsa Guardar para subir a la nube)`;
      status.className = 'imp-status ok';
    };
    reader.readAsText(file);
  }
}
setupCSVDrop('colDropZone', 'colFileInput', 'colCsvStatus', 'collectionInput');
setupCSVDrop('wlDropZone', 'wlFileInput', 'wlCsvStatus', 'wishlistInput');

// ── MATCHES & CROSS-REFERENCE ──────────────────────────────
function renderWishlistMatchSelector() {
  const container = $('wishlistMatchSelector');
  if (!container) return;
  container.innerHTML = '';
  if (Object.keys(myWishlists).length === 0) {
    container.innerHTML = '<p class="text-xs text-muted">No tienes wishlists creadas.</p>';
    return;
  }
  Object.keys(myWishlists).forEach(listName => {
    const qty = myWishlists[listName].length;
    const lbl = document.createElement('label');
    lbl.className = 'wl-checkbox-label';
    lbl.innerHTML = `
      <input type="checkbox" value="${escapeHtml(listName)}" class="wl-match-cb" checked>
      ${escapeHtml(listName)} <span class="text-xs text-muted">(${qty})</span>`;
    container.appendChild(lbl);
  });
}

$('refreshMatchesBtn').addEventListener('click', async () => {
  if (!currentPlayer) return;
  const container = $('matchesContainer');

  const selectedWlNames = Array.from(document.querySelectorAll('.wl-match-cb:checked')).map(cb => cb.value);
  if (selectedWlNames.length === 0) {
    container.innerHTML = '<p style="color:var(--rose);font-weight:bold;">Selecciona al menos una wishlist para buscar.</p>';
    return;
  }

  const searchMap = new Map();
  selectedWlNames.forEach(wlName => {
    (myWishlists[wlName] || []).forEach(cardStr => {
      const parsed = parseCardString(cardStr);
      const key = parsed.name.toLowerCase();
      if (!searchMap.has(key)) {
        searchMap.set(key, { name: parsed.name, qty: parsed.qty, fromLists: new Set([wlName]) });
      } else {
        const ext = searchMap.get(key);
        ext.qty = Math.max(ext.qty, parsed.qty);
        ext.fromLists.add(wlName);
      }
    });
  });

  if (searchMap.size === 0) {
    container.innerHTML = '<p class="text-muted">Las wishlists seleccionadas están vacías.</p>';
    return;
  }

  container.innerHTML = '<p class="text-muted">Analizando colecciones de los jugadores…</p>';

  try {
    const allCol = await db.collection('collections').get();
    let html = '';
    let found = 0;

    allCol.forEach(doc => {
      if (doc.id === currentPlayer.uid) return;
      const data = doc.data();
      let remoteLists = {};
      if (data.lists) remoteLists = data.lists;
      else if (data.cards) remoteLists = { "Principal": data.cards };

      let playerHtml = '';
      let playerMatches = 0;

      Object.keys(remoteLists).forEach(colName => {
        const foundInList = [];
        (remoteLists[colName] || []).forEach(pcStr => {
          const pc = parseCardString(pcStr);
          const pcLow = pc.name.toLowerCase();
          for (const [searchKey, searchObj] of searchMap.entries()) {
            if (pcLow.includes(searchKey)) {
              foundInList.push(`
                <li>
                  <span class="qty-badge bg-emerald">${pc.qty} disp.</span>
                  <strong>${escapeHtml(searchObj.name)}</strong>
                  <span class="text-xs text-muted" style="margin-left:auto;">
                    (buscas ${searchObj.qty} — en: ${Array.from(searchObj.fromLists).join(', ')})
                  </span>
                </li>`);
              break;
            }
          }
        });
        if (foundInList.length) {
          playerMatches += foundInList.length;
          playerHtml += `<div class="match-list-group"><h4>Lista: ${escapeHtml(colName)}</h4><ul>${foundInList.join('')}</ul></div>`;
        }
      });

      if (playerMatches > 0) {
        found++;
        html += `<div class="match-card"><h3>🔥 ${escapeHtml(data.name)}</h3>${playerHtml}</div>`;
      }
    });

    container.innerHTML = found
      ? html
      : '<p class="text-muted">Ningún jugador del grupo tiene las cartas de tus wishlists seleccionadas.</p>';

  } catch (e) {
    console.error(e);
    container.innerHTML = '<p style="color:var(--rose);font-weight:700;">Error al consultar colecciones. Verifica permisos en Firestore.</p>';
  }
});

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
        <div>
          <span class="player-name">${escapeHtml(d.name)}</span>
          ${d.isAdmin ? '<span class="badge-admin" style="margin-left:.5rem;">Admin</span>' : ''}
          ${isMe ? '<span class="player-meta" style="margin-left:.5rem;">(tú)</span>' : ''}
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;">
          ${!isMe ? `<button class="btn btn-sm ${d.isAdmin ? 'btn-ghost' : 'btn-blue'}" data-uid="${uid}" data-admin="${d.isAdmin}">
            ${d.isAdmin ? 'Quitar admin' : 'Dar admin'}
          </button>` : ''}
        </div>`;
      list.appendChild(row);
    });

    list.querySelectorAll('[data-uid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const wasAdmin = btn.dataset.admin === 'true';
        const ok = await bModal.confirm(wasAdmin
          ? '¿Quitar permisos de administrador a este jugador?'
          : '¿Dar permisos de administrador a este jugador?');
        if (!ok) return;
        btn.disabled = true;
        try {
          await db.collection('players').doc(uid).update({ isAdmin: !wasAdmin });
          toast('Permisos actualizados.');
          loadAdminPanel();
        } catch (e) {
          toast('Error al actualizar permisos.', 'err');
          btn.disabled = false;
        }
      });
    });

  } catch (e) {
    console.error(e);
    list.innerHTML = '<p style="color:var(--rose);font-weight:700;">Error al cargar jugadores (Permisos).</p>';
  }
}