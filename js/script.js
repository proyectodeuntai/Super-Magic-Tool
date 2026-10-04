// ═══════════════════════════════════════════════════════════
// MAGIC CARD MATCHER — script.js
// Todo el comportamiento de la app vive aquí. Las funciones puras
// (parseo, normalización y cálculo de cruces) están en card-utils.js,
// que se carga antes y se cubre con tests en tests/test.html.
// ═══════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

// ── ARRANQUE SEGURO ────────────────────────────────────────
// Si falta config.js o el CDN de Firebase no carga (bloqueadores, sin red),
// antes el cargador se quedaba girando para siempre. Ahora se explica.
function mostrarErrorCritico(titulo, texto) {
  const loader = $('appLoader');
  if (loader) loader.remove();
  document.body.innerHTML = `
    <div class="firebase-error" role="alert">
      <h2>${titulo}</h2>
      <p>${texto}</p>
      <button class="btn btn-gold" id="reintentarBtn">Reintentar</button>
    </div>`;
  $('reintentarBtn')?.addEventListener('click', () => location.reload());
  throw new Error(titulo);
}

if (typeof FIREBASE_CONFIG === 'undefined') {
  mostrarErrorCritico('Falta la configuración',
    'No se ha encontrado <code>config.js</code> con las credenciales de Firebase.');
}
if (typeof firebase === 'undefined') {
  mostrarErrorCritico('No se pudo cargar Firebase',
    'Tu navegador ha bloqueado el CDN de Firebase o no hay conexión. Revisa la red ' +
    'o los bloqueadores y vuelve a intentarlo.');
}

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();
const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();

// ── ESTADO ─────────────────────────────────────────────────
let currentPlayer = null;
let isRegistering = false;
let DEMO_MODE = false;
let appArrancada = false;          // evita volver a cargar la app si ya está dentro
let usuarioVerificando = null;     // usuario pendiente de verificar su correo
let reenvioTimer = null;

let allCollections = {};
let allWishlists = {};
let unsubCloud = [];
let cloudDataReady = { col: false, wl: false };

let myCollections = { 'Mi colección': [] };
let activeColList = 'Mi colección';
let myWishlists = { 'Mi lista de deseados': [] };
let activeWlList = 'Mi lista de deseados';

let saveTimers = { col: null, wl: null };
let syncStatusTimers = { col: null, wl: null };

// ── TOAST ──────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  const shadows = { err: 'var(--red)', inf: 'var(--blue)', success: 'var(--yellow)' };
  t.style.boxShadow = `6px 6px 0 ${shadows[type] || shadows.success}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── FOCO: utilidades compartidas por modales ───────────────
function focusables(container) {
  return [...container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter(el => !el.disabled && el.offsetParent !== null);
}
function trapTab(e, container) {
  if (e.key !== 'Tab') return;
  const f = focusables(container);
  if (!f.length) return;
  const primero = f[0];
  const ultimo = f[f.length - 1];
  if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
}

// ── MODAL PROPIO (alert / confirm / prompt) ────────────────
const bModal = (() => {
  const backdrop = document.createElement('div');
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

  const box = () => backdrop.querySelector('.b-modal-box');
  const msg = () => backdrop.querySelector('#bModalMsg');
  const input = () => backdrop.querySelector('#bModalInput');
  const ok = () => backdrop.querySelector('#bModalOk');
  const cancel = () => backdrop.querySelector('#bModalCancel');

  let ultimoFoco = null;

  function open(enfocar) {
    ultimoFoco = document.activeElement;
    backdrop.classList.add('open');
    setTimeout(() => { if (enfocar) enfocar().focus(); }, 40);
  }

  function close() {
    backdrop.classList.remove('open');
    input().style.display = 'none';
    input().value = '';
    cancel().style.display = 'none';
    if (ultimoFoco && typeof ultimoFoco.focus === 'function') ultimoFoco.focus();
  }

  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); cancel().click(); return; }
    trapTab(e, box());
  });

  function alert(text) {
    return new Promise(resolve => {
      msg().textContent = text;
      cancel().style.display = 'none';
      cancel().onclick = () => { close(); resolve(); };
      open(ok);
      ok().onclick = () => { close(); resolve(); };
    });
  }

  function confirm(text) {
    return new Promise(resolve => {
      msg().textContent = text;
      cancel().style.display = 'inline-flex';
      open(ok);
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
      open(input);
      ok().onclick = () => { const v = input().value.trim(); close(); resolve(v || null); };
      cancel().onclick = () => { close(); resolve(null); };
      input().onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok().click(); } };
    });
  }

  return { alert, confirm, prompt };
})();

// ── PANTALLAS DE ACCESO ────────────────────────────────────
const authModal = $('authModalContainer');

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

function hideLoader() {
  const loader = $('appLoader');
  if (loader) loader.classList.add('hidden');
}

function showLogin() {
  $('verifyScreen')?.classList.add('hidden');
  $('mainApp')?.classList.add('hidden');
  $('loginScreen')?.classList.remove('hidden');
  hideLoader();
  setAuthState('login');
}

// Pantalla dedicada de verificación: se explica qué pasa y se da salida.
function showVerify(user, mensaje) {
  usuarioVerificando = user;
  $('loginScreen')?.classList.add('hidden');
  $('mainApp')?.classList.add('hidden');
  $('verifyScreen')?.classList.remove('hidden');
  $('verifyEmailText').textContent = user?.email || 'tu correo';
  setVerifyStatus(mensaje || 'Tu correo todavía no está verificado. Ábrelo para poder entrar.', '');
  hideLoader();
}

function setVerifyStatus(texto, tipo) {
  const el = $('verifyStatus');
  if (!el) return;
  el.innerHTML = texto || '';
  el.className = 'auth-feedback' + (tipo ? ` ${tipo}` : '');
  if (!texto) el.className = 'auth-feedback';
}

$('checkVerifyBtn')?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return showLogin();
  const btn = $('checkVerifyBtn');
  btn.disabled = true;
  setVerifyStatus('Comprobando…', '');
  try {
    await user.reload();
    if (auth.currentUser.emailVerified) {
      setVerifyStatus('¡Correo verificado! Entrando…', 'success');
      await enterApp(auth.currentUser);
    } else {
      setVerifyStatus(
        'Todavía no consta como verificado. Abre el enlace del correo (revisa spam) y vuelve a intentarlo.',
        'error');
    }
  } catch (e) {
    console.error(e);
    setVerifyStatus('No se pudo comprobar. Inténtalo de nuevo en un momento.', 'error');
  } finally {
    btn.disabled = false;
  }
});

$('resendVerifyBtn')?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return showLogin();
  const btn = $('resendVerifyBtn');
  try {
    await user.sendEmailVerification();
    setVerifyStatus(`Correo reenviado a <strong>${escapeHtml(user.email)}</strong>. Revisa también la carpeta de spam.`, 'success');
    // Cooldown para no machacar el servicio de correo de Firebase.
    let restante = 45;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = `Reenviar (${restante}s)`;
    clearInterval(reenvioTimer);
    reenvioTimer = setInterval(() => {
      restante -= 1;
      if (restante <= 0) {
        clearInterval(reenvioTimer);
        btn.disabled = false;
        btn.textContent = original;
      } else {
        btn.textContent = `Reenviar (${restante}s)`;
      }
    }, 1000);
  } catch (e) {
    console.error(e);
    setVerifyStatus('No se pudo reenviar el correo. Espera un momento e inténtalo de nuevo.', 'error');
  }
});

$('verifyLogoutBtn')?.addEventListener('click', async () => {
  await auth.signOut();
});

// Enlaces del formulario de acceso
$('linkToRegister')?.addEventListener('click', e => { e.preventDefault(); setAuthState('register'); });
$('linkToForgot')?.addEventListener('click', e => { e.preventDefault(); setAuthState('forgot'); });
$('backFromRegister')?.addEventListener('click', () => setAuthState('login'));
$('backFromForgot')?.addEventListener('click', () => setAuthState('login'));

// ── ENTRAR EN LA APP ───────────────────────────────────────
async function enterApp(user) {
  if (!user) return;
  if (currentPlayer && currentPlayer.uid === user.uid && !$('mainApp').classList.contains('hidden')) return;

  try {
    const doc = await db.collection('players').doc(user.uid).get();
    let username = user.email.split('@')[0];

    if (doc.exists) {
      const d = doc.data();
      username = d.name || username;
      // Cuentas del modelo anterior (isAdmin y friends vivían en la ficha
      // pública): se pasan al formato nuevo una sola vez.
      await migratePlayerRecord(user.uid, d);
    } else {
      await db.collection('players').doc(user.uid).set({
        name: username, nameLower: username.toLowerCase(), createdAt: serverTimestamp()
      });
    }

    const isAdmin = await loadAdminFlag(user.uid);
    const friends = await loadFriendUids(user.uid);
    currentPlayer = { uid: user.uid, name: username, isAdmin, friends };
    $('authPillText').textContent = username;
    $('userMenuBtn').classList.add('active');

    const adminBtn = $('tabAdminBtn');
    if (adminBtn) isAdmin ? adminBtn.classList.remove('hidden') : adminBtn.classList.add('hidden');

    $('loginScreen').classList.add('hidden');
    $('verifyScreen').classList.add('hidden');
    $('mainApp').classList.remove('hidden');
    hideLoader();

    ensureUsernameClaim(username.toLowerCase(), user.uid);

    await loadCloudData();
    subscribeCloudData();
    updateFriendsUI();
    updateHomeOnboarding();
    switchTab('Home');

    if (!appArrancada) { toast(`Bienvenido, ${username}`); appArrancada = true; }
  } catch (e) {
    console.error(e);
    toast('Error al cargar tu perfil. Recarga la página.', 'err');
  }
}

// Vuelta al estado desconectado (limpia suscripciones y datos en memoria).
function signedOutReset() {
  clearCloudSubscriptions();
  allCollections = {};
  allWishlists = {};
  cloudDataReady = { col: false, wl: false };
  currentPlayer = null;
  appArrancada = false;
  usuarioVerificando = null;
  myCollections = { 'Mi colección': [] };
  myWishlists = { 'Mi lista de deseados': [] };
  activeColList = 'Mi colección';
  activeWlList = 'Mi lista de deseados';
  $('authPillText').textContent = 'Sin sesión';
  $('userMenuBtn')?.classList.remove('active');
  $('tabAdminBtn')?.classList.add('hidden');
  showLogin();
}

auth.onAuthStateChanged(async user => {
  if (isRegistering) return;
  if (DEMO_MODE) return;

  if (user && user.emailVerified) {
    await enterApp(user);
  } else if (user) {
    // Antes se expulsaba en silencio (signOut). Ahora se explica y se da salida.
    showVerify(user);
  } else {
    signedOutReset();
  }
});

// ── MODO DEMO (probar sin cuenta) ──────────────────────────
const DEMO_DATA = {
  myName: 'Tú (demo)',
  myCollections: { 'Mi colección': ['4 Lightning Bolt', '2 Force of Will', '1 Black Lotus', '4 Brainstorm'] },
  myWishlists: { 'Mi lista de deseados': ['4 Lightning Bolt', '3 Force of Will', '1 Sol Ring'] },
  players: [
    { uid: 'demo-maria', name: 'María', col: ['2 Force of Will', '4 Birds of Paradise', '3 Lightning Bolt'], wl: ['4 Lightning Bolt', '2 Sol Ring'] },
    { uid: 'demo-carlos', name: 'Carlos', col: ['2 Sol Ring', '1 Mana Crypt', '4 Thoughtseize'], wl: ['1 Black Lotus', '2 Force of Will'] },
    { uid: 'demo-lucia', name: 'Lucía', col: ['4 Brainstorm', '2 Snapcaster Mage', '1 Sol Ring'], wl: ['4 Brainstorm'] }
  ]
};

function enterDemo() {
  DEMO_MODE = true;
  currentPlayer = { uid: 'demo-user', name: DEMO_DATA.myName, isAdmin: false,
    friends: DEMO_DATA.players.map(p => p.uid) };
  myCollections = JSON.parse(JSON.stringify(DEMO_DATA.myCollections));
  myWishlists = JSON.parse(JSON.stringify(DEMO_DATA.myWishlists));
  activeColList = Object.keys(myCollections)[0] || 'Mi colección';
  activeWlList = Object.keys(myWishlists)[0] || 'Mi lista de deseados';

  allCollections = {};
  allWishlists = {};
  DEMO_DATA.players.forEach(p => {
    allCollections[p.uid] = { name: p.name, lists: { Principal: p.col } };
    allWishlists[p.uid] = { name: p.name, lists: { Principal: p.wl } };
  });
  cloudDataReady = { col: true, wl: true };

  $('authPillText').textContent = DEMO_DATA.myName;
  $('userMenuBtn').classList.add('active');
  $('tabAdminBtn')?.classList.add('hidden');
  $('loginScreen').classList.add('hidden');
  $('verifyScreen').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
  $('demoBanner').classList.remove('hidden');
  hideLoader();
  updateFriendsUI();

  updateListUI('col');
  updateListUI('wl');
  renderWishlistMatchSelector();
  updateHomeOnboarding();
  switchTab('Home');
  toast('Modo demo: datos de ejemplo, nada se guarda.', 'inf');
}

function exitDemo() {
  DEMO_MODE = false;
  accModal?.classList.add('hidden');
  $('demoBanner').classList.add('hidden');
  signedOutReset();
}

$('demoBtn')?.addEventListener('click', enterDemo);
$('exitDemoBtn')?.addEventListener('click', exitDemo);

// ── ERRORES DE AUTENTICACIÓN ───────────────────────────────
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
      if (cred.user.emailVerified) await enterApp(cred.user);
      else showVerify(cred.user, 'Tu correo todavía no está verificado. Te hemos mandado un enlace: ábrelo para entrar.');

    } else if (state === 'register') {
      if (!username) return showAuthFeedback('Elige un nombre de jugador.');
      if (!password || password.length < 6) return showAuthFeedback('La contraseña debe tener al menos 6 caracteres.');

      isRegistering = true;
      try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const nameLower = username.toLowerCase();
        try {
          // Reclamación ATÓMICA del nombre: usernames/{nameLower} es la clave única.
          await db.runTransaction(async t => {
            const uRef = db.collection('usernames').doc(nameLower);
            const uSnap = await t.get(uRef);
            if (uSnap.exists) throw new Error('USERNAME_TAKEN');
            const now = serverTimestamp();
            t.set(uRef, { uid: cred.user.uid, createdAt: now });
            t.set(db.collection('players').doc(cred.user.uid), {
              name: username, nameLower, createdAt: now
            });
          });
        } catch (txErr) {
          await cred.user.delete().catch(() => {});
          await auth.signOut();
          return showAuthFeedback(
            txErr && txErr.message === 'USERNAME_TAKEN'
              ? 'Ese nombre de jugador ya está en uso. Elige otro.'
              : 'No se pudo crear la cuenta. Inténtalo de nuevo.'
          );
        }
        await cred.user.sendEmailVerification();
        showVerify(cred.user,
          `Cuenta creada. Te hemos enviado un correo a <strong>${escapeHtml(email)}</strong>: ` +
          'ábrelo y haz clic en el enlace para poder entrar.');
      } finally { isRegistering = false; }

    } else if (state === 'forgot') {
      await auth.sendPasswordResetEmail(email);
      showAuthFeedback('Enlace enviado. Revisa tu correo y la carpeta de spam.', 'success');
    }

  } catch (err) {
    const friendly = AUTH_ERRORS[err.code];
    if (friendly) showAuthFeedback(friendly);
    else { console.error('[Auth]', err); showAuthFeedback('Algo salió mal. Inténtalo de nuevo.'); }
  }
});

// ── MODAL DE CUENTA ────────────────────────────────────────
const accModal = $('accountModal');
let focoAntesCuenta = null;

function abrirCuenta() {
  if (!currentPlayer) return;
  $('usernameChangeStatus').classList.add('hidden');
  $('newUsernameInput').value = currentPlayer.name;
  focoAntesCuenta = document.activeElement;
  accModal.classList.remove('hidden');
  $('userMenuBtn').setAttribute('aria-expanded', 'true');
  setTimeout(() => $('newUsernameInput')?.focus(), 40);
}
function cerrarCuenta() {
  accModal.classList.add('hidden');
  $('userMenuBtn')?.setAttribute('aria-expanded', 'false');
  if (focoAntesCuenta && typeof focoAntesCuenta.focus === 'function') focoAntesCuenta.focus();
}

$('userMenuBtn')?.addEventListener('click', abrirCuenta);
$('closeAccountModalBtn')?.addEventListener('click', cerrarCuenta);
accModal?.addEventListener('click', e => { if (e.target === accModal) cerrarCuenta(); });
accModal?.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); cerrarCuenta(); return; }
  trapTab(e, accModal);
});

$('modalLogoutBtn')?.addEventListener('click', async () => {
  cerrarCuenta();
  if (DEMO_MODE) { exitDemo(); return; }
  await auth.signOut();
  toast('Sesión cerrada.', 'inf');
});

$('saveNewUsernameBtn')?.addEventListener('click', async () => {
  if (DEMO_MODE) { toast('No disponible en modo demo.', 'inf'); return; }
  const input = $('newUsernameInput');
  const status = $('usernameChangeStatus');
  const newName = input.value.trim();

  if (!newName) {
    status.classList.remove('hidden');
    status.className = 'username-status err';
    status.textContent = 'El nombre no puede estar vacío.';
    return;
  }
  if (newName.toLowerCase() === currentPlayer.name.toLowerCase()) { cerrarCuenta(); return; }

  status.classList.remove('hidden');
  status.className = 'username-status inf';
  status.textContent = 'Comprobando…';

  const newLower = newName.toLowerCase();
  const oldLower = currentPlayer.name.toLowerCase();

  try {
    await db.runTransaction(async t => {
      const uRef = db.collection('usernames').doc(newLower);
      const uSnap = await t.get(uRef);
      if (uSnap.exists && uSnap.data().uid !== currentPlayer.uid) throw new Error('USERNAME_TAKEN');
      if (!uSnap.exists) t.set(uRef, { uid: currentPlayer.uid, createdAt: serverTimestamp() });
      t.update(db.collection('players').doc(currentPlayer.uid), { name: newName, nameLower: newLower });
    });
    // Libera el nombre antiguo si era tuyo (best-effort: puede no existir en cuentas antiguas)
    if (oldLower !== newLower) {
      db.collection('usernames').doc(oldLower).get()
        .then(snap => { if (snap.exists && snap.data().uid === currentPlayer.uid) return snap.ref.delete(); })
        .catch(() => {});
    }
    // Propaga el nuevo nombre a los documentos de colección/wishlist
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
    setTimeout(cerrarCuenta, 1200);
  } catch (e) {
    status.className = 'username-status err';
    status.textContent = 'Ese nombre ya está en uso o hubo un error. Inténtalo de nuevo.';
  }
});

$('modalDeleteBtn')?.addEventListener('click', async () => {
  if (DEMO_MODE) { toast('No disponible en modo demo.', 'inf'); return; }
  const user = auth.currentUser;
  if (!user) return;

  const ok = await bModal.confirm('¿Eliminar tu cuenta? Se borrarán tu perfil, colección y lista de deseados de forma permanente.');
  if (!ok) return;

  const pwd = await bModal.prompt('Introduce tu contraseña para confirmar:', '••••••••', true);
  if (!pwd) return;

  try {
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, pwd);
    await user.reauthenticateWithCredential(credential);
    toast('Verificado. Borrando datos…', 'inf');
    await db.collection('collections').doc(user.uid).delete().catch(() => {});
    await db.collection('wishlists').doc(user.uid).delete().catch(() => {});
    await db.collection('admins').doc(user.uid).delete().catch(() => {});
    // Las subcolecciones no se borran solas al eliminar el documento padre.
    const friendsSnap = await db.collection('players').doc(user.uid).collection('friends').get().catch(() => null);
    if (friendsSnap) await Promise.all(friendsSnap.docs.map(f => f.ref.delete().catch(() => {})));
    await db.collection('players').doc(user.uid).delete().catch(() => {});
    await db.collection('usernames').doc(currentPlayer.name.toLowerCase()).delete().catch(() => {});
    cerrarCuenta();
    await user.delete();
    toast('Cuenta eliminada.', 'inf');
  } catch (err) {
    const wrongPwd = ['auth/wrong-password', 'auth/invalid-login-credentials', 'auth/internal-error'];
    if (wrongPwd.includes(err.code)) await bModal.alert('Contraseña incorrecta. Acción cancelada.');
    else await bModal.alert('Error al eliminar. Inténtalo de nuevo.');
  }
});

// ── DATOS EN LA NUBE ───────────────────────────────────────
async function loadCloudData() {
  if (!currentPlayer) return;

  try {
    const colDoc = await db.collection('collections').doc(currentPlayer.uid).get();
    if (colDoc.exists) {
      const d = colDoc.data();
      myCollections = d.lists ? d.lists : { 'Mi colección': d.cards || [] };
    }
  } catch (e) { console.warn('Colección:', e); }
  if (!myCollections[activeColList]) activeColList = Object.keys(myCollections)[0] || 'Mi colección';
  updateListUI('col');

  try {
    const wlDoc = await db.collection('wishlists').doc(currentPlayer.uid).get();
    if (wlDoc.exists) {
      const d = wlDoc.data();
      myWishlists = d.lists ? d.lists : { 'Mi lista de deseados': d.cards || [] };
    }
  } catch (e) { console.warn('Wishlist:', e); }
  if (!myWishlists[activeWlList]) activeWlList = Object.keys(myWishlists)[0] || 'Mi lista de deseados';
  updateListUI('wl');
  renderWishlistMatchSelector();
}

function scheduleSave(prefix) {
  if (DEMO_MODE) return;
  clearTimeout(saveTimers[prefix]);
  setSyncStatus(prefix, 'saving');
  saveTimers[prefix] = setTimeout(() => saveFullDictToCloud(prefix), 1200);
}

async function saveFullDictToCloud(prefix) {
  if (!currentPlayer || DEMO_MODE) return;
  const colName = prefix === 'col' ? 'collections' : 'wishlists';
  const dict = prefix === 'col' ? myCollections : myWishlists;
  try {
    await db.collection(colName).doc(currentPlayer.uid).set({
      name: currentPlayer.name,
      updatedAt: serverTimestamp(),
      lists: dict
    });
    setSyncStatus(prefix, 'saved');
  } catch (e) {
    setSyncStatus(prefix, '');
    toast('Error al sincronizar.', 'err');
  }
}

function setSyncStatus(prefix, state) {
  const el = $(`${prefix}SyncStatus`);
  if (!el) return;
  el.className = `sync-status sync-${state}`;
  el.textContent = state === 'saving' ? 'Guardando…' : state === 'saved' ? '✓ Guardado' : '';
  clearTimeout(syncStatusTimers[prefix]);
  if (state === 'saved') syncStatusTimers[prefix] = setTimeout(() => setSyncStatus(prefix, ''), 2200);
}

// ── PERFIL, ROLES Y AMIGOS EN FIRESTORE ────────────────────
// El documento público players/{uid} solo lleva el nombre. El rol de admin
// vive en admins/{uid} y la lista de amigos en players/{uid}/friends/{amigo},
// así que el directorio no revela ni quién manda ni con quién compartes.
async function loadAdminFlag(uid) {
  try {
    const snap = await db.collection('admins').doc(uid).get();
    return snap.exists;
  } catch (e) { console.warn('admins:', e); return false; }
}

async function loadFriendUids(uid) {
  try {
    const snap = await db.collection('players').doc(uid).collection('friends').get();
    return snap.docs.map(d => d.id);
  } catch (e) { console.warn('friends:', e); return []; }
}

// Convierte una ficha antigua: isAdmin → admins/{uid} y el array friends →
// subcolección, y deja el documento público limpio.
async function migratePlayerRecord(uid, data) {
  const plan = planPlayerMigration(data, uid);
  if (!plan.createAdminRole && !plan.friendUids.length && !plan.cleanPlayerDoc) return;

  // El rol se crea ANTES de limpiar la ficha: las reglas solo lo permiten
  // mientras el flag antiguo siga presente.
  if (plan.createAdminRole) {
    await db.collection('admins').doc(uid).set({ at: serverTimestamp() })
      .catch(e => console.warn('Migrar rol:', e));
  }
  if (plan.friendUids.length) {
    const batch = db.batch();
    plan.friendUids.forEach(f => batch.set(db.collection('players').doc(uid).collection('friends').doc(f), { at: serverTimestamp() }));
    await batch.commit().catch(e => console.warn('Migrar amigos:', e));
  }
  if (plan.cleanPlayerDoc) {
    const del = firebase.firestore.FieldValue.delete();
    await db.collection('players').doc(uid).update({ isAdmin: del, friends: del })
      .catch(e => console.warn('Limpiar ficha:', e));
  }
}

// ── AMIGOS Y SINCRONIZACIÓN ────────────────────────────────
// Las reglas de Firestore solo permiten leer tu colección y la de tus amigos,
// así que ya no se escucha la colección entera: se escucha documento a
// documento (el tuyo y el de cada amigo) y los cruces se recalculan solos.
function friendList() {
  return Array.isArray(currentPlayer && currentPlayer.friends) ? currentPlayer.friends : [];
}

function cloudTargets() {
  if (!currentPlayer) return [];
  return [currentPlayer.uid, ...friendList()]
    .filter((uid, i, all) => uid && all.indexOf(uid) === i);
}

function clearCloudSubscriptions() {
  unsubCloud.forEach(unsub => { try { unsub(); } catch (e) { /* ya estaba cerrada */ } });
  unsubCloud = [];
}

function subscribeCloudData() {
  clearCloudSubscriptions();
  allCollections = {};
  allWishlists = {};
  const targets = cloudTargets();
  cloudDataReady = { col: targets.length === 0, wl: targets.length === 0 };

  const needed = targets.length;
  const seen = { col: 0, wl: 0 };
  const mark = kind => {
    if (seen[kind] < needed) seen[kind] += 1;
    if (seen[kind] >= needed) cloudDataReady[kind] = true;
    if (cloudDataReady.col && cloudDataReady.wl) runMatches();
  };

  targets.forEach(uid => {
    unsubCloud.push(db.collection('collections').doc(uid).onSnapshot(ref => {
      if (ref.exists) allCollections[uid] = ref.data(); else delete allCollections[uid];
      mark('col');
    }, err => {
      console.error('Snapshot collections:', uid, err);
      mark('col');
    }));

    unsubCloud.push(db.collection('wishlists').doc(uid).onSnapshot(ref => {
      if (ref.exists) allWishlists[uid] = ref.data(); else delete allWishlists[uid];
      mark('wl');
    }, err => {
      console.error('Snapshot wishlists:', uid, err);
      mark('wl');
    }));
  });

  if (!targets.length) runMatches();
}

// ── GESTIÓN DE AMIGOS ──────────────────────────────────────
// Tú decides quién ve tus listas. El permiso va de dueño a amigo: al añadir
// a alguien, esa persona pasa a poder leer tu colección y tu lista de deseos.
function updateFriendsUI() {
  const summary = $('friendsSummary');
  if (summary) {
    const n = friendList().length;
    summary.textContent = DEMO_MODE
      ? `${n} amigos simulados`
      : n === 0
        ? 'Todavía no has añadido a nadie. Sin amigos no hay cruces que mostrar.'
        : `${n} ${n === 1 ? 'amigo' : 'amigos'} · solo veis las listas de quien os ha añadido`;
  }
  const manage = $('manageFriendsBtn');
  if (manage) manage.classList.toggle('hidden', !!DEMO_MODE);
}

async function renderFriendsModal() {
  const list = $('friendsPlayersList');
  if (!list) return;
  if (DEMO_MODE) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem">No disponible en modo demo.</p>';
    return;
  }
  list.innerHTML = '<p class="text-muted" style="padding:1rem">Cargando jugadores…</p>';
  try {
    const snap = await db.collection('players').orderBy('nameLower').get();
    const mine = new Set(friendList());
    const others = [];
    snap.forEach(doc => {
      if (doc.id === currentPlayer.uid) return;
      const d = doc.data();
      const isFriend = mine.has(doc.id);
      others.push(`
        <div class="player-row">
          <div class="player-info">
            <span class="player-name">${escapeHtml(d.name || 'Jugador')}</span>
            <span class="player-meta">${isFriend ? 'Ve tu colección y tu lista de deseados' : 'No ve nada tuyo'}</span>
          </div>
          <div class="player-actions">
            <button class="btn btn-sm ${isFriend ? 'btn-danger' : 'btn-primary'}"
              data-friend-toggle="${escapeHtml(doc.id)}" aria-pressed="${isFriend}"
              aria-label="${isFriend ? 'Dejar de compartir mis listas con ' + escapeHtml(d.name || 'este jugador') : 'Compartir mis listas con ' + escapeHtml(d.name || 'este jugador')}">
              ${isFriend ? 'Dejar de compartir' : 'Compartir mis listas'}
            </button>
          </div>
        </div>`);
    });
    list.innerHTML = others.length
      ? others.join('')
      : '<p class="text-muted" style="padding:1rem">Todavía no hay otros jugadores registrados.</p>';
    list.querySelectorAll('[data-friend-toggle]').forEach(btn => {
      btn.addEventListener('click', () => toggleFriend(btn.dataset.friendToggle));
    });
  } catch (e) {
    console.error('Amigos:', e);
    list.innerHTML = '<p class="match-error" style="padding:1rem">No se pudo cargar la lista de jugadores.</p>';
  }
}

async function toggleFriend(uid) {
  if (!currentPlayer || !uid) return;
  const isFriend = friendList().indexOf(uid) > -1;
  const ref = db.collection('players').doc(currentPlayer.uid).collection('friends').doc(uid);
  try {
    if (isFriend) await ref.delete();
    else await ref.set({ at: serverTimestamp() });
  } catch (e) {
    console.error('Guardar amigos:', e);
    toast('No se pudo guardar la lista de amigos.', 'err');
    return;
  }
  currentPlayer.friends = isFriend
    ? friendList().filter(id => id !== uid)
    : friendList().concat(uid);
  updateFriendsUI();
  subscribeCloudData();
  renderFriendsModal();
  toast(isFriend ? 'Has dejado de compartir con ese jugador.' : 'Ahora esa persona puede ver tus listas.');
}

const friendsModal = $('friendsModal');
let focoAntesAmigos = null;

function abrirAmigos() {
  if (!friendsModal) return;
  focoAntesAmigos = document.activeElement;
  friendsModal.classList.remove('hidden');
  $('manageFriendsBtn')?.setAttribute('aria-expanded', 'true');
  renderFriendsModal();
  setTimeout(() => $('closeFriendsModalBtn')?.focus(), 40);
}
function cerrarAmigos() {
  friendsModal?.classList.add('hidden');
  $('manageFriendsBtn')?.setAttribute('aria-expanded', 'false');
  if (focoAntesAmigos && typeof focoAntesAmigos.focus === 'function') focoAntesAmigos.focus();
}

$('manageFriendsBtn')?.addEventListener('click', abrirAmigos);
$('closeFriendsModalBtn')?.addEventListener('click', cerrarAmigos);
friendsModal?.addEventListener('click', e => { if (e.target === friendsModal) cerrarAmigos(); });
friendsModal?.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); cerrarAmigos(); return; }
  trapTab(e, friendsModal);
});

// Reclama tu nombre en usernames si aún no existe (cuentas antiguas).
async function ensureUsernameClaim(nameLower, uid) {
  try {
    const ref = db.collection('usernames').doc(nameLower);
    const snap = await ref.get();
    if (!snap.exists) await ref.set({ uid, createdAt: serverTimestamp() });
  } catch (e) { console.warn('ensureUsernameClaim:', e); }
}

// ── PESTAÑAS PRINCIPALES ───────────────────────────────────
const TABS = ['Home', 'Collection', 'Wishlist', 'Admin'];

function switchTab(tabName, { focusPanel = false } = {}) {
  TABS.forEach(t => {
    const panel = $(`panel${t}`);
    const btn = $(`tab${t}Btn`);
    const activo = t === tabName;
    panel?.classList.toggle('active', activo);
    if (btn) {
      btn.setAttribute('aria-selected', activo ? 'true' : 'false');
      btn.tabIndex = activo ? 0 : -1;
    }
  });
  if (focusPanel) $(`panel${tabName}`)?.focus();
  if (tabName === 'Admin') loadAdminPanel();
  if (tabName === 'Home') runMatches();
}

TABS.forEach(tab => {
  const btn = $(`tab${tab}Btn`);
  if (!btn) return;
  btn.addEventListener('click', () => switchTab(tab));
  // Navegación con flechas dentro del tablist (patrón ARIA de pestañas).
  btn.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const visibles = TABS.filter(t => !$(`tab${t}Btn`)?.classList.contains('hidden'));
    const i = visibles.indexOf(tab);
    const next = visibles[(i + (e.key === 'ArrowRight' ? 1 : -1) + visibles.length) % visibles.length];
    const nextBtn = $(`tab${next}Btn`);
    switchTab(next);
    nextBtn?.focus();
  });
});

document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.goto, { focusPanel: true }));
});

// ── LISTAS: UI ─────────────────────────────────────────────
function totalCards(dict) {
  return Object.values(dict || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

function updateTabCounts() {
  const c = $('tabColCount');
  const w = $('tabWlCount');
  if (c) c.textContent = totalCards(myCollections);
  if (w) w.textContent = totalCards(myWishlists);
}

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
  renderVisualList(prefix, $(`${prefix}SearchInput`).value);
  renderOnboarding(prefix, arr.length);
  updateTabCounts();
}

function renderOnboarding(prefix, count) {
  const el = $(`${prefix}Onboarding`);
  if (!el) return;
  el.classList.toggle('hidden', count > 0);
}

function switchToList(prefix, name) {
  if (prefix === 'col') activeColList = name; else activeWlList = name;
  const inp = $(`${prefix}SearchInput`);
  if (inp) inp.value = '';
  updateListUI(prefix);
}

$('colListSelect')?.addEventListener('change', e => switchToList('col', e.target.value));
$('wlListSelect')?.addEventListener('change', e => switchToList('wl', e.target.value));

// ── MENÚS DE ACCIONES ──────────────────────────────────────
const menus = {};

function setupMenu(btnId, menuId) {
  const btn = $(btnId);
  const menu = $(menuId);
  if (!btn || !menu) return null;

  const close = ({ devolverFoco = false } = {}) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (devolverFoco) btn.focus();
  };
  const open = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('.menu-item')?.focus();
  };

  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close({ devolverFoco: true }); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('.menu-item')];
      const i = items.indexOf(document.activeElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      e.preventDefault();
      next?.focus();
    }
  });
  return { close, open };
}

// Cada acción dentro del menú cierra el menú tras ejecutarse.
function menuAction(menuKey, itemId, fn) {
  $(itemId)?.addEventListener('click', () => {
    menus[menuKey]?.close();
    fn();
  });
}

menus.col = setupMenu('colMenuBtn', 'colMenu');
menus.wl = setupMenu('wlMenuBtn', 'wlMenu');

// ── ACCIONES DE LISTA ──────────────────────────────────────
function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'lista';
}

async function handleNewList(prefix) {
  const name = await bModal.prompt('Nombre de la nueva lista:', 'Ej: Mazo moderno');
  if (!name) return;
  const dict = prefix === 'col' ? myCollections : myWishlists;
  if (dict[name]) { await bModal.alert('Ya existe una lista con ese nombre.'); return; }
  dict[name] = [];
  switchToList(prefix, name);
  saveFullDictToCloud(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();
  updateTabCounts();
}

async function handleRenameList(prefix) {
  const dict = prefix === 'col' ? myCollections : myWishlists;
  const active = prefix === 'col' ? activeColList : activeWlList;
  const name = await bModal.prompt('Nuevo nombre para la lista:', active);
  if (!name || name === active) return;
  if (dict[name]) { await bModal.alert('Ya existe una lista con ese nombre.'); return; }

  // Reconstruye el diccionario conservando el orden de las listas.
  const nuevo = {};
  Object.keys(dict).forEach(k => { nuevo[k === active ? name : k] = dict[k]; });
  if (prefix === 'col') { myCollections = nuevo; activeColList = name; }
  else { myWishlists = nuevo; activeWlList = name; }

  updateListUI(prefix);
  saveFullDictToCloud(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();
  toast('Lista renombrada.');
}

function handleExportList(prefix) {
  const dict = prefix === 'col' ? myCollections : myWishlists;
  const active = prefix === 'col' ? activeColList : activeWlList;
  const arr = dict[active] || [];
  if (!arr.length) { toast('La lista está vacía: no hay nada que exportar.', 'inf'); return; }

  const texto = arr.join('\n');
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(active)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exportadas ${arr.length} cartas.`);
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
  updateTabCounts();
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
  updateTabCounts();
  toast('Lista vaciada.');
}

$('colNewListBtn')?.addEventListener('click', () => handleNewList('col'));
$('wlNewListBtn')?.addEventListener('click', () => handleNewList('wl'));
menuAction('col', 'colRenameBtn', () => handleRenameList('col'));
menuAction('wl', 'wlRenameBtn', () => handleRenameList('wl'));
menuAction('col', 'colExportBtn', () => handleExportList('col'));
menuAction('wl', 'wlExportBtn', () => handleExportList('wl'));
menuAction('col', 'colClearListBtn', () => handleClearList('col'));
menuAction('wl', 'wlClearListBtn', () => handleClearList('wl'));
menuAction('col', 'colDelListBtn', () => handleDeleteList('col'));
menuAction('wl', 'wlDelListBtn', () => handleDeleteList('wl'));

// ── AÑADIR CARTA RÁPIDO ────────────────────────────────────
function setupQuickAdd(prefix) {
  const input = $(`${prefix}QuickAddInput`);
  const button = $(`${prefix}QuickAddBtn`);
  if (!input || !button) return;

  function addCard() {
    const raw = input.value.trim();
    if (!raw) return;
    const dict = prefix === 'col' ? myCollections : myWishlists;
    const active = prefix === 'col' ? activeColList : activeWlList;
    const { qty, name } = parseCardString(raw);
    const entry = `${qty} ${name}`;
    dict[active].push(entry);
    input.value = '';
    updateListUI(prefix);
    scheduleSave(prefix);
    if (prefix === 'wl') renderWishlistMatchSelector();
    updateTabCounts();
  }

  button.addEventListener('click', addCard);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCard(); } });
}

// ── AUTOCOMPLETADO DE NOMBRES (catálogo de Scryfall) ───────
// Al escribir en el campo de añadir carta se sugiere el nombre OFICIAL, para no
// meter erratas que luego impiden que los cruces casen. Si Scryfall no responde
// o no hay red, el campo sigue funcionando igual: simplemente no sugiere.
const _scryfallCache = new Map();
async function fetchCardSuggestions(query) {
  const key = String(query).toLowerCase();
  if (_scryfallCache.has(key)) return _scryfallCache.get(key);
  const res = await fetch(scryfallAutocompleteUrl(query), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Scryfall ' + res.status);
  const data = await res.json();
  const nombres = Array.isArray(data.data) ? data.data.slice(0, 8) : [];
  _scryfallCache.set(key, nombres);
  return nombres;
}

function setupScryfallAutocomplete(prefix) {
  const input = $(`${prefix}QuickAddInput`);
  if (!input) return;

  const wrap = document.createElement('div');
  wrap.className = 'sf-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('ul');
  list.id = `${prefix}CardSuggestions`;
  list.className = 'sf-list hidden';
  list.setAttribute('role', 'listbox');
  wrap.appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('autocomplete', 'off');

  let nombres = [];
  let activo = -1;
  let timer = null;
  let peticion = 0;

  function cerrar() {
    list.classList.add('hidden');
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    nombres = [];
    activo = -1;
  }
  function pintar() {
    list.innerHTML = nombres.map((n, i) =>
      `<li role="option" id="${list.id}-${i}" aria-selected="${i === activo}"` +
      ` class="sf-op${i === activo ? ' sf-activo' : ''}">${escapeHtml(n)}</li>`).join('');
    list.classList.toggle('hidden', !nombres.length);
    input.setAttribute('aria-expanded', String(nombres.length > 0));
    input.setAttribute('aria-activedescendant', activo >= 0 ? `${list.id}-${activo}` : '');
  }
  function elegir(i) {
    if (i < 0 || i >= nombres.length) return;
    input.value = completeCardQuery(input.value, nombres[i]);
    cerrar();
    input.focus();
  }
  function mover(delta) {
    if (!nombres.length) return;
    const total = nombres.length + 1;   // incluye el estado "ninguna activa" (-1)
    activo = ((activo + 1 + delta) % total + total) % total - 1;
    pintar();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const { query } = splitCardQuery(input.value);
    if (query.length < 2) { cerrar(); return; }
    timer = setTimeout(async () => {
      const mio = ++peticion;
      try {
        const r = await fetchCardSuggestions(query);
        if (mio !== peticion) return;   // respuesta antigua: se descarta
        nombres = r;
        activo = -1;
        pintar();
      } catch { if (mio === peticion) cerrar(); }
    }, 220);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!nombres.length) return; mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!nombres.length) return; mover(-1); }
    else if (e.key === 'Escape') { cerrar(); }
    else if (e.key === 'Tab') { cerrar(); }
    else if (e.key === 'Enter' && activo >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();   // con sugerencia resaltada, Enter la elige
      elegir(activo);
    }
  });
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[role="option"]');
    if (!li) return;
    e.preventDefault();   // el input no pierde el foco
    elegir(Array.from(list.children).indexOf(li));
  });
  input.addEventListener('blur', () => setTimeout(cerrar, 120));
}

// El autocompletado se engancha ANTES que el alta rápida: así, con una
// sugerencia resaltada, Enter la elige en lugar de añadir media carta.
setupScryfallAutocomplete('col');
setupScryfallAutocomplete('wl');
setupQuickAdd('col');
setupQuickAdd('wl');

// ── AUTO-GUARDADO DEL TEXTAREA ─────────────────────────────
function setupTextareaAutosave(prefix) {
  const textarea = $(prefix === 'col' ? 'collectionInput' : 'wishlistInput');
  if (!textarea) return;

  textarea.addEventListener('input', () => {
    const dict = prefix === 'col' ? myCollections : myWishlists;
    const active = prefix === 'col' ? activeColList : activeWlList;
    const cards = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
    dict[active] = cards;
    renderOnboarding(prefix, cards.length);
    updateTabCounts();
    scheduleSave(prefix);
    if (prefix === 'wl') renderWishlistMatchSelector();
  });

  textarea.addEventListener('blur', () => updateListUI(prefix));
}
setupTextareaAutosave('col');
setupTextareaAutosave('wl');

// ── LISTA VISUAL (paginada) ────────────────────────────────
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
    container.innerHTML = '<p class="text-muted" style="padding:1rem">No se encontraron cartas.</p>';
    return;
  }

  const page = listPage[prefix];
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, filtered.length);
  const pageItems = filtered.slice(start, end);

  container.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'list-page-bar';
  bar.innerHTML =
    `<span class="list-page-info">${filtered.length} carta${filtered.length !== 1 ? 's' : ''}` +
    (filterText ? ' encontradas' : '') +
    (totalPages > 1 ? ` — p. ${page + 1}/${totalPages}` : '') +
    `</span>` +
    (totalPages > 1 ? `<div class="list-page-btns">` +
      `<button class="btn btn-sm btn-ghost page-prev" ${page === 0 ? 'disabled' : ''}>&#8249; Ant.</button>` +
      `<button class="btn btn-sm btn-ghost page-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Sig. &#8250;</button>` +
      `</div>` : '');
  container.appendChild(bar);

  pageItems.forEach(({ s, i }) => {
    const { qty, name } = parseCardString(s);
    const row = document.createElement('div');
    row.className = 'visual-card-row';
    row.innerHTML =
      `<div class="card-info">` +
      `<span class="qty-badge">${qty}x</span>` +
      `<span class="card-name">${escapeHtml(name)}</span>` +
      `</div>` +
      `<button class="card-delete-btn" type="button" aria-label="Eliminar ${escapeHtml(name)} de la lista" title="Eliminar carta">&times;</button>`;
    row.querySelector('.card-delete-btn').addEventListener('click', () => {
      arr.splice(i, 1);
      if (prefix === 'col') myCollections[activeColList] = arr;
      else myWishlists[activeWlList] = arr;
      updateListUI(prefix);
      scheduleSave(prefix);
      if (prefix === 'wl') renderWishlistMatchSelector();
      updateTabCounts();
    });
    container.appendChild(row);
  });

  if (totalPages > 1) {
    const bar2 = document.createElement('div');
    bar2.className = 'list-page-bar';
    bar2.innerHTML =
      `<span class="list-page-info">Mostrando ${start + 1}–${end} de ${filtered.length}</span>` +
      `<div class="list-page-btns">` +
      `<button class="btn btn-sm btn-ghost page-prev" ${page === 0 ? 'disabled' : ''}>&#8249; Anterior</button>` +
      `<button class="btn btn-sm btn-ghost page-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Siguiente &#8250;</button>` +
      `</div>`;
    container.appendChild(bar2);
  }

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

// ── VISTAS: Lista / Texto / Importar ───────────────────────
function selectImpTab(panelRoot, targetId) {
  const tabs = panelRoot.querySelectorAll('.imp-tab');
  tabs.forEach(b => {
    const activo = b.dataset.target === targetId;
    b.setAttribute('aria-selected', activo ? 'true' : 'false');
    b.tabIndex = activo ? 0 : -1;
  });
  panelRoot.querySelectorAll('.imp-panel').forEach(p => p.classList.toggle('active', p.id === targetId));
}

document.querySelectorAll('.imp-mode-tabs').forEach(tabGroup => {
  const panelRoot = tabGroup.closest('.panel') || document;
  tabGroup.querySelectorAll('.imp-tab').forEach(btn => {
    btn.addEventListener('click', () => selectImpTab(panelRoot, btn.dataset.target));
    btn.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const items = [...tabGroup.querySelectorAll('.imp-tab')];
      const i = items.indexOf(btn);
      const next = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
      selectImpTab(panelRoot, next.dataset.target);
      next.focus();
    });
  });
});

// ── IMPORTACIÓN: fusionar y guardar ────────────────────────
// mergeCardLists y parseCSV viven en card-utils.js.
function mergeAndSave(prefix, newCards) {
  const textareaId = prefix === 'col' ? 'collectionInput' : 'wishlistInput';
  const existing = $(textareaId).value.split('\n').map(l => l.trim()).filter(l => l);
  const merged = mergeCardLists(existing, newCards);
  $(textareaId).value = merged.join('\n');

  if (prefix === 'col') myCollections[activeColList] = merged;
  else myWishlists[activeWlList] = merged;

  updateListUI(prefix);
  scheduleSave(prefix);
  if (prefix === 'wl') renderWishlistMatchSelector();
  updateTabCounts();
  selectImpTab(prefix === 'col' ? $('panelCollection') : $('panelWishlist'), `${prefix}-view`);
}

function setupCSVDrop(prefix) {
  const zone = $(`${prefix}DropZone`);
  const input = $(`${prefix}FileInput`);
  const status = $(`${prefix}CsvStatus`);
  if (!zone || !input || !status) return;

  const pickFile = () => input.click();

  zone.addEventListener('click', pickFile);
  // La zona es un botón: Enter y Espacio deben funcionar con teclado.
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); }
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
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
      mergeAndSave(prefix, cards);
      status.textContent = `✓ ${cards.length} cartas importadas.`;
      status.className = 'imp-status ok';
    };
    reader.readAsText(file);
  }
}
setupCSVDrop('col');
setupCSVDrop('wl');

// ── SELECTOR DE LISTAS A BUSCAR (matcher) ──────────────────
function renderWishlistMatchSelector() {
  const container = $('wishlistMatchSelector');
  const box = $('wishlistMatchSelectorBox');
  if (!container || !box) return;
  container.innerHTML = '';
  const keys = Object.keys(myWishlists);

  if (keys.length <= 1) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  keys.forEach(listName => {
    const lbl = document.createElement('label');
    lbl.className = 'wl-checkbox-label';
    lbl.innerHTML = `
      <input type="checkbox" value="${escapeHtml(listName)}" class="wl-match-cb" checked>
      ${escapeHtml(listName)} <span class="text-xs text-muted">(${myWishlists[listName].length})</span>`;
    container.appendChild(lbl);
  });
}

// ── GUÍA DE INICIO (3 pasos) ───────────────────────────────
function updateHomeOnboarding() {
  const el = $('homeOnboarding');
  if (!el) return;
  const isEmpty = currentPlayer && totalCards(myCollections) === 0 && totalCards(myWishlists) === 0;
  el.classList.toggle('hidden', !isEmpty);
}

// ── MATCHER ────────────────────────────────────────────────
function setSummaryCell(cellId, valueId, valor) {
  const cell = $(cellId);
  const num = $(valueId);
  if (num) num.textContent = valor;
  if (cell) cell.classList.toggle('is-zero', valor === 0);
}

function runMatches() {
  if (!currentPlayer) return;
  updateHomeOnboarding();

  const iWantEl = $('matchesIWant');
  const theyWantEl = $('matchesTheyWant');
  const iHaveEl = $('matchesIHave');
  if (!iWantEl) return;

  [iWantEl, theyWantEl, iHaveEl].forEach(el => { if (el) el.innerHTML = '<p class="text-muted">Buscando…</p>'; });

  const selectedWl = Array.from(document.querySelectorAll('.wl-match-cb:checked')).map(cb => cb.value);
  const effectiveSelected = selectedWl.length ? selectedWl : Object.keys(myWishlists);
  const { owned, partial, iWant, theyWant, hasWanted } = computeMatches({
    myWishlists,
    selectedLists: effectiveSelected,
    myCollections,
    allCollections,
    allWishlists,
    myUid: currentPlayer.uid
  });

  // Columna 1: cartas de mi lista de deseados que ya tengo.
  if (iHaveEl) {
    if (!hasWanted) {
      iHaveEl.innerHTML = '<p class="text-muted">Añade cartas a tu lista de deseados primero.</p>';
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

  if (!cloudDataReady.col || !cloudDataReady.wl) {
    if (iWantEl) iWantEl.innerHTML = '<p class="text-muted">Cargando datos de los jugadores…</p>';
    if (theyWantEl) theyWantEl.innerHTML = '';
    return;
  }

  iWantEl.innerHTML = iWant.length
    ? iWant.map(g => renderCollapsibleGroup(g.name, g.hits.map(h =>
      `<li><span class="qty-badge qty-available">${h.available}</span><strong>${escapeHtml(h.name)}</strong><span class="match-meta">buscas ${h.qty}</span></li>`
    ).join(''), g.hits.length, g.lines)).join('')
    : '<p class="text-muted">Nadie tiene lo que buscas.</p>';

  if (theyWantEl) theyWantEl.innerHTML = theyWant.length
    ? theyWant.map(g => renderCollapsibleGroup(g.name, g.hits.map(h =>
      `<li><span class="qty-badge qty-mine">${h.mine}</span><strong>${escapeHtml(h.name)}</strong><span class="match-meta">ellos buscan ${h.want}</span></li>`
    ).join(''), g.hits.length)).join('')
    : '<p class="text-muted">Nadie busca lo que tienes.</p>';

  // Resumen de 3 cifras
  setSummaryCell('sumIHaveCell', 'sumIHave', owned.length + partial.length);
  setSummaryCell('sumIWantCell', 'sumIWant', iWant.reduce((n, g) => n + g.hits.length, 0));
  setSummaryCell('sumTheyWantCell', 'sumTheyWant', theyWant.reduce((n, g) => n + g.hits.length, 0));

  const lastUpdated = $('lastUpdated');
  if (lastUpdated) {
    const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    lastUpdated.textContent = `Actualizado a las ${hora}`;
  }

  // Colapsables accesibles (aria-expanded + aria-controls).
  document.querySelectorAll('.collapsible-toggle').forEach(btn => {
    const body = btn.nextElementSibling;
    btn.addEventListener('click', () => {
      const abierto = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', abierto ? 'false' : 'true');
      body.classList.toggle('collapsed', abierto);
      const flecha = btn.querySelector('.collapse-arrow');
      if (flecha) flecha.textContent = abierto ? '▸' : '▾';
    });
  });

  document.querySelectorAll('.btn-copy-msg').forEach(btn => {
    btn.addEventListener('click', () => {
      const playerName = btn.dataset.player;
      let cardLines = [];
      try { cardLines = JSON.parse(btn.dataset.cards); } catch { cardLines = []; }
      const msg = buildWhatsAppMessage(playerName, cardLines);
      navigator.clipboard.writeText(msg).then(() => {
        toast('Mensaje copiado al portapapeles');
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = msg;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('Mensaje copiado al portapapeles'); }
        catch { toast('No se pudo copiar el mensaje.', 'err'); }
        document.body.removeChild(ta);
      });
    });
  });
}

function renderCollapsibleGroup(playerName, itemsHtml, count, cardLines = []) {
  const groupId = 'cg-' + Math.random().toString(36).slice(2, 8);
  const bodyId = groupId + '-body';
  return `
    <div class="match-card">
      <button class="collapsible-toggle" type="button" aria-expanded="false" aria-controls="${bodyId}">
        <span class="collapse-arrow" aria-hidden="true">▸</span>
        <span class="collapse-name">${escapeHtml(playerName)}</span>
        <span class="collapse-count">${count} carta${count !== 1 ? 's' : ''}</span>
      </button>
      <div class="collapsible-body collapsed" id="${bodyId}">
        <ul class="match-item-list">${itemsHtml}</ul>
        ${cardLines.length ? `<button class="btn-copy-msg btn btn-sm btn-ghost" type="button" data-player="${escapeHtml(playerName)}" data-cards="${escapeHtml(JSON.stringify(cardLines))}">Copiar mensaje</button>` : ''}
      </div>
    </div>`;
}

function buildWhatsAppMessage(playerName, cardLines) {
  const list = cardLines.map(c => `  - ${c}`).join('\n');
  return `Hola ${playerName}, me interesan estas cartas de tu colección:\n${list}\n¡Gracias!`;
}

$('refreshMatchesBtn')?.addEventListener('click', runMatches);

// ── PANEL DE ADMIN ─────────────────────────────────────────
async function loadAdminPanel() {
  if (!currentPlayer?.isAdmin) return;
  const list = $('adminPlayerList');
  if (!list) return;
  list.innerHTML = '<p class="text-muted" style="padding:1rem">Cargando…</p>';

  try {
    const [snap, adminsSnap] = await Promise.all([
      db.collection('players').orderBy('nameLower').get(),
      db.collection('admins').get()
    ]);
    if (snap.empty) { list.innerHTML = '<p class="text-muted" style="padding:1rem">No hay jugadores registrados.</p>'; return; }
    const adminIds = new Set(adminsSnap.docs.map(a => a.id));

    list.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const uid = doc.id;
      const isMe = uid === currentPlayer.uid;
      const isAdminRow = adminIds.has(uid);
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <div class="player-info">
          <span class="player-name">${escapeHtml(d.name)}</span>
          ${isAdminRow ? '<span class="badge-admin">Admin</span>' : ''}
          ${isMe ? '<span class="player-meta">(tú)</span>' : ''}
        </div>
        <div class="player-actions">
          ${!isMe ? `
            <button class="btn btn-sm ${isAdminRow ? 'btn-ghost' : 'btn-blue'}"
              data-action="toggle" data-uid="${uid}" data-admin="${isAdminRow}">
              ${isAdminRow ? 'Quitar admin' : 'Dar admin'}
            </button>
            <button class="btn btn-sm btn-danger" data-action="delete" data-uid="${uid}" data-name="${escapeHtml(d.name)}">
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
          const ref = db.collection('admins').doc(uid);
          if (wasAdmin) await ref.delete(); else await ref.set({ at: serverTimestamp() });
          toast(wasAdmin ? 'Permisos retirados.' : 'Permisos concedidos.');
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
          const friendsSnap = await db.collection('players').doc(uid).collection('friends').get();
          const batch = db.batch();
          friendsSnap.forEach(f => batch.delete(f.ref));
          batch.delete(db.collection('players').doc(uid));
          batch.delete(db.collection('collections').doc(uid));
          batch.delete(db.collection('wishlists').doc(uid));
          batch.delete(db.collection('admins').doc(uid));
          await batch.commit();
          toast(`Datos de "${name}" eliminados.`, 'inf');
          loadAdminPanel();
        } catch (e) { toast('Error al eliminar.', 'err'); btn.disabled = false; }
      });
    });

  } catch (e) {
    console.error(e);
    list.innerHTML = '<p class="match-error" style="padding:1rem">Error al cargar jugadores.</p>';
  }
}

// Auto-entrar en la demo si la URL lleva ?demo (enlace de la portada)
if (new URLSearchParams(location.search).has('demo')) enterDemo();
