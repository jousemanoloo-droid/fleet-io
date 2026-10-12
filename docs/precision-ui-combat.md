# Corrección de interfaz y combate — precision-20261012

## Fallos y correcciones

1. **Menú:** Clan, Stash, Taller y Cosméticos se insertaban independientemente
   después de Single Player. `client/js/main-menu.js` mueve los botones originales
   a `#menu-quick-access`, preservando sus IDs y handlers. `client/css/main.css`
   crea cuatro tarjetas iguales en escritorio y 2×2 hasta 700 px, con estados
   de clan, volumen de Stash, recetas disponibles y skin. El volumen es la unidad
   real del inventario; no se crea un segundo límite ficticio de slots.
2. **Leaderboard:** el widget heredaba `pointer-events:none` del HUD y no tenía
   estado activo en las pestañas. `client/js/leaderboard-ui.js` y
   `client/css/leaderboard.css` restauran clics, pestañas activas, ARIA, vacíos y
   plegado con `#btn-toggle-leaderboard`. En móvil arranca plegado. El indicador
   recibe el puesto real de sala en `room:rank`; global/diario/clanes conservan
   su protocolo compacto anterior y el ranking privado no depende del culling.
3. **Cañones:** el punto de disparo se desplazaba en la dirección del enemigo,
   con un radio aproximado ajeno a la textura y escala de la nave. Ahora el
   catálogo compartido `client/js/ship-classes.js` define `gunOffsets` en píxeles
   de textura y `muzzle()` transforma offset, escala y rotación. `visuals.js`
   dibuja las puntas usando ese mapa y genera variantes por clase. Servidor
   (`server/combat.js`) y predicción (`client/js/projectiles.js`) usan el mismo
   helper. Hunter dispara desde sus dos cañones; Battleship/Carrier/Stealth desde
   el cañón de su modelo. Triple disparo comparte cañones físicos con abanico
   angular. Los drones orbitales usan su escala visible de 0,28. Los sprites de
   láser anclan la cola, no el centro, al origen del proyectil.
4. **Enjambre:** E lanzaba drones en línea recta según la orientación de la nave.
   `server/swarm.js` adquiere la nave o Boss vivo más cercano en 800 px, asigna
   `targetId` y `ATTACK_SWARM`, y dirige continuamente su velocidad con una
   anticipación limitada del movimiento del objetivo. Dura como máximo 6 s;
   cada dron impacta una vez y regresa. El cooldown sigue siendo 8 s. Sin objetivo
   se activa `DEFENSIVE_SWEEP` a 130 px del jugador. Se incluyen escoltas,
   tácticos y orbitales, con daño de Boss atribuido por el gestor autoritativo.
   `server/rpg.js` conserva la persecución autónoma normal del Carrier y evita
   reposicionar drones que participan en el enjambre.
5. **Contador:** el HUD contaba solo `player.drones`, mientras dibujaba también
   tácticos y orbitales. `server/droneCounts.js` define el número activo de la
   flota visible completa. Snapshots incluyen `activeDroneCount` y revisión;
   `drones:count-update` envía inmediatamente los cambios al dueño junto a sus
   drones, sin difusión global. El cliente descarta otras salas/vidas/revisiones
   y evita restaurar drones con un snapshot anterior. `client/js/hud-ui.js`
   actualiza `#escort-drones-count`, conservando `#hud-drones` para efectos
   existentes. Se retira el divisor 12 porque ese límite solo era de escoltas
   ganadas, no del total visible con drones tácticos y orbitales.

## Otros ajustes derivados de la revisión

El adaptador de CrazyGames se ejecuta después de existir `document.body`;
el SDK v3 oficial permanece en `<head>`. Esto evita la excepción de su
inicialización al intentar insertar nodos antes de existir el cuerpo. Se
conservan loadingStart/loadingStop, gameplay y anuncios. La cuenta inicial
actualiza también las tarjetas del menú sin esperar a entrar en una partida.
El indicador opcional de depuración muestra snapshots a 20 Hz, coherente con
la simulación autoritativa de 30 Hz. `/version` permite verificar el despliegue.

## Archivos principales

| Área | Archivos |
| --- | --- |
| Inicio | `client/index.html`, `client/css/main.css`, `client/js/main-menu.js`, `client/js/features.js` |
| Ranking | `client/js/leaderboard-ui.js`, `client/css/leaderboard.css`, `server/gameLoop.js` |
| Disparos | `client/js/ship-classes.js`, `client/js/ballistics.js`, `client/js/visuals.js`, `client/js/projectiles.js`, `server/combat.js` |
| Drones | `server/swarm.js`, `server/rpg.js`, `server/droneCounts.js`, `server/entities.js`, `client/js/network.js`, `client/js/cyber.js` |
| HUD/vida | `client/js/hud-ui.js`, `client/js/game-scene.js` |
| Textos | `client/js/translations.js` |
| QA | `tests/precision.test.js`, fixtures actualizadas de cámara, motor, rankings y enjambre |

El esquema de snapshots añade campos al final de la fila del jugador, con
fallback para filas antiguas. No se autoriza movimiento, daño ni propiedad de
objetos desde el cliente. No se cambia CORS, secretos, catálogo de materiales,
transacciones de Stash ni configuración de almacenamiento. Los listener nuevos
se eliminan al apagar la escena; los gráficos y botones conservan sus propietarios.

## Validación y publicación

`npm test`: suite completa de HTTP/WebSocket, SDK, economía, clases, extracción
y combate, más pruebas nuevas de offsets, homing, Boss, barrido defensivo,
conteo de drones, pestañas y conservación de botones. También se revisa en
navegador el menú a 390 y 1440 px, modales, selección de categorías y plegado.
El registro se guarda en `artifacts/precision-tests.txt`.

La publicación usa el repositorio ya conectado a Render y Firebase Hosting
del proyecto `fleet-io-d45d5`. El nuevo cliente carga assets con versión
`precision-20261012`; la versión del backend se comprueba en `/version`.
El despliegue reúne las fases locales pendientes necesarias para mantener
consistentes servidor y cliente. No incluye `.env`, datos de cuentas ni
archivos de credenciales en Git o en el paquete de código.

Las comprobaciones de navegador verifican los flujos recorridos; no garantizan
ausencia universal de errores en todos los dispositivos ni certifican anuncios
reales fuera del portal. La fabricación/extracción persistente sigue requiriendo
`ECONOMY_SECRET` estable y `ECONOMY_FILE` sobre disco persistente configurado.
