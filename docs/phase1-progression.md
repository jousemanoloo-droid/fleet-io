# FASE 1: progresión y clases por partida

Los cambios están integrados en el proyecto. Publicar cliente y servidor juntos:
el protocolo conserva los campos antiguos y añade atributos y clase al bloque RPG.

## Archivos y conexiones

- `client/js/progression.js`: curva de XP creciente, 3 puntos por nivel, límite 60.
- `client/js/ship-classes.js`: catálogo inmutable compartido entre navegador y Node.
- `server/shipClasses.js`: hitos 10/25/45, selección validada, modifiers sin acumular,
  regeneración a delta fijo, fecha de autoelección, restauración tras muerte.
- `server/rpg.js`: cinco upgrades (velocidad, cadencia, daño, regeneración y visión),
  daño/cooldown por clase, camuflaje y metadatos. El antiguo atributo `shield` se
  acepta por compatibilidad de protocolo pero no se ofrece en la nueva UI.
- `server/entities.js`: inicialización, tick a 30Hz, muerte y respawn. Los upgrades
  pertenecen a la partida: el reinicio gratuito los elimina; rewarded conserva
  atributos y recalcula la clase alcanzable con el 50% de XP retenido.
- `server/server.js`: `chooseShipClass` y los eventos existentes de atributos/habilidades.
- `server/combat.js`: Hunter doble, Battleship splash, drones Carrier y bloqueo del
  auto-disparo/auto-apuntado durante camuflaje. El splash afecta a otros jugadores
  en 120px con caída lineal y respeta sus protecciones; no daña al dueño.
- `server/interest.js` / `server/gameLoop.js`: radar amplía AOI a un máximo de 5×5
  celdas. La caché distingue el alcance de pilotos en una misma celda.
- `client/js/network.js`: añade regen/vision y el bloque clase/rango/elección/camuflaje.
  Solo transmite duraciones restantes, no exige relojes de cliente sincronizados.
- `client/js/movement.js` / `player.js`: selección detiene el modelo compartido y
  se reconcilia con `motionRevision` al cambiar de clase.
- `client/js/class-ui.js`: modal de cuatro opciones, propiedad de GameScene. Evita
  crear listeners globales o intervalos y descarta respuestas de salas/vidas cerradas.
- `client/js/game-scene.js`: construye ClassUI, llama sync tras estado autoritativo,
  bloquea controles y actualiza textura/tamaño/translucidez. No pausa los snapshots.
- `client/js/features.js`: cinco atributos y habilidad C / botón táctil de camuflaje.
- `client/js/cyber.js`: cámara con +5% campo visible por punto de visión (máximo +50%).
- `client/js/projectiles.js`: predicción de cañones acorde al catálogo compartido.
- `client/index.html`: carga catálogo y ClassUI antes de la escena.
- `client/js/translations.js`: todo texto nuevo en EN/ES, inglés por defecto.

## Contrato de elección

```js
socket.timeout(8000).emit('chooseShipClass', {
  roomId, deathId, milestone: 10, classId: 'hunter'
}, (error, result) => {
  // Solo utilizar result.player si la sala y vida siguen siendo las mismas.
});
```

`milestone` es el hito pendiente confirmado por el servidor, no el nivel del
cliente. Se rechazan IDs inexistentes, prototipos, niveles inválidos, elecciones
duplicadas, muerte o sala antigua. No hay optimismo en compras ni selección.

## Balance y ciclo de vida

| Clase | Velocidad | HP/escudo | Armas |
|---|---:|---:|---|
| Hunter | ×1,30 | ×0,80 | Doble láser, cooldown ×0,70 |
| Battleship | ×0,75 | ×2,50 | Daño ×2,20, cooldown ×1,60, splash 120px |
| Carrier | ×0,90 | ×1,15 | 3/4/5 drones de persecución, según evolución |
| Stealth | ×1,10 | ×1,00 | Camuflaje translúcido 4s, cooldown 12s; no dispara |

La regeneración usa la integridad HP/escudo existente: 2 HP/s base, +2 HP/s por
punto, después de 3 segundos sin daño, sin exceder maxHp. Cadencia y daño conservan
los bonos anteriores. Velocidad añade 15px/s por punto, multiplicados por la clase.

La elección inmoviliza y protege solo esa nave, durante un máximo de 20 segundos;
el mundo y la conexión siguen activos. Después se elige la clase actual o Hunter.
Bots usan el mismo validador y eligen automáticamente. Cruces de varios hitos se
resuelven en orden. Mutaciones cada 10 niveles siguen siendo un sistema independiente.

El cliente cierra el modal y libera sus bindings de traducción al morir, salir de
sala o cerrar escena. Los callbacks capturan una generación para ignorar respuestas
tardías. Los drones reutilizan sus objetos; cambios de clase y muerte los liberan.
No se crean temporizadores por jugador para clases, camuflaje o regeneración:
sus expiraciones se evalúan en el tick autoritativo.

CrazyGames `gameplayStop` refleja el modal; `gameplayStart` vuelve cuando ya no hay
pantallas que bloqueen la partida. Se mantienen los callbacks de anuncios existentes.

## Comprobaciones

`tests/ship-classes.test.js` verifica selección/replay/caps, física detenida,
autoelección, camuflaje, splash, identidad estable de drones, roundtrip de snapshots,
respawn y 100 ciclos de UI sin acumular nodos ni bindings. El test del servidor
Socket.io también envía sala/vida/hito/IDs inválidos y elecciones repetidas.
Son pruebas de lógica controladas; no sustituyen mediciones de memoria del navegador
durante sesiones largas ni pruebas de carga con jugadores reales.
