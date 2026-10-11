# FLEET.IO

> Juego `.io` multijugador masivo en navegador. Conduce tu nave nodriza espacial, absorbe chatarra y construye una flota de drones escoltas en formaciones tácticas.

## Stack Tecnológico

| Capa       | Tecnología                              |
|------------|-----------------------------------------|
| Servidor   | Node.js + Express + Socket.io           |
| Motor      | Bucle autoritativo a **30 TPS**         |
| Cliente    | Phaser 3 (CDN) + Socket.io-client (CDN) |
| Render     | HTML5 Canvas (WebGL / 2D)               |
| Red        | WebSockets con interpolación de estado  |

## Estructura del Proyecto

```
fleet-io/
├── client/
│   ├── index.html      # Punto de entrada HTML + HUD + Overlay
│   ├── game.js         # Arranque estable del cliente
│   ├── js/
│   │   ├── game-scene.js # Escena, input, HUD y eventos Socket.IO
│   │   ├── renderer.js # WebGL, Arcade y contador FPS opcional
│   │   ├── player.js   # Predicción y reconciliación del jugador local
│   │   ├── movement.js # Paso fijo compartido con el servidor
│   │   ├── progression.js # Curva de XP compartida, niveles 1–40
│   │   ├── economy.js   # Monedas, tienda y recompensa diaria local
│   │   ├── features.js  # Habilidades, atributos y efectos sociales
│   │   ├── retention.js # Gemas, radar de cacerías, jefe y efectos de eliminación
│   │   ├── network.js  # Protocolo compacto e interpolación
│   │   └── visuals.js  # Texturas sci-fi y fondo de paralaje
│   ├── config.js       # URL pública del backend
│   ├── features.css    # Modales y controles RPG responsivos
│   └── monetization.js # Adaptador de anuncios recompensados
├── server/
│   ├── server.js       # Express + Socket.io (entrypoint)
│   ├── gameLoop.js     # Bucle autoritativo 30 TPS
│   ├── entities.js     # Clases: Player, Drone, Scrap, WORLD
│   ├── roomManager.js  # Matchmaking, códigos y ciclo de vida
│   ├── gameRoom.js     # Mundo aislado y colecciones Map
│   ├── bot.js          # FSM y steering de bots
│   ├── rpg.js          # XP, atributos, habilidades y evolución
│   ├── worldEvents.js  # Calendario, loot, núcleos, cacerías y Leviathan
│   └── combat.js       # Disparos, colisiones y obstáculos
├── package.json
└── README.md
```

## Instalación y Ejecución

### 1. Requisitos
- **Node.js 24** (comprueba con `node --version`; Docker incluye este runtime)
- **npm** o **pnpm**

### 2. Instalar dependencias
Abre una terminal en la carpeta raíz del proyecto y ejecuta:

```bash
npm install
```

Esto descargará `express` y `socket.io`.

### 3. Arrancar el servidor

```bash
npm start
```

o en modo *watch* (reinicia al cambiar archivos):

```bash
npm run dev
```

### 4. Abrir el juego
En tu navegador web (Chrome / Edge / Firefox recomendado):

```
http://localhost:3000
```

Abre varias pestañas para probar el multijugador localmente.

## Mecánicas de Juego

- **Movimiento:** Mueve el **ratón** sobre la pantalla. La nave nodriza persigue el puntero con inercia.
- **Chatarra (Scrap):** Flota por el mapa en tres valores (1 / 2 / 3, indicados por brillo/tamaño). Absórbela acercándote.
- **Puntuación:** Cada scrap = `valor × 10` puntos.
- **Drones escoltas:** Cada 5 piezas de chatarra recibes un dron (máximo **12**) que orbita tu nave en formación.
- **Mapa:** Mundo infinito acotado de **4000 × 4000** con cuadrícula y 3 capas de estrellas con paralaje.
- **Tabla de líderes:** Top 6 jugadores por puntuación en el centro superior.

## Arquitectura de Red (Resumen)

```
[Cliente Phaser WebGL, RAF 60/120/144 Hz]
        │  playerMove (paso fijo 30 Hz, seq, tx, ty)
        ▼
[Socket.io WebSocket]
        │
        ▼
[Servidor: 30 TPS autoritativo]
  ├─ player.update()        (inercia, movimiento)
  ├─ scrap.update()
  ├─ checkScrapCollection() (radio absorb)
  └─ maybeSpawnScrap()
        │  gameState (30 Hz: keyframe fiable v2 + deltas v3)
        ▼
[Cliente: predicción local + buffer remoto 80 ms / 5 estados]
  └─ render independiente del tick de red (Phaser RAF)
```

## Personalización Rápida

- **Mundo:** Edita `WORLD = { width, height }` en [server/entities.js](server/entities.js#L5-L8).
- **Tick rate:** Modifica `TICK_RATE` en [server/gameLoop.js](server/gameLoop.js#L7-L8).
- **Velocidad / aceleración:** Atributos `maxSpeed`, `acceleration`, `friction` de `Player` en [entities.js](server/entities.js#L87-L92).
- **Spawn de scrap:** `maxScraps` y frecuencia en `_maybeSpawnScrap()` en [gameLoop.js](server/gameLoop.js#L89-L110).
- **Tema colores de HUD:** Variables CSS `--accent*` en el `<style>` de [client/index.html](client/index.html#L9-L20).

## Troubleshooting

| Síntoma                          | Causa / Solución                                                   |
|----------------------------------|--------------------------------------------------------------------|
| El navegador abre pantalla negra | Comprueba la consola (F12). Asegúrate de haber hecho `npm install`.|
| `Error: listen EADDRINUSE :3000` | El puerto 3000 está ocupado. Usa `set PORT=3001 && npm start`      |
| Tirones con red inestable | Ajusta `INTERP_BUFFER_MS` en `client/js/game-scene.js` (80 ms por defecto). |
| No carga Phaser / Socket.io CDN  | Comprueba conexión a internet o reemplaza CDN por archivos locales.|

## Anuncios recompensados y resurrección

`client/index.html` carga el SDK v3 oficial de CrazyGames y
`client/monetization.js` expone `window.AdManager`. El arranque espera `SDK.init()`:
en el entorno `crazygames` usa el SDK nativo; la simulación cancelable solo funciona
en `localhost` o `127.0.0.1`. Firebase, iframes públicos y el portal nunca simulan
recompensas si el SDK no está disponible o no inicializa correctamente.
`showRewardedAd(onSuccess, onFailure)` recompensa únicamente una finalización;
`showInterstitialAd(callback)` solicita un anuncio `midgame`, devuelve una promesa
booleana y llama a `callback(completed, error)` sin conceder recompensas.
El reinicio gratuito solicita `midgame` únicamente en muertes donde no se ofreció
revivir con anuncio. Nunca combina ambos tipos en la misma muerte. El SDK decide
si hay inventario y si permite el intersticial por su intervalo automático.

El adaptador nativo solicita `rewarded` y recompensa solo desde `adFinished`.
`adStarted` pausa la escena y silencia su audio; finalización o error restauran
el estado anterior. `gameplayStart` y `gameplayStop` reflejan entrada efectiva,
muerte, resurrección confirmada, menú, desconexión y selección de mutaciones.
El canvas usa Phaser RESIZE y ResizeObserver para adaptarse al iframe sin estirar
las naves. No hay controles propios de pantalla completa.

Solo en localhost, para probar otro proveedor usar `AdManager.setAdapter(adapter)` con los métodos
`showRewardedAd()` y `showInterstitialAd()`. Ambos deben devolver `Promise<boolean>`;
el wrapper del SDK resuelve `true` al completar y `false` al cancelar o no disponer
de anuncios. Los anuncios display de AdSense no sirven por sí solos como rewarded ads.
La confirmación de anuncios procede del SDK en el cliente; el backend valida
la muerte y la economía retenida, pero no dispone de una prueba independiente
de visualización del anuncio. Un cliente modificado puede solicitar una recompensa.

### Actualización de QA de CrazyGames (11 de octubre de 2026)

`monetization.js` arranca en el head después del SDK oficial. Encola la intención
de `loadingStart` desde el arranque y la comunica después de `SDK.init()` (nunca
usa módulos del SDK antes de inicializar). `GameScene` termina la carga únicamente
con recursos y menú listos. Socket.io conecta independientemente: un backend
frío no deja abierta la carga del SDK. La pantalla de espera cubre el menú hasta
que sus controles estén preparados. La carga y el gameplay son idempotentes.

Corrección del bloqueo Loading Start: `AdManager` fuerza `loadingStop` a los ocho
segundos desde el inicio de carga comunicado al SDK. `BootScene` tiene también
un límite de ocho segundos para abortar audio opcional atascado y abrir el menú.
La ruta normal cancela ambos temporizadores. Entrar a una partida confirma
además el fin de carga antes de `gameplayStart`. El menú puede mostrar conexión
pendiente; no inicia gameplay hasta que el servidor confirma la entrada. La
muerte notifica `gameplayStop` antes de generar efectos visuales. Las excepciones
de telemetría se registran en consola en lugar de ocultarse.

En la revisión automática, ver solo Loading Start no demuestra por sí solo que
falten todas las llamadas: el auditor debe usar el paquete nuevo y pulsar Play
para observar gameplayStart, morir o volver al menú para gameplayStop. No se
envían eventos de partida ficticios desde el menú para completar un informe.

Las dos opciones de muerte comparten exactamente la clase `death-choice`, tamaño
y estilo. La opción gratuita recibe el foco. La oferta rewarded aparece como
máximo en una de cada dos muertes, además de un intervalo mínimo de 120 segundos
entre ofertas. Durante anuncios se pausan GameScene/UIScene, audio HTML5 y los
contextos Web Audio activos; se restaura exclusivamente el estado anterior al
terminar o fallar. Un error o timeout nunca concede recompensa ni bloquea el
reinicio. Basic Launch/adblock deshabilitan nuevas ofertas; unfilled/adCooldown
aplazan los reintentos. La API oficial es `midgame`, **no `midroll`**.

El backend permite Firebase y orígenes HTTPS del dominio CrazyGames y de
`builds.gamedistribution.com`, incluidos sus subdominios con comprobación del
sufijo DNS. Tanto polling CORS como el handshake WebSocket usan esta regla.

Archivos de esta actualización: `client/index.html`, `client/monetization.js`,
`client/js/game-scene.js`, `client/js/features.js`, `client/js/translations.js`,
`server/server.js` y el nuevo `server/origins.js`. Publicar todo `client/`, no solo
el HTML, para mantener coherentes los scripts y sus versiones de caché.

Desde PowerShell en la raíz del proyecto:

```powershell
Set-Location D:\Juego.io
git push origin main
firebase deploy --only hosting --project fleet-io-d45d5 --non-interactive
```

El push de la revisión confirmada inicia el despliegue automático de Render.
Comprobar `https://fleet-io-backend.onrender.com/healthz` después del despliegue.
Para CrazyGames, actualizar el envío con `artifacts/fleet-io-crazygames-upload.zip`:
contiene únicamente el cliente con `index.html` en la raíz. El ZIP completo de
fuentes es para guardar el proyecto, no para subirlo al portal. Publicar Firebase
no sustituye los archivos ya subidos al Developer Portal.

En la vista previa del portal verificar loadingStart/Stop, entrada/muerte/respawn,
los botones de igual tamaño y restauración de audio tras anuncios completos y
fallidos. Las pruebas automatizadas usan un SDK controlado; no verifican anuncios
reales, aceptación de QA ni activación de monetización. En Basic Launch los
anuncios están deshabilitados por la plataforma. La aprobación general depende
también de sus requisitos de cuenta, multijugador y calidad, fuera de estos cinco
bloques de integración.

Referencias: [API oficial de anuncios](https://docs.crazygames.com/sdk/video-ads/),
[requisitos de anuncios](https://docs.crazygames.com/requirements/ads/) y
[eventos de juego y carga](https://docs.crazygames.com/sdk/game/).

El servidor conserva una captura de puntuación, chatarra y número de escoltas al
morir. Cada `deathId` admite una sola resurrección: la recompensada conserva el 50%
de esos tres valores, redondeado hacia abajo, y las mutaciones; el reinicio gratuito
restablece la progresión y la flota. Ambos restauran toda la vida y buscan una
posición separada de los enemigos. `takeDamage(amount)` respeta tres segundos de
protección tras resurgir. El cliente detiene el envío de movimientos durante la
muerte y el anuncio, y espera el estado autoritativo para cerrar el modal.

Los cañones del chasis y los drones autónomos atacan enemigos cercanos. Los proyectiles usan
colisiones continuas contra naves, drones y asteroides. Una nave humana permanece
muerta hasta elegir una resurrección; los bots resurgirán tras tres segundos.
Las pruebas cubren las muertes, anuncios, resurrecciones y eventos cliente/servidor:
ejecutar `npm test`.

Para publicar en CrazyGames, empaquetar el contenido de `client/` con `index.html`
en la raíz. Configurar `FLEET_CONFIG.backendUrl` en `config.js` con el backend HTTPS
y permitir el origen real del juego mediante `CLIENT_ORIGINS` en el servidor.
Validar rewarded, midgame y eventos de partida en la vista previa del portal antes
de publicar: las pruebas automatizadas utilizan un SDK controlado, no inventario real.
Referencias: [SDK v3](https://docs.crazygames.com/sdk/intro/),
[anuncios](https://docs.crazygames.com/sdk/video-ads/) y
[eventos del juego](https://docs.crazygames.com/sdk/game/).

## Salas multijugador y bots

El menú permite juego rápido público, crear/unirse a una sala privada y modo
solitario. Las públicas admiten 30 humanos y el matchmaking elige la sala no llena
con menos jugadores. Las privadas admiten 8 humanos y generan códigos aleatorios
de seis caracteres mediante `node:crypto`, sin caracteres ambiguos. El código se
muestra en el HUD con un botón de copia. El modo solitario admite un humano y siete
bots identificados como `[BOT]`, con nombres en naranja.

Cada `GameRoom` mantiene Maps independientes de jugadores, chatarra, asteroides y
proyectiles, y su propio intervalo a 30 TPS. Los snapshots a 30 Hz incluyen `roomId`,
`p` (humanos/bots), `s` (chatarra), `b` (proyectiles) y `o` (obstáculos). Solo se
envían a sockets de esa sala. Al cambiar de sala, el cliente limpia entidades,
interpolación, partículas y mutaciones pendientes, y descarta paquetes de otro mundo.

| Evento de entrada | Datos | Respuesta por acknowledgement |
|---|---|---|
| `joinRoom` | `{ name, roomCode: 'public' }` o código privado | `{ ok, room, roomCode }` o `{ ok: false, error }` |
| `createPrivateRoom` | `{ name }` | Código y sala creados |
| `startSinglePlayer` | `{ name }` | Sala solitaria con 7 bots |
| `leaveRoom` | `{}` | `{ ok: true }` |

El servidor envía `welcome` al entrar, `roomInfo` cuando cambia la ocupación y
`gameState` durante la partida. Un código erróneo o una sala llena no retiran al
jugador de su sala actual. Los cambios están limitados a uno por segundo/socket;
el gestor limita el total a 100 salas. Las públicas/privadas vacías paran sus ticks
y caducan a los 60 segundos (comprobación cada 5 segundos). Las solitarias se
destruyen inmediatamente al salir su humano. Al apagar el servidor se limpian
todos los intervalos y Maps.

Los bots comparten física, daño y economía con `Player`. Priorizan huida con vida
baja o inferioridad de escoltas; después buscan material por distancia/valor y,
con más de cinco drones, interceptan y flanquean enemigos. La huida se evalúa a
30 Hz; las decisiones estratégicas se escalonan a 5 Hz para reducir coste. Eligen
sus propias mutaciones y sueltan su chatarra al morir, agrupada en hasta 20 piezas.
Respawnean tras tres segundos sin progresión y con protección temporal.

La simulación limita a 250 piezas de chatarra y 240 proyectiles por sala. No usa
esperas ni I/O síncrono durante los ticks. Los intervalos independientes comparten
el hilo de Node.js: no aíslan CPU. Dimensiona la cantidad de salas mediante pruebas
de carga; una instalación de mayor capacidad necesitará distribuir salas entre
procesos/workers manteniendo un único propietario autoritativo para cada mundo.

## Despliegue en producción

El backend es un proceso Node.js persistente que sirve Express y Socket.IO.
Puedes servir también el cliente desde ese mismo proceso, o publicar exclusivamente
`client/` en Vercel/Cloudflare Pages y conectarlo al backend por HTTPS.

### Variables y conexión del cliente

| Configuración | Valor / uso |
|---|---|
| `PORT` | Puerto de escucha; `process.env.PORT || 3000`. La plataforma puede inyectarlo. |
| `NODE_ENV` | `production` en la nube. |
| `CLIENT_ORIGINS` | Lista de orígenes autorizados separados por comas, por ejemplo `https://fleet.vercel.app,https://fleet.pages.dev`. Sin rutas ni barra final. |
| `client/config.js` → `backendUrl` | Vacío para compartir origen; URL HTTPS pública del backend para hosting separado. |

En producción, `CLIENT_ORIGINS` vacío permite conexiones del mismo origen. Los
dominios de preview deben autorizarse explícitamente si quieres jugar desde ellos.
La restricción se aplica a polling y WebSocket; no sustituye autenticación.

Para configurar localmente, copia `.env.example` a `.env`, edita las variables y
ejecuta `npm run start:env`. `npm start` lee el entorno del proceso y no carga `.env`
automáticamente. En la nube introduce las variables en el panel del servicio;
no subas `.env` al repositorio ni incluyas secretos en `client/config.js`.

Para un frontend separado, después de desplegar el backend, edita y guarda:

```js
// client/config.js
window.FLEET_CONFIG = Object.freeze({
  backendUrl: 'https://TU-BACKEND.onrender.com',
});
```

Usa la URL pública real de Render o Railway, sin `/socket.io` al final. Publica ese
cambio junto con el cliente. Este archivo es JavaScript estático: las variables del
panel de Vercel/Pages no se inyectan automáticamente en él. Para compartir origen,
deja `backendUrl: ''`. El cliente selecciona `io()` o `io(backendUrl)`.

### Docker local

Desde la raíz del proyecto, con Docker instalado:

```bash
docker build --pull -t fleet-io .
docker run --rm --name fleet-io -p 3000:3000 --env-file .env fleet-io
```

Antes del segundo comando, crea `.env` desde `.env.example` y conserva `PORT=3000`.
Abre `http://localhost:3000`; `http://localhost:3000/healthz` debe devolver
`{"status":"ok"}`. La imagen instala con `npm ci --omit=dev`, usa usuario sin
privilegios, excluye secretos y dependencias locales, y ejecuta Node directamente.
`EXPOSE 3000` documenta el puerto; si cambias `PORT`, ajusta también el mapeo `-p`.

### Backend en Render

1. Sube el proyecto completo a un repositorio GitHub/GitLab/Bitbucket.
2. En Render, crea **New → Web Service** y conecta ese repositorio.
3. Selecciona **Docker**, deja la raíz del servicio vacía y usa `./Dockerfile`.
4. Configura `NODE_ENV=production`. Deja que Render configure `PORT`.
5. Define **Health Check Path** como `/healthz`; conserva el comando del Dockerfile.
6. Despliega y comprueba `https://TU-SERVICIO.onrender.com/healthz`.
7. Para compartir origen, abre la URL del servicio y juega directamente.

Referencia: [servicios web](https://render.com/docs/web-services) y
[Docker en Render](https://render.com/docs/docker).

### Backend en Railway

1. Sube el proyecto completo a GitHub.
2. Crea un proyecto con **Deploy from GitHub repo** y selecciona el repositorio.
3. Mantén la raíz del servicio en el repositorio: Railway detecta `Dockerfile`.
4. Configura `NODE_ENV=production` y `PORT=3000` en **Variables**.
5. Configura el healthcheck `/healthz` y conserva el `CMD` de la imagen.
6. En **Settings → Networking → Public Networking**, pulsa **Generate Domain**;
   usa `3000` como puerto destino si te lo solicita.
7. Comprueba `https://TU-DOMINIO.up.railway.app/healthz` y abre el dominio para jugar.

Referencia: [servicios](https://docs.railway.com/services) y
[dominios públicos](https://docs.railway.com/networking/domains/working-with-domains).

### Cliente estático en Vercel

1. Despliega primero el backend y configura su URL en `client/config.js`.
2. Importa el repositorio en Vercel con **Add New → Project**.
3. Establece **Root Directory** en `client` y **Framework Preset** en **Other**.
4. Deja **Build Command** vacío y **Output Directory** en `.`. No requiere instalar
   dependencias; el cliente usa los scripts CDN del HTML.
5. Despliega y copia el origen público del frontend.
6. Añádelo a `CLIENT_ORIGINS` del backend y redespliega el servicio.

Referencia: [configuración del build de Vercel](https://vercel.com/docs/builds/configure-a-build).

### Cliente estático en Cloudflare Pages

1. Configura la URL del backend en `client/config.js` y sube el cambio.
2. En **Workers & Pages**, crea una aplicación **Pages** e importa el repositorio.
3. Usa **Framework preset: None**, **Build command: `exit 0`** y
   **Build output directory: `client`**. Mantén la raíz del proyecto en el repositorio.
4. Despliega y añade `https://TU-PROYECTO.pages.dev` a `CLIENT_ORIGINS` del backend.
5. Redespliega el backend y abre el frontend para comprobar la conexión.

Referencia: [HTML estático en Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).

### Verificación y límites de despliegue

- Ejecuta `npm test` antes de publicar. Comprueba `/healthz`, abre dos navegadores,
  lanza ambas naves y verifica que comparten jugadores y puntuaciones.
- Si el frontend no conecta, revisa `backendUrl`, HTTPS y el origen exacto en
  `CLIENT_ORIGINS`. El tráfico `/socket.io/` debe alcanzar el servicio Node.js.
- Vercel/Pages alojan únicamente `client/` en esta arquitectura. El servidor
  Socket.IO y su bucle de juego se ejecutan en Render/Railway.
- Mantén **una sola instancia y un solo proceso**: el mundo vive en memoria,
  se pierde al reiniciar y no se comparte entre réplicas. Para escalar necesitas
  gestionar salas/estado autoritativo y coordinación entre procesos.
- CrazyGames SDK v3 usa anuncios nativos en el portal y simulación en localhost.
  Valida los anuncios reales en la vista previa de CrazyGames antes de publicar.

## Licencia
MIT

## Renderizado sci-fi, predicción y rendimiento

`client/js/renderer.js` fuerza WebGL y configura Arcade sin debug. El render usa
requestAnimationFrame: `target: 120` no limita el refresco ni garantiza FPS en todos
los dispositivos. La cámara y las animaciones usan delta time. La simulación de
movimiento es compartida en `movement.js`, con pasos de 33,33 ms e interpolación
visual entre pasos; el servidor conserva la autoridad sobre combate y economía.

El jugador local responde al ratón, WASD o flechas. Cada entrada tiene `seq`; el
servidor consume como máximo una por tick y confirma `inputSeq`. El cliente elimina
entradas confirmadas y reproduce las restantes. Rebase continuo de la simulación,
con offset visual amortiguado equivalente a 0,2 a 60 Hz y limitado al 25% de la
velocidad de avance (12 px/s en reposo), evita acumular errores y corregirlos con
retrocesos periódicos. Muerte, resurrección y cambio de
sala reinician la predicción para evitar arrastrar estados del mundo anterior.
Los enemigos y láseres conservan cinco snapshots y se interpolan a 80 ms, incluida
la rotación por el arco más corto. No se extrapolan enemigos indefinidamente si
faltan paquetes. Las colas de entrada y partículas tienen límites explícitos.

El protocolo empaqueta jugadores, drones, chatarra y proyectiles en arrays.
`network.js` comparte el codificador/decodificador con el servidor y acepta también
snapshots antiguos de objetos. La versión actual transmite keyframes fiables v2 y
deltas v3 independientes relativos a esa base, reconstruyendo cada estado completo.
Desplegar cliente y servidor juntos al actualizar este protocolo.

Naves, drones, escudos, láseres, asteroides y chatarra usan texturas procedurales
reutilizadas. Las capas TileSprite de estrellas usan paralaje 0,1 / 0,2 / 0,3 y una
nebulosa oscura. Los efectos se omiten fuera de cámara; HUD se actualiza al cambiar
valores y la tabla de líderes como máximo cuatro veces por segundo. Las mutaciones
se desbloquean al alcanzar niveles 10, 20, 30 y 40. La curva de XP se comparte entre
servidor y HUD. Un drop que cruza varios hitos abre una sola elección de mutación.

## Evolución, habilidades y economía

La nave comienza a 225 px/s (7,5 px por tick). `BASE_SPEED` y
`BASE_ACCELERATION` en `client/js/movement.js` controlan el movimiento compartido;
la aceleración escala con la velocidad máxima para alcanzar también las mejoras
sin que la fricción las anule. El reinicio gratuito conserva esta velocidad base.

Cada pieza de chatarra concede 10 XP y una baja concede 100 XP. Para subir se
consumen `floor(100 × nivel^1.4)` XP y se conserva el excedente. Los primeros costes
son 100, 263, 465, 696 y 951 XP. El máximo es nivel 40. Cada subida concede tres
puntos de atributos; las asignaciones y sus límites se validan en el servidor.

| Atributo | Por punto | Límite |
| --- | --- | --- |
| Velocidad | +15 px/s | +150 px/s |
| Escudo | +50 HP máximos | +500 HP |
| Daño | +0,1 al multiplicador | Multiplicador 2,0 |
| Cadencia | −15 ms de recarga | Recarga mínima 100 ms |

Los chasis evolucionan en niveles 1/10/25/40: caza de un cañón, fragata de dos,
crucero con cañones pesados y generadores laterales, y nodriza de cuatro cañones.
La nodriza incluye dos drones autónomos que orbitan cada dos segundos y atacan
al rival más cercano dentro de 400 px, además de las escoltas recolectadas.

| Control | Habilidad | Duración | Recarga |
| --- | --- | --- | --- |
| Shift / clic derecho | Turbo ×2,8 y protección de daño | 250 ms | 3 s |
| Q | Escudo inmune a todo daño | 2 s | 12 s |
| R | EMP, radio 350 px: ralentiza e impide disparar | 1,5 s | 15 s |

Los impactos añaden una pausa visual breve y sacudida ligera; las explosiones
pesadas usan una sacudida mayor. Los proyectiles emiten estelas de 150 ms.
Los efectos tienen límites de partículas y se omiten fuera de la cámara.

La pantalla de muerte identifica al atacante con nave, vida, puntuación y racha.
**Revenge Spawn** reinicia sin flota a 400–500 px del atacante si sigue vivo y hay
un punto seguro, con marcador durante tres segundos. El anuncio recompensado
mantiene el 50% de puntuación, XP, chatarra y escoltas; el reinicio gratuito
borra la progresión. Cada muerte admite una única resurrección. El líder vivo
lleva corona y aura dorada y su posición exacta aparece en todos los radares.
Las rachas 2/3/5+ muestran DOUBLE KILL / DOMINATING / UNSTOPPABLE.

Al terminar una partida se otorgan `floor(puntuación / 50)` monedas y se muestra
el tiempo de supervivencia. La liquidación usa identificadores de partida para
evitar repetirla al recibir snapshots de muerte o recargar. La tienda permite
comprar y equipar Alien Green (600), Golden Elite (1500), Mecha Chrome (1000),
Plasma Cyan (gratis), Solar Orange (400) y Void Purple (800).

La recompensa diaria concede 500 monedas cada 24 horas y Carga Solar (+10% de
velocidad durante 15 s) en la primera partida posterior a reclamarla. Monedas,
compras, selección y fecha de reclamación se guardan en localStorage, incluyendo
las claves `fleet_io_coins`, `fleet_io_unlocked_skins`, `fleet_io_unlocked_trails`
y `fleet_io_last_login`. Si el navegador bloquea el almacenamiento, se usa memoria
de sesión. Esta economía es local al navegador y modificable por el usuario;
no representa una cuenta ni saldo protegido en el backend.

CrazyGames conserva `gameplayStart`/`gameplayStop`, pausa y silencio durante
anuncios, y éxito de recompensa exclusivamente tras `adFinished`. Los paneles
de atributos y tienda detienen el seguimiento de gameplay; el mundo multijugador
continúa en el servidor mientras están abiertos.

Para comprobarlo localmente sin editar la URL de Render en `client/config.js`:

```bash
npm run preview
```

Abrir `http://127.0.0.1:3013/?debug=1`: muestra FPS reales del render y usa un backend
local en el puerto 3014. `PREVIEW_PORT` permite cambiar el primer puerto; el backend
usa el siguiente. La URL de producción y la integración CrazyGames se conservan.
Ejecutar `npm test` para verificar predicción a 60/120/144 Hz, reconciliación, red,
mutaciones, cámara, anuncios y resurrección. Los anuncios reales se validan en la
vista previa del portal. Las API de RAF y TileSprite siguen la documentación de
[Phaser TimeStep](https://docs.phaser.io/api-documentation/class/core-timestep) y
[TileSprite](https://docs.phaser.io/phaser/concepts/gameobjects/tile-sprite).

## Gemas, recuperación y eventos de mundo

`server/worldEvents.js` mantiene el estado dentro de cada sala. Comparte la fase
del calendario del proceso con todas las salas, y se actualiza desde el tick
existente a 30 Hz: no crea un intervalo por gema ni timers que sobrevivan a una
sala. Los jugadores de salas privadas no reciben eventos ni coordenadas de otras
salas. El mapa sigue usando coordenadas positivas de 0 a 4000.

- **Gemas de XP:** cada nave destruida dispersa 24 gemas; los drones también
  dispersan 24 con 20 XP totales. Aplican fricción 0,92 durante 300 ms y luego
  buscan al jugador vivo más cercano en 250 px mediante una rejilla espacial.
  La aceleración es `clamp(1200 × (1 − distancia/250)^2, 200, 1200)` px/s².
  El sonido aumenta 0,05 por recogida hasta pitch 2,2, y reinicia tras 1,5 s.
- **Energy Core:** contiene `floor(totalXp × 0.5)` de la vida terminada; `xp` es
  solo el residuo de un nivel y no se usa como XP acumulada. El resto se reparte
  entre las gemas de la explosión. El núcleo dura 45 s, cualquiera puede robarlo
  y su propietario ve una flecha al reaparecer con distancia en metros (10 px/m).
  Recuperarlo muestra PROGRESS RECOVERED y reproduce un sonido especial.
- **Narrow Escape:** tras recibir daño y quedar por debajo del 10% de HP,
  sobrevivir tres segundos sin daño o eliminar al atacante concede 200 XP una
  sola vez por activación. La viñeta pulsa entre alfa 0,2 y 0,6. La ralentización
  visual de 500 ms afecta animaciones, nunca la simulación ni la predicción.
- **Bounty:** nivel 40 o racha de diez bajas anuncian una recompensa de 5000
  monedas. La posición se envía en snapshots para los indicadores de calavera.
  El golpe final concede el premio y avisa a la sala. Morir o salir retira la
  cacería; otro cumplimiento posterior puede emitir una nueva.
- **Gold Tide:** cada cuatro minutos, con aviso 15 s antes, aparecen 15
  asteroides dorados en el cuadrante jugable a menos de 600 px de `(0,0)`.
  Tienen 300 HP frente a los 100 del asteroide normal. Dan 500 XP/50 monedas,
  frente a 100 XP/10 monedas, en gemas físicas. La siguiente tormenta reemplaza
  los meteoritos dorados restantes. Los cañones atacan asteroides próximos cuando
  no encuentran naves o jefe dentro de alcance.
- **Leviathan:** cada diez minutos aparece en `(2000,2000)` con 12.000 HP.
  Patrulla a 35 px/s, pasa a agresión ante jugadores a 800 px y dispara 24
  proyectiles radiales cada tres segundos. Su barra se muestra dentro de 1000 px.
  El premio total es 10.000 XP/5000 monedas: el 60% se reparte proporcionalmente
  al daño efectivo, con restos enteros conservados; el 40% cae en 30 gemas. Si
  un contribuyente sigue en la sala pero está muerto, conserva su XP pendiente
  para la siguiente reaparición. Salir de la sala elimina su entidad y sus
  premios pendientes: no hay cuenta ni almacén de recompensas offline.

Los títulos persistentes son **Space Terror** (cacería), **Leviathan Slayer**
(golpe final al jefe) y **Dominator** (primer puesto). Se muestran en las placas
de nombre y en los primeros cinco puestos de la clasificación. La tienda añade
Frost Shatter (900 monedas), Black Hole (1800) y Neon Graffiti (1200). Las compras,
títulos y efecto equipado se guardan junto al perfil local y se envían al servidor
como cosméticos. Frost congela y fragmenta la nave; Black Hole absorbe partículas
en espiral; Neon Graffiti deja una marca durante diez segundos.

Los premios de monedas llegan como recibos fiables `coin_reward` y también
permanecen en el snapshot del jugador hasta `ackCoinReward`. El navegador guarda
el premio antes de confirmar, agrupando ráfagas en una escritura cada 100 ms para
evitar bloquear el render, con una secuencia persistente por sala que impide
duplicarlo. Esto mantiene la economía existente en localStorage; no protege un
saldo contra modificaciones del navegador ni lo sincroniza entre dispositivos.

El snapshot v2 añade `w.g` (gemas), `w.c` (núcleos), `w.q` (cacerías), `w.boss`
y el tiempo hasta la siguiente tormenta. Son arrays de primitivas, completos
y resistentes a pérdida de snapshots volatile. Gemas limitadas a 360 por sala,
núcleos a 64, proyectiles a 240 y recibos pendientes a 64 con reserva consolidada.
El cliente reutiliza imágenes, textos y partículas, limita voces de audio a seis
y efectos simultáneos, y libera los objetos al cambiar de sala o cerrar la escena.

Para QA visual de eventos sin esperar el calendario real:

```bash
npm run preview -- --events
```

Este comando precarga exclusivamente `tools/event-preview.cjs`: crea un jefe de
300 HP, objetos de prueba y premios de muestra en el backend local. Docker y
`npm start` usan los valores de producción y nunca cargan esta fixture. Los
anuncios y su pausa/silencio mantienen la integración CrazyGames existente.


## PvP competitivo: Némesis, KotH, parry y suministros

El servidor decide las colisiones, premios, temporizadores y buffs por sala. El cliente
reconstruye estados completos a 30 Hz desde keyframes y deltas y usa el mismo modelo de movimiento para predecir
el multiplicador de venganza, incluyendo su vencimiento durante el replay de entradas.
La integración de anuncios y los eventos `gameplayStart/gameplayStop` se mantienen.

- **Némesis:** dos eliminaciones consecutivas del mismo rival asignan su ID a la víctima.
  Una eliminación en sentido contrario reinicia la cuenta; destruir a tu Némesis concede
  1500 XP una sola vez y transmite `NEMESIS_DESTROYED`. Tras revivir con una Némesis
  conectada, se conceden 3000 ms de invulnerabilidad y velocidad ×1.5, con timer cancelable
  y deadline autoritativo. Si el vencedor también muere, sus XP quedan pendientes para
  la siguiente vida. Desconectar elimina referencias y contadores de esa identidad.
- **KotH:** círculo de radio 400 en `(0, 0)`, respetando las coordenadas solicitadas.
  Puesto que el mapa ocupa `[0,4000] × [0,4000]`, su región jugable está en la esquina
  superior izquierda. Los ocupantes vivos ganan 50 XP y 5 monedas por segundo.
  Salir o morir reinicia el tiempo continuo. El líder se anuncia cada 2 segundos;
  empates se resuelven por ID. Los intervalos conservan su fase sin acumular premios
  durante una pausa del proceso.
- **Parry:** tecla **F** o botón táctil, ventana de 300 ms y recarga de 5 segundos.
  La colisión recorre el segmento del disparo y refleja su velocidad exactamente ×−2,
  cambia propietario/color y duplica su daño. Cada disparo admite hasta seis rebotes
  para acotar la amplificación. La confirmación activa chispas, onda radial y audio
  metálico que respeta silencio y anuncios.
- **Suministros:** un pod de 1500 HP cada 90 segundos, a ≥800 px del origen y fuera
  de asteroides. Hay un máximo de un pod activo por sala: el siguiente reemplaza al
  anterior. Destruirlo concede al vencedor vivo un buff aleatorio durante 15 segundos;
  morir elimina el buff. `DOUBLE_FIRE_RATE` divide por dos el intervalo de disparo;
  `PIERCING_LASERS` atraviesa naves y escoltas, dañando una vez a cada entidad por bala;
  `MIRROR_SHIELD` refleja impactos con la misma regla que parry. Un nuevo buff reemplaza
  al anterior. Los proyectiles perforantes resuelven hasta 64 impactos por tick.

`server/competitive.js` gestiona el estado por sala; `client/js/competitive.js` presenta
zona, calavera pulsante, flechas, barras de HP y avisos. El snapshot incluye
`competitive.pods` (arrays primitivos) y `competitive.leader`; la metadata de jugador
incluye Némesis, tiempos restantes y tipo de buff. Es compatible con snapshots antiguos.
Todos los timers de venganza se cancelan al morir, abandonar o destruir la sala; los
handlers, objetos de Phaser, tweens y elementos DOM se limpian al terminar la escena.

Verificación: `npm test`. Prueba visual acelerada y aislada:

```sh
npm run preview -- --pvp
```

Abre la URL local indicada y crea una sala privada. Esta fixture coloca al piloto en la
zona y añade una Némesis, un pod y buffs de prueba. Solo se carga con `--pvp`:
`npm start` y Docker mantienen los intervalos y premios de producción.


## Movilidad, peligros y sinergias de combate

`server/hazards.js` concentra el estado por sala, el grid de explosiones y los deadlines.
`client/js/hazards.js` renderiza espirales, materia oscura, ondas y el HUD de combos.
`wormholePairs` es una geometría global inmutable con dos pares bidireccionales:
`(700,700) ↔ (3300,3300)` y `(700,3300) ↔ (3300,700)`, radio 60.

- **Slingshot:** las naves duplican su velocidad al entrar y disponen de un límite de
  motor ×2 durante 1 segundo. Los proyectiles conservan dirección y aumentan velocidad
  y daño ×1.25. El cooldown es de 500 ms por entidad, con claves de tipo e ID para
  evitar colisiones entre naves y disparos. Además, una llegada debe salir del círculo
  de destino antes de volver a entrar; quedarse quieto no produce saltos repetidos.
  Los proyectiles usan intersecciones de segmento y resuelven los impactos del recorrido
  restante en el destino, sin atravesar físicamente el mapa entre los portales.
- **Sincronización de saltos:** `WORMHOLE_TRAVERSE` incluye revisión y estado autoritativo.
  La revisión reinicia predicción/interpolación al cambiar de posición; los snapshots
  permiten recuperarse incluso si falta un efecto. Las entradas anteriores al salto
  se descartan y las nuevas incluyen la revisión. No se suaviza un salto de miles de
  píxeles como si fuera un error ordinario. Las estelas duran 1 segundo y comparten un
  emisor de 240 partículas con un máximo de 32 objetos seguidos.
- **Supernova:** cada 180 segundos de calendario de sala se selecciona un sector fuera
  de la zona central del mapa. Aviso de 5 s sin fuerzas; actividad de 10 s con radio 500,
  aceleración `clamp(12000/(dist+10)^2,50,900)` y daño de 40 HP/s en el núcleo de radio 80;
  disipación de 2 s con un único impulso radial de 600 px/s. Mantiene las protecciones
  de daño existentes. Las fases tienen deadlines y no acumulan ráfagas por retrasos del
  proceso. El efecto de materia oscura reutiliza 48 imágenes; el aviso usa un único
  objeto Graphics y su tween se cancela al cambiar de fase/sala.
- **Plasma volátil:** ocho asteroides rojos de 200 HP por sala, repuestos cada 30 s hasta
  ese límite. Las salidas de portales se mantienen libres. Una explosión de radio 300
  aplica `150*(1-dist/300)` de daño y `800*(1-dist/300)` px/s de impulso. El grid de celdas
  de 300 px limita las consultas a actores cercanos; asteroides volátiles alcanzados
  tienen destrucción programada a +100 ms, conservando atribución del atacante. La cola
  usa el tick del servidor y no crea temporizadores independientes ni duplica estallidos.
- **Kill chain:** máximo 5 stacks. Cada baja renueva 10 s; después se pierde un stack
  cada 2 s. La cadencia usa un factor `1-count*.05`, y la velocidad `1+count*.03`.
  Los deadlines de disparo son fraccionarios para conservar la mejora media a 30 Hz,
  especialmente con un solo stack. La muerte reinicia la cadena. `COMBO_UPDATE` notifica
  las transiciones; el snapshot transporta contador y tiempo para incorporación tardía.

Las velocidades del motor están en px/tick. Las fuerzas descritas en px/s o px/s² se
convierten una sola vez al integrar. Los impulsos se mantienen separados del motor,
se amortiguan y no desaparecen por aplicar su límite de velocidad. Predicción y replay
usan el mismo modelo para gravedad, combos y amortiguación. Los snapshots incorporan
`hazards`, metadata de movimiento y revisión de proyectiles, conservando compatibilidad
con estados antiguos. Se mantienen PvP, mutaciones, resurrección y CrazyGames SDK v3.

Los estados personales se reinician al morir; las referencias a entidades ausentes se
purgan en el siguiente tick, y las colas/mapas se liberan al destruir la sala. Los efectos de
explosión comparten una onda, tienen límite de frecuencia y respetan silencio/anuncios.
No hay un emisor nuevo por cada frame ni timers de reacción pendientes tras destruir salas.

Prueba visual aislada:

```sh
npm run preview -- --hazards
```

Crea una sala privada en la URL local. El modo de prueba adelanta una supernova, coloca
plasma cercano, concede stacks y fuerza un salto de demostración. Solo se precarga con
`--hazards`; `npm start` y Docker utilizan la configuración normal. Verificación: `npm test`.


## Suite cyber-neon y Drone Swarm Blitz

- `client/js/cyber.js`: bloom compartido de cámara (dos pasadas), aberración cromática
  transitoria, retícula de perspectiva cian/magenta y zoom amortiguado entre 1.2 y 0.75.
  Se mide densidad visible cada 100ms; la amortiguación usa delta y conserva el mismo
  resultado a 60, 120 y 144Hz. API de efectos: https://docs.phaser.io/phaser/concepts/fx.
- Los impactos críticos (vida restante <=25%) y bajas del jugador local congelan
  únicamente la presentación durante 30ms, con sacudida 0.015 durante 150ms.
  Socket.io, acumulador de predicción, envío de controles y física autoritativa siguen
  funcionando. No se detiene la escena ni se descartan milisegundos de movimiento.
- **E / botón circular ENJAMBRE**: drones a 900px/s, ataque de 3s, un impacto de 75
  por dron, recarga autoritativa de 8s y retorno con factor 0.15 por tick. Las colisiones
  usan segmentos barridos y un hash espacial de 128px. La orientación de lanzamiento
  se conserva aunque el piloto gire. **EMP se mantiene en R**, parry en F.
- `server/swarm.js` aporta 2 drones tácticos en chasis 1, 3 en chasis 2 y 4 en chasis
  3/4 (niveles de evolución 10/25/40). También lanza escoltas ganadas. Los drones de
  chasis se guardan en `tacticalDrones` para que `drones` conserve su significado de
  flota adquirida: reiniciar pierde las escoltas y revivir con anuncio conserva
  exactamente la mitad. Los objetos tácticos se reciclan en un pool limitado a 256.
- Las estelas de drones comparten un emisor con 256 partículas y presupuesto de 32
  drones visibles por actualización. Los láseres usan otro emisor compartido de 192
  partículas, evitando emisores y temporizadores por cada disparo. El audio original
  `client/assets/audio/drone_launch.wav` se sirve localmente y respeta anuncios/silencio.
- Parry refleja desde un cono frontal de 120 grados; MIRROR_SHIELD conserva reflexión
  omnidireccional. El HUD de Leviathan muestra su vida global durante la partida.

### Protocolo de red v3 y pérdida de paquetes

El servidor sigue a 30Hz. Una vez por segundo envía un keyframe v2 completo por canal
fiable. Entre keyframes transmite deltas v3 relativos a esa misma base: cambios por ID
para jugadores, chatarra, proyectiles y obstáculos, y campos modificados de las tuplas
primitivas. Cada delta contiene todas las diferencias respecto a la base; perder uno
no afecta la reconstrucción del siguiente. No se encadenan deltas volátiles.

`FleetNetwork.Decoder` conserva una sola base inmutable, verifica sala/base y solicita
`requestSnapshot` si falta. El servidor limita estas recuperaciones a dos por segundo.
Las entradas y salidas de sala limpian estados visuales y las nuevas bases reemplazan
las anteriores. Los anuncios y las mutaciones siguen con sus validaciones existentes.

Ejecutar `npm test` para las comprobaciones de predicción, Socket.io real, estados de
los drones, cooldown, daño único, muerte/resurrección, pérdida de paquetes y zoom/impactos.
`npm run preview` abre el cliente con un backend local sin cambiar `client/config.js`.
La medida de FPS del modo `?debug=1` es una observación local, no una garantía para
cualquier GPU, móvil, conexión o cantidad de jugadores en producción.

Los dominios publicados https://fleet-io-d45d5.web.app y https://fleet-io-d45d5.firebaseapp.com están autorizados explícitamente en producción. CLIENT_ORIGINS añade otros orígenes exactos; no se utiliza un comodín público.

### Idioma del cliente (EN / ES)

El primer acceso siempre carga en inglés, independientemente del idioma del navegador.
El botón neón **EN → ES / ES → EN** del menú cambia el idioma inmediatamente. La
preferencia se guarda en `localStorage` con la clave `fleetio.language`; si el
almacenamiento está bloqueado, el selector sigue funcionando durante la sesión.

Todos los textos traducibles están en `client/js/translations.js`. `client/js/i18n.js`
se carga antes del resto del cliente. Los atributos `data-i18n` traducen el HTML;
`FleetI18n.m(key, params)` y `FleetI18n.render(target, message, property)` mantienen
actualizados los textos dinámicos del DOM y de Phaser (`property: 'phaserText'`).
Los parámetros pueden contener otros mensajes traducibles, números o nombres de
jugadores. Nunca se modifica el nombre elegido, el código de sala, un ID de habilidad
ni el protocolo de red por cambiar el idioma.

Los errores conocidos del backend se traducen en el cliente, incluso si proceden de
una versión anterior del servidor en español. Las referencias a los objetos de texto
son débiles y los efectos temporales se desvinculan al finalizar. El cambio de idioma
no recarga la página ni reinicia la escena, la partida o el ciclo de anuncios.

Comprobaciones del diccionario, valores por defecto, almacenamiento, textos vivos y
mensajes del servidor: `node --test tests/i18n.test.js`.

### Contratos, Supernova Frenzy, Overdrive y Revenge

`server/engagement.js` utiliza el tick de la sala, sin intervalos adicionales. Cada
piloto recibe un contrato individual cada 90 s. Parry exige dos bajas con proyectiles
reflejados por el propio piloto; KotH suma 15 s dentro del radio existente de 400 px
alrededor de (0, 0). Ambos vencen a los 60 s. El contrato de 400 XP sin daño vence a
los 40 s y solo contabiliza recogidas de chatarra, gemas y núcleos; recibir daño o
morir lo cancela. Completar paga tres veces el coste del nivel vigente y 50 Créditos
Neón usando la moneda cosmética y sus recibos idempotentes existentes.

Supernova Frenzy tiene un calendario compartido por las salas: 180 s de descanso,
10 s de aviso y 30 s de actividad, reiniciando el descanso al acabar. Es un evento
independiente del colapso gravitatorio previo. El centro es el centro geométrico del
mapa (2000, 2000); radio 400 px, 20 gemas de 100 XP + 1 crédito cada una, 100 XP/s
para los ocupantes y radiación de 5% de HP máximo/s. Se respetan las protecciones
existentes y no se otorga XP ambiental mientras se elige una mutación. Los drops
etiquetados se limpian al terminar y las pausas del proceso no acumulan premios.

Overdrive se activa por debajo del 15% de vida: 6 s, 45 s de cooldown, velocidad
+35%, cadencia de flota/cañones x2 y cooldown de Parry a la mitad. Su duración está
incluida en el modelo de movimiento compartido y se consume durante la predicción
y el replay. El archivo WAV de activación se sintetiza localmente y se silencia
junto con el resto del juego durante anuncios.

Las skins Cyber Blue, Void Purple y Solar Flare tienen estelas eléctricas, anillos
y llamaradas generadas una vez. Space Pirate se desbloquea tras cinco bajas en una
sesión; Untouchable tras un contrato sin daño; Dominator conserva el desbloqueo
por liderar la clasificación. El título se elige en la tienda y se guarda con el
perfil cosmético local. Los IDs de skins, estelas y títulos no dependen del idioma.

La acción destacada de muerte pasa por `AdManager.showRewardedAd` y únicamente
tras `adFinished` emite `request_revenge_respawn`. El servidor valida sala/vida,
consume la muerte una sola vez, restaura el 50% de la XP y flota, e intenta un punto
libre a 400–500 px del asesino. Si no hay asesino vivo o espacio, conserva el spawn
seguro. El escudo dorado dura 3 s y permite disparar. El núcleo personal de la XP
ya restaurada se retira para impedir recuperarla dos veces. El evento antiguo de
revenge queda como alias; el respawn ordinario sigue disponible sin recompensa.

Los eventos de contratos son fiables y dirigidos al piloto. Los snapshots conservan
estado suficiente para reconstruir contrato, evento y Overdrive al entrar; los
campos nuevos se añaden al final de las tuplas para admitir clientes anteriores.
`client/js/engagement.js` reutiliza la viñeta y emisores compartidos acotados, dibuja
la zona una sola vez y actualiza el HUD a 10 Hz. Al cambiar de sala o cerrar la escena
limpia listeners, objetos y partículas. Los textos están en el diccionario EN/ES.

Comprobaciones del nuevo sistema: `node --test tests/engagement.test.js`.


### Engine stability: projectiles, FOV and dense combat

- Shared `client/js/ballistics.js` adds ship inertia (pixels per 30 Hz tick) and launches outside each chassis hitbox plus 15px. Swept authoritative collisions still prevent tunneling; reflections and portals change the projectile motion revision.
- `client/js/projectiles.js` preallocates 400 Arcade sprites. Bodies stay disabled because rendering must not apply a second collision simulation. Visuals are recycled without creating/destroying sprites during combat. Automatic weapons predict locally; owner/life/fire sequence adopts the authoritative ID, errors over 20px ease back, rejected/unconfirmed predictions expire after 350ms. Damage remains server-only.
- `UIScene` has its own zoom-1 camera above `GameScene`. It owns the low-HP/Overdrive vignette and screen announcements; resize and camera zoom events resize the overlay. Existing HTML HUD/minimap remains in the independent browser overlay. Arrow projection uses the visible world rectangle at the current FOV.
- Shared trail emitters only emit for visible ships, at intervals of at least 40ms. A reusable 25-slot timestamp quota per ship caps combined propulsion, skin and slingshot trails over their maximum 400ms lifetime. Off-screen ships produce no new particles; existing particles fade within their short lifespan. Bloom/chromatic effects suspend below a measured 50 FPS and can recover after 20 seconds above 58 FPS.
- `server/interest.js` indexes 1000px sectors. Each human socket receives its own 3x3 neighborhood of ships, lasers, scrap, obstacles, gems and impacts at 30Hz. Sector transitions and resync requests send a reliable immutable keyframe; deltas reference that baseline. Small global rankings, event/leader/core/pod/bounty markers and the pilot's nemesis marker remain available for HUD navigation. Leaving an AOI is not treated as ship destruction. Disconnected baselines and trail quotas are cleaned up.
- Defensive snapshot decoding rejects malformed packets and requests a new reliable baseline. CrazyGames lifecycle/ad hooks and EN/ES localization are preserved.

Validation: `node --test tests/engine.test.js` exercises fast/fused muzzle geometry, shot metadata, AOI transitions, invalid packets, 400-slot recycling, immediate prediction and overlay zoom/resize cleanup. These changes bound object/particle work; stable 60 FPS on every low-end GPU cannot be guaranteed without measurements on those devices.
