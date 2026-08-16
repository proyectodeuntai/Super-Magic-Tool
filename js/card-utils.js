// ═══════════════════════════════════════════════════════════
// Magic Toolbox — Funciones puras (importación y normalización)
// Se carga ANTES que script.js y expone las funciones como globals.
// También se puede importar desde Node para los tests (Vitest).
// ═══════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // Convierte una línea de carta en { qty, name }.
  // Acepta "4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt"
  // y el sideboard de MTGO: "SB: 3 Tormod's Crypt".
  function parseCardString(cardStr) {
    const s = String(cardStr || '').trim();
    if (!s) return { qty: 1, name: '' };
    const sb = s.match(/^sb:\s*(\d+)\s+(.*)$/i);
    if (sb) return { qty: parseInt(sb[1], 10), name: sb[2].trim() };
    const match = s.match(/^(\d+)x?\s+(.*)$/i);
    if (match) return { qty: parseInt(match[1], 10), name: match[2].trim() };
    return { qty: 1, name: s };
  }

  // Clave normalizada para comparar nombres: sin mayúsculas, espacios,
  // paréntesis (ej: "(M21)") y con las caras de las cartas dobles ordenadas
  // ("Fire // Ice" y "Ice // Fire" son la misma carta).
  function normalizeCardName(name) {
    return String(name || '')
      .split('//')
      .map(f => f.trim())
      .sort()
      .join(' ')
      .replace(/\([^)]*\)/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, '');
  }

  // Parsea texto de CSV/TXT. Quita el BOM de UTF-8 (Moxfield, Excel…).
  // Con header devuelve líneas "N Nombre"; sin header normaliza cada línea.
  function parseCSV(text) {
    const cleanText = String(text || '').replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return [];
    const header = lines[0].toLowerCase();
    if (header.includes('name')) {
      const cols = lines[0].split(',').map(c => c.trim().toLowerCase());
      const nameIdx = cols.findIndex(c => ['name', 'card name', 'cardname'].includes(c));
      const qtyIdx = cols.findIndex(c => ['count', 'qty', 'quantity', 'amount'].includes(c));
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
        let qty = 1;
        if (qtyIdx >= 0) {
          const parsed = parseInt(parts[qtyIdx], 10);
          if (Number.isFinite(parsed) && parsed > 0) qty = parsed;
        }
        return [`${qty} ${name}`];
      });
    }
    // Sin header: líneas sueltas ("4 Lightning Bolt", "SB: 3 Tormod's Crypt", …)
    return lines.map(l => parseCardString(l)).map(({ qty, name }) => `${qty} ${name}`);
  }

  // Fusiona dos listas de cartas sumando las cantidades de los duplicados.
  // Devuelve líneas canónicas "N Nombre" manteniendo el orden de `existing`.
  function mergeCardLists(existing, incoming) {
    const map = new Map();
    const add = entries => (entries || []).forEach(s => {
      const { qty, name } = parseCardString(s);
      if (!name) return;
      const key = normalizeCardName(name);
      if (map.has(key)) map.get(key).qty += qty;
      else map.set(key, { name, qty });
    });
    add(existing);
    add(incoming);
    return Array.from(map.values()).map(({ qty, name }) => `${qty} ${name}`);
  }

  // Cálculo puro de cruces del matcher. No toca el DOM: recibe los datos
  // y devuelve lo que hay que mostrar en cada columna.
  //  - owned/partial: cartas de tu wishlist que ya tienes (completas / a medias)
  //  - iWant/theyWant: por jugador, lo que buscas y ellos tienen, y viceversa
  //  - hasWanted: si hay algo en tu wishlist que buscar
  function computeMatches(opts) {
    const { myWishlists, selectedLists, myCollections, groupCollections, groupWishlists, myUid } = opts || {};

    // Lo que YO busco (de las wishlists seleccionadas)
    const searchMap = new Map();
    (selectedLists || []).forEach(wlName => {
      (myWishlists[wlName] || []).forEach(cardStr => {
        const { name, qty } = parseCardString(cardStr);
        const key = normalizeCardName(name);
        if (!searchMap.has(key)) searchMap.set(key, { name, qty });
        else searchMap.get(key).qty = Math.max(searchMap.get(key).qty, qty);
      });
    });

    // Lo que YO tengo
    const myCards = new Map();
    Object.values(myCollections || {}).flat().forEach(cardStr => {
      const { name, qty } = parseCardString(cardStr);
      const key = normalizeCardName(name);
      if (!myCards.has(key)) myCards.set(key, { name, qty });
      else myCards.get(key).qty += qty;
    });

    // Cartas de mi wishlist que ya tengo (completas o a medias)
    const owned = [];
    const partial = [];
    for (const [wKey, wCard] of searchMap.entries()) {
      const mine = myCards.get(wKey);
      if (!mine) continue;
      if (mine.qty >= wCard.qty) owned.push({ name: wCard.name, want: wCard.qty, have: mine.qty });
      else partial.push({ name: wCard.name, want: wCard.qty, have: mine.qty });
    }

    const iWant = [];
    const theyWant = [];

    for (const uid in groupCollections) {
      if (uid === myUid) continue;
      const data = groupCollections[uid];
      const remoteLists = data.lists || (data.cards ? { Principal: data.cards } : {});

      // Lo que YO quiero y ELLOS tienen
      if (searchMap.size > 0) {
        const hitsMap = new Map();
        Object.values(remoteLists).flat().forEach(pcStr => {
          const pc = parseCardString(pcStr);
          const pcKey = normalizeCardName(pc.name);
          if (searchMap.has(pcKey)) {
            const searchObj = searchMap.get(pcKey);
            if (!hitsMap.has(pcKey)) hitsMap.set(pcKey, { ...searchObj, available: pc.qty });
            else hitsMap.get(pcKey).available += pc.qty; // Sumar duplicados de sus propias listas
          }
        });
        if (hitsMap.size > 0) {
          const hits = Array.from(hitsMap.values());
          iWant.push({ name: data.name || 'Jugador', hits, lines: hits.map(h => `${h.qty}x ${h.name}`) });
        }
      }

      // Lo que ELLOS quieren y YO tengo
      if (myCards.size > 0) {
        const theirWlData = groupWishlists[uid];
        if (theirWlData) {
          const theirLists = theirWlData.lists || (theirWlData.cards ? { Principal: theirWlData.cards } : {});
          const hitsMap = new Map();
          Object.values(theirLists).flat().forEach(wlStr => {
            const wc = parseCardString(wlStr);
            const wcKey = normalizeCardName(wc.name);
            if (myCards.has(wcKey)) {
              const myCard = myCards.get(wcKey);
              if (!hitsMap.has(wcKey)) hitsMap.set(wcKey, { name: wc.name, want: wc.qty, mine: myCard.qty });
              else hitsMap.get(wcKey).want = Math.max(hitsMap.get(wcKey).want, wc.qty);
            }
          });
          if (hitsMap.size > 0) theyWant.push({ name: data.name || 'Jugador', hits: Array.from(hitsMap.values()) });
        }
      }
    }

    return { owned, partial, iWant, theyWant, hasWanted: searchMap.size > 0 };
  }

  const api = { parseCardString, normalizeCardName, parseCSV, mergeCardLists, computeMatches };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
