// ═══════════════════════════════════════════════════════════
// MAGIC CARD MATCHER — script.js
// ═══════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

// ── FIREBASE GUARD ─────────────────────────────────────────
if (typeof FIREBASE_CONFIG === 'undefined') {
  document.body.innerHTML = `
    <div style="font-family:monospace;padding:2rem;color:#f4697a;background:#111;min-height:100vh;">
      <h2>⚠️ Falta config.js</h2>
      <p style="margin-top:1rem;color:#aaa;">
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

// ── AUTH FEEDBACK ──────────────────────────────────────────
function showAuthFeedback(msg, type = 'error') {
  const fb = $('authFeedback');
  if (!fb) return;
  fb.innerHTML = msg;
  fb.className = `auth-feedback ${type}`;
}
function clearAuthFeedback() {
  const fb = $('authFeedback');
  if (!fb) return;
  fb.textContent = '';
  fb.className = 'auth-feedback';
}
function setAuthState(state) {
  clearAuthFeedback();
  if (authModal) authModal.setAttribute('data-state', state);
}

// ── AUTH NAVIGATION LINKS ──────────────────────────────────
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
    TABS.forEach(t => {
      $(`panel${t}`)?.classList.remove('active');
      $(`tab${t}Btn`)?.classList.remove('active');
    });
    $(`panel${tab}`)?.classList.add('active');
    btn.classList.add('active');
    if (tab === 'Admin') loadAdminPanel();
  });
});

// ── AUTH STATE OBSERVER ────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (user) {
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
          name: username,
          nameLower: username.toLowerCase(),
          isAdmin: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      currentPlayer = { uid: user.uid, name: username, isAdmin };

      // Update header pill
      $('authPillText').textContent = username;
      $('authPill').classList.add('active');
      $('logoutBtn').style.display = 'inline-block';

      // Admin tab — show only for real admins
      const adminTab = $('tabAdminBtn');
      if (adminTab) adminTab.style.display = isAdmin ? 'block' : 'none';

      // Show app, hide login screen
      $('loginScreen').classList.add('hidden');
      $('mainApp').style.display = 'block';

      await loadCloudData();
      toast(`Sesión activa: ${username}`);

    } catch (e) {
      console.error(e);
      toast('Error al sincronizar datos del jugador.', 'err');
    }

  } else {
    currentPlayer = null;
    $('authPillText').textContent = 'Sin sesión';
    $('authPill').classList.remove('active');
    $('logoutBtn').style.display = 'none';

    // Always hide admin tab on logout — prevents stale state
    const adminTab = $('tabAdminBtn');
    if (adminTab) {
      adminTab.style.display = 'none';
      adminTab.classList.remove('active');
    }

    // Switch to Home tab so a non-admin who saw Admin doesn't land there
    TABS.forEach(t => {
      $(`panel${t}`)?.classList.remove('active');
      $(`tab${t}Btn`)?.classList.remove('active');
    });
    $('panelHome')?.classList.add('active');
    $('tabHomeBtn')?.classList.add('active');

    // Clear inputs
    $('collectionInput').value = '';
    $('wishlistInput').value = '';
    collectionCloud = [];
    wishlistCloud = [];

    // Show login screen, hide app
    $('mainApp').style.display = 'none';
    $('loginScreen').classList.remove('hidden');
    setAuthState('login');
  }
});

// ── AUTH FORM ──────────────────────────────────────────────
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearAuthFeedback();

  const state = authModal.getAttribute('data-state');
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

      const nameLower = username.toLowerCase();
      const existing = await db.collection('players').where('nameLower', '==', nameLower).limit(1).get();
      if (!existing.empty) return showAuthFeedback('Ese nombre de jugador ya está en uso.');

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await db.collection('players').doc(cred.user.uid).set({
        name: username, nameLower,
        isAdmin: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('¡Cuenta creada correctamente!');

    } else if (state === 'forgot') {
      await auth.sendPasswordResetEmail(email);
      showAuthFeedback('Enlace enviado. Revisa tu buzón de correo.', 'success');
    }

  } catch (err) {
    console.error(err);
    if (err.code === 'auth/operation-not-allowed') {
      showAuthFeedback(`
        <strong>⚠️ PROVEEDOR DESACTIVADO EN FIREBASE:</strong><br>
        Activa el inicio con Correo en Firebase Console → Authentication → Sign-in method.
      `);
      return;
    }
    const msgs = {
      'auth/user-not-found': 'Las credenciales introducidas no son correctas.',
      'auth/wrong-password': 'Las credenciales introducidas no son correctas.',
      'auth/invalid-credential': 'Las credenciales introducidas no son correctas.',
      'auth/email-already-in-use': 'Este correo electrónico ya está registrado.',
      'auth/invalid-email': 'Formato de correo inválido (ejemplo@dominio.com).',
      'auth/weak-password': 'La contraseña es demasiado débil (mínimo 6 caracteres).',
    };
    showAuthFeedback(msgs[err.code] || `Error: ${err.message}`);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await auth.signOut();
  toast('Sesión cerrada.', 'inf');
});

// ── CLOUD DATA ─────────────────────────────────────────────
async function loadCloudData() {
  if (!currentPlayer) return;

  const colDoc = await db.collection('collections').doc(currentPlayer.uid).get();
  if (colDoc.exists) {
    collectionCloud = colDoc.data().cards || [];
    $('collectionInput').value = collectionCloud.join('\n');
    updateCardCount('col', collectionCloud.length);
  }

  const wlDoc = await db.collection('wishlists').doc(currentPlayer.uid).get();
  if (wlDoc.exists) {
    wishlistCloud = wlDoc.data().cards || [];
    $('wishlistInput').value = wishlistCloud.join('\n');
    updateCardCount('wl', wishlistCloud.length);
  }
}

function updateCardCount(prefix, n) {
  const el = $(`${prefix}CardCount`);
  if (el) el.textContent = n > 0 ? `${n} carta${n !== 1 ? 's' : ''}` : '';
}

async function saveList(collection, inputId, cloudVar, label) {
  if (!currentPlayer) return toast('Sesión expirada.', 'err');
  const cards = $(inputId).value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  try {
    await db.collection(collection).doc(currentPlayer.uid).set({
      name: currentPlayer.name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      cards
    });
    if (collection === 'collections') { collectionCloud = cards; updateCardCount('col', cards.length); }
    else { wishlistCloud = cards; updateCardCount('wl', cards.length); }
    toast(`${label} guardada en la nube.`);
  } catch (e) {
    toast(`Error al guardar ${label.toLowerCase()}.`, 'err');
  }
}

$('saveCollectionBtn').addEventListener('click', () => saveList('collections', 'collectionInput', 'collectionCloud', 'Colección'));
$('saveWishlistBtn').addEventListener('click', () => saveList('wishlists', 'wishlistInput', 'wishlistCloud', 'Wishlist'));

// ── IMPORT MODE TABS ───────────────────────────────────────
document.querySelectorAll('.imp-mode-tabs').forEach(tabGroup => {
  tabGroup.querySelectorAll('.imp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tabGroup.querySelectorAll('.imp-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.target;
      // find sibling imp-panels (parent's siblings)
      const panelContainer = tabGroup.parentElement;
      panelContainer.querySelectorAll('.imp-panel').forEach(p => {
        p.classList.toggle('active', p.id === target);
      });
    });
  });
});

// ── CSV IMPORT ─────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];

  // Detect if it has a header row with "name" / "Card Name" / "cardname"
  const header = lines[0].toLowerCase();
  if (header.includes('name')) {
    const cols = lines[0].split(',').map(c => c.trim().toLowerCase());
    const nameIdx = cols.findIndex(c => c === 'name' || c === 'card name' || c === 'cardname');
    const qtyIdx = cols.findIndex(c => c === 'count' || c === 'qty' || c === 'quantity' || c === 'amount');

    return lines.slice(1).flatMap(line => {
      const parts = parseCSVLine(line);
      const name = parts[nameIdx]?.trim();
      if (!name) return [];
      const qty = qtyIdx >= 0 ? parseInt(parts[qtyIdx]) || 1 : 1;
      return [`${qty} ${name}`];
    });
  }

  // Fallback: treat each line as "qty name" or just "name"
  return lines.map(l => l.trim()).filter(l => l.length > 0);
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function setupCSVDrop(dropZoneId, fileInputId, statusId, textareaId) {
  const zone = $(dropZoneId);
  const input = $(fileInputId);
  const status = $(statusId);

  zone.addEventListener('click', () => input.click());

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
        status.textContent = 'El archivo no contiene cartas reconocibles.';
        status.className = 'imp-status err';
        return;
      }
      // Merge with existing text (avoid duplicates)
      const existing = $(textareaId).value.split('\n').map(l => l.trim()).filter(l => l);
      const merged = [...new Set([...existing, ...cards])];
      $(textareaId).value = merged.join('\n');
      status.textContent = `✓ ${cards.length} cartas importadas desde ${file.name}`;
      status.className = 'imp-status ok';
      // Switch to text tab so user sees the result
      const tabGroup = zone.closest('.panel').querySelector('.imp-mode-tabs');
      tabGroup.querySelectorAll('.imp-tab').forEach(b => b.classList.toggle('active', b.dataset.target === textareaId.replace('Input', '-text').replace('collection', 'col').replace('wishlist', 'wl')));

      const prefix = textareaId.includes('collection') ? 'col' : 'wl';
      switchToTextTab(prefix);
    };
    reader.readAsText(file);
  }
}

function switchToTextTab(prefix) {
  const panel = prefix === 'col' ? $('panelCollection') : $('panelWishlist');
  const tabGroup = panel.querySelector('.imp-mode-tabs');
  tabGroup.querySelectorAll('.imp-tab').forEach(b => b.classList.toggle('active', b.dataset.target === `${prefix}-text`));
  panel.querySelectorAll('.imp-panel').forEach(p => p.classList.toggle('active', p.id === `${prefix}-text`));
}

setupCSVDrop('colDropZone', 'colFileInput', 'colCsvStatus', 'collectionInput');
setupCSVDrop('wlDropZone', 'wlFileInput', 'wlCsvStatus', 'wishlistInput');

// ── URL IMPORT (Moxfield / Archidekt) ─────────────────────
// Both sites require a CORS proxy for direct fetch. We use a
// public proxy (allorigins) and parse the JSON/HTML response.
// This covers the public API endpoints both platforms expose.

async function fetchDeckFromUrl(rawUrl, statusId, textareaId) {
  const status = $(statusId);
  status.textContent = 'Obteniendo lista…';
  status.className = 'imp-status inf';

  let cards = [];
  try {
    // ── Moxfield ──────────────────────────────────────────
    // Public deck URL: https://www.moxfield.com/decks/<id>
    // API endpoint:    https://api2.moxfield.com/v2/decks/all/<id>
    const moxMatch = rawUrl.match(/moxfield\.com\/decks\/([\w-]+)/);
    if (moxMatch) {
      const deckId = moxMatch[1];
      const apiUrl = `https://api2.moxfield.com/v2/decks/all/${deckId}`;
      const proxy = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

      const resp = await fetch(proxy);
      if (!resp.ok) throw new Error(`Error HTTP: ${resp.status}`);
      const data = await resp.json(); // Obtenemos el JSON directo

      const sections = ['mainboard', 'sideboard', 'commanders', 'companions', 'maybeboard'];
      for (const section of sections) {
        if (!data[section]) continue;
        for (const [, card] of Object.entries(data[section])) {
          cards.push(`${card.quantity} ${card.card.name}`);
        }
      }
      if (!cards.length) throw new Error('Sin cartas en la respuesta de Moxfield.');
      mergeCards(textareaId, cards);
      status.textContent = `✓ ${cards.length} cartas importadas desde Moxfield.`;
      status.className = 'imp-status ok';
      return;
    }

    // ── Archidekt ─────────────────────────────────────────
    // Public deck URL: https://archidekt.com/decks/<id>/...
    // API endpoint:    https://archidekt.com/api/decks/<id>/
    const archiMatch = rawUrl.match(/archidekt\.com\/decks\/(\d+)/);
    if (archiMatch) {
      const deckId = archiMatch[1];
      const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;
      const proxy = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

      const resp = await fetch(proxy);
      if (!resp.ok) throw new Error(`Error HTTP: ${resp.status}`);
      const data = await resp.json(); // Obtenemos el JSON directo

      for (const card of data.cards) {
        if (card.category === 'Maybeboard') continue;
        cards.push(`${card.quantity} ${card.card.oracleCard.name}`);
      }
      if (!cards.length) throw new Error('Sin cartas en la respuesta de Archidekt.');
      mergeCards(textareaId, cards);
      status.textContent = `✓ ${cards.length} cartas importadas desde Archidekt.`;
      status.className = 'imp-status ok';
      return;
    }

    throw new Error('URL no reconocida. Pega un enlace de Moxfield o Archidekt.');

  } catch (err) {
    console.error(err);
    status.textContent = `⚠ ${err.message}`;
    status.className = 'imp-status err';
  }
}

function mergeCards(textareaId, newCards) {
  const existing = $(textareaId).value.split('\n').map(l => l.trim()).filter(l => l);
  const merged = [...new Set([...existing, ...newCards])];
  $(textareaId).value = merged.join('\n');
  const prefix = textareaId.includes('collection') ? 'col' : 'wl';
  switchToTextTab(prefix);
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

// ── MATCHES ────────────────────────────────────────────────
$('refreshMatchesBtn').addEventListener('click', async () => {
  if (!currentPlayer) return;
  const container = $('matchesContainer');
  container.innerHTML = '<p class="text-muted">Analizando colecciones del grupo…</p>';

  // Make sure wishlist is current from textarea
  wishlistCloud = $('wishlistInput').value.split('\n').map(l => l.trim()).filter(l => l);

  if (!wishlistCloud.length) {
    container.innerHTML = '<p style="font-weight:700;color:var(--rose);">Tu Wishlist está vacía. Añade cartas y guárdalas primero.</p>';
    return;
  }

  try {
    const all = await db.collection('collections').get();
    let html = '';

    all.forEach(doc => {
      if (doc.id === currentPlayer.uid) return;
      const data = doc.data();
      const partnerCards = data.cards || [];

      const matches = wishlistCloud.filter(wl =>
        partnerCards.some(pc => pc.toLowerCase().includes(wl.toLowerCase().replace(/^\d+\s+/, '')))
      );

      if (matches.length) {
        html += `
          <div class="match-card">
            <h3>🔥 ${escapeHtml(data.name)} tiene ${matches.length} carta${matches.length !== 1 ? 's' : ''} que buscas</h3>
            <ul>${matches.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>
          </div>`;
      }
    });

    container.innerHTML = html || '<p class="text-muted">Sin coincidencias con otros miembros en este momento.</p>';
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p style="color:var(--rose);font-weight:700;">Error al consultar colecciones.</p>';
  }
});

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
        <div>
          <span class="player-name">${escapeHtml(d.name)}</span>
          ${d.isAdmin ? '<span class="badge-admin" style="margin-left:.5rem;">Admin</span>' : ''}
          ${isMe ? '<span class="player-meta" style="margin-left:.5rem;">(tú)</span>' : ''}
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;">
          ${!isMe ? `
            <button class="btn btn-sm ${d.isAdmin ? 'btn-ghost' : 'btn-blue'}" data-uid="${uid}" data-admin="${d.isAdmin}">
              ${d.isAdmin ? 'Quitar admin' : 'Dar admin'}
            </button>
          ` : ''}
        </div>`;
      list.appendChild(row);
    });

    // Toggle admin button handler
    list.querySelectorAll('[data-uid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const wasAdmin = btn.dataset.admin === 'true';
        btn.disabled = true;
        try {
          await db.collection('players').doc(uid).update({ isAdmin: !wasAdmin });
          toast(`Permisos actualizados.`);
          loadAdminPanel(); // Refresh
        } catch (e) {
          toast('Error al actualizar permisos.', 'err');
          btn.disabled = false;
        }
      });
    });

  } catch (e) {
    console.error(e);
    list.innerHTML = '<p style="color:var(--rose);font-weight:700;">Error al cargar jugadores.</p>';
  }
}

// ── HELPERS ────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
