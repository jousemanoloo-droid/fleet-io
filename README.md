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
│   ├── game.js         # Lógica Phaser: input, render, interpolación
│   ├── config.js       # URL pública del backend
│   └── monetization.js # Adaptador de anuncios recompensados
├── server/
│   ├── server.js       # Express + Socket.io (entrypoint)
│   ├── gameLoop.js     # Bucle autoritativo 30 TPS
│   ├── entities.js     # Clases: Player, Drone, Scrap, WORLD
│   ├── roomManager.js  # Matchmaking, códigos y ciclo de vida
│   ├── gameRoom.js     # Mundo aislado y colecciones Map
│   ├── bot.js          # FSM y steering de bots
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
[Cliente Phaser 60FPS]
        │  playerMove (throttled ~30Hz)
        ▼
[Socket.io WebSocket]
        │
        ▼
[Servidor: 30 TPS autoritativo]
  ├─ player.update()        (inercia, movimiento)
  ├─ scrap.update()
  ├─ checkScrapCollection() (radio absorb)
  └─ maybeSpawnScrap()
        │  gameState snapshot (volatile, ~15Hz)
        ▼
[Cliente: interpolación 100ms buffer]
  └─ render 60FPS (Phaser RAF)
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
| Ping alto o jugadores "tartan"   | Reduce `INTERP_BUFFER_MS` en [client/game.js](client/game.js#L12)  |
| No carga Phaser / Socket.io CDN  | Comprueba conexión a internet o reemplaza CDN por archivos locales.|

## Anuncios recompensados y resurrección

`client/index.html` carga el SDK v3 oficial de CrazyGames y
`client/monetization.js` expone `window.AdManager`. El arranque espera `SDK.init()`:
en el entorno `crazygames` usa anuncios reales; en localhost, fuera del portal o
sin SDK activa una simulación cancelable de tres segundos. Un fallo de
inicialización identificado dentro del portal no concede recompensas simuladas.
`showRewardedAd(onSuccess, onFailure)` recompensa únicamente una finalización;
`showInterstitialAd(callback)` solicita un anuncio `midgame`, devuelve una promesa
booleana y llama a `callback(completed, error)` sin conceder recompensas.
No se muestran interstitials automáticamente al morir.

El adaptador nativo solicita `rewarded` y recompensa solo desde `adFinished`.
`adStarted` pausa la escena y silencia su audio; finalización o error restauran
el estado anterior. `gameplayStart` y `gameplayStop` reflejan entrada efectiva,
muerte, resurrección confirmada, menú, desconexión y selección de mutaciones.
El canvas usa Phaser RESIZE y ResizeObserver para adaptarse al iframe sin estirar
las naves. No hay controles propios de pantalla completa.

Para usar otro proveedor, usar `AdManager.setAdapter(adapter)` con los métodos
`showRewardedAd()` y `showInterstitialAd()`. Ambos deben devolver `Promise<boolean>`;
el wrapper del SDK resuelve `true` al completar y `false` al cancelar o no disponer
de anuncios. Los anuncios display de AdSense no sirven por sí solos como rewarded ads.
Antes de usar recompensas reales, añadir validación del comprobante del proveedor
en `handleRespawn` del servidor: el modo demo confía en la finalización del cliente.

El servidor conserva una captura de puntuación, chatarra y número de escoltas al
morir. Cada `deathId` admite una sola resurrección: la recompensada conserva el 50%
de esos tres valores, redondeado hacia abajo, y las mutaciones; el reinicio gratuito
restablece la progresión y la flota. Ambos restauran toda la vida y buscan una
posición separada de los enemigos. `takeDamage(amount)` respeta tres segundos de
protección tras resurgir. El cliente detiene el envío de movimientos durante la
muerte y el anuncio, y espera el estado autoritativo para cerrar el modal.

Las escoltas disparan automáticamente a enemigos cercanos. Los proyectiles usan
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
proyectiles, y su propio intervalo a 30 TPS. Los snapshots a 15 Hz incluyen `roomId`,
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
- El sistema de anuncios continúa en modo demo; activar monetización real requiere
  integrar y validar las recompensas del proveedor, como se indica arriba.

## Licencia
MIT
