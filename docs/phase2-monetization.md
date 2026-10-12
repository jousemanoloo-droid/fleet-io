# FASE 2: Créditos Estelares, garaje y retención diaria

> Actualización del 12/10/2026: la UI usa ahora el wallet autoritativo del servidor
> para saldo, compras, misiones, racha y tickets de anuncios. SDK.data/localStorage
> conservan el token de huésped, no deciden el saldo. Las explicaciones locales de
> esta guía describen la implementación anterior y se mantienen como historial.
> Véase [auditoría e integración actual](audit-20261012.md), especialmente la
> configuración de secreto/disco y la limitación de verificación real de anuncios.

## Código por archivo

- `client/js/economy.js`: wallet, compras/equipamiento, guardado validado, migración,
  recibos idempotentes, créditos de juego, reloj UTC y reserva de anuncios.
- `client/js/garage-ui.js`: panel de tienda, cuatro categorías, misiones, racha,
  tarjeta de bienvenida no bloqueante y botón +500 créditos. Propiedad de Features;
  elimina UI y bindings de traducción al cerrar/destruir, sin intervalos globales.
- `client/js/daily-quests.js`: reglas puras de misiones y racha, compartibles con Node.
- `server/cosmetics.js`: IDs permitidos y colores autoritativos de láser.
- `server/server.js`: evento getServerTime, cosméticos en spawn y cambios de loadout.
- `server/rpg.js`, `client/js/network.js`: sessionKills y laserStyle en snapshots.
- `server/combat.js`, `client/js/projectiles.js`: estilos de disparos autoritativos y
  predichos (incluido arcoíris), sin alterar daño o atributos de combate.
- `client/js/features.js`: delega la tienda al garaje, recoge estadísticas una vez
  por segundo y el último tramo al morir/salir, sincroniza hora cada minuto.
- `client/js/game-scene.js`: solicita hora tras conectar y envía el loadout al entrar.
- `client/js/translations.js`, `client/features.css`, `client/index.html`: EN/ES y UI.

## Orden de scripts en index.html

Después de renderer y antes de features:

```html
<script src="js/daily-quests.js?v=phase2"></script>
<script src="js/economy.js?v=phase2"></script>
<script src="js/garage-ui.js?v=phase2"></script>
<script src="js/features.js?v=phase2"></script>
```

El menú principal mantiene su acceso a la tienda; Features.shop() abre GarageUI.
Features.begin() crea el baseline de estadísticas de la vida. Features.sync()
entrega estadísticas autoritativas de kills, tiempo y score; sus watermarks
impiden recompensar otra vez el mismo snapshot, tras recargar o tras respawn.
El antiguo bonus de score al cerrar la partida ya no se añade en el nuevo garaje.
Los premios existentes de eventos siguen usando sus recibos separados.

## Economía

50 créditos por nave destruida, 1 por segundo sobrevivido. Skins, trails, láseres
y efectos solo son cosméticos. Compras descuentan una vez y solo equipan artículos
poseídos. Starlight está bloqueada para compra y se desbloquea al completar día 7.
IDs y metadatos desconocidos, saldos negativos/no enteros, JSON inválido y guardados
demasiado grandes se rechazan. Sin almacenamiento se mantiene una sesión en memoria
y se informa en el garaje. Ledgers y conjuntos de inventario son acotados.

Fuera del portal se usa localStorage. En CrazyGames, Economy usa SDK.data como
única fuente de guardado, después de la inicialización existente de AdManager.
Solo migra un guardado local antiguo si no existe ya un guardado de cuenta; nunca
suma dos saldos. El SDK gestiona huéspedes y sincronización de usuarios conectados.

**Configurar en el Developer Portal:** Progress Save → “Yes, using the Data Module
from the CrazyGames SDK”. Sin esa opción la plataforma puede deshabilitar el módulo
de datos. Los errores se manejan sin impedir jugar; no se promete persistencia
de cuenta cuando el módulo está deshabilitado.

Referencia: https://docs.crazygames.com/sdk/data/

## Rewarded del garaje

```js
await window.AdManager.showRewardedAd(
  () => economy.rewardAd(receiptId), // Solo adFinished llama a esta función.
  () => showFriendlyFailure()
);
```

El garaje reserva el intento antes de solicitarlo y permite solo uno en curso.
Cooldown visual de 30 segundos también en cancelación/error; al completar, son
30 segundos desde la finalización. Recibo único: jamás se suman +500 dos veces.
La moneda se concede únicamente en el callback de éxito del AdManager; ninguna
resolución de requestAd por sí sola concede la recompensa. Al fallar se libera el
estado pendiente y se puede cerrar la tienda. El SDK puede imponer una espera mayor.

Se conservan los hooks existentes de silencio/pausa/restauración y los límites de
simulación a localhost. El botón requiere SDK disponible y hora del servidor; no
simula anuncios en Firebase o en CrazyGames si el SDK falla.

Referencia: https://docs.crazygames.com/sdk/video-ads/

## Misiones, racha y hora

3 misiones distintas por día UTC, seleccionadas de un pool por semilla de perfil
y fecha (no cambian al recargar). Destruir 10 naves, ganar 2000 puntos, sobrevivir
180 segundos o jugar Hunter/Carrier/Stealth. El jugador reclama la recompensa de
cada misión completada una sola vez desde el garaje.

Los días consecutivos se cuentan al reclamar la recompensa: 100, 150, 200, 250,
300, 400 créditos y Starlight el séptimo día. Tras día 7 el ciclo vuelve a día 1;
perder un día reinicia la racha. La tarjeta de bienvenida no tapa Play ni bloquea
el menú: el usuario puede abrir el garaje o posponerla.

getServerTime devuelve Date.now() del servidor. El cliente avanza esa muestra con
performance.now(), sin usar el reloj local para reclamar recompensas. Cambiar
zona horaria o adelantar Date.now() en el dispositivo no adelanta los días. Sin
hora confiable no se conceden rachas ni misiones. No se esperan estas solicitudes
para completar loadingStart/loadingStop ni para entrar a una partida.

## Spawn y multijugador

```js
socket.emit('joinRoom', {
  name, roomCode,
  cosmetics: { skin: 'gold', trail: 'purple', laser: 'green' }
}, callback);
```

El servidor aplica cosméticos antes de welcome/respawned. Cambiar equipamiento
envía setCosmetics durante la partida. Skins/trails/laserStyle aparecen en los
snapshots de todos los jugadores; los proyectiles llevan el color del estilo.
El servidor valida el catálogo pero no verifica propiedad de un inventario local.

## Límites y validación

Esta es una economía cosmética local / SDK.data; no hay aún cuentas autenticadas
ni base de datos de economía en el backend. La hora del servidor evita trampas de
reloj, pero localStorage/SDK.data y JavaScript pueden modificarse por un cliente
alterado. Para seguridad contra manipulación directa se necesita una wallet
autoritativa ligada a una cuenta validada y persistencia transaccional en backend;
el SDK de anuncios no proporciona aquí una prueba de visionado verificable por
el servidor. No se presenta este guardado como una economía resistente a hackers.

tests/phase2.test.js cubre UTC/cambios de hora, día 7, huecos de racha, misiones,
recompensas idempotentes, cooldown de éxitos/fallos, datos corruptos, SDK.data,
cosméticos y fallos de anuncios. Las pruebas SDK controladas no verifican anuncios
reales ni sincronización entre dispositivos en una cuenta real del portal.

Actualizar cliente y backend juntos. Estas modificaciones quedan en el proyecto;
esta fase no incluye publicar automáticamente en Firebase, Render o CrazyGames.
