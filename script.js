// ═══════════════════════════════════════════════════════════
// MAGIC CARD MATCHER — REFACTORED SECURE CORE (script.js)
// ═══════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

if (typeof FIREBASE_CONFIG === 'undefined') {
  document.body.innerHTML = `
    <div style="font-family:monospace;padding:2rem;color:#f4697a;background:#0d0f14;min-height:100vh;">
      <h2>⚠️ Falta config.js</h2>
      <p style="margin-top:1rem;color:#6b7a99;">
        Copia <code>config.example.js</code> como <code>config.js</code>
        y rellena tus credenciales de Firebase Console.
      </p>
    </div>`;
  throw new Error('config.js no encontrado.');
}

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

let currentPlayer = null;
let collectionCloud = [];
let wishlistCloud = [];

const authModalContainer = document.querySelector('.auth-modal');

// ── TOAST NOTIFICATIONS ────────────────────────────────────
function toast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  if (type === 'err') t.style.boxShadow = '6px 6px 0px var(--primary)';
  else if (type === 'inf') t.style.boxShadow = '6px 6px 0px var(--accent-blue)';
  else t.style.boxShadow = '6px 6px 0px var(--accent-yellow)';

  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── AUTH FEEDBACK ERRORS ───────────────────────────────────
function showAuthFeedback(message, type = 'error') {
  const fb = $('authFeedback');
  if (!fb) return;
  fb.innerHTML = message;
  fb.className = `auth-feedback ${type}`;
}

function clearAuthFeedback() {
  const fb = $('authFeedback');
  if (!fb) return;
  fb.textContent = '';
  fb.className = 'auth-feedback';
}

function setAuthModalState(state) {
  clearAuthFeedback();
  if (authModalContainer) {
    authModalContainer.setAttribute('data-state', state);
  }
}

// ── TABS NAVIGATION ────────────────────────────────────────
const tabs = ['Home', 'Collection', 'Wishlist', 'Admin'];
tabs.forEach(tab => {
  const btn = $(`tab${tab}Btn`);
  if (btn) {
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        const p = $(`panel${t}`);
        const b = $(`tab${t}Btn`);
        if (p) p.classList.remove('active');
        if (b) b.classList.remove('active');
      });
      const targetPanel = $(`panel${tab}`);
      if (targetPanel) targetPanel.classList.add('active');
      btn.classList.add('active');
    });
  }
});

// Listeners para cambiar las vistas internas del modal
$('linkToRegister').addEventListener('click', (e) => { e.preventDefault(); setAuthModalState('register'); });
$('linkToForgot').addEventListener('click', (e) => { e.preventDefault(); setAuthModalState('forgot'); });
document.querySelectorAll('#linkToLogin').forEach(el => {
  el.addEventListener('click', (e) => { e.preventDefault(); setAuthModalState('login'); });
});

// ── OBSERVAR EL ESTADO DE LA SESIÓN DE FORMA AUTOMÁTICA ────
auth.onAuthStateChanged(async (user) => {
  if (user) {
    try {
      const playerDoc = await db.collection('players').doc(user.uid).get();
      let username = user.email.split('@')[0];
      let isAdmin = false;

      if (playerDoc.exists) {
        const data = playerDoc.data();
        username = data.name || username;
        isAdmin = !!data.isAdmin;
      } else {
        await db.collection('players').doc(user.uid).set({
          name: username,
          nameLower: username.toLowerCase(),
          isAdmin: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      currentPlayer = { uid: user.uid, name: username, isAdmin };

      // Actualizar píldora visual del header
      $('authPillText').textContent = username;
      $('authPill').classList.add('active');
      $('logoutBtn').style.display = 'inline-block';

      if (isAdmin) {
        const adminTab = $('tabAdminBtn');
        if (adminTab) adminTab.style.display = 'block';
      }

      // DESBLOQUEAR APLICACIÓN COMPLETAMENTE EN LA INTERFAZ
      $('loginModal').classList.remove('open');
      $('mainApp').style.display = 'block';

      await loadCloudData();
      toast(`Sesión activa: ${username}`);
    } catch (e) {
      console.error(e);
      toast('Error al sincronizar datos del jugador', 'err');
    }
  } else {
    // BLOQUEAR APLICACIÓN COMPLETAMENTE SI NO HAY SESIÓN ACTIVA
    currentPlayer = null;
    $('authPillText').textContent = 'Sin sesión';
    $('authPill').classList.remove('active');
    $('logoutBtn').style.display = 'none';

    const adminTab = $('tabAdminBtn');
    if (adminTab) adminTab.style.display = 'none';

    $('collectionInput').value = '';
    $('wishlistInput').value = '';

    // Forzar apertura del modal impidiendo cierres manuales
    $('mainApp').style.display = 'none';
    setAuthModalState('login');
    $('loginModal').classList.add('open');
  }
});

// ── MANEJO DEL FORMULARIO UNIFICADO DE AUTENTICACIÓN ───────
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAuthFeedback();

  const state = authModalContainer.getAttribute('data-state');
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const username = $('authUsername').value.trim();

  if (!email) return showAuthFeedback('El correo electrónico es obligatorio.');

  try {
    if (state === 'login') {
      if (!password) return showAuthFeedback('Introduce tu contraseña.');
      await auth.signInWithEmailAndPassword(email, password);

    } else if (state === 'register') {
      if (!username) return showAuthFeedback('Asigna un Nombre de Jugador.');
      if (!password || password.length < 6) return showAuthFeedback('La contraseña debe tener mínimo 6 caracteres.');

      // Validar alias duplicado en la base de datos Firestore
      const nameLower = username.toLowerCase();
      const existing = await db.collection('players').where('nameLower', '==', nameLower).limit(1).get();
      if (!existing.empty) return showAuthFeedback('Ese nombre de jugador ya está en uso.');

      // Crear credenciales en Firebase Authentication
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);

      // Guardar perfil extendido mapeado por su UID exacto
      await db.collection('players').doc(userCredential.user.uid).set({
        name: username,
        nameLower: nameLower,
        isAdmin: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      toast('¡Cuenta creada correctamente!');

    } else if (state === 'forgot') {
      await auth.sendPasswordResetEmail(email);
      showAuthFeedback('Enlace enviado. Revisa tu buzón de correo.', 'success');
    }
  } catch (error) {
    console.error("Firebase Auth Error:", error);

    // Tratamiento didáctico para el error de proveedor desactivado en la consola
    if (error.code === 'auth/operation-not-allowed') {
      showAuthFeedback(`
        <strong>⚠️ PROVEEDOR DESACTIVADO EN FIREBASE:</strong><br>
        Debes activar el método de inicio por Correo en tu Firebase Console.<br><br>
        <span style="font-size:0.75rem; text-transform:none; font-family:monospace; display:block; background:#fff; padding:0.5rem; border:1px solid var(--border); color:#111;">
          Ir a: Authentication > pestaña "Sign-in method" > Habilitar "Correo electrónico/contraseña".
        </span>
      `);
      return;
    }

    switch (error.code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        showAuthFeedback('Las credenciales introducidas no son correctas.');
        break;
      case 'auth/email-already-in-use':
        showAuthFeedback('Este correo electrónico ya está registrado.');
        break;
      case 'auth/invalid-email':
        showAuthFeedback('El formato del correo electrónico no es válido (ejemplo@dominio.com).');
        break;
      case 'auth/weak-password':
        showAuthFeedback('La contraseña es demasiado débil (mínimo 6 caracteres).');
        break;
      default:
        showAuthFeedback(`Error de Firebase: ${error.message}`);
    }
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await auth.signOut();
  toast('Sesión cerrada correctamente.', 'inf');
});

// ── PERSISTENCIA Y CARGA DE DATOS DESDE FIRESTORE ──────────
async function loadCloudData() {
  if (!currentPlayer) return;

  const colDoc = await db.collection('collections').doc(currentPlayer.uid).get();
  if (colDoc.exists) {
    collectionCloud = colDoc.data().cards || [];
    $('collectionInput').value = collectionCloud.join('\n');
  }

  const wlDoc = await db.collection('wishlists').doc(currentPlayer.uid).get();
  if (wlDoc.exists) {
    wishlistCloud = wlDoc.data().cards || [];
    $('wishlistInput').value = wishlistCloud.join('\n');
  }
}

$('saveCollectionBtn').addEventListener('click', async () => {
  if (!currentPlayer) return toast('Sesión expirada.', 'err');
  const cards = $('collectionInput').value.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  try {
    await db.collection('collections').doc(currentPlayer.uid).set({
      name: currentPlayer.name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      cards: cards
    });
    toast('Colección sincronizada en la nube');
  } catch (e) {
    toast('Error al guardar colección', 'err');
  }
});

$('saveWishlistBtn').addEventListener('click', async () => {
  if (!currentPlayer) return toast('Sesión expirada.', 'err');
  const cards = $('wishlistInput').value.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  try {
    await db.collection('wishlists').doc(currentPlayer.uid).set({
      name: currentPlayer.name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      cards: cards
    });
    toast('Wishlist sincronizada en la nube');
  } catch (e) {
    toast('Error al guardar wishlist', 'err');
  }
});

// ── ALGORITMO DE INTERSECCIÓN Y CRUCES DE CARTAS ───────────
$('refreshMatchesBtn').addEventListener('click', async () => {
  if (!currentPlayer) return;
  $('matchesContainer').innerHTML = '<p class="text-muted">Analizando colecciones cruzadas del grupo en Firestore...</p>';

  try {
    const allCollections = await db.collection('collections').get();
    let html = '';

    if (wishlistCloud.length === 0) {
      $('matchesContainer').innerHTML = '<p class="text-rose" style="font-weight:700;">Tu Wishlist en la nube está vacía.</p>';
      return;
    }

    allCollections.forEach(doc => {
      if (doc.id === currentPlayer.uid) return;
      const partnerData = doc.data();
      const partnerCards = partnerData.cards || [];

      const matches = wishlistCloud.filter(wlCard =>
        partnerCards.some(pCard => pCard.toLowerCase().includes(wlCard.toLowerCase()))
      );

      if (matches.length > 0) {
        html += `
        <div style="border: 3px solid var(--border); padding: 1.5rem; margin-bottom: 1rem; box-shadow: 6px 6px 0px var(--border); background:#fff;">
          <h3 style="color:var(--accent-blue); margin-bottom:0.5rem;">🔥 ¡${partnerData.name} tiene cartas que buscas!</h3>
          <ul style="padding-left:1.25rem; font-weight:500;">
            ${matches.map(m => `<li>${m}</li>`).join('')}
          </ul>
        </div>`;
      }
    });

    $('matchesContainer').innerHTML = html || '<p class="text-muted">No hay coincidencias en este momento con otros miembros.</p>';
  } catch (e) {
    console.error(e);
    $('matchesContainer').innerHTML = '<p class="text-rose">Error al procesar matrices de intercambio.</p>';
  }
});