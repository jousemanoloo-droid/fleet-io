# Pulido adicional — polish-20261012

Esta revisión completa los puntos del adjunto sobre la versión anterior
`precision-20261012`. El código actualizado está aplicado en el proyecto local.

## Cambios por archivo

- `client/css/main.css`: fondo `rgba(10,15,30,.75)`, blur de 10 px, borde cian
  `.25`, radio de 12 px y padding uniforme de 16 px. Hover de −4 px con brillo
  y transición de .25 s. Se mantienen cuatro columnas y 2×2 hasta 700 px.
- `client/js/main-menu.js`: iconos SVG propios, títulos uniformes y subtítulos
  dinámicos; reutiliza exactamente los botones y handlers de los modales.
- `client/js/leaderboard-ui.js`: comprobación de colecciones nulas y contención
  de excepciones con mensaje de sincronización. Conserva el cache válido y el
  sistema de pestañas activas, ARIA, plegado y posición autoritativa anterior.
- `server/swarm.js`: radio estricto de adquisición de 900 px, incluido el borde;
  se mantienen targetId, homing de seis segundos y barrido defensivo.
- `server/server.js`: identificador local de versión actualizado a `polish-20261012`.
- `client/js/game-scene.js`: `screenShake(intensity,duration)` acotado a 350 ms
  y .015, sin reiniciar una sacudida activa y respetando movimiento reducido.
  Emisor común de muzzle flashes con máximo de 64 partículas vivas y vida de
  85 ms. Al extraerse limpia contador y posición de ranking. El HUD redondea
  visualmente HP para evitar valores como `114.99999999999999`; la física del
  servidor conserva su precisión.
- `client/js/projectiles.js`: destello en disparos predichos y nuevos disparos
  confirmados; no repite el destello al reconciliar un proyectil ya predicho.
  Reutiliza las mismas coordenadas de cañón, escala y rotación que el servidor.
- `client/js/features.js`: sacudida crítica cuando el daño es al menos 20 o la
  vida queda en 25% o menos; usa el helper limitado.
- `client/js/retention.js`: sacudida de 260 ms y .01 al derrotar un Boss cercano.
- `client/js/translations.js`: títulos nuevos y mensaje defensivo EN/ES.
- `client/index.html`: versión de assets `polish-20261012`; mantiene el SDK v3
  oficial en head y el adaptador después de existir el cuerpo de la página.
- `tools/preview.cjs`, `tools/polish-preview.cjs`: escenario aislado opcional
  `node tools/preview.cjs --polish`. Usa un archivo de cuenta y secreto efímeros
  de prueba, materiales asignados por el backend y una nave estacionaria en un
  portal. Ningún entrypoint de producción importa esta fixture; exige modo
  development. No se emite una victoria inventada desde el navegador.

## Precisión y compatibilidad

Se conserva la matriz correcta: `x + ox*cos(theta) - oy*sin(theta)` y
`y + ox*sin(theta) + oy*cos(theta)`, con offsets escalados según la textura.
El segundo término de Y utiliza **coseno**, corrigiendo la errata de la fórmula
del adjunto. No se cambian balances, daño de láser ni autoridad de movimiento.

Los contadores siguen llegando en todos los snapshots como `activeDroneCount`,
además del evento optimizado `drones:count-update`; no hace falta duplicar ese
canal como `drones:sync-count`. Solo se actualiza el jugador correspondiente y
se rechazan otras salas, vidas y revisiones. La limpieza al regresar del portal
también evita mostrar una flota evacuada como si siguiera activa.

El adaptador sigue en `client/monetization.js`, su ubicación real; no se crea una
segunda copia en `client/js/` que inicialice el SDK dos veces. Las pruebas
existentes comprueban loadingStart/loadingStop, gameplayStart/gameplayStop,
pausa durante anuncios y recompensa tras adFinished. La vista local utiliza
simulación de anuncios según la política existente; no certifica anuncios reales
del portal CrazyGames.

## QA realizado

**246/246 pruebas automáticas aprobadas.** Registro:
`artifacts/polish-tests.txt`. Se añaden cobertura del borde exacto de 900 px,
fallback del ranking, límites de screenShake, movimiento reducido y contador
cero al salir por extracción.

En navegador se ha recorrido **Menú → Partida → Extracción → Taller → Fabricar**:

1. El escenario prepara Carrier y 25 titanios, 8 cristales y 2 núcleos en el
   inventario temporal del servidor (65/75 de volumen).
2. La canalización y completeExtraction reales depositan los materiales mediante
   el archivo persistente de prueba antes de vaciar la carga.
3. El menú muestra 65/200 en Stash y una receta disponible.
4. El taller fabrica Void Stalker; el servidor consume los materiales y guarda
   la propiedad. La UI muestra desbloqueo permanente y Stash vacío.
5. El registro del navegador contiene **0 errores y 0 advertencias** durante este
   recorrido. Captura: `artifacts/polish-cycle-workshop.png`.

Esto valida el recorrido observado con datos controlados, no todos los posibles
dispositivos, condiciones de red o la aprobación editorial de CrazyGames.
La prueba no usa datos ni discos del servicio público. Render continúa necesitando
almacenamiento persistente y ECONOMY_SECRET estable para habilitar extracción y
fabricación de forma permanente en producción.
