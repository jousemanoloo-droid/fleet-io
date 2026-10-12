# Extraction Space — Fase 4: fabricación y mercado negro

Integración aplicada sobre el servidor y cliente existentes. El taller completa
el ciclo: recoger → extraer → guardar → fabricar o vender → volver a jugar.

## Catálogo y economía

| ID de receta | Materiales del Stash | Desbloqueo permanente |
| --- | --- | --- |
| `void_stalker` | 25 `titanium_scrap`, 8 `quantum_crystal`, 2 `alien_tech_core` | Skin legendaria violeta, equipable en taller/garaje. |
| `reinforced_shield` | 50 `titanium_scrap`, 12 `quantum_crystal` | +15% del escudo base al aparecer. |
| `quantum_thruster` | 5 `alien_tech_core`, 4 `dark_matter_shard` | Extracción de 3 segundos, en lugar de los 4 habituales. |

**Correspondencia de nombres:** las recetas denominan Núcleo de Plasma al
núcleo épico `alien_tech_core` de Fase 2. El taller muestra ambos nombres.
No se introduce un quinto recurso ni se reinterpreta el antiguo ID `plasma_core`
del guardado de Fase 1; su migración histórica sigue siendo independiente.

Cada desbloqueo se fabrica una sola vez. No hay niveles acumulables de módulos,
descuento enviado por el cliente, coste adicional en créditos ni reembolso.
El valor de venta sacrificado es 1.650 créditos para la skin, 1.400 para el escudo
y 10.000 para el propulsor, usando los precios base del catálogo existente.
Estas cifras son referencias de coste de oportunidad; el equilibrio definitivo
necesita datos de partidas y tasas reales de obtención de los recursos.

## Estructura por módulos

| Archivo | Integración |
| --- | --- |
| `client/js/crafting-recipes.js` | Catálogo compartido e inmutable de tres recetas; sanitización de IDs. |
| `server/craftingRecipes.js` | Expone el mismo catálogo al backend, evitando costes divergentes en UI. |
| `server/blackMarket.js` | Transacción autoritativa, validaciones, rollback, idempotencia y aplicación de pasivas. |
| `server/accounts.js` | Inicializa el mercado, persiste `state.crafted`, migra cuentas antiguas y prepara la nave. |
| `server/server.js` | Registra `craft:request` mediante el límite seguro de sockets y aplica módulos al entrar/revivir. |
| `server/entities.js` | Conserva módulos al reaparecer; reinicia correctamente el bonus al reiniciar atributos de partida. |
| `server/cosmetics.js` | Reconoce `void_stalker` como skin válida. La propiedad sigue validándose en la cuenta. |
| `server/playerExtraction.js` | Captura duración de 3/4 s al comenzar el canal y mantiene todas las cancelaciones previas. |
| `client/js/crafting-ui.js` | Botón del menú, tarjetas, suficiencia de materiales, fabricación, equipamiento y enlace al Stash. |
| `client/js/economy.js` | Solicitud dedicada de fabricación; descarta ACKs de conexiones/cuentas anteriores. |
| `client/js/extraction-hud.js` | Barra y cuenta atrás adaptadas a la duración confirmada por el servidor. |
| `client/js/game-scene.js` | Inicializa el taller, protege la entrada de juego mientras está abierto y limpia al cerrar escena. |
| `client/js/features.js`, `client/js/garage-ui.js` | Color multijugador y vista/equipamiento de la skin. |
| `client/js/translations.js`, `client/features.css`, `client/index.html` | EN/ES, estilo Cyber-Neon, animación y orden de scripts. |
| `tests/crafting.test.js` | Validación de transacciones, persistencia, concurrencia, clases, red y limpieza. |

## Contrato autoritativo

El navegador envía exclusivamente:

```js
socket.timeout(8000).emit('craft:request', {
  recipeId: 'reinforced_shield'
}, (error, result) => {
  // La UI muestra un resultado; no resta ni concede nada localmente.
});
```

El servidor obtiene la identidad de la sesión firmada, nunca de un `playerId`
en el paquete. Rechaza recetas desconocidas, estructuras malformadas, campos
extra, falta de cuenta, falta de materiales y fabricación durante una vida
activa. Se permite fabricar en el menú sin nave o tras morir, antes de revivir.
Abrir el menú durante una partida viva no equivale a abandonar la sala: la UI
advierte que hay que extraer o terminar la partida para fabricar.

Una fabricación válida clona el estado actual y, sin `await`, resta todos los
materiales, incrementa la revisión del Stash y añade la propiedad a `crafted`.
Para la skin también añade su ID a `skins`. El mismo archivo persistente guarda
ambos cambios mediante el almacén existente de cuentas. Si falla la escritura,
se restaura el estado anterior completo. Tras guardar, se incrementa la revisión
de cuenta y se publica `accountState` a las sesiones del mismo perfil.

El ACK exitoso incluye el snapshot normal de cuenta y `crafted: recipeId`.
Si ya se fabricó, devuelve `ok: true, alreadyOwned: true` sin volver a consumir.
Esto hace seguros los reintentos tras perder un ACK y las peticiones de varias
pestañas en el mismo proceso Node. Las recetas que compiten por los mismos
materiales se evalúan contra el saldo actualizado por la transacción anterior.

Errores específicos: `craft.invalid`, `craft.inRun`, `craft.materials` y
`extraction.persistence`. Un fallo/timeout del cliente no concede una recompensa
local; la UI permite refrescar la cuenta y reintentar sin duplicar el coste.

## Aplicación de pasivas y renderizado

`accounts.preparePlayer(socketId, player)` deriva los módulos del registro del
servidor al ingresar y al revivir. Nunca usa `localStorage`, el handshake de
cosméticos o estadísticas enviadas por el navegador como prueba de propiedad.
Una fabricación realizada desde otra pestaña no altera la nave ya activa;
entra en vigor al siguiente spawn de esa nave.

El juego actual representa el atributo de escudo mediante `maxHp`. El módulo
añade **15 puntos a la base de 100**, escalados por el multiplicador de vida de
la clase. Por ejemplo: nave inicial 115; Hunter 92 antes de otras mejoras.
Los puntos tácticos y mutaciones conservan sus propios incrementos. El bonus
se registra sin multiplicador de clase para evitar acumulación al evolucionar.
La aplicación repetida es idempotente y preserva el porcentaje de salud;
el respawn restaura después el comportamiento de salud completa existente.

El propulsor fija `extractionDuration = 3000` en el actor del servidor. La
canalización captura esa duración al comenzar; barcos sin módulo siguen en
4000 ms. El HUD acepta únicamente esas dos duraciones. Daño, salida del círculo,
caducidad, teletransporte, muerte y fallo del Stash siguen cancelando exactamente
como en Fase 3. El navegador nunca completa la extracción por su cuenta.

Void Stalker es un estilo de color de los modelos de nave existentes, no una
nueva clase ni una ventaja de combate. Su skin se transmite por el campo
cosmético existente de los snapshots y todos los pilotos reciben el mismo color.
No se cambia el formato de red ni se añaden broadcasts por frame.

## Cliente, lifecycle y memoria

`index.html` carga `crafting-recipes.js` antes de `economy.js` y `crafting-ui.js`
antes de `game-scene.js`. La escena crea el componente con `(scene, C,
syncGameplayTracking)`. El componente renderiza al abrir, recibir una cuenta,
cambiar de idioma o terminar una petición; no trabaja dentro del render loop.

Las tarjetas muestran existencias/coste en verde o rojo, estado permanente y
botón de equipamiento para la skin fabricada. La animación respeta
`prefers-reduced-motion` y el diseño usa una columna en pantallas pequeñas.
Los textos se actualizan en EN/ES sin recargar y no usan HTML recibido del usuario.

El listener de cuenta y de Escape solo existe mientras el taller está abierto.
Al cerrar se eliminan esos listeners, nodos y bindings de traducción. Al
destruir la escena se retiran además las suscripciones de bienvenida,
desconexión e idioma. Un ACK tardío no modifica un modal nuevo ni una conexión
diferente. Los botones se bloquean durante una petición para evitar doble clic.

El taller comparte el seguimiento de modales de CrazyGames: abrirlo detiene
jugabilidad y cerrarlo solo la reanuda si corresponde al estado actual.
Su destrucción no dispara una reanudación. No se cambian `loadingStart`,
`loadingStop`, el SDK, la emisión de anuncios ni los callbacks de recompensa.

## Persistencia y consolidación de fases

Configurar `ECONOMY_SECRET` estable y `ECONOMY_FILE` en almacenamiento
persistente y escribible. Ejemplo de Render con disco montado:
`ECONOMY_FILE=/var/data/fleet/economy.json`. Sin persistencia, la UI desactiva
fabricación y el servidor no consume materiales ni promete desbloqueos permanentes.

Las cuentas anteriores adquieren `crafted: []` por defecto. IDs corruptos o
desconocidos se eliminan; Void Stalker solo se restaura si existe su receta
fabricada. No se importan desbloqueos o materiales de un cache local.

El sistema mantiene el límite actual de **una instancia autoritativa por
almacén JSON**. Para múltiples procesos/servidores hace falta un almacén
transaccional compartido; usar el mismo archivo en varios procesos no garantiza
exclusión mutua ni evita pérdidas. Esta fase no introduce esa topología.

La integración conserva clanes, códigos de salas privadas, inventario in-run,
límites por clase, botín, depósito/ventas y extracción. Los módulos son de cuenta
y se aplican de la misma forma en salas públicas, privadas y contra bots.
Todos los scripts locales llevan nueva versión de caché `extraction4-20261012`.
El código está aplicado localmente; esta solicitud no incluye publicación.

## Pruebas

Suite completa: `npm test`. Las nuevas pruebas cubren costes exactos, paquetes
falsos, materiales insuficientes, inventario a bordo, consumo de tres recetas,
persistencia/relectura, fallo de escritura y rollback, compras de skin no
autorizadas, ACK duplicados, pestañas concurrentes, cambios de clase,
respawn libre/recompensado, extracción a tres segundos y ACKs de conexión antigua.
El taller se abre/cierra 40 veces sin acumular listeners o traducciones.

La suite usa dobles de Phaser y del SDK para determinados casos. No constituye
una certificación de FPS en GPU, anuncios reales o login real de CrazyGames.

Resultado tras integrar esta fase: **236/236 pruebas aprobadas**, incluidas
17 nuevas pruebas de fabricación. Registro: `artifacts/extraction-phase4-tests.txt`.
