// ═══════════════════════════════════════════════════════════
// Tests unitarios de card-utils.js — ejecutar con `npm test`
// ═══════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import cardUtils from '../js/card-utils.js';

const { parseCardString, normalizeCardName, parseCSV, mergeCardLists } = cardUtils;

describe('parseCardString', () => {
  it('parsea cantidad y nombre', () => {
    expect(parseCardString('4 Lightning Bolt')).toEqual({ qty: 4, name: 'Lightning Bolt' });
  });

  it('acepta el formato Nx', () => {
    expect(parseCardString('4x Lightning Bolt')).toEqual({ qty: 4, name: 'Lightning Bolt' });
  });

  it('asume cantidad 1 si no hay número', () => {
    expect(parseCardString('Lightning Bolt')).toEqual({ qty: 1, name: 'Lightning Bolt' });
  });

  it('parsea el sideboard de MTGO (SB:)', () => {
    expect(parseCardString("SB: 3 Tormod's Crypt")).toEqual({ qty: 3, name: "Tormod's Crypt" });
  });

  it('ignora espacios alrededor', () => {
    expect(parseCardString('  2  Counterspell  ')).toEqual({ qty: 2, name: 'Counterspell' });
  });
});

describe('normalizeCardName', () => {
  it('es insensible a mayúsculas, espacios y puntuación', () => {
    expect(normalizeCardName('Lightning Bolt')).toBe(normalizeCardName('lightning-bolt'));
  });

  it('ignora el set entre paréntesis', () => {
    expect(normalizeCardName('Counterspell (M21)')).toBe(normalizeCardName('Counterspell'));
  });

  it('empareja cartas de doble cara en cualquier orden', () => {
    expect(normalizeCardName('Fire // Ice')).toBe(normalizeCardName('Ice // Fire'));
  });

  it('no confunde nombres distintos', () => {
    expect(normalizeCardName('Fire // Ice')).not.toBe(normalizeCardName('Fire'));
  });
});

describe('parseCSV', () => {
  it('quita el BOM de UTF-8 del header', () => {
    const csv = '\uFEFFcount,name\n2,Lightning Bolt\n';
    expect(parseCSV(csv)).toEqual(['2 Lightning Bolt']);
  });

  it('respeta la columna de cantidad', () => {
    const csv = 'name,qty\nLightning Bolt,4\nCounterspell,2\n';
    expect(parseCSV(csv)).toEqual(['4 Lightning Bolt', '2 Counterspell']);
  });

  it('ignora filas sin nombre', () => {
    const csv = 'name,qty\n,4\nCounterspell,2\n';
    expect(parseCSV(csv)).toEqual(['2 Counterspell']);
  });

  it('no convierte cantidad 0 en algo distinto de 1', () => {
    const csv = 'name,count\nLightning Bolt,0\n';
    expect(parseCSV(csv)).toEqual(['1 Lightning Bolt']);
  });

  it('normaliza líneas sueltas sin header (incluido SB: de MTGO)', () => {
    const text = "4 Lightning Bolt\nSB: 3 Tormod's Crypt";
    expect(parseCSV(text)).toEqual(['4 Lightning Bolt', "3 Tormod's Crypt"]);
  });
});

describe('mergeCardLists', () => {
  it('suma cantidades de duplicados', () => {
    expect(mergeCardLists(['2 Llanowar Elves'], ['1 Llanowar Elves'])).toEqual(['3 Llanowar Elves']);
  });

  it('mantiene las cartas no duplicadas', () => {
    expect(mergeCardLists(['1 Black Lotus'], ['2 Counterspell'])).toEqual(['1 Black Lotus', '2 Counterspell']);
  });

  it('preserva el orden de la lista existente', () => {
    expect(mergeCardLists(['2 Counterspell', '1 Black Lotus'], ['3 Counterspell']))
      .toEqual(['5 Counterspell', '1 Black Lotus']);
  });

  it('suma cantidades de la misma carta en formatos distintos', () => {
    expect(mergeCardLists(['2x Lightning Bolt'], ['1 Lightning Bolt'])).toEqual(['3 Lightning Bolt']);
  });
});

describe('computeMatches', () => {
  const me = 'me';
  const bob = 'bob';
  const base = {
    myWishlists: { 'Mi wishlist': ['4 Lightning Bolt', '2 Counterspell'] },
    selectedLists: ['Mi wishlist'],
    myCollections: { 'Mi colección': ['2 Llanowar Elves', '3 Counterspell'] },
    groupCollections: {
      [me]: { name: 'Yo', lists: { Principal: ['2 Llanowar Elves'] } },
      [bob]: { name: 'Bob', lists: { Principal: ['4 Lightning Bolt', '1 Fire // Ice'] } }
    },
    groupWishlists: {
      [me]: { name: 'Yo', lists: { Principal: ['1 Counterspell'] } },
      [bob]: { name: 'Bob', lists: { Principal: ['2 Llanowar Elves', '1 Ice // Fire'] } }
    },
    myUid: me
  };

  it('tiene wishlist que buscar', () => {
    expect(computeMatches(base).hasWanted).toBe(true);
  });

  it('detecta wishlist completa en mi colección', () => {
    expect(computeMatches(base).owned).toEqual([{ name: 'Counterspell', want: 2, have: 3 }]);
  });

  it('sin tenencias parciales por defecto', () => {
    expect(computeMatches(base).partial).toEqual([]);
  });

  it('encuentra lo que busco en la colección de otro', () => {
    expect(computeMatches(base).iWant)
      .toEqual([{ name: 'Bob', hits: [{ name: 'Lightning Bolt', qty: 4, available: 4 }], lines: ['4x Lightning Bolt'] }]);
  });

  it('encuentra lo que otro busca en mi colección', () => {
    expect(computeMatches(base).theyWant)
      .toEqual([{ name: 'Bob', hits: [{ name: 'Llanowar Elves', want: 2, mine: 2 }] }]);
  });

  it('detecta tenencia parcial', () => {
    const r = computeMatches({ ...base, myCollections: { 'Mi colección': ['2 Lightning Bolt', '3 Counterspell'] } });
    expect(r.partial).toEqual([{ name: 'Lightning Bolt', want: 4, have: 2 }]);
  });

  it('sin wishlist → hasWanted false', () => {
    expect(computeMatches({ ...base, selectedLists: [] }).hasWanted).toBe(false);
  });

  it('cruza dobles caras en cualquier orden con el grupo', () => {
    const r = computeMatches({ ...base, myWishlists: { 'Mi wishlist': ['1 Ice // Fire'] }, selectedLists: ['Mi wishlist'], myCollections: {} });
    expect(r.iWant)
      .toEqual([{ name: 'Bob', hits: [{ name: 'Ice // Fire', qty: 1, available: 1 }], lines: ['1x Ice // Fire'] }]);
  });
});
