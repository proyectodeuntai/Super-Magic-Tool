# Magic Card Matcher

Herramienta web para que tú y tus amigos descubráis qué cartas de *Magic: The Gathering* podéis intercambiar. Cruza tu colección con las listas de deseados de los demás y te dice, en tres columnas, qué puedes dar y qué puedes recibir.

## Qué hace

- **Coincidencias (pantalla principal):** cartas de tu lista de deseados que ya tienes, cartas que buscas y tienen tus amigos, y cartas que tienes y buscan ellos. Los cruces se recalculan solos al cambiar cualquier lista.
- **Mi colección y Lista de deseados:** varias listas por pestaña, tres formas de cargar cartas (añadir a mano, pegar texto, importar archivo) y acciones por lista (renombrar, exportar, vaciar, eliminar).
- **Privacidad por amigos:** tu colección y tu lista de deseados solo las ven tú y los jugadores que tú añadas a tu lista de amigos (bloque «Amigos», arriba en Coincidencias). El directorio público guarda **solo tu nombre**: el rol de administrador y tu lista de amigos viven aparte y no son visibles para los demás. Los cruces se calculan únicamente con esos datos; un desconocido con una cuenta nueva no ve nada de nadie.
- **Modo demo (`?demo`):** prueba la herramienta con datos de ejemplo sin crear cuenta.
- **Panel de administración:** solo para cuentas con rol de admin (documento `admins/{uid}`), para dar o quitar permisos y borrar datos.

## Estructura del proyecto

```
index.html            Portada pública (qué hace + acceso)
app.html              La aplicación (acceso, app y pantallas de estado)
css/style.css         Todo el sistema visual (tokens, componentes, responsive, print)
js/card-utils.js      Funciones puras: parseo, normalización y cálculo de cruces
js/script.js          Interfaz, autenticación, sincronización y render
tests/test.html       Tests de las funciones puras (se abren en el navegador)
config.js             Credenciales de Firebase (generado en el deploy)
firebase/             Reglas de Firestore
assets/               Icono y fuentes auto-alojadas
.github/workflows/    Despliegue a GitHub Pages
```

## Cómo cargar tus cartas

- **A mano:** `4 Lightning Bolt` (el número es la cantidad; sin número se asume 1).
- **Texto:** pega una lista, una carta por línea.
- **Importar:** arrastra un `.csv` o `.txt` exportado de **Moxfield** (`Export`), **MTGO** (`Export as CSV`) o **Archidekt**. Las cartas repetidas suman cantidades.

Puedes exportar cualquier lista como `.txt` con el menú **Acciones → Exportar lista**.

## Cuentas

Cada persona necesita su cuenta: el intercambio solo funciona si todos subís vuestras cartas.

- El **correo debe verificarse** para entrar. Si aún no lo está, la app muestra una pantalla con el correo usado, un botón para **reenviar** el enlace y otro para **volver a comprobar**.
- El nombre de jugador es único (se reserva de forma atómica) y se puede cambiar desde el menú de cuenta.

## Desarrollo

No hay build: son archivos estáticos. Para probar en local sirve la carpeta con cualquier servidor HTTP y abre `app.html`:

```bash
py -3 -m http.server 8768
# http://127.0.0.1:8768/app.html  ·  http://127.0.0.1:8768/app.html?demo
```

`config.js` con las credenciales de Firebase no se versiona; en el despliegue se genera desde los *secrets* del repositorio.

### Tests

Abre `tests/test.html` en el navegador. Cubre las funciones puras de `js/card-utils.js` (parseo, normalización, fusión de listas y cálculo de coincidencias).

## Firestore

| Ruta | Qué guarda | Quién la lee |
| --- | --- | --- |
| `players/{uid}` | Nombre del jugador (directorio) | Cualquier jugador registrado |
| `players/{uid}/friends/{amigo}` | Lista de amigos | Solo su dueño |
| `admins/{uid}` | Rol de administrador | Su dueño y los admins |
| `usernames/{nombre}` | Nombre reservado (clave única) | Cualquier jugador registrado |
| `collections/{uid}` | Colección del jugador | Su dueño y sus amigos |
| `wishlists/{uid}` | Lista de deseados | Su dueño y sus amigos |

**Primer administrador.** Si el proyecto no tenía ya un `isAdmin: true` en `players`, hay que crear el primer rol a mano una sola vez: Firebase Console → Firestore → nuevo documento `admins/{UID_DE_TU_CUENTA}` (con un campo cualquiera). A partir de ahí, ese admin reparte permisos desde el panel. Las cuentas antiguas que ya tenían `isAdmin: true` crean su rol solas al entrar.

## Despliegue

Cada push a `main` publica automáticamente en GitHub Pages (`.github/workflows/deploy.yml`): copia los archivos a `dist/`, añade *cache-busting* por hash a CSS, JS, icono y fuentes, y genera `config.js` desde los secrets.

## Accesibilidad

- Navegación por teclado completa, con **foco visible** en todo lo interactivo.
- Pestañas, menús, colapsables y modales con roles y estados ARIA (`tablist`, `aria-selected`, `aria-expanded`, `dialog`).
- Los modales atrapan el foco, cierran con `Escape` y devuelven el foco al cerrarse.
- Mensajes de estado y errores en regiones `aria-live`.
- Contraste de texto conforme a **WCAG AA** y soporte de `prefers-reduced-motion`.
