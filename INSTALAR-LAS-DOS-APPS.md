# Instalar las DOS apps por separado (Bitácora y Panel)

> **Respuesta corta:** las dos apps declaraban el mismo *alcance* (`scope`) — todo el sitio.
> Con dos apps solapadas, Chrome no instala la segunda: ofrece **"abrir en viaje"**, la que ya
> estaba instalada. Ahora cada app vive en su propia carpeta con su propio alcance y las dos se
> instalan por separado. **Hay que desinstalar una vez la app vieja** (paso 0) y volver a instalar.

---

## 1. Por qué aparecía "abrir en viaje"

Un manifest de PWA declara su `scope`: el conjunto de direcciones que pertenecen a esa app. Las dos
apps declaraban `scope: "./"` **estando las dos en la raíz** del sitio, así que la Bitácora
instalada reclamaba también `viaje-admin.html`. Cuando abrías el Panel y tocabas "Instalar",
Chrome no veía una app nueva: veía una dirección que ya pertenece a una app instalada, y en lugar
de instalar te ofrecía **abrirla en "viaje"**.

Está documentado por el propio equipo de Chrome: con alcances que se solapan, el navegador respeta
la app ya instalada ("Open in…") y no ofrece una segunda. El campo `id` del manifest **no** evita
el solapamiento; la solución es que cada app tenga una ruta propia que no se pise con la otra.

## 2. Qué cambió

| Antes | Ahora |
|---|---|
| `viaje.html` (Bitácora) y `viaje-admin.html` (Panel) en la raíz, `scope "./"` | **`/bitacora/`** para la Bitácora y **`/panel/`** para el Panel |
| Manifest en la raíz | Cada app lleva su manifest **dentro de su carpeta** (`/bitacora/manifest.json`, `/panel/manifest.json`): las rutas relativas del manifest se resuelven contra el manifest, así que tiene que viajar con su app |
| Cualquier página podía quedar reclamada por la app instalada | `scope` = `/bitacora/` y `/panel/`: **alcances disjuntos** |

Lo que **no** cambió: los datos, la sesión, las funciones, los íconos, el botón flotante "Instalar",
la ventana emergente de la bitácora y los archivos compartidos (`lib/`, `icons/`, `sw.js`,
`pwa-install.js`, `firebase-config.js`, `ruta.jpg`), que siguen en la raíz.

### Direcciones nuevas

La portada `https://appsparavos-ops.github.io/Viajes/` ahora existe (antes daba 404) y tiene una
tarjeta para cada app. Es solo una página de entrada: no se instala, no declara manifest.

| App | Dirección | Contiene |
|---|---|---|
| **Bitácora de Viaje** | `https://appsparavos-ops.github.io/Viajes/bitacora/` | el diario del viaje |
| **Panel de Viaje** | `https://appsparavos-ops.github.io/Viajes/panel/` | admin + `presupuesto.html` + `scanner.html` |

### Las direcciones viejas siguen funcionando

`viaje.html`, `viaje-admin.html`, `presupuesto.html` y `scanner.html` quedaron como **páginas de
redirección** que llevan a la carpeta nueva **conservando los parámetros** (`?user=…&id=…`). Sirven
para: los enlaces de WhatsApp ya compartidos, los accesos directos guardados y las pestañas
abiertas. No son instalables a propósito: no declaran service worker propio.

---

## 3. Instalación paso a paso (una sola vez)

### Paso 0 — quitar la app "Viaje"/"Bitácora" vieja

La app que ya instalaste se instaló desde la raíz y su alcance es **todo el sitio**: mientras siga
instalada, Chrome va a seguir ofreciendo "abrir en viaje" en cualquier página, incluido el Panel.
Por eso hay que quitarla **una vez** y reinstalarla desde la dirección nueva.

- **Windows:** abrí la app → menú **⋮** (arriba a la derecha de la ventana, dentro de la app) →
  **Desinstalar Panel/Bitácora…**. También sirve: `chrome://apps` → clic derecho en el ícono →
  *Quitar de Chrome*; o Configuración → Aplicaciones → buscar "Viaje" → Desinstalar.
- **Android:** mantener presionado el ícono → **Desinstalar** (o arrastrarlo a "Desinstalar").
- **iPhone/iPad:** mantener presionado el ícono → *Eliminar app* → *Eliminar de la pantalla de inicio*.

> ⚠️ **Si te ofrece borrar los datos del sitio, contestá que NO.** Ahí están el borrador local, las
> fotos y los gastos guardados en ese dispositivo. El desinstalar normal **no** toca los datos.
> Igual, tus viajes publicados están en Firebase y bajan solos al volver a entrar con tu cuenta.

### Paso 1 — instalar la Bitácora

1. Abrí `https://appsparavos-ops.github.io/Viajes/` (la portada) → tarjeta **Bitácora**, o directo
   `https://appsparavos-ops.github.io/Viajes/bitacora/` **en Chrome o Edge**.
2. Tocá el **botón flotante "Instalar"** (abajo a la derecha) → *Instalar*.

### Paso 2 — instalar el Panel

1. Volvé a la portada → tarjeta **Panel**, o abrí `https://appsparavos-ops.github.io/Viajes/panel/`.
2. Tocá el **botón flotante "Instalar"** → esta vez Chrome dice *"Instalar Panel de Viaje"* y lo
   instala como **segunda app**, con su propio ícono.

### Paso 3 — comprobar

- En el escritorio / cajón de apps tenés **dos íconos distintos**: *Bitácora* (libro, ámbar) y
  *Panel* (valija, azul noche).
- Al abrir cualquiera de las dos, la otra **no** aparece como "abrir en…": son apps independientes.
- Dentro del Panel, **👁️ Ver bitácora** abre la Bitácora en una ventana aparte.

### Si no querés desinstalar nada (alternativa)

Abrí una vez la app vieja instalada, dejá que cargue **30 segundos** y cerrala: al arrancar, Chrome
revisa el manifest de la app y puede actualizarle sola la dirección y el alcance a `/bitacora/`
(por eso las páginas viejas declaran el manifest de su app). Si después de eso el Panel **sigue**
diciendo "abrir en viaje", volvé al paso 0: desinstalar es la vía garantizada.

---

## 4. Cómo se verificó (sin confiar en el código)

- **`herramientas/verificar-manifiestos.js`** (nuevo, sin navegador): resuelve los manifiestos tal
  como los resuelve Chrome —cada ruta relativa contra la **URL del manifiesto**— y falla si un
  `scope` contiene la `start_url` de la otra app, si el `scope` es la raíz del sitio, o si las
  páginas de una app caen dentro del alcance de la otra. **Resultado: sin fallos.**
- **Ensayo de despliegue:** el contenido de este zip se sirvió en una subcarpeta
  (`http://localhost:8001/Viajes/`, igual que GitHub Pages) y las **6 suites pasaron sin fallos**:
  así queda comprobado que no hay ninguna ruta absoluta que se rompa al publicar.
- **`verificar-pwa.js`, sección 9**: le pide al navegador el manifiesto de cada app, los resuelve y
  comprueba que ninguna URL de una app cae en el alcance de la otra; además recorre las 4
  direcciones viejas y verifica que redirigen a la carpeta correcta conservando los parámetros.
- **`verificar-boton-instalar.js`**, **`verificar-android-windows.js`**, **`verificar-modo-borrador.js`**
  y **`verificar-limpiar-offline.js`**: las 4 suites siguen **sin fallos** con la estructura nueva
  (instalabilidad limpia en Android/Windows, botón flotante en las 4 pantallas, modo borrador y
  limpiador intactos).

Detalle de Chrome que quedó documentado en el código: los **atajos** (`shortcuts`) de un manifest
solo pueden apuntar **dentro** de su `scope`; el atajo "Ver bitácora" del Panel se quitó porque
Chrome lo ignoraba (daba dos advertencias). La bitácora se sigue abriendo desde el Panel con el
botón y la ventana emergente.
