# Magic Toolbox — Super Magic Tool

Herramienta web para grupos de juego de *Magic: The Gathering*. De momento incluye una herramienta:

- **Card Matcher**: cruza tu wishlist con las colecciones del grupo para descubrir quién tiene las cartas que buscas y quién busca las que tú tienes.

## Estructura

```
index.html        → Portada con el listado de herramientas
structure.html    → App principal (auth, colección, wishlist, matcher, grupos, admin)
script.js         → Lógica de cliente (vanilla JS + Firebase)
card-utils.js     → Funciones puras (importación y normalización), usadas por la app y los tests
card-utils.test.js→ Tests unitarios (Vitest)
style.css         → Sistema de diseño (estilo Bauhaus)
config.js         → Credenciales de Firebase (NO commitear)
config.example.js → Plantilla de configuración
firestore.rules   → Reglas de seguridad de Firestore
firebase.json     → Configuración de Firebase (reglas + índices)
package.json      → Dev deps y scripts (npm test)
.github/workflows/deploy.yml → Despliegue a GitHub Pages
```

## Puesta en marcha local

1. Copia la plantilla y rellena los valores de tu proyecto Firebase:
   ```bash
   cp config.example.js config.js
   ```
   Los valores están en Firebase Console → Configuración del proyecto → Tus apps → SDK.

2. Sirve la carpeta con un servidor estático (no uses `file://`, Firebase Auth falla por origen):
   ```bash
   npx serve .
   ```

3. Habilita en Firebase Console:
   - **Authentication → Sign-in method → Email/contraseña**.
   - **Firestore Database** (y luego despliega las reglas de abajo).

## Grupos

La app funciona por **grupos**: cada jugador crea un grupo (se genera un código) o se une a uno existente con ese código. Las reglas de Firestore limitan las lecturas a tu grupo, así que:

- Puedes invitar con un **enlace directo**: botón "Copiar enlace" en la pestaña Grupo. Quien lo abra se une con un clic (o automáticamente tras iniciar sesión).

- Solo ves las colecciones, wishlists y jugadores de tu propio grupo (y a ti mismo).
- Los administradores pueden ver y gestionar a todos los jugadores.
- Para cambiar de grupo hay que salir del actual y unirse a otro.

## Tests

Las funciones puras (parseo de cartas, CSV, normalización, fusión de listas y cruces del matcher) están cubiertas por tests de dos formas:

**Sin Node (recomendado):** abre `test.html` en el navegador. No instala nada y muestra el resultado (✓/✗) en la propia página.

**Con Node (opcional, para CI):** las mismas pruebas en [Vitest](https://vitest.dev):

```bash
npm install
npm test
```

## Despliegue de las reglas de seguridad

Las reglas están en `firestore.rules`. Despliégalas antes de dar acceso a nadie:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore --project TU_PROYECTO_ID
```

> ⚠️ Sin estas reglas, cualquier usuario autenticado podría leer/escribir/borrar datos ajenos.

## ¿Cómo funciona el rol de admin?

Un jugador es admin si su documento en `players/{uid}` tiene `isAdmin: true`. Las reglas impiden que un jugador se auto-promocione, así que para nombrar a un admin:

1. Firebase Console → Firestore → colección `players` → tu documento.
2. Añade el campo `isAdmin` con valor `true`.

## Despliegue a GitHub Pages

El workflow `.github/workflows/deploy.yml` genera `config.js` a partir de los *secrets* del repositorio y publica la carpeta `dist/`. Configura estos secrets en el repo (Settings → Secrets and variables → Actions):

- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`

Cada push a `main` despliega automáticamente.

## Notas de seguridad

- `config.js` contiene las claves públicas de Firebase y está en `.gitignore`; no lo commitees con valores reales. Hubo un `config.js` con credenciales en el historial de `main`; se ha **purgado del historial con `git filter-branch`** (requiere un `git push --force-with-lease origin main` para reflejarlo en GitHub).
- La autorización real la aplica `firestore.rules`. El flag `isAdmin` en el cliente solo controla qué pestañas se muestran.
- Cada usuario solo escribe en sus propios documentos. Las lecturas se limitan a tu grupo (`groupId` en `players`), a ti mismo y a los admins.
- Los nombres de jugador son únicos de forma atómica: el documento `usernames/{nameLower}` es la reclamación del nombre.

### Rotar la API key de Firebase

La apiKey web de Firebase **no es un secreto**: va embebida en el navegador de cada visitante y la seguridad real la imponen las `firestore.rules`. Aun así, si quieres invalidar la clave que quedó expuesta en el historial público:

1. Ve a Google Cloud Console → tu proyecto → **APIs y servicios → Credenciales**.
2. Localiza la clave (la cadena `AIza…`) y crea una **nueva clave de API** (Crear credenciales → Clave de API).
3. (Recomendado) **Restringe** la nueva clave: en *Restricciones de aplicación* → sitios web, añade `https://*.github.io/*` y `http://localhost:*`; en *Restricciones de API*, limítala a las APIs que usas (Identity Toolkit API para auth).
4. Actualiza el secret **`FIREBASE_API_KEY`** del repo (GitHub → Settings → Secrets and variables → Actions) y tu `config.js` local con la nueva clave.
5. Vuelve a desplegar (un push a `main` regenera GitHub Pages con la nueva clave).
6. Cuando esté desplegado con la nueva clave, **borra la clave antigua** en Credenciales.

## Limitaciones conocidas

- La normalización de nombres de carta es agresiva (quita texto entre paréntesis y une todo en minúsculas) para maximizar aciertos; puede agrupar nombres equivalentes.
- `memberUids` en los documentos de grupo no se limpia al salir del grupo (la pertenencia real se deriva de `players.{uid}.groupId`), así que la lista de miembros del panel se calcula desde los jugadores, no desde ese campo.
- Al eliminar una cuenta, el grupo del que era dueño queda huérfano: un admin debe borrar el documento `groups/{id}` desde la consola.
