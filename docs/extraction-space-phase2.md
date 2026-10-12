# Extraction Space — Fase 2: rarezas, volumen y HUD

Los cambios están aplicados en el proyecto. Esta fase añade loot y venta de
materiales y sustituye el balance de carga de la fase anterior. Conserva el
stash autoritativo, la pérdida por muerte/abandono, las salas y los flujos existentes
del SDK; no introduce una resurrección ni un depósito controlados por el navegador.

## Estructura de módulos

| Archivo | Responsabilidad |
|---|---|
| `server/resourceTypes.js` | Catálogo exportado para Node y generadores autoritativos de ráfagas por origen. |
| `server/shipCargoLimits.js` | Capacidades de carga y máximo permitido de un stack. |
| `client/js/resource-types.js` | Fuente única compartida de IDs, pesos, rarezas, colores, iconos y precios. Objetos congelados. |
| `client/js/ship-cargo-limits.js` | Fuente compartida del balance por clase; el cliente la usa solo para presentación/validación. |
| `client/js/extraction-rules.js` | Validación de cuatro tipos, migración del archivo guardado y esquema de stash versión 2. |
| `server/extractionInventory.js` | Rechazo de sobrecarga, recogida y eliminación única del drop; mantiene el commit de extracción de Fase 1. |
| `server/worldEvents.js`, `bossManager.js`, `hazards.js` | Drops de asteroides, muertes de enemigos, jefes y asteroides volátiles. |
| `server/environmentEvents.js` | Una tirada de materia oscura cuando expira naturalmente un agujero negro. |
| `server/accounts.js` | Migración de perfiles, validación de ventas y commit conjunto de materiales/saldo. |
| `client/js/cargo-hud.js` | Barra de volumen, colores por umbral, ARIA y generación única de texturas procedurales por rareza. |
| `client/js/stash-ui.js`, `class-ui.js` | HUD nuevo, iconos en el pool existente, venta desde el stash y capacidades visibles al elegir clase. |
| `client/js/network.js` | Valida los nuevos tipos/pesos máximos en los deltas de recursos. |
| `client/index.html`, `features.css`, `translations.js` | Scripts, colores, animación CSS reducida y textos EN/ES. |
| `tests/resource-cargo.test.js`, `extraction.test.js`, `room-network.test.js` | Catálogo, migración, ventas, fuentes exclusivas, volumen, HUD y regresiones. |

## Recursos y valor económico

| ID | Rareza | Volumen por unidad | Créditos al vender una unidad | Fuente |
|---|---|---:|---:|---|
| `titanium_scrap` | Común | 1 | 10 | Asteroides y enemigos derrotados |
| `quantum_crystal` | Raro | 3 | 75 | Asteroides dorados, ricos en energía o volátiles; jefes |
| `alien_tech_core` | Épico | 8 | 400 | Exclusivamente jefes globales |
| `dark_matter_shard` | Legendario | 15 | 2.000 | Disipación natural de agujeros negros |

Se elige **venta de materiales ya extraídos** como punto de concesión de créditos.
Depositar en el stash no concede créditos adicionales: evita cobrar por depositar
y volver a cobrar por vender el mismo material. No se compra ni vende carga in-run.

Precios y cantidades se resuelven en Node. El valor que aparece en la UI es
informativo; enviar `price`, `value` o un saldo distinto no cambia la transacción.

## Capacidades y recogida

| Clase | Volumen máximo |
|---|---:|
| Nave inicial | 60 |
| Hunter | 30 |
| Battleship | 120 |
| Carrier | 75 |
| Stealth | 40 |

Ejemplo: tres unidades de titanio, dos cristales, un núcleo y un fragmento pesan
`3 × 1 + 2 × 3 + 1 × 8 + 1 × 15 = 32`. Hunter rechaza esa carga; Carrier la admite.
La recogida exige que quepa el stack completo, sin fracciones ni recogidas parciales.
Si no cabe, el objeto sigue en el mapa. El primer actor validado que sí tenga
espacio lo recoge y el servidor borra la entidad de su Map.

La carga total se valida de nuevo al extraer. Elegir una nave que no pueda llevar
la carga actual se rechaza en Node y su botón se deshabilita cuando el HUD conoce
esa condición. El timeout sigue eligiendo una clase válida, sin congelar la nave.

El stash conserva sus capacidades 200–2.000 y ampliaciones previas. Reducir la
bodega de una clase no reduce el almacén permanente.

## Generación de loot

- Asteroides: titanio según HP, entre 2 y 12 unidades. Los normales no generan
  cristales. Dorados: probabilidad de cristal 45%; ricos en energía/volátiles: 25%.
  La marca `energyRich: true` puede utilizarla un generador de asteroides adicional.
- Enemigos: titanio proporcional a nivel, vida máxima y número de escoltas antes
  de morir, entre 2 y 12 unidades. Se requiere un atacante enemigo reconocido en
  la sala; no se conceden materiales por abandonar o por invocar otra vez la muerte.
- Jefe global: rango limitado de 1–4 según HP máximo. Genera `rango × 3` de titanio,
  `rango` cristales y `ceil(rango / 2)` núcleos épicos. No genera materia oscura.
- Agujero negro: 3% de probabilidad de un fragmento legendario al cumplirse su
  expiración natural. La zona se elimina antes de la tirada para impedir duplicados.
  Tormentas, radiación y cierre/destrucción de una sala no generan fragmentos.

Las ráfagas se dividen en un máximo de cuatro stacks por tipo con offsets radiales.
No se crean timers, emisores ni cuerpos físicos por cada recurso. Se conserva el
límite global de 128 drops por sala, TTL de 60 segundos, recogida por proximidad
a 15 Hz y filtrado de visibilidad en los snapshots/deltas existentes a 20 Hz.
El combate autoritativo permanece a 30 Hz. No se ha añadido un tipo nuevo de
minijefe: el cristal raro ya tiene fuentes en asteroides especiales y jefes.

## Migración sin pérdida de cantidades

Al leer **el archivo autoritativo del backend**, los materiales de Fase 1 se
convierten así:

```text
titanium    → titanium_scrap
plasma_core → quantum_crystal
alien_relig → alien_tech_core
```

Las cantidades, capacidad y revisión se conservan. El peso actualizado de esos
materiales es igual o menor que antes, por lo que un stash antiguo válido cabe
en la misma capacidad. El registro convertido lleva `schemaVersion: 2`. En un
archivo mixto se suman los aliases válidos una sola vez y después se valida el
total; valores negativos, absurdos, desconocidos o desbordados no se aceptan.

Esta migración no se ejecuta sobre RPCs del cliente, drops nuevos ni localStorage.
Las cantidades enviadas por el navegador jamás acreditan materiales. El cache
local de stash sigue siendo descartado y el backend continúa siendo la autoridad.
Perfiles viejos sin stash reciben un almacén vacío válido.

## Venta desde el stash

```js
// Cliente: identifica material y cantidad; nunca el precio ni los créditos concedidos.
const result = await economy.request('sellResource', {
  resource: 'quantum_crystal',
  quantity: 2
});
// Éxito: result.credits === 150 y nuevo estado de cuenta confirmado por Node.
```

El servidor exige recurso conocido, cantidad entera positiva y propiedad suficiente
en `secureStash`. Copia el estado, retira materiales y suma el precio del catálogo;
ambos cambios se persisten en una única escritura/rename del archivo de cuentas.
Si falla el disco, restaura cantidades y créditos. No vende por debajo de cero,
no acepta precios del cliente ni permite vender materiales que siguen in-run.
Repetir una venta de todo el stock cuando ya quedó vacío se rechaza.

Se conserva el requisito de secreto estable y disco persistente configurados con
`ECONOMY_SECRET` y `ECONOMY_FILE`. Sin persistencia, las ventas y los depósitos se
rechazan. El archivo sigue siendo de **una sola instancia**; no es una transacción
distribuida. Para muchas ventas/extracciones simultáneas o varias réplicas hay que
sustituir esta frontera por una BD compartida/cola transaccional. No se promete
rendimiento ilimitado de I/O ni protección frente al robo del token de huésped.

## HUD y recursos en el mapa

`CargoHUD.update(used, capacity, visible)` recibe números del paquete privado
`inventory:update`. El porcentaje solo sirve para representar la barra; el
navegador no calcula recogidas ni concede volumen.

- Menos del 70%: verde.
- Desde el 70% hasta menos del 90%: amarillo.
- Desde el 90% hasta menos del 100%: rojo fijo.
- Al 100%: rojo pulsante mediante CSS, sin intervalo JavaScript.

Se respeta `prefers-reduced-motion`. La barra expone `aria-valuenow`, máximo y
etiqueta traducida. Las texturas de recursos se generan una vez, con halos azules
para común/raro, morados para épico y dorados para legendario. El pool de 128
imágenes existente se reutiliza; se liberan IDs retirados antes de adquirir otros
para evitar parpadeos cuando cambia todo el sector.

El componente no registra sockets ni callbacks de frame. El gestor de stash
continúa siendo dueño de las suscripciones de inventario, modal y traducción;
destruirlo también destruye el HUD. El modal conserva su bloqueo de movimiento
y las llamadas previas de gameplayStart/gameplayStop.

## Orden de integración en index.html

```html
<!-- Antes de network.js y extraction-rules.js -->
<script src="js/resource-types.js?v=extraction2-20261012"></script>
<script src="js/ship-cargo-limits.js?v=extraction2-20261012"></script>
<script src="js/network.js?v=extraction2-20261012"></script>
<script src="js/extraction-rules.js?v=extraction2-20261012"></script>
<!-- ...economy, features y módulos existentes... -->
<script src="js/cargo-hud.js?v=extraction2-20261012"></script>
<script src="js/stash-ui.js?v=extraction2-20261012"></script>
<script src="js/game-scene.js?v=extraction2-20261012"></script>
```

Los scripts ya están incluidos. Publicar cliente y backend coordinadamente y
recargar clientes antiguos para que sus validadores conozcan los IDs/capacidades
nuevos. La transferencia al stash conserva `room.extraction.completeExtraction(player)`;
las zonas y condiciones de escape pertenecen a la fase correspondiente.

## Validación y límites

La batería completa ejercita las pruebas anteriores de stash, muerte/respawn,
clases, monetización/SDK, eventos, clanes, HTTP y salas privadas con WebSocket real.
Los casos adicionales comprueban catálogo único, conservación de cantidades en
migración, venta con precio falso, stock insuficiente, rollback de I/O, orígenes
exclusivos del loot, probabilidad de black-hole a ambos lados del umbral, rechazo
de sobrecarga y seis puntos frontera de los colores del HUD.

El login con una cuenta real en CrazyGames no se ha ejercitado dentro del portal;
se conserva la integración existente de identidad/SDK/data, incluidos sus límites
documentados. Las pruebas de SDK son simuladas y no certifican anuncios ni login
reales. Tampoco se certifican 60 FPS en todas las GPU o en el hardware de Render.
Esta implementación no publica automáticamente los cambios.
