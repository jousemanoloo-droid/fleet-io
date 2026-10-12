# Extraction Space — Fase 3: puertas y canalización

La [Fase 4](extraction-space-phase4.md) añade el propulsor permanente que reduce
el canal a tres segundos; cuatro sigue siendo el valor por defecto.

Implementada en la estructura existente (`server/server.js`, `server/gameLoop.js`
y `client/js/game-scene.js`). No hay que crear un segundo servidor o escena.

## Archivos e integración

| Archivo | Responsabilidad |
| --- | --- |
| `server/extractionGates.js` | Calendario por sala, aparición, caducidad, posiciones y radio. |
| `server/playerExtraction.js` | Máquina de estados autoritativa de canalización, cancelación y finalización. |
| `server/gameRoom.js` | Crea ambos gestores; libera canales, portales y referencias al abandonar/destruir la sala. |
| `server/gameLoop.js` | Actualiza puertas y canales después del movimiento, combate, jefes y progresión, a 30 Hz. |
| `server/entities.js` | Cancela al recibir daño real o morir. |
| `server/server.js` | Vincula cada jugador al depósito existente y al callback de evacuación de Socket.io. |
| `client/js/extraction-hud.js` | Anillos, partículas, radar direccional, progreso, cancelación y victoria. |
| `client/js/game-scene.js` | Crea/destruye HUD y vuelve al menú tras una victoria confirmada. |
| `client/js/translations.js`, `client/features.css`, `client/index.html` | Textos EN/ES, estética y carga del módulo antes de la escena. |
| `tests/extraction-gates.test.js` | Pruebas del calendario, riesgo, persistencia, aislamiento, evacuación y limpieza. |

`GameRoom` crea `ExtractionGates` y `PlayerExtraction`. En el ingreso autorizado,
después de `room.extraction.attach(...)`, el servidor registra
`room.playerExtraction.attach(player, onSuccess)`. El callback observa el cierre
de la partida, emite la victoria privada y llama a `roomManager.leave(socket)`.
La salida libera también los proyectiles propios y la membresía de Socket.io;
una sala individual se elimina inmediatamente y una privada vacía sigue el
calendario de limpieza existente.

El cliente carga `extraction-hud.js` después de `stash-ui.js` y antes de
`game-scene.js`. La escena crea el HUD con `(scene, C)` y llama a `update(now)`
cada frame. Todas las suscripciones son propias del componente y se retiran
con `socket.off(event, handler)` en `shutdown`, sin borrar listeners ajenos.
No hay pasos manuales de integración pendientes.

## Reglas y ajustes

- Cada **120–240 segundos** por sala aparecen **1–2** puertas, si hay ubicaciones
  válidas. Su radio es **120 px** y duran **45 segundos**. Se evita ubicarlas
  dentro de asteroides o a menos de 800 px entre sí; la búsqueda tiene 32 intentos.
- La entrada del centro de una nave viva con carga comienza automáticamente
  **4 segundos** de canalización. Puede moverse mientras permanezca dentro.
  Con carga vacía no se inicia una extracción innecesaria.
- Todo daño aceptado cancela, incluido daño ambiental; impactos bloqueados por
  protección no cuentan como daño. Salir, colapsar la puerta, morir, seleccionar
  una evolución, cambiar de sala o teletransportarse también interrumpe.
- Después de daño/cancelación hay 1 segundo de espera para reintentar. Un fallo
  del depósito aplica 2 segundos antes del siguiente intento automático.
- El tiempo avanza por pasos de simulación, con máximo 1/30 s por actualización.
  Una pausa del servidor superior a 250 ms cancela; un salto de reloj o un tick
  tardío nunca sustituye cuatro segundos de validaciones de combate.
- Para cambiar tiempos/radio: `ExtractionGates.interval()`, `GATE_LIFETIME`,
  `GATE_RADIUS` y `CHANNEL_MS`. Si cambia el radio o duración, actualizar las
  validaciones correspondientes del HUD; el contrato actual es deliberadamente
  estricto.

Los Jump Gates de extracción son independientes de los wormholes de movilidad
ya existentes: no sustituyen ni modifican sus teletransportes.

## Red, autoridad y transacción

| Evento servidor → cliente | Uso |
| --- | --- |
| `extraction:opened` | Aviso del sector a los participantes de esa sala. |
| `extraction:gates` | Lista de hasta dos puertas con tiempo restante; al entrar y cada 2 s. |
| `extraction:progress` | Estado privado de canalización, inicio y hasta 5 actualizaciones/s. |
| `extraction:cancelled` | Motivo de interrupción o fallo al guardar. |
| `extraction:success` | Única confirmación de depósito y evacuación, con materiales extraídos. |

Los eventos privados llevan `roomId`, `playerId`, `deathId`, `motionRevision` y
una `revision` creciente. El HUD descarta identidades y versiones antiguas.
Los portales se transmiten como marcadores globales de sala, no como objetos
completos a 20 Hz; eso permite indicar su dirección aunque estén fuera de visión.
Los anillos y partículas se ocultan fuera de pantalla y el radar se actualiza a
10 Hz. Máximos visuales: dos gráficos reutilizables y 48 partículas vivas.

**No existe RPC cliente de finalización, recompensa ni depósito.** Un navegador
modificado que emita `extraction:success`, `completeExtraction` o
`requestExtraction` no ejecuta ninguna transacción. La finalización solo nace
del estado físico comprobado por `PlayerExtraction.update()`.

Tras el último tick válido, `completeExtraction(player)` vuelve a comprobar
carga, capacidad y Stash, realiza la escritura durable y solo entonces vacía
`inRunInventory`. Un error de disco o Stash lleno conserva la carga y la nave.
El servidor evacua después del commit y no llama a `die()` ni otorga una segunda
recompensa en créditos: siguen concediéndose al vender los materiales.

## Persistencia y publicación

La extracción real necesita `ECONOMY_SECRET` estable y `ECONOMY_FILE` en un
volumen persistente y escribible del backend. Por ejemplo, en Render con disco
montado: `ECONOMY_FILE=/var/data/fleet/economy.json`. Sin almacenamiento durable
la extracción falla explícitamente y mantiene el botín a bordo.

La solución conserva la autoridad por proceso del proyecto: varios procesos
que compartan un archivo JSON no proporcionan transacciones distribuidas.
Para escalar a varias instancias hace falta sustituir el almacén por una base
de datos transaccional y coordinar las salas.

CrazyGames mantiene su cargador y flujo de anuncios. La victoria invoca
`gameplayStop()` y vuelve al menú; la siguiente entrada usa el `gameplayStart()`
existente. No se solicita un anuncio ni se usa un callback publicitario para
determinar la extracción. No se cambian el login, el catálogo de recursos o los
códigos de salas privadas.

Estos archivos están aplicados en el proyecto local; esta solicitud no publica
la versión. Los sufijos de assets de `index.html` se actualizan para evitar
mezclar módulos antiguos y nuevos al desplegar.

## Validación

Ejecutar `npm test` para la suite completa. Las nuevas pruebas incluyen el
impacto en el último tick, caducidad, salida del círculo, muerte, teletransporte,
evolución, interrupción de simulación, guardado/relectura en disco, Stash lleno,
ausencia de persistencia, membresía real del gestor de salas y destrucción de una
sala individual dentro del tick. El HUD se somete a 100 reemplazos de portales
sin crecer por encima de dos gráficos y libera listeners, traducciones y efectos.

Los tests de objetos Phaser emplean dobles del motor: no certifican rendimiento
GPU, 60 FPS ni anuncios/login reales del portal en un navegador de producción.

Resultado de la suite completa tras integrar Fase 3: **219/219 pruebas aprobadas**,
con 16 pruebas nuevas. Registro: `artifacts/extraction-phase3-tests.txt`.
