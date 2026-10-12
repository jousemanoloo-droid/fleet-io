# Extraction Space — Fase 1: inventario de incursión y stash seguro

> Actualización: [Fase 2](extraction-space-phase2.md) sustituye los IDs y límites
> de carga de esta guía histórica y migra automáticamente los materiales guardados.

La implementación está aplicada en el proyecto. No cambia los créditos ganados,
los anuncios y sus callbacks, el combate, los power-ups instantáneos, los premios
del jefe, las clases, los clanes ni los rankings. Los materiales son un sistema
adicional, separado de chatarra, XP y Créditos Estelares.

## Archivos y responsabilidades

| Archivo | Integración |
|---|---|
| `client/js/extraction-rules.js` | Catálogo, pesos, capacidades y validación estricta compartida con Node. No concede recursos. |
| `server/extractionInventory.js` | Un gestor por sala: carga volátil, recogida, drops, pérdida, API interna de extracción y limpieza. |
| `server/accounts.js` | Stash en el wallet autoritativo, migración de perfiles antiguos, ampliación pagada y commit persistente. |
| `server/entities.js` | Vacía carga al morir y en todo respawn, incluido rewarded; emite el desglose antes de limpiarlo. |
| `server/gameRoom.js` | Crea/destruye el gestor y aplica pérdida por abandono al salir o cambiar de sala. |
| `server/gameLoop.js` | Actualiza recogida desde el tick, empaqueta drops y aplica culling/deltas. |
| `server/worldEvents.js`, `bossManager.js`, `hazards.js` | Drops nuevos de asteroides, jefe y asteroides volátiles. Premios anteriores se conservan. |
| `server/shipClasses.js` | Rechaza evoluciones con capacidad insuficiente y evita que el timeout deje bloqueada la elección. |
| `server/server.js` | Vincula actor y wallet, publica el HUD privado y ofrece lectura de inventario. No acepta importaciones ni depósitos del cliente. |
| `client/js/network.js` | Añade `resources` al protocolo existente de deltas, valida IDs/cantidades y conserva baselines. |
| `client/js/economy.js` | Valida el stash recibido del backend; rechaza datos inválidos sin sobrescribir el último estado válido. |
| `client/js/stash-ui.js` | Panel del menú/garaje, capacidad, iconos, advertencias, HUD, resumen de pérdida y pool de drops. |
| `client/js/features.js`, `garage-ui.js`, `game-scene.js` | Accesos, actualización del estado y bloqueo de entrada mientras el panel está abierto. |
| `client/index.html`, `features.css`, `translations.js` | Orden de scripts, diseño responsive Cyber-Neon y textos EN/ES. Inglés continúa como idioma inicial. |
| `tests/extraction.test.js`, `room-network.test.js` | Transacciones, límites, corrupción, muerte, aislamiento, paquetes falsificados y limpieza. |

Los comentarios del código documentan las fronteras de autoridad, transacciones,
suscripciones y puntos donde se debe integrar la siguiente fase.

## Esquema y balance inicial

```js
player.inRunInventory = { titanium: 14, plasma_core: 2 };
// Propiedad del servidor: estas cantidades pesan 24 unidades.

player.secureStash = {
  capacity: 200,
  items: { titanium: 30, alien_relig: 1 },
  revision: 1
};
// En un actor conectado, secureStash es un getter del wallet, no una copia local.
```

| Recurso | Peso por unidad |
|---|---:|
| `titanium` | 1 |
| `plasma_core` | 5 |
| `alien_relig` | 10 |

`alien_relig` conserva exactamente el ID solicitado. El nombre visible es
“Alien Relic” / “Reliquia Alienígena”. No se crean aliases que permitan contar
dos veces un mismo material.

| Nave | Capacidad de carga |
|---|---:|
| Inicial | 80 |
| Hunter | 40 |
| Battleship | 160 |
| Carrier | 120 |
| Stealth | 60 |

El stash empieza con capacidad 200 y se amplía de 100 en 100 hasta 2.000. El
precio es `1000 + (capacidadActual - 200) * 5` Créditos Estelares; lo decide el
servidor. Modificar precio, capacidad o contenido en la solicitud no tiene efecto.
Esta compra amplía capacidad; nunca añade materiales.

Se exige tipo de recurso conocido, entero no negativo, límite de cantidad,
capacidad coherente y peso total permitido. Se rechazan arrays, flotantes,
negativos, IDs extraños y claves como `__proto__`. Los ceros no ocupan registros.

## Recogida y riesgo

- Asteroide normal: 3 de titanio; dorado: 10. Volátil: 1 núcleo de plasma.
- Jefe derrotado: 3 núcleos y 1 reliquia. Se mantienen sus monedas, XP y power-ups.
- La recogida usa posición/radio del servidor a 15 Hz, sin RPC de recogida ni
  simulación de inventario en el navegador. Si no cabe el stack completo,
  permanece en el mapa y otro jugador puede recogerlo.
- Drops: máximo 128 por sala, expiración a 60 segundos y visibilidad por AOI.
  El pool gráfico tiene máximo 128 imágenes, sin física ni emisores individuales.
- Morir copia el desglose y vacía carga en la misma ejecución síncrona. Un segundo
  daño letal no vuelve a notificar ni gastar ese botín. Ningún respawn recupera materiales.
- Desconexión detectada por Socket.IO, salida de sala o cambio de partida:
  pérdida por abandono y desvinculación inmediata. El stash no se modifica.
  Una caída de red no detectable aún sigue los tiempos de ping/timeout existentes;
  reconectar crea un actor nuevo con carga vacía, nunca recupera la anterior.
- Volver a un menú superpuesto conservando la misma partida no es una extracción
  ni desconexión. Repetir `joinRoom` a la misma sala no reinicia inventario ni
  duplica créditos por supervivencia.
- Elegir una clase con bodega menor que la carga actual se rechaza. Al expirar
  la selección se elige una clase que sí pueda transportarla.

## Contratos de red

Servidor → dueño del actor, fiable y solo cuando cambia:

```js
socket.emit('inventory:update', {
  roomId, playerId, deathId, motionRevision, revision,
  items: { titanium: 14, plasma_core: 2 }, used: 24, capacity: 80
});

socket.emit('player:wipe-inventory', {
  roomId, playerId, deathId, motionRevision, revision,
  items: {}, used: 0, capacity: 80,
  lost: { titanium: 14, plasma_core: 2 }, reason: 'death' // o 'abandon'
});
```

Cliente → servidor:

```js
socket.timeout(8000).emit('inventory:request', { roomId, deathId }, callback);
await economy.request('readStash');
await economy.request('upgradeStash');
```

`accountOpen` recibe únicamente identidad; un intento de enviar `secureStash`
o `inRunInventory` se rechaza. No existen eventos de depósito o importación.
`accountAction: extract` no es una acción aceptada. Stash e inventario privado
no forman parte del snapshot público de naves. `resources` contiene solo drops
del mapa `[id, x, y, tipo, cantidad]`, con deltas relativos a un baseline fiable.

El HUD descarta salas, actores, vidas y revisiones atrasadas. Las suscripciones
de HUD duran lo que la escena; las del modal (`accountState` y Escape) se retiran
al cerrarlo. Al destruir la escena se eliminan todas las restantes y el pool.

## Extracción: punto de integración para la próxima fase

Esta fase **no define zonas, canalización ni condiciones de escape**. Por ello
no se inventa un botón que deposite recursos desde cualquier punto del mapa.
El gestor ya incluye la transferencia, que debe llamar el controlador
autoritativo de extracción cuando sus condiciones se hayan cumplido:

```js
// Solo en Node, después de comprobar zona, duración y estado de combate.
const result = room.extraction.completeExtraction(player);
if (result.ok) {
  // El stash está persistido y la carga ya está vacía.
  // El controlador de la próxima fase puede finalizar la incursión aquí.
}
```

La función valida actor vivo y miembro actual de la sala, contenido exacto,
capacidad de su clase, vinculación al wallet, capacidad del stash y almacenamiento
persistente. El depósito es todo o nada. Si el stash está lleno, el disco falla
o no hay persistencia configurada, conserva íntegramente la carga y devuelve error.
Repetir la llamada después de un éxito encuentra la carga vacía y no duplica recursos.
La finalización de la partida/teletransporte pertenece al futuro controlador de zonas.

## Persistencia y seguridad

Se reutiliza el backend de cuentas existente. En Render:

```text
ECONOMY_SECRET=<secreto aleatorio estable de al menos 32 bytes>
ECONOMY_FILE=/var/data/fleet/economy.json
```

Se requiere un disco persistente realmente montado. Sin él el stash se puede
consultar, pero el depósito de extracción se rechaza: no se promete persistencia
usando memoria temporal. Se guarda mediante archivo temporal y reemplazo del
archivo de cuentas antes de vaciar el inventario. Un fallo restaura el wallet
anterior. La transacción es síncrona en una sola instancia Node; no hay intercalación
de muerte/desconexión entre depósito y borrado de carga.

Un stash corrupto en un perfil guardado se restablece al esquema vacío sin borrar
monedas ni otros campos válidos del wallet. Un archivo de cuentas JSON íntegramente
ilegible mantiene la política anterior de fallo cerrado: no se borran todas las
cuentas intentando recuperar una sola. Los errores de serialización/escritura
se manejan en el almacenamiento existente y en la frontera de extracción.

El navegador elimina el antiguo cache `fleet_io_stash`; jamás lo sube, importa
o mezcla con el stash autoritativo. Editar objetos de JavaScript puede falsificar
la presentación de una consola local, pero no acredita materiales en Node.
Se conserva el token de huésped usando SDK.data cuando está disponible, conforme
a su [API oficial de almacenamiento](https://docs.crazygames.com/sdk/data/).

El archivo JSON es almacenamiento de **una instancia**, no una base distribuida.
El commit se ejecuta al extraer, no en cada frame. Para un despliegue con muchas
extracciones simultáneas o varias réplicas, esta frontera debe sustituirse por
una transacción en una BD compartida y su cola/lock; no basta con copiar el archivo
a varios servidores. La seguridad de anuncios reales mantiene las limitaciones
documentadas en la auditoría anterior; este módulo no las modifica.

## Verificación

`npm test`: **195/195 pruebas pasan**, incluidas las pruebas anteriores de SDK,
clases, economía, jefes y clanes y las conexiones reales de HTTP/WebSocket.

Casos nuevos: cinco capacidades, rechazo de cantidades manipuladas, recogida llena,
pérdida exacta una sola vez, respawn recompensado vacío, abandono, persistencia/reload,
no duplicación, rollback ante I/O fallido, stash lleno, ampliación con precio
autoritativo, corrupción parcial sin borrar wallet, evolución sobrecargada,
128 drops/TTL/deltas, solicitudes de inventario de otra sala y rechazo de depósitos
falsificados. El test de UI abre/cierra 40 veces y recorre 5.120 IDs de drops usando
solo 128 imágenes; comprueba ausencia de listeners y bindings retenidos al destruir.

Estas pruebas no certifican FPS constantes en cualquier GPU ni la capacidad del
hardware contratado de Render. No se ha publicado esta fase.
