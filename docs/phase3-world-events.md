# FASE 3: entorno vivo autoritativo

## Archivos

| Archivo | Responsabilidad |
|---|---|
| server/bossManager.js | Calendario aleatorio 180–300 segundos, spawn, combate, ledger de daño y eliminación de proyectiles |
| server/environmentEvents.js | Agujero negro, radiación, fuerza/daño en Node y caducidad |
| server/powerups.js | Orbes, límite global, recogida única, buffs y expiración |
| client/js/powerup-ui.js | Pools de imágenes/Graphics, partículas compartidas y contadores de buffs |
| server/gameRoom.js | Construcción y destrucción de gestores por sala |
| server/gameLoop.js | Tick de gestores y filtrado de snapshots por sectores |
| client/js/network.js | Metadatos de buffs, deltas de zonas/orbes y validación de paquetes |
| server/rpg.js / client/js/movement.js | Overclock y sincronización de velocidad/predicción |
| server/entities.js / server/shipClasses.js | Inmunidad central, limpieza al morir y bloqueo de regeneración |
| server/combat.js / client/js/ship-classes.js | Triple disparo autoritativo y patrón predictivo compartido |
| client/js/cyber.js | Reducción visual de campo en radiación |
| client/js/game-scene.js | Construcción, snapshot y update de PowerupUI |
| server/worldEvents.js | Fachada compatible del jefe y drops de asteroides grandes |

El servidor existente entra por `server/server.js`. Se incluye `server/index.js`
como alias (`require('./server')`) para arrancar con `node server/index.js` sin
crear un segundo servidor. Docker/Render pueden seguir usando server/server.js.

## Integración del bucle

GameRoom crea Powerups y EnvironmentEvents. WorldEvents crea BossManager y conserva
sus métodos bossHit/spawnBoss para compatibilidad con combate, hazards y retención.
El tick de 30Hz evalúa ambiente y recogida antes de actualizar jugadores/combate.
BossManager actualiza desde WorldEvents.update. El cierre de sala detiene el tick,
destruye gestores y vacía sus mapas. Ningún gestor nuevo crea intervalos o timers.

En cliente, index.html carga powerup-ui.js antes de game-scene.js. GameScene.create
construye PowerupUI después de Retention (que genera energy-core). Tras decodificar
un snapshot llama PowerupUI.snapshot; update(now, delta) interpola y dibuja. No
envía solicitudes de recogida, daño, fuerza ni concesión de buffs. Los listeners
welcome/disconnect se retiran en shutdown y los objetos vuelven al pool al salir
de la zona de interés. El código de anuncios y de loading no se modifica.

## Balance

- Jefe: 12000 HP, radio 100px, aparición aleatoria dentro del mapa cada 3–5 minutos.
  Patrulla o persigue jugadores cercanos y lanza 24 proyectiles radiales cada 3s.
  Caduca a los 180s. Comparte el límite de 240 proyectiles de la sala.
- Al derrotarlo: 6000 XP y 3000 créditos proporcionales al daño efectivo, mediante
  reparto entero de restos mayores; además 4000 XP/2000 créditos físicos en gemas
  y tres power-ups. Contribuyentes muertos conservan XP pendiente hasta respawn.
  Desconectados se retiran del ledger. Los créditos usan los recibos de la Fase 2.
  El reparto se realiza por jugador: no se introduce un sistema de clanes nuevo.
- Agujero negro: radio 450px, duración 30s, aceleración limitada 80–900px/s² y
  daño central de 35 HP/s a 75px o menos. Fuerza y daño son exclusivamente Node.
- Radiación: radio 550px, duración 30s, bloquea regeneración y reduce el campo
  visual. El servidor también limita el alcance de red de pilotos afectados.
- Orbes: máximo 24, duran 45s, spawn inicial 15s y después cada 20s. Asteroides
  dorados/grandes y jefes también producen drops.
- SHIELD: inmunidad total de HP durante 5s mediante Player.takeDamage central.
- OVERCLOCK: velocidad y cadencia ×1,5 durante 8s, con predicción compartida.
- TRIPLE: patrón de tres cañones durante 8s. No acumula stacks; recoger de nuevo
  refresca la duración. Morir elimina los tres buffs.

## Red y trabajo visual

Zonas: [id,x,y,radius,type,remaining]. Orbes: [id,x,y,type,remaining]. Duraciones de
objetos se cuantizan a segundos, no se transmiten timestamps de Node al navegador.
Las filas se incluyen en los deltas relativos a un keyframe fiable, por lo que
perder un delta intermedio no cambia la reconstrucción del siguiente.

El filtrado usa el área de interés existente (3×3 sectores o 5×5 con radar),
incluyendo radio de zonas que cruzan un borde. Es culling por proximidad, no una
prueba exacta de cada píxel del viewport. La barra del jefe y su aviso son globales
por sala, una excepción necesaria para que todos sepan su salud y aparición.

El cliente mantiene pools acotados (hasta 48 imágenes/6 Graphics al sustituir
completamente una tanda), un emisor compartido de máximo 48 partículas y HUD
actualizado a 4Hz. Los círculos se dibujan al crear la zona, no por frame.
Cuando el jefe muere/caduca se eliminan incluso los proyectiles reflejados que
conserven sourceId del jefe. Al cerrar escena se destruyen pools, emisor y HUD.

## Validación y entrega

tests/phase3.test.js cubre calendario, spawn, expiración, overkill/NaN, reparto,
recogida única, inmunidad, cadencia/velocidad/triple, radiación y atracción,
deltas con paquetes perdidos, límites y 50 tandas de UI sin acumular recursos.
La suite de lógica completa conserva las verificaciones de las Fases 1 y 2.

Publicar cliente y servidor juntos para activar el protocolo ampliado. Estos
cambios están en el proyecto y no se despliegan automáticamente en esta fase.
Las pruebas controladas no garantizan 60 FPS en todos los dispositivos ni
reemplazan mediciones de memoria, ancho de banda y carga con partidas reales.
