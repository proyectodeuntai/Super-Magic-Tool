# Auditoría y rework — Magic Card Matcher

Fecha: 2026-10-02 · Alcance: toda la app (`index.html`, `app.html`, `css/style.css`, `js/script.js`, `js/card-utils.js`, despliegue y docs).

## Resumen

El problema no era una sola cosa: la app **se veía saturada**, tenía **fricción real en el acceso** (expulsión silenciosa si el correo no estaba verificado) y **fallaba en silencio** si el CDN de Firebase no cargaba. Además, la interfaz apenas tenía accesibilidad (1 solo `role`, cero foco visible, sin `prefers-reduced-motion`) y arrastraba CSS muerto.

Resultado: rediseño visual completo, app renombrada a `app.html`, accesibilidad real, microcopy claro, y nuevas funciones de gestión de listas (renombrar / exportar). **26/26 tests en verde** y todas las parejas de color por encima de AA.

---

## 1. Qué sobraba (eliminado)

| Elemento | Motivo |
|---|---|
| 20 clases CSS sin uso (`tool-card`, `tool-cta`, `tools-grid`, `grid-matches`, `url-badge*`, `sync-*`, `uppercase`, `field-flex-1`…) | Código muerto heredado de una versión anterior. |
| `.icon-btn`, `.list-count-row`, `.verify-box` | Creadas para el rediseño y finalmente no usadas. |
| Recuento duplicado (`#colCardCount` / `#wlCardCount`) | El número ya aparecía en la pestaña y en la barra de la lista. |
| 9 formas animadas del login (animación) | Pasaron a formas estáticas y discretas. |
| Comentarios `<!-- CAMBIO 1 / CAMBIO 2 -->` en el JS | Restos de parches anteriores. |
| Réplica de "Buscar coincidencias" | Los cruces se recalculan solos (snapshots + al cambiar de pestaña). Ahora hay un botón **"Actualizar"** opcional, no un paso obligatorio. |

## 2. Qué faltaba (añadido)

- **Exportar lista** como `.txt` (antes solo se podía importar).
- **Renombrar lista** desde un menú **Acciones** (antes solo crear/vaciar/eliminar).
- **Resumen de 3 cifras** en la pantalla de coincidencias (ya las tienes tú / te las pueden dar / te las piden ellos).
- **Pantalla dedicada de verificación** de correo, con **reenviar**, **volver a comprobar** y **usar otra cuenta**.
- **Contadores** de cartas en cada pestaña.
- **Selector de listas a buscar** oculto cuando solo hay una (antes mostraba un selector vacío sin explicación).
- **Guía de inicio en 3 pasos** solo cuando todo está vacío.
- **Menú de cuenta accesible** (`aria-expanded`, foco atrapado, `Escape`).
- **Mensajes de error de arranque** con botón *Reintentar* si falta `config.js` o falla Firebase.

## 3. Bugs y trampas corregidos

1. **Expulsión silenciosa.** `onAuthStateChanged` hacía `auth.signOut()` sin explicar nada si el correo no estaba verificado. Ahora se muestra la pantalla de verificación con salidas claras.
2. **Loader infinito.** Si no cargaba el CDN de Firebase, `firebase.initializeApp` rompía el script y el spinner giraba para siempre. Ahora se detecta y se informa.
3. **Modal propio (`bModal`)** no atrapaba el foco ni cerraba con `Escape` en todos los modos, y no restauraba el foco. Corregido.
4. **Pestañas y vistas** usaban la clase `.active`; el CSS nuevo se guía por `aria-selected`. Alineado en JS (incluidas las sub-pestañas Lista/Texto/Importar).
5. **Botón de borrar carta** era solo un `×` sin nombre accesible. Ahora `aria-label="Eliminar <carta> de la lista"`.
6. **Drop-zone** era `role=button` sin soporte de teclado. Ahora responde a `Enter` y `Espacio`.
7. **Colapsables** no exponían estado. Ahora usan `aria-expanded` + `aria-controls`.
8. **`escapeHtml`** no escapaba `'`. Corregido.
9. **Duplicados de importación** ahora suman cantidades (`mergeCardLists`) en lugar de crear líneas repetidas.

## 4. Accesibilidad

- Foco visible global (`:focus-visible`) y `outline` coherente; antes había `outline: none` sin sustituto.
- Patrones ARIA: `tablist`/`tab` con `aria-selected`, `tabindex` rotativo y **navegación con flechas**; menús con `aria-haspopup`/`aria-expanded` y cierre con `Escape`; modales `role=dialog` con foco atrapado y restauración.
- Regiones `aria-live` para estado de guardado, toasts, resumen y errores de formulario.
- `prefers-reduced-motion` respetado; `@media print` incluido.
- Enlace **"Saltar al contenido"**.
- Contraste **WCAG AA** en todo el texto (medido, sección 6).

## 5. Rendimiento y mantenimiento

- CSS reescrito en un fichero con **índice de 25 secciones** y tokens; menos reglas y sin solapamientos.
- `js/card-utils.js` se mantiene como funciones puras, aisladas de la UI y cubiertas por tests.
- Despliegue con *cache-busting* por hash para CSS/JS/icono/fuentes.

## 6. Contrastes medidos (paleta nueva)

| Pareja | Ratio | Estado |
|---|---|---|
| Tinta `#141414` sobre papel `#f4f1ea` | 16.33 | AA |
| Texto apagado `#5c584f` sobre papel | 6.28 | AA |
| Texto apagado sobre tarjeta blanca | 7.09 | AA |
| Rojo de texto `#a01019` sobre papel | 7.21 | AA |
| Blanco sobre rojo `#b1121d` | 7.06 | AA |
| Blanco sobre azul `#0b4f8a` | 8.40 | AA |
| Blanco sobre verde `#0a6242` | 7.40 | AA |
| Tinta sobre amarillo `#f5c400` | 11.21 | AA |
| Placeholder sobre blanco | 7.09 | AA |

> El amarillo nunca se usa como color de texto (blanco sobre amarillo = 1.64, insuficiente). Solo funciona como fondo con tinta encima.

## 7. Estructura final

```
index.html   →  portada pública (qué hace + acceso)
app.html     →  la aplicación (antes structure.html)
css/style.css
js/card-utils.js · js/script.js
tests/test.html
```

`structure.html` se renombró a `app.html`; también se actualizaron los enlaces, el workflow de despliegue y este README.

## 8. Verificación realizada

- `tests/test.html`: **26/26** tests pasados.
- Modo demo en navegador: coincidencias de 3 jugadores, resumen `2/4/4`, contadores de pestaña `4` y `3`, sin errores de consola.
- Interacciones probadas: pestañas y navegación con flechas, menú Acciones (abrir, `aria-expanded`, `Escape`, foco), sub-pestañas, añadir carta, renombrar lista, exportar, `bModal` (abrir y cerrar con `Escape`), pantalla de verificación centrada.
- Comprobación automática: los **51** ids que el JS consulta existen en el DOM (salvo `reintentarBtn`, que se crea solo en el estado de error crítico).

## 9. Pendiente / recomendaciones

1. ~~**Endurecer reglas de Firestore**~~ **Hecho**: modelo «grupo cerrado de amigos» con directorio público mínimo. `collections/{uid}` y `wishlists/{uid}` solo se leen si eres el dueño o estás en su lista de amigos. El documento público `players/{uid}` guarda **solo el nombre** (sirve para buscar y añadir amigos); el rol vive en `admins/{uid}` y la lista de amigos en la subcolección privada `players/{uid}/friends/{amigo}`, así que nadie puede ver quién es admin ni con quién compartes. La app escucha documento a documento (el suyo y el de cada amigo) en vez de la colección entera, y migra sola las cuentas antiguas que tenían `isAdmin`/`friends` en la ficha.
2. **Importar cartas del catálogo** (Scryfall) para autocompletar nombres y evitar erratas tipográficas.
3. **Historial de intercambios**: marcar cartas ya intercambiadas para que no vuelvan a aparecer.
4. **PWA** (manifest + service worker) para uso offline y en el móvil.
5. **Aviso de correo no verificado en la propia app** si más adelante se decide dejar entrar sin verificar.
