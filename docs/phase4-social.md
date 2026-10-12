# FASE 4: marcadores, clanes y partidas privadas

## Módulos y conexiones

- `server/leaderboard.js`: Top 10 global, diario UTC y de clanes. Muestreo de
  todas las salas una vez por segundo; excluye bots. Paquetes compactos y emitidos
  solo si cambia su contenido. Máximo 1000 registros globales y 1000 diarios.
- `server/clans.js`: etiquetas canónicas, pertenencia exclusiva, capacidad y
  agregación de puntuaciones. Máximo 256 clanes y 64 miembros por clan.
- `server/roomManager.js`: crea ambos servicios; preserva el aislamiento existente
  por sala, acepta códigos con prefijo y limpia salas vacías y servicios al cerrar.
- `server/server.js`: joinClan/leaveClan, envío inicial de marcadores, rate limit
  de 1s para cambios de clan y limpieza de pertenencia al desconectar.
- `client/js/leaderboard-ui.js`: pestañas GLOBAL/DIARIO/CLANES en la esquina
  superior derecha, filas con nombre, clase, tag y puntos. Usa textContent.
- `client/js/clan-ui.js`: crear/unirse por etiqueta, salir, preferencia recordada,
  solicitud de reentrada al reconectar y rechazo de callbacks de conexiones viejas.
- `server/rpg.js`, `client/js/network.js`: clanTag en snapshots de jugadores.
- `client/js/game-scene.js`: creación de interfaces y prefijo [TAG] en las naves.
- `client/index.html`, `client/features.css`, `client/js/translations.js`: carga de
  módulos, etiquetas EN/ES y estética existente.

Las interfaces se cargan antes de game-scene.js. GameScene.create las construye
cuando el socket ya existe. El ranking global sustituye el renderer anterior del
HUD; los rankings locales antiguos se conservan como compatibilidad en snapshots,
muestreados a 1Hz y omitidos de los deltas si coinciden con el keyframe fiable.

## Contratos

```js
socket.timeout(8000).emit('joinClan', {tag:'[ACE]'}, (error,result) => {
  // result = {ok:true, tag:'ACE'} o {ok:false,error:'error.clanTag'}
});
socket.timeout(8000).emit('leaveClan', {}, callback);
socket.on('clanState', ({tag}) => updateClanUI(tag));
socket.on('leaderboards', packet => updateRanking(packet));
```

joinClan crea la etiqueta si no existe y se une si ya existe. Los clientes no
envían puntuación, clase, ID de otro jugador ni miembros del clan. Solo el servidor
calcula las puntuaciones a partir de Player. Cambiar de sala conserva el clan;
desconectar retira la membresía y elimina el grupo si queda vacío. Preferir una
etiqueta en localStorage no concede membresía: el servidor valida cada reentrada.

Paquete leaderboard:

```js
{
  v:1, revision:42, day:20738,
  global:[['socketId','Pilot','hunter','ACE',12345]],
  daily:[['socketId','Pilot','hunter','ACE',12345]],
  clans:[['ACE',20000,3]] // tag, suma de puntos actuales, miembros activos en salas
}
```

El global retiene el mejor score observado por conexión desde el arranque del
proceso. El diario retiene los mejores scores observados en cada día UTC y se
reinicia a medianoche UTC. No reinicia el score de una nave que siga jugando.
Contribuyen salas públicas, privadas y singleplayer (solo sus humanos).
Las filas se ordenan en servidor y los empates se resuelven de forma estable.

No se deduce identidad de cuenta por el nombre: dos conexiones con igual nombre
siguen siendo distintas. No hay persistencia histórica entre reinicios ni ranking
compartido entre varios procesos Node. Para eso debe añadirse una cuenta validada
y un repositorio compartido (p.ej. Redis/DB), manteniendo la misma API de servicio.

## Códigos privados

RoomManager genera seis símbolos mediante node:crypto y verifica unicidad. La UI
muestra `FLEET-XXXXXX` y permite copiar ese código. El servidor también acepta la
versión antigua de seis símbolos, para conservar compatibilidad. El input ahora
admite 12 caracteres. La respuesta antigua roomCode conserva seis símbolos; el
campo room.code del estado visible añade FLEET-.

```js
socket.emit('createPrivateRoom',{name:'Pilot',cosmetics:loadout},callback);
socket.emit('joinRoom',{name:'Friend',roomCode:'FLEET-ABC234'},callback);
```

Solo quien introduce ese código entra en esa instancia. El matchmaking público
no selecciona salas privadas. Los códigos son invitaciones, no contraseñas ni
autenticación: no compartirlos si se desea restringir la entrada. Capacidad privada
por defecto 8, máximo total 100 salas. Un cambio a sala llena falla antes de retirar
al jugador de la sala anterior. Salas sin humanos detienen su tick y se destruyen
tras 60 segundos; el sweep corre cada 5s, elimina códigos, membresías y mapas.

## Validación y limpieza

Tags: Unicode NFKC → mayúsculas, opcionalmente [corchetes], 2–8 caracteres A–Z/0–9.
No se aceptan HTML, espacios internos, signos ni datos de otro tipo. Hay una lista
básica de términos bloqueados, con variantes leet comunes; ampliar con la variable
`CLAN_BLOCKED_TAGS=TAG1,TAG2`. Este filtro no sustituye una moderación multilingüe
completa ni un canal de denuncias. Los nombres se normalizan y limitan a 16
caracteres permitidos. El renderer DOM no interpreta nombres o tags como HTML.

Los módulos UI retiran listeners de socket y bindings de traducción en shutdown.
Los marcadores se reconstruyen al reconectar y descartan revisiones antiguas. El
clan usa una generación por solicitud para ignorar ACKs de una conexión anterior.
Los servicios del servidor usan mapas acotados; RoomManager.destroy cancela sus
intervalos, destruye salas y vacía clanes/registros. No hay timers por jugador.

Los modales mantienen gameplayStop/gameplayStart mediante el tracker existente;
no alteran loadingStart/loadingStop, anuncios, economía o autoridad de combate.

## Consolidación y validación

El arranque existente sigue en server/server.js; server/index.js es un alias.
Actualizar client/ y server/ juntos para activar snapshots/UI/eventos nuevos.
Esta fase entrega archivos locales; no publica automáticamente servicios.

tests/phase4.test.js comprueba normalización, límites, exclusividad, salas con
prefijo, sweep, rankings entre salas, UTC, registros acotados, deltas, renderizado
de texto seguro, limpieza de UI y ACKs antiguos. La suite de lógica incluye las
fases anteriores; pruebas de carga real/distribución quedan como validación de
producción independiente.
