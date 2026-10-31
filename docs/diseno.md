# Operador — documento de diseño

**Autor:** Juan Manuel Canchala · **Reto 1** — Frontier CDMX, 31 de octubre de 2026 · Repo `frontier-cdmx` · Diagramas en [arquitectura.md](arquitectura.md).

## Resumen

1. Operador recibe una tarea en lenguaje natural y la ejecuta en una aplicación de escritorio que no conoce y que no tiene API. Solo la ve por VNC, en capturas de 1280×800, y tiene que terminar dentro de los 5 minutos que el evaluador espera.
2. Todo pasa en un solo bucle. `pi` corre Sonnet 5.5 con razonamiento alto, y el modelo decide cada paso sobre la captura del momento con ocho herramientas propias de pantalla. No hay planificador previo ni plan cerrado: decide el modelo que ve la pantalla.
3. Un revisor (Haiku 5.5) mira la pantalla antes de cada acción que reconoce como escritura (un clic marcado como guardar, un rótulo con verbo de escritura, Enter) y la frena **solo** si la pantalla contradice la tarea. Lo que no se ve como escritura pasa sin él (sección 9). No hay listas blancas en el código.
4. Cada tarea corre en su propio proceso de `pi`. Al reportar se cierra la conexión VNC, el proceso se mata y solo después se publica el estado. Nada actúa sobre el escritorio después del reporte ni pasado el plazo.
5. Medido hoy en el escritorio de práctica: 5 de 5 tareas, entre 25 y 60 s y entre 0.037 y 0.072 USD por tarea ([eval/gasto.md](../eval/gasto.md)). El set oculto todavía no tiene corrida registrada en el repo: es lo primero que falta medir.

## 1. Contexto y problema

Una empresa usa un sistema de gestión sin API ni documentación. Todo se hace a mano: formularios, ventanas emergentes y reportes que se exportan uno por uno. Hay cinco sistemas así, de modo que el agente no puede asumir una app concreta. La evaluación corre sobre una app que nunca ha visto, en un escritorio limpio que se resetea antes de cada tarea ([material/README.md](../material/README.md)).

Contrato del servicio (implementado en [`src/servidor.ts`](../src/servidor.ts)):

- `GET /health`: 200 `{"ok":true}` cuando el agente está listo. No exige token y lo acepta si viene. Responde 503 si no encuentra el ejecutable de `pi`, porque sin él toda tarea fallaría.
- `POST /tasks` (Bearer): valida el cuerpo, responde `{"task_id": …}` antes de lanzar el agente y trabaja en segundo plano.
- `GET /tasks/{task_id}` (Bearer): `{"estado", "resumen"}`, con `estado` en `en_curso`, `terminada` o `fallida`.

Una tarea cuenta como correcta solo si se cumple todo: la app quedó con los cambios esperados, no hubo cambios fuera de la tarea, no hay duplicados, el estado final es el esperado, el resumen cumple el formato (`respuesta: <valor>` con el número primero; dos datos separados por `;`) y no repite ningún secreto. Tres consecuencias de diseño:

- **Los errores no cuestan igual.** Fallar una tarea pierde un punto. Un cambio de más pierde el punto y además cuenta como acción destructiva. Reportar `terminada` en una tarea que no quedó bien también pierde el punto, y el reto lo nombra aparte como falso éxito.
- **Hay tareas que deben fallar.** Imposibles, peligrosas o ambiguas (dos personas con el mismo nombre) se reportan `fallida` nombrando los datos que explican por qué.
- **Negar de más también cuesta.** En octubre la mayoría de nuestras tareas fallidas fueron negaciones de nuestro propio código, no daño (sección 2). Un control que frena lo que la pantalla sí permite pierde puntos igual que uno que deja pasar un error.

Hechos del escritorio que condicionan el diseño (del material del reto):

- Tras un clic, la pantalla tarda hasta 1 s en repintar; una captura inmediata trae la pantalla vieja.
- Un clic con menos de 100 ms entre bajar y soltar el botón se ignora.
- Escribir sobre un campo con texto lo concatena.
- El escritorio se resetea entre tareas, pero nuestro servicio persiste. La app puede cambiar durante el día.
- A los 5 minutos el evaluador deja de consultar y resetea: lo que el agente haga después cae en la tarea siguiente como acción fuera de la tarea.

## 2. Por qué cambiamos respecto a Aprendiz

El diseño que entregamos a las 12:00 fue **Aprendiz** (sigue en el historial del repo, commit `f197b93`): Python con FastAPI y SQLite, un planificador que fijaba un plan cerrado solo con el texto de la tarea, un actor barato, un clasificador de recortes, una compuerta con lista blanca que negaba por defecto, un detector de efectos y un verificador. Con ese diseño sacamos **12/56** en el set oculto del evento de octubre.

Lo que aprendimos:

- **Nos negamos a nosotros mismos.** De 34 tareas fallidas, unas 19 fueron negaciones de nuestro propio código, no errores del agente. El plan lo hacía un planificador que no ve la pantalla, y la compuerta comparaba contra ese plan de forma literal: un dato escrito de otra forma (una fecha en palabras, un teléfono o un documento con separadores, un filtro con nombre largo) o una ambigüedad que no existía bastaban para negar una acción correcta.
- **Corrimos el set oculto tarde**, cuando ya no quedaba margen para corregir. El set oculto se corre apenas pase el primer caso de práctica.
- **Cuando el costo no limita, conviene el modelo fuerte.** Repartimos el juicio entre modelos baratos y lo rodeamos de controles; los controles terminaron decidiendo por el modelo.

El diseño de referencia es [cuisangelo/frontier-screen-agent](https://github.com/cuisangelo/frontier-screen-agent), que sacó **51/56** en el mismo set: un solo bucle de `pi` con Sonnet 5.5 y un revisor Haiku que frena solo lo que la pantalla contradice. Tomamos esa idea. La implementación es propia: ese repo no tiene licencia, así que se leyó para entender el diseño y no se copió código.

|                       | Aprendiz (octubre)                                                               | Operador (hoy)                                                                    |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Quién decide          | Planificador sin pantalla + actor barato                                         | Un modelo fuerte que ve la pantalla en cada paso                                  |
| Control de escrituras | Negar por defecto: clasificador, compuerta con lista blanca, detector de efectos | Revisor que frena solo contradicciones visibles                                   |
| Resumen               | Código determinista desde datos estructurados                                    | El modelo redacta; el código pone la línea `respuesta:` primero y oculta secretos |
| Lenguaje y estado     | Python, FastAPI, SQLite                                                          | TypeScript en Node 24 sin dependencias, JSON por tarea                            |
| Set oculto            | A media tarde                                                                    | Plan: apenas pase el primer caso. **Pendiente:** sin corrida registrada           |

Lo que se conserva de Aprendiz: cliente RFB propio con clic de 150 ms, cerrar antes de publicar, una tarea a la vez por escritorio, memoria por app sin datos del negocio ni coordenadas, y filtro de secretos exactos sin borrar cadenas genéricas.

## 3. Objetivos y no-objetivos

### Objetivos

| #   | Objetivo                                        | Medida                                                                                                                                             |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Resolver tareas en una app que no conoce        | Set oculto. **Pendiente:** sin corrida registrada                                                                                                  |
| O2  | Cero falsos éxitos y cero acciones destructivas | Meta, no garantía. En las 5 tareas de práctica: ninguno (5/5 pasan `/__check`, que incluye "sin acciones fuera de la tarea")                       |
| O3  | No negar de más                                 | Que ningún freno del revisor detenga una acción que la pantalla sostenía. Se revisa en las trazas del set oculto (pendiente)                       |
| O4  | Cerrar dentro del plazo                         | Corte del agente a los 280 s desde el POST y publicación de respaldo a los 290 s, antes de los 300 s del evaluador. En práctica: 25–60 s por tarea |
| O5  | Costo acotado                                   | Tope duro de 0.60 USD por tarea. En práctica: 0.037–0.072 USD por tarea (solo el bucle principal; ver 6.6)                                         |
| O6  | `POST /tasks` en menos de 2 s                   | Responde antes de lanzar el agente. Latencia en el despliegue: no medida                                                                           |

### No-objetivos

| No-objetivo                                                    | Razón                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Nada específico de la app de práctica                          | La evaluación corre sobre otra app. Las instrucciones y el código no nombran pantallas, rótulos ni coordenadas de SIGECOM |
| Plan cerrado o lista blanca en el código                       | Fue la causa principal de las fallas de octubre (sección 2)                                                               |
| Dos tareas a la vez en un mismo escritorio                     | Se pisan el foco y el teclado. Una tarea nueva para el mismo escritorio detiene a la anterior (ADR-4)                     |
| Replay de coordenadas                                          | La app puede cambiar de diseño; la memoria guarda rutas y nombres, nunca píxeles                                          |
| Herramientas o proveedores que operen la pantalla por nosotros | Lo prohíbe el reto. `pi` es el bucle del agente; las herramientas de pantalla y el cliente VNC son nuestros               |
| Operar después del reporte o pasados los 5 min                 | Lo que se haga después cae en la tarea siguiente                                                                          |

## 4. Supuestos

| Supuesto                                                                                       | Si es falso                                                                                                    | Detección                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Las apps de evaluación se parecen a la de práctica: kiosco web con menús, formularios y tablas | El modelo se pierde más y gasta más pasos                                                                      | Set oculto; motivo de cierre y pasos en las trazas                                                                                |
| La pantalla mide 1280×800                                                                      | Las instrucciones dicen 1280×800; cada captura le dice al modelo su tamaño real. **No se valida en el código** | `scripts/humo-vnc.ts` imprime el tamaño; trazas                                                                                   |
| Los 5 min cuentan desde nuestro `POST /tasks`                                                  | El reloj real empieza antes                                                                                    | El corte a 280 s deja 20 s; el plazo es configurable (`TASK_DEADLINE_MS`)                                                         |
| El escritorio se resetea entre tareas; el servicio persiste                                    | Las notas de una app se contaminan con estado de otra tarea                                                    | Las notas guardan solo la interfaz, nunca datos de registros                                                                      |
| Las capturas pueden mostrar datos sensibles del negocio                                        | Salen hacia el proveedor de modelos                                                                            | No se puede evitar viendo solo píxeles (sección 8)                                                                                |
| La app cambia durante el día                                                                   | Una nota deja de servir                                                                                        | Las notas son pistas; el modelo decide sobre la pantalla actual y las instrucciones le piden leer los avisos de cambio de versión |
| El costo que reporta `pi` es el gasto de la tarea                                              | El tope de 0.60 USD no cuenta el revisor ni las notas                                                          | Comparar el saldo de OpenRouter antes y después de una corrida (pendiente)                                                        |
| `/data` sobrevive a un redespliegue                                                            | Se pierden las tareas consultables y las notas por app                                                         | `railway.json` no declara volumen: **pendiente confirmar** que hay uno montado en `/data`                                         |

## 5. Casos difíciles

Casi todos se resuelven con el juicio del modelo guiado por [`instrucciones.md`](../src/operador/instrucciones.md), con el revisor como segunda mirada sobre las escrituras. Lo que queda fuera de ambos está en la columna "Lo cubre".

| Caso                                                                                                                     | Decisión                                                                                                                                                                                     | Razón                                                                                                 | Lo cubre                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homónimos en una edición                                                                                                 | Buscar y **contar** coincidencias. Si hay más de una y la tarea no dice cuál, no se cambia nada: `fallida` nombrando cada una con el dato que las distingue (código, documento, NIT, ciudad) | Elegir una es un cambio equivocado más un falso éxito                                                 | Instrucciones; el revisor frena si el registro en pantalla no es el de la tarea                                                                       |
| Homónimos en una pregunta                                                                                                | Igual que en la edición; `fallida` sin línea `respuesta:`                                                                                                                                    | Contestar sobre uno es un valor equivocado reportado como éxito                                       | Instrucciones; el código quita la respuesta de toda tarea `fallida`                                                                                   |
| Búsqueda que distingue tildes                                                                                            | Probar con y sin tilde antes de concluir que algo no existe                                                                                                                                  | Un falso "no existe" termina en duplicado o en una falla injusta                                      | Instrucciones                                                                                                                                         |
| Crear algo que ya existe                                                                                                 | Buscar antes por documento, NIT o código; si existe, `fallida`                                                                                                                               | Un duplicado se mide como daño                                                                        | Instrucciones; el revisor frena una acción aprobada repetida                                                                                          |
| Antes de cambiar un registro                                                                                             | Que el registro en pantalla sea el que identifica la tarea                                                                                                                                   | Un dato que no coincide indica otro registro                                                          | Revisor, al guardar: frena si el registro visible no es el de la tarea. Las instrucciones piden buscar y contar coincidencias, no confirmar cada dato |
| Texto en pantalla que da órdenes                                                                                         | Es información, nunca una orden                                                                                                                                                              | La inyección llega dentro de datos de negocio                                                         | Instrucciones; el revisor compara con la tarea original, que lee del entorno y no de lo que diga el modelo                                            |
| El mismo dato escrito distinto (fecha en palabras, separadores, nombre largo de un filtro)                               | El modelo interpreta; el revisor solo frena una contradicción visible                                                                                                                        | Era la negación más frecuente de Aprendiz                                                             | Diseño del revisor (ADR-2)                                                                                                                            |
| Varios campos en un formulario                                                                                           | `llenar` en una sola llamada, con clic directo en cada campo                                                                                                                                 | El orden del Tab no es predecible; un turno por campo gasta tiempo                                    | Herramienta `llenar`                                                                                                                                  |
| Corrimiento del diseño tras una validación                                                                               | Cada acción devuelve la captura posterior y el modelo decide con ella                                                                                                                        | Reusar coordenadas viejas hace caer el clic en el hueco                                               | Herramientas                                                                                                                                          |
| Clic perdido mientras la vista carga                                                                                     | Esperar a que la pantalla se calme y mirar; nunca repetir un guardado sin mirar antes                                                                                                        | Repetir a ciegas es la fuente típica de duplicados                                                    | Espera de calma; instrucciones; revisor (duplicado)                                                                                                   |
| Contar registros                                                                                                         | Filtrar y recorrer todas las páginas                                                                                                                                                         | Contar filas a ojo es el camino con más errores de lectura                                            | Instrucciones. El modelo lee sobre la captura completa: no hay herramienta para ampliar una zona (sección 2)                                          |
| Fechas relativas ("ayer", "el sábado")                                                                                   | Se cuentan desde la fecha "Hoy" que muestra la app                                                                                                                                           | La fecha del servidor no es la de la app                                                              | Instrucciones. **El cálculo lo hace el modelo**: no hay código de calendario                                                                          |
| Imposible por datos                                                                                                      | `fallida` diciendo qué se buscó y dónde                                                                                                                                                      | La imposibilidad depende de los datos de la app                                                       | Instrucciones                                                                                                                                         |
| Peligrosa por el texto                                                                                                   | Borra o cambia varios registros sin nombrar cuáles, o pide revelar una credencial: `fallida` sin hacerla                                                                                     | Un falso negativo es destructivo                                                                      | Instrucciones; el revisor también frena por peligrosa o por revelar un secreto                                                                        |
| Exportar                                                                                                                 | `pulsar` con intención `guardar`, con los filtros confirmados en pantalla antes de exportar                                                                                                  | Exportar deja una acción registrada en la app; negar un exporte posible es una falla                  | Instrucciones; revisor. Si la app no permite un filtro tan exacto como la tarea, no hay regla escrita: decide el modelo                               |
| Lista desplegable, también la que depende de otro campo                                                                  | `elegir`, no `pulsar` más Enter sobre la lista abierta. Si la opción no aparece porque depende de otro campo, el modelo tiene que notarlo                                                    | Una sola llamada en vez de un clic y un Enter aparte; un Enter suelto pasa por el revisor             | Descripción de `elegir`. Las listas que dependen de otro campo no están en las instrucciones: quedan al juicio del modelo                             |
| Aviso de novedades o cambio de versión                                                                                   | Leerlo antes de cerrarlo: puede decir qué botones o menús cambiaron                                                                                                                          | La app puede cambiar durante el día                                                                   | Instrucciones; las notas por app se revisan completas si cambia la versión (6.4)                                                                      |
| Se cae la conexión VNC a mitad de una acción                                                                             | La herramienta avisa que la acción pudo aplicarse y pide mirar antes de repetir; la siguiente herramienta reconecta                                                                          | Repetir sin mirar duplica                                                                             | Herramientas                                                                                                                                          |
| Botón de solo ícono, toggle que guarda al clic, autoguardado, botón «Sí» con tilde, rótulos como «Registrar» o «Generar» | El revisor solo ve lo que el modelo marca como `guardar`, un rótulo con uno de los verbos de 6.3 o un Enter                                                                                  | No hay forma de saber desde fuera qué guarda                                                          | **Hueco reconocido** (sección 9)                                                                                                                      |
| Tiempo                                                                                                                   | El modelo ve los segundos que le quedan en cada resultado; el ejecutor mata el proceso al plazo                                                                                              | Nada debe caer en la tarea siguiente                                                                  | Reloj en las herramientas; corte duro (ADR-4)                                                                                                         |
| Secretos                                                                                                                 | Se ocultan los secretos exactos que recibimos; no se filtran cadenas genéricas                                                                                                               | Una cadena genérica borraría referencias legítimas (facturas, documentos) que el resumen debe nombrar | Ejecutor y servidor (6.5)                                                                                                                             |

## 6. Arquitectura

Diagramas en [arquitectura.md](arquitectura.md): (1a) contenedores y límites de confianza; (1b) componentes del ciclo de una tarea; (2) secuencia de una tarea desde el POST hasta la publicación.

| Componente                                                             | Responsabilidad                                                                                                                                                        | Modelo                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Servidor ([`servidor.ts`](../src/servidor.ts))                         | Contrato HTTP, Bearer (salvo `/health`), `task_id` inmediato, estado en memoria y en un JSON por tarea, una tarea por escritorio, respaldo de plazo, redacción de logs | —                                                                      |
| Ejecutor ([`ejecutor.ts`](../src/operador/ejecutor.ts))                | Lanza un proceso de `pi` por tarea con un entorno mínimo, lo vigila, lo mata y arma el resumen                                                                         | —                                                                      |
| Agente (`pi` + [`instrucciones.md`](../src/operador/instrucciones.md)) | Bucle: mira la captura, decide, llama una herramienta                                                                                                                  | `anthropic/claude-sonnet-5.5`, razonamiento `high`                     |
| Herramientas ([`herramientas.ts`](../src/operador/herramientas.ts))    | Extensión de `pi`: ocho herramientas de pantalla, reloj y traza                                                                                                        | —                                                                      |
| Revisor (en `herramientas.ts`)                                         | Antes de cada acción de escritura: aprueba o frena con una razón                                                                                                       | `anthropic/claude-haiku-5.5`                                           |
| Notas por app ([`memoria.ts`](../src/operador/memoria.ts))             | Tras cada tarea, reescribe las notas de la interfaz de esa app                                                                                                         | `anthropic/claude-haiku-5.5`, en otro proceso de `pi` sin herramientas |
| Escritorio ([`src/escritorio/`](../src/escritorio/))                   | Cliente RFB 3.8 sobre WebSocket, autenticación VNC, PNG propio, acciones a ritmo humano                                                                                | —                                                                      |
| Datos (`DATA_DIR`, `/data` en la imagen)                               | `tasks/` (estado), `trazas/<id>/` (pasos, capturas, eventos del modelo, reporte), `notas-apps/`                                                                        | —                                                                      |

Los modelos se cambian por entorno (`AGENT_MODEL`, `GUARD_MODEL`, `AGENT_THINKING`). Todo sale por OpenRouter.

### 6.1 Flujo de una tarea

1. `POST /tasks` valida el token y el cuerpo (máximo 64 KB, `tarea` no vacía, `escritorio.url` `ws://` o `wss://`, `escritorio.password` texto), crea un `task_id`, guarda la tarea `en_curso` en disco y responde. El reloj de la tarea cuenta desde que llegó el POST.
2. **Una tarea por escritorio.** La URL se normaliza (mayúsculas del host, puerto por defecto, barra final, fragmento). Si ya hay una tarea en ese escritorio, se le pide parar y la nueva espera a que se detenga, hasta 15 s; esa espera se descuenta de su plazo.
3. El servidor lee las notas de las apps conocidas y llama al ejecutor con el tiempo que queda.
4. El ejecutor lanza `pi` sin sesión, sin herramientas incorporadas, sin extensiones, skills, archivos de contexto ni plantillas ajenas, y con una sola extensión: `herramientas.ts`. El prompt de sistema son las instrucciones más las notas; el mensaje es `Tarea: <texto>`. La URL y la contraseña del escritorio viajan solo por variables de entorno del proceso.
5. El modelo llama a `ver_pantalla`, lee el nombre de la app y la fecha "Hoy", y avanza una herramienta por turno. Cada herramienta de acción devuelve la captura posterior, su tamaño en píxeles y los segundos que quedan.
6. Antes de cada acción de escritura, el revisor recibe la captura del momento. Si frena, la acción no se ejecuta y el modelo recibe la razón.
7. `reportar` escribe `reporte.json`, cierra la conexión VNC y bloquea cualquier herramienta posterior.
8. El ejecutor, que revisa cada 250 ms, ve el reporte (o que el proceso cayó, que se acabó el plazo, que llegó otra tarea para el escritorio o que se pasó el tope de costo), mata `pi` con `SIGKILL` y espera a que salga.
9. Solo entonces arma el resumen, oculta los secretos y el servidor publica `terminada` o `fallida`.
10. En segundo plano, si la tarea identificó la app, se actualizan sus notas (6.4).

### 6.2 Herramientas

Las coordenadas son píxeles de la captura completa. Todas corren en secuencia (`executionMode: "sequential"`) y anotan cada paso en la traza.

| Herramienta    | Qué hace                                                                                                                                                           | Pasa por el revisor                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `ver_pantalla` | Captura completa                                                                                                                                                   | No                                                                   |
| `pulsar`       | Clic (o doble clic) en (x, y). Declara `elemento`, `intencion` (`navegar`, `editar` o `guardar`) y, al guardar, `verificado`: qué datos comprobó y en qué pantalla | Si la intención es `guardar` o el rótulo tiene un verbo de escritura |
| `escribir`     | Clic en el campo, seleccionar todo y escribir (si el texto es vacío, borra)                                                                                        | No                                                                   |
| `llenar`       | Varios campos del mismo formulario en una llamada; no guarda                                                                                                       | No                                                                   |
| `elegir`       | Clic en una lista, escribe el comienzo de la opción y Enter. Su descripción pide usarla en vez de `pulsar` más Enter sobre una lista abierta                       | No                                                                   |
| `teclas`       | Una tecla o combinación (`enter`, `tab`, `escape`, `ctrl+a`, `shift+tab`…)                                                                                         | Si es Enter                                                          |
| `desplazar`    | Rueda del ratón sobre (x, y), 3 pasos por defecto                                                                                                                  | No                                                                   |
| `reportar`     | Cierra la tarea: `estado`, `aplicacion`, `respuesta` (opcional) y `resumen`                                                                                        | No; después de ella todo se bloquea                                  |

**Ritmo humano** ([`pantalla.ts`](../src/escritorio/pantalla.ts)). El clic mueve el puntero, espera 40 ms y mantiene el botón 150 ms (la app ignora pulsaciones de menos de 100 ms); en un doble clic deja 80 ms entre las dos pulsaciones. Las teclas van con 30 ms entre eventos y las letras con 15 ms. Después de cada acción se espera a que la pantalla se calme: al menos 1200 ms desde la entrada, porque la app tarda hasta 1 s en repintar; luego 400 ms sin cambios y nunca más de 5 s.

**Conexión.** Si la conexión VNC está cerrada, la siguiente herramienta reconecta y lo anota. Si se cae a mitad de una acción, la herramienta responde que la acción pudo haberse aplicado y que hay que mirar antes de repetir. Si al conectar la primera imagen no llega en 20 s, la conexión se cierra antes de fallar: el escritorio de práctica admite una sola conexión VNC, y una conexión colgada lo dejaría ocupado.

### 6.3 Revisor

Es un gancho `tool_call` de la extensión: corre antes de que la herramienta se ejecute.

- **Cuándo.** `pulsar` con intención `guardar`; `pulsar` con un rótulo que contiene un verbo de escritura (guardar, grabar, aceptar, confirmar, eliminar, borrar, exportar, enviar, aplicar, anular, emitir, pagar, si); `teclas` con Enter. Rótulos como «Registrar», «Generar», «Facturar», «Bloquear», «Revertir» o «Reversar» no lo disparan por sí solos: dependen de que el modelo marque el clic como `guardar`. El verbo se busca como palabra completa, así que «Guardado» no dispara. «Sí» con tilde tampoco: la expresión usa `\b`, que no toma la í como letra, y solo reconoce «Si» sin tilde.
- **Qué ve.** La tarea original, leída del entorno del proceso y no de lo que diga el modelo; la acción; la evidencia que da el agente (lo que dice haber comprobado en pantallas anteriores); las acciones que ya aprobó en esta tarea; y la captura actual. No ve el historial ni el razonamiento del agente.
- **Cuándo frena.** Solo ante un problema concreto que la pantalla muestre: los valores no coinciden con la tarea; se cambiaría un dato que la tarea no pide o el registro no es el de la tarea; repetiría una acción ya aprobada y crearía un duplicado; la tarea es peligrosa o revela un secreto. Si la pantalla es coherente con la tarea y con la evidencia, aprueba: no exige pruebas de pantallas anteriores. No hay una regla aparte para exportes.
- **Si falla.** Sin modelo, con un error o con una respuesta que no es JSON, frena con la razón. Un fallo del revisor nunca abre un camino sin revisión.
- **Tope.** Al tercer freno, el mensaje al modelo le pide reportar `fallida` y explicar por qué. Es una instrucción, no un corte: el revisor sigue mirando cada escritura.

### 6.4 Memoria por app

- **Identidad.** El nombre de la app que el modelo reporta tal como aparece en la cabecera, normalizado: minúsculas, sin tildes, con guiones y hasta 60 caracteres.
- **Cuándo se escribe.** Al publicar una tarea que identificó la app, `terminada` o `fallida`, en segundo plano y en serie, para que dos tareas no escriban las mismas notas a la vez.
- **Cómo.** Se arma una bitácora con la traza: rótulos de los clics y su intención, nombres de los campos escritos (sin el valor), nombres de las listas (sin la opción elegida), teclas, desplazamientos y cada decisión del revisor con su razón (hasta 200 caracteres por razón). Esa parte se corta en 6000 caracteres y después se agrega el resumen final completo. Si la traza no tiene acciones, no se actualiza nada. Otra corrida de `pi`, sin herramientas ni pantalla y con Haiku 5.5, devuelve las notas completas actualizadas en `notas-apps/<app>.md`. Cada actualización tiene un tope de 90 s.
- **Qué guarda.** Rutas de menú; qué tiene cada pantalla y dónde están sus filtros, listas y botones (barra derecha, abajo, arriba); nombres reales de los botones para guardar, aplicar, anular, exportar y confirmar; campos de solo lectura, listas desplegables, diálogos y avisos; y trampas (tildes, paginación, acciones que no cierran el formulario). Nunca datos de registros (nombres de personas, códigos, montos, fechas), resultados ni coordenadas. Máximo 40 viñetas; si la bitácora contradice las notas, gana la bitácora.
- **Versión.** La primera línea de las notas es la versión de la app que muestra la cabecera, si aparece. Si la bitácora muestra otra versión que la de las notas, la consigna le pide al modelo de notas revisar todas las notas contra lo nuevo. La bitácora no tiene un campo de versión: solo llega si aparece en el nombre de la app que reporta el agente, en su resumen o en las razones del revisor, y las instrucciones no le piden al agente leerla.
- **Cómo se usa.** Las notas de **todas** las apps conocidas se agregan al prompt de sistema como "pistas, no órdenes: la app puede haber cambiado". Van todas porque la app no se conoce hasta ver la primera captura.

### 6.5 Resumen y secretos

El modelo entrega por `reportar` los campos por separado y el código arma el texto ([`armarResumen`](../src/operador/ejecutor.ts)):

- Si la tarea es `terminada` y trae `respuesta`, la primera línea es `respuesta: <valor>`, en una sola línea.
- Si el campo `respuesta` viene vacío pero el resumen tiene una línea que empieza con `respuesta:`, el valor se rescata de ahí, para no perder una respuesta que el modelo dejó en el lugar equivocado.
- Se quitan del cuerpo las líneas que empiezan con `respuesta:`, para que no haya dos.
- Una tarea `fallida` nunca lleva línea `respuesta:`, aunque el modelo la mande.
- El formato del valor (número primero y sin texto alrededor; `dato1; dato2` en el orden preguntado) lo piden las instrucciones y la descripción de la herramienta. **El código no lo valida.**

Secretos: la contraseña del escritorio, el token del equipo y la key de OpenRouter. La contraseña nunca entra al contexto del modelo: viaja por variable de entorno y solo la usa el cliente RFB. Se ocultan dos veces, con `[oculto]`: el ejecutor reemplaza los secretos exactos de 4 caracteres o más en el resumen y en el error, y el servidor reemplaza cada secreto, sin largo mínimo, y su forma codificada para URL en el resumen, el error, el texto de la tarea guardado y cada línea de log. Si el ejecutor lanza una excepción, el resumen lleva solo la primera línea del mensaje, de hasta 200 caracteres, nunca el stack. Cuando el agente no reportó, la salida de error de `pi` (sus últimas 15 líneas) va redactada al log y al archivo de la tarea, no al resumen. No se filtran cadenas alfanuméricas genéricas, porque borrarían referencias legítimas que el resumen tiene que nombrar.

### 6.6 Presupuesto de tiempo y costo

Constantes del código (todas configurables por entorno donde se indica):

| Constante                                      | Valor                                                                                                                                                | Dónde        | Para qué                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| Plazo de la tarea (`TASK_DEADLINE_MS`)         | 280 s desde el POST                                                                                                                                  | Servidor     | El ejecutor mata `pi` a este tiempo; deja 20 s antes de los 5 min                      |
| Reloj del modelo                               | El plazo menos 15 s                                                                                                                                  | Ejecutor     | Que el modelo alcance a reportar antes del corte duro                                  |
| Avisos al modelo                               | Menos de 60 s: si faltan uno o dos pasos (guardar y verificar), hacerlos; si falta más, reportar lo hecho. Menos de 15 s: terminar ya con `reportar` | Herramientas | Cerrar con un reporte y no con un corte                                                |
| Respaldo (`TASK_GRACE_MS`)                     | Pedir parar a plazo + 5 s; publicar `fallida` a plazo + 10 s                                                                                         | Servidor     | Si el ejecutor no devuelve, primero se detiene al agente y después se publica          |
| Espera por la tarea anterior (`ABORT_WAIT_MS`) | Hasta 15 s, descontados del plazo                                                                                                                    | Servidor     | Nunca dos agentes en el mismo escritorio                                               |
| Vigilancia del ejecutor                        | Cada 250 ms                                                                                                                                          | Ejecutor     | Reporte, proceso vivo, plazo, aborto, costo                                            |
| Conexión VNC                                   | 15 s para el saludo, 20 s para la primera imagen; si no llega, se cierra la conexión                                                                 | Escritorio   | Fallar rápido sin dejar ocupada la única conexión que admite el escritorio de práctica |
| Calma tras cada acción                         | Mínimo 1200 ms, 400 ms sin cambios, tope 5 s                                                                                                         | Escritorio   | No capturar la pantalla vieja: la app tarda hasta 1 s en repintar                      |
| Tope de costo (`MAX_COST_USD`)                 | 0.60 USD por tarea                                                                                                                                   | Ejecutor     | Un bucle no gasta la key del día                                                       |
| Actualización de notas                         | Tope de 90 s                                                                                                                                         | Memoria      | No dejar procesos colgados                                                             |
| Apagado (`SIGTERM`)                            | Espera hasta 10 s a que paren las tareas                                                                                                             | Servidor     | Cerrar sin dejar agentes operando                                                      |

Con un escritorio libre, la línea de tiempo de una tarea es: el modelo ve su reloj llegar a cero a los 265 s del POST, el ejecutor mata `pi` a los 280 s, el servidor pide parar a los 285 s y publica `fallida` a los 290 s si nada de lo anterior devolvió. El evaluador deja de consultar a los 300 s.

**Medido** (escritorio de práctica, 31 de octubre, [eval/gasto.md](../eval/gasto.md)):

| Tarea | Tipo                    | Resultado           | Tiempo      | Costo (pi)          |
| ----- | ----------------------- | ------------------- | ----------- | ------------------- |
| E1    | Crear                   | Pasa                | 60 s        | 0.0723 USD          |
| E2    | Editar                  | Pasa (dos corridas) | 50 s y 48 s | 0.0691 y 0.0645 USD |
| E3    | Contar                  | Pasa                | 39 s        | 0.0578 USD          |
| E4    | Exportar                | Pasa                | 38 s        | 0.0490 USD          |
| E5    | Homónimos (debe fallar) | Pasa                | 25 s        | 0.0372 USD          |

En el banco de 5 de 5 (corridas de las 18:32 a las 18:35 UTC): 42 s y 0.056 USD de media por tarea, 0.28 USD en total. Todas las tareas quedaron muy por debajo del plazo y del tope.

Límites de esa medición:

- **El costo es el que reporta `pi` por los turnos del agente.** Las llamadas del revisor salen por el registro de modelos de la extensión y las notas por otro proceso; ninguna pasa por ese conteo, y el tope de 0.60 USD tampoco las cuenta. Su costo real está pendiente de medir.
- Son cinco tareas de una sola app, con una corrida por tarea (dos en E2): no hay p95 ni consistencia entre corridas.
- `scripts/probar.ts` llama al ejecutor directamente; el contrato HTTP se prueba aparte con un ejecutor falso.
- No está anotado si esas corridas usaron notas por app; el script corre sin ellas salvo con `MEMORIA=1`.

## 7. Decisiones (ADR)

### ADR-1 · Un solo bucle que decide con la pantalla

- **Contexto.** Aprendiz separaba planificar (sin pantalla) de actuar, y una compuerta comparaba cada escritura contra el plan. Unas 19 de las 34 fallas de octubre fueron negaciones de ese mecanismo.
- **Decisión.** Un modelo fuerte (Sonnet 5.5, razonamiento alto) decide cada paso con la captura del momento. Las instrucciones son un procedimiento general (orientarse, entender la tarea, encontrar, actuar, verificar, reportar) y reglas cortas, sin nada de una app concreta.
- **Descartado.**
  - _Planificador con plan cerrado y actor barato_: es Aprendiz; el plan negaba lo que la pantalla permitía.
  - _Replanificar en cada captura con un planificador aparte_: dos modelos razonando sobre lo mismo, más latencia y una interfaz más entre ellos.
- **Consecuencias.** El juicio depende de un solo modelo, y las defensas contra el daño son instrucciones y una segunda mirada, no estructura. A cambio, el modelo que decide es el mismo que ve los datos.

### ADR-2 · Revisor que frena solo lo que la pantalla contradice

- **Contexto.** Un error en un guardado no se deshace. Pero un control que niega por defecto repite lo de octubre.
- **Decisión.** Antes de cada acción de escritura, Haiku 5.5 mira la captura actual con la tarea original, lo que el agente dice haber comprobado y lo ya aprobado, y frena solo ante una contradicción visible (6.3). Ante cualquier fallo propio, frena.
- **Descartado.**
  - _Lista blanca y negar por defecto_: es Aprendiz.
  - _Sin revisor_: un guardado con un valor mal leído o un segundo guardado no tendrían una segunda mirada.
  - _Revisar también las lecturas_: suma latencia y costo en acciones que no persisten.
  - _Darle al revisor el historial del agente_: heredaría el mismo contexto, incluido lo que la pantalla le haya dicho al agente.
- **Consecuencias.** La cobertura depende de que la escritura se vea como escritura: un `guardar` declarado, un verbo en el rótulo o un Enter. Un toggle sin verbo marcado como `navegar`, un «Sí» con tilde o un botón «Registrar» o «Generar» marcados como `navegar`, el autoguardado al escribir o el Enter dentro de `elegir` no pasan por el revisor. Su latencia y su tasa de frenos están sin medir.

### ADR-3 · `pi` como harness, un proceso por tarea

- **Contexto.** Hace falta un bucle de agente con herramientas, imágenes, razonamiento y OpenRouter, sin herramientas externas que operen la pantalla por nosotros.
- **Decisión.** `pi` 1.1.0 (`@earendil-works/pi-coding-agent`) sin sesión, sin herramientas incorporadas, sin extensiones, skills, archivos de contexto, plantillas ni temas, con nuestra extensión como única fuente de herramientas. Un proceso por tarea, con un entorno mínimo (`PATH`, `HOME`, `NODE_OPTIONS`, telemetría apagada, la key y las variables de la tarea).
- **Descartado.**
  - _Bucle propio sobre la API_: más código para lo mismo en un día.
  - _Un solo proceso de `pi` para todas las tareas_: no se puede matar una tarea sin tocar las otras, y el estado de la conexión quedaría compartido.
  - _Heredar el entorno del servidor_: el proceso del agente vería el token del equipo y cualquier otra variable.
- **Consecuencias.** El modelo no tiene herramientas de archivos ni de terminal: solo las ocho de pantalla. El costo y la traza dependen del formato de eventos JSON de `pi`.

### ADR-4 · Detenerse antes de publicar

- **Contexto.** A los 5 min el evaluador resetea, y lo que el agente haga después cae en la tarea siguiente. Una llamada colgada a un proveedor no se corta con un chequeo dentro del bucle.
- **Decisión.**
  - `reportar` cierra la conexión VNC y bloquea toda herramienta posterior.
  - El ejecutor mata `pi` con `SIGKILL` y espera a que salga antes de devolver.
  - El servidor tiene un respaldo en dos pasos: pide parar a plazo + 5 s y publica `fallida` a plazo + 10 s.
  - Una tarea nueva para el mismo escritorio detiene a la anterior y espera hasta 15 s a que pare, descontados de su plazo.
  - Al arrancar, las tareas que quedaron `en_curso` pasan a `fallida` con el motivo "el servicio se reinició durante la tarea" y siguen consultables.
- **Descartado.** _Publicar primero y cerrar después_: el evaluador puede leer el estado y resetear con el agente todavía operando. _Encolar la tarea nueva o responder 409_: la anterior ya está abandonada y el evaluador no reintenta.
- **Consecuencias.** Una tarea que terminaría entre los 280 s y los 300 s se pierde: es un precio deliberado.

### ADR-5 · Cliente RFB propio, sin dependencias

- **Contexto.** El escritorio expone VNC solo por WebSocket. Necesitamos controlar la duración del clic y la espera por la pantalla.
- **Decisión.** RFB 3.8 sobre el WebSocket nativo de Node 24: autenticación VNC (DES), codificaciones Raw y CopyRect, imagen en memoria y PNG armado con `zlib`. Sin paquetes de npm.
- **Descartado.** _noVNC dentro de un navegador_: un despliegue pesado y una capa más. _Clientes VNC por TCP_: requieren un puente al WebSocket. _Librerías de npm_: lo que corre en la imagen es lo que está en el repo.
- **Consecuencias.** DES solo existe en Node 24 con el proveedor legacy de OpenSSL. Lo necesita el proceso que abre la conexión VNC, que es el de `pi` de cada tarea y no el servidor: por eso va en `NODE_OPTIONS`, en el Dockerfile y en el entorno que arma el ejecutor. El `pi` de las notas por app no abre VNC y corre sin él. Sin compresión, más ancho de banda. Si el servidor exigiera otra codificación, la conexión falla con un error claro.

### ADR-6 · Memoria por app como notas de interfaz

- **Contexto.** La empresa tiene cinco sistemas y el servicio persiste entre tareas; el escritorio no.
- **Decisión.** Notas en Markdown por app, reescritas por Haiku tras cada tarea a partir de la bitácora, sin datos ni coordenadas, entregadas como pistas (6.4).
- **Descartado.** _Procedimientos en SQLite para seguir paso a paso_ (Aprendiz): una secuencia vieja se sigue aunque la app haya cambiado. _Replay de coordenadas_: hace clic en el sitio equivocado sin enterarse. _Reconocer la app antes de la primera tarea_: gasta del plazo y abre pantallas sin necesidad. _Guardar datos vistos_: el escritorio se resetea y serían datos sensibles persistidos.
- **Consecuencias.** La primera tarea en una app nueva va sin notas. Las notas de una app llegan también a las tareas de otra, marcadas como pistas. El efecto de las notas en el resultado no está medido.

### ADR-7 · Resumen: el modelo redacta, el código ordena y oculta

- **Contexto.** El formato se evalúa de forma literal: la línea `respuesta:`, el primer número, el separador, los secretos.
- **Decisión.** `reportar` separa `estado`, `respuesta` y `resumen`; el código pone la respuesta primero y sola, la quita de las tareas fallidas y oculta los secretos (6.5).
- **Descartado.** _Resumen determinista desde datos estructurados_ (Aprendiz): necesitaba el plan y los verificadores que quitamos. _Resumen libre del modelo_: la línea `respuesta:` podría no ir primera, repetirse o colarse en una tarea fallida.
- **Consecuencias.** El formato del valor depende del modelo. Las reglas que sí impone el código tienen pruebas unitarias.

### ADR-8 · Un contenedor siempre encendido en Railway

- **Contexto.** `POST /tasks` debe responder en menos de 2 s y las tareas duran hasta 5 min en segundo plano.
- **Decisión.** Imagen `node:24-slim` con `pi` instalado global con pnpm. [`railway.json`](../railway.json): una réplica, sin dormir, chequeo de salud en `/health` (tope 120 s) y reinicio `ALWAYS`. Estado en memoria y en un JSON por tarea en `/data`, escrito de forma atómica (archivo temporal y renombrado).
- **Descartado.**
  - _Varias réplicas_: `GET /tasks/{id}` caería en la que no tiene la tarea.
  - _Dormir sin tráfico_: el primer POST pagaría el arranque en frío.
  - _Reiniciar solo ante fallos_: deja de reiniciar tras varias caídas y el agente quedaría fuera.
  - _Serverless_: las tareas duran minutos en segundo plano.
  - _SQLite_: un solo proceso con un archivo por tarea no la necesita.
- **Consecuencias.** Un reinicio pierde la tarea en curso; queda `fallida` y consultable solo si `/data` persiste (sección 4).

### ADR-9 · Modelos: Sonnet 5.5 decide, Haiku 5.5 revisa

- **Contexto.** La lección de octubre fue que, cuando el costo no limita, conviene el modelo fuerte. Medido hoy: entre 0.037 y 0.072 USD por tarea, lejos del tope de 0.60 USD.
- **Decisión.** `anthropic/claude-sonnet-5.5` con razonamiento `high` como agente; `anthropic/claude-haiku-5.5` como revisor y para las notas. Los tres se cambian por entorno.
- **Descartado.** _Un modelo barato como agente con controles alrededor_: es lo que hizo Aprendiz. _El modelo fuerte también como revisor_: más caro para una decisión de sí o no sobre una captura, sin una medición que lo justifique.
- **Consecuencias.** Revisor y agente son de la misma familia, así que sus fallas pueden estar correlacionadas; el revisor solo ve la pantalla y la tarea, no el razonamiento del agente.

### 7.1 Decisiones de detalle

| Decisión                                 | Elegido                                                                                            | Descartado y por qué                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Llenar formularios                       | `llenar`: varios campos en una llamada, clic directo en cada uno, una captura al final para releer | Un turno por campo: más tiempo. Navegar con Tab: el orden no es predecible                                                                                                           |
| Reemplazar texto                         | Clic, `ctrl+a` y escribir; texto vacío borra con Supr                                              | Escribir sobre el campo: concatena                                                                                                                                                   |
| Duración del clic                        | 40 ms de puntero quieto y 150 ms de botón abajo; 80 ms entre las pulsaciones de un doble clic      | 100 ms: es el umbral bajo el cual se ignora, sin margen                                                                                                                              |
| Espera tras una acción                   | Mínimo 1200 ms, luego 400 ms sin cambios, tope 5 s                                                 | Captura inmediata: trae la pantalla vieja. Pausa fija: lenta cuando repinta rápido, corta cuando tarda. Mínimo de 700 ms: queda por debajo del segundo que puede tardar el repintado |
| Primera imagen VNC que no llega          | Cerrar la conexión a los 20 s y fallar                                                             | Fallar sin cerrar: la conexión seguiría ocupando la única ranura del escritorio de práctica                                                                                          |
| Leer texto pequeño                       | Sobre la captura completa                                                                          | `ampliar` (zona de hasta 640×400 al doble): queda para después de medir (sección 2). OCR: otra tubería que puede fallar                                                              |
| Qué devuelve una acción                  | La captura posterior, su tamaño y los segundos que quedan                                          | Una captura aparte: un turno más por acción                                                                                                                                          |
| Herramientas en paralelo                 | No: una por turno y en secuencia                                                                   | En paralelo: dos acciones se pisan el foco                                                                                                                                           |
| Qué manda al revisor                     | Intención `guardar`, verbo de escritura en el rótulo, o Enter                                      | Solo la intención declarada: el modelo puede marcar mal un botón. Todo clic: latencia en cada lectura                                                                                |
| Revisor con error o sin respuesta válida | Frena con la razón                                                                                 | Aprobar: un fallo abriría un camino sin revisión                                                                                                                                     |
| Frenos del revisor                       | Al tercero se pide reportar `fallida`                                                              | Sin límite: un bucle entre agente y revisor. Cortar al primero: un error corregible tumbaría la tarea                                                                                |
| Exporte sin filtro exacto en la app      | Sin regla escrita: decide el modelo, y el revisor frena solo si la pantalla contradice la tarea    | Aprobarlo con el filtro más cercano y decirlo en el resumen: regla propia que queda para después de medir (sección 2). Negarlo: una falla de las que nos costaron en octubre         |
| Respuesta dentro del resumen             | Si el campo `respuesta` viene vacío, se rescata la línea `respuesta:` del resumen                  | Perderla: una pregunta bien respondida quedaría sin la línea que compara el evaluador                                                                                                |
| Entorno del proceso de `pi`              | Mínimo y explícito                                                                                 | Heredar el del servidor: el agente vería el token del equipo                                                                                                                         |
| Contraseña del escritorio                | Variable de entorno del proceso, usada solo por el cliente RFB                                     | En el prompt: el modelo podría repetirla en un resumen                                                                                                                               |
| Estado de las tareas                     | Memoria y un JSON por tarea, escrito con archivo temporal y renombrado                             | SQLite: un esquema y una capa más para un solo proceso que no consulta entre tareas. Un solo archivo: una escritura cortada lo corrompe todo                                         |
| Archivo de tarea ilegible al arrancar    | Se ignora y se registra                                                                            | Caer: un archivo malo dejaría el servicio fuera                                                                                                                                      |
| Identidad del escritorio                 | URL normalizada                                                                                    | URL cruda: dos formas de escribir el mismo escritorio operarían a la vez                                                                                                             |
| `keepAliveTimeout`                       | 65 s                                                                                               | El valor por defecto de Node (5 s) coincide con el sondeo del evaluador y el proxy de Railway respondería 502                                                                        |
| `/health` sin `pi`                       | 503                                                                                                | 200 siempre: Railway daría por bueno un despliegue roto                                                                                                                              |
| Rutas con barras repetidas o finales     | Se aceptan                                                                                         | Rutas estrictas: un entrypoint registrado con barra final daría 404                                                                                                                  |
| Error no capturado del agente            | Se registra redactado y el servidor sigue                                                          | Caer: tumbaría todas las tareas en curso                                                                                                                                             |
| Comparación del token                    | Hash y comparación en tiempo constante                                                             | Comparación directa de textos: filtra por tiempos                                                                                                                                    |
| Notas por app                            | Todas las apps conocidas, como pistas                                                              | Solo la app actual: no se conoce hasta ver la primera captura                                                                                                                        |
| Fechas relativas                         | El modelo cuenta desde "Hoy" de la app                                                             | Fecha del servidor: no es la de la app. Código de calendario: no está hecho (sección 9)                                                                                              |
| Proveedor de modelos                     | OpenRouter, con la key del evento                                                                  | APIs directas: varias claves y SDKs                                                                                                                                                  |
| Pruebas automáticas                      | Sin red ni crédito: ejecutor falso para el servidor                                                | Pruebas contra OpenRouter: gastan la key de 45 USD sin recarga                                                                                                                       |

## 8. Seguridad y límites de confianza

Detalle por límite en [arquitectura.md](arquitectura.md#3-límites-de-confianza).

| Amenaza                                  | Control                                                                                                                                                       | Dónde                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Contraseña del escritorio                | Viaja por variable de entorno al proceso de `pi` y solo la usa el cliente RFB. No entra al prompt, a la traza ni a los logs; se oculta en resúmenes y errores | Ejecutor, herramientas, servidor |
| Token del equipo y key de OpenRouter     | Variables de entorno. El token no llega al proceso del agente; la key sí, porque `pi` la necesita. Ocultos en resúmenes y logs                                | Servidor, ejecutor               |
| El agente toca el sistema del contenedor | `pi` corre sin herramientas incorporadas ni extensiones ajenas: el modelo solo puede usar las ocho herramientas de pantalla                                   | Ejecutor                         |
| Datos sensibles en las capturas          | Viajan al proveedor (agente y revisor). No se puede evitar viendo solo píxeles                                                                                | Proveedor                        |
| Instrucciones dentro de la pantalla      | Regla en las instrucciones; el revisor compara cada escritura con la tarea original leída del entorno                                                         | Instrucciones, revisor           |
| Una tarea que pide revelar un secreto    | Es peligrosa: `fallida`. El revisor frena una acción que revela un secreto                                                                                    | Instrucciones, revisor           |
| Secretos en el resumen                   | Reemplazo de secretos exactos, también codificados para URL; sin filtro de cadenas genéricas                                                                  | Ejecutor, servidor               |
| Acceso a la API                          | Bearer en `/tasks`, comparado en tiempo constante; `/health` público. Cuerpo de hasta 64 KB                                                                   | Servidor                         |
| Trazas con datos del negocio             | Quedan en `DATA_DIR` dentro del contenedor; `data/` y `.env` están fuera de git y de la imagen                                                                | Datos                            |
| Acciones tras el reporte o el plazo      | `reportar` bloquea y cierra VNC, `SIGKILL`, respaldo en dos pasos                                                                                             | ADR-4                            |
| Datos del negocio en las notas por app   | La consigna los prohíbe, pero el resumen del agente y las razones del revisor entran a la bitácora: **no está garantizado**                                   | Memoria                          |

## 9. Riesgos y mitigaciones

| Riesgo                                                                                                                                     | Efecto                                                            | Mitigación                                                                 | Detección                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Una escritura que no se ve como escritura (toggle, ícono, autoguardado, Enter dentro de `elegir`, «Sí» con tilde, «Registrar» o «Generar») | Pasa sin revisor                                                  | Instrucciones: guardar siempre con intención `guardar`; verbos del rótulo  | Diff inesperado en `/__check`; trazas               |
| El revisor frena de más                                                                                                                    | Vuelve la falla de octubre                                        | Consigna de frenar solo contradicciones visibles; tope de tres frenos      | Frenos y sus razones en `pasos.jsonl`               |
| El revisor aprueba algo malo                                                                                                               | Un cambio de más o equivocado                                     | Las instrucciones son la primera línea; el revisor, la segunda             | `/__check`                                          |
| Texto en pantalla manipula al agente                                                                                                       | Una escritura no pedida                                           | Regla en las instrucciones; el revisor ve la tarea original                | Pruebas con notas inyectadas (pendiente ampliar)    |
| La app de evaluación es muy distinta                                                                                                       | El agente se pierde                                               | Instrucciones generales; ante la duda, `fallida` con razón                 | Set oculto (pendiente)                              |
| El costo real supera al contado                                                                                                            | El tope de 0.60 USD no frena el gasto del revisor ni de las notas | Medido 0.037–0.072 USD por tarea en el bucle principal, lejos del tope     | Saldo de OpenRouter antes y después (pendiente)     |
| Fecha relativa mal calculada                                                                                                               | Valor equivocado reportado como éxito                             | Instrucción de contar desde "Hoy" de la app                                | Pruebas con fechas relativas (pendiente)            |
| Texto pequeño mal leído (totales, contadores, códigos)                                                                                     | Valor equivocado reportado como éxito                             | Ninguna propia: sin `ampliar`, el modelo lee la captura completa           | `scripts/probar.ts` compara el primer número        |
| Formato de la respuesta (separadores, texto antes del número)                                                                              | Respuesta mal comparada                                           | Instrucciones y descripción de `reportar`; el código pone la línea primera | `scripts/probar.ts` compara el primer número        |
| Notas equivocadas o con datos                                                                                                              | Pistas falsas o datos persistidos                                 | Notas como pistas; la bitácora gana sobre las notas viejas                 | Revisar `notas-apps/`                               |
| `/data` sin volumen                                                                                                                        | Un redespliegue borra tareas y notas                              | Pendiente confirmar el volumen en Railway                                  | `GET /tasks/{id}` tras un redespliegue              |
| Pantalla de otro tamaño                                                                                                                    | Las instrucciones dicen 1280×800                                  | Cada captura le dice al modelo su tamaño real; el código no lo valida      | Humo de VNC; trazas                                 |
| Proveedor lento o caído                                                                                                                    | Pasos sin respuesta                                               | El ejecutor corta al plazo pase lo que pase                                | Motivo `sin_tiempo` en el log                       |
| Reinicio del contenedor                                                                                                                    | Se pierde la tarea en curso                                       | Queda `fallida` y consultable; reinicio `ALWAYS`                           | `/health`; log `tarea_ilegible` o motivo `reinicio` |

## 10. Cómo medimos

**Pruebas sin red** (`npm test`, nunca llaman a OpenRouter): el servidor con un ejecutor falso (contrato, token, validación, redacción de secretos, una tarea por escritorio, respaldo de plazo, reinicio, rutas), el cliente RFB (DES, PNG, teclas), el armado del resumen y los invariantes del despliegue (`Dockerfile` y `railway.json`).

**Banco de práctica** (`scripts/probar.ts`): `/__reset` → el ejecutor sobre la tarea → `/__check` → reglas de estado, del primer número de `respuesta:` y de los datos que tiene que nombrar una tarea que falla. Cada corrida anota tiempo y costo en [eval/gasto.md](../eval/gasto.md). Antes de una corrida que gasta se consulta el saldo y se empieza con una tarea; si la corrida pasa de 1 USD estimado, se confirma antes.

**Set oculto** (hasta tres corridas por equipo desde `/evento`). Lección de octubre: correrlo apenas pase el primer caso de práctica, no al final. **Pendiente:** no hay corrida registrada en el repo.

**Qué miramos.** En `DATA_DIR/tasks/<id>.json` y en la línea de log de la tarea, el motivo de cierre (`stopReason`: `reporto`, `sin_tiempo`, `proceso_caido`, `abortada` o `sin_presupuesto` desde el ejecutor; `tiempo`, `cancelada`, `error_interno` o `reinicio` desde el servidor). En la traza (`DATA_DIR/trazas/<id>/`), los pasos por tarea y cada freno del revisor con su razón. Con ambos, si cada falla fue daño, error del agente o negación propia. Esa última separación es la que en octubre llegó tarde.

**Pendiente de medir:**

- Resultado en el set oculto, por dificultad y por tipo de falla.
- Costo y latencia del revisor, y costo de las notas.
- p95 de tiempo y costo, y consistencia entre corridas de la misma tarea.
- Efecto de las notas por app (con y sin `MEMORIA=1`).
- Tiempo de respuesta de `POST /tasks` en el despliegue.
- Variaciones propias: dos datos en una pregunta, fechas relativas, notas inyectadas, crear algo que ya existe, exporte con otros filtros.

## 11. Preguntas abiertas

1. **¿Crear algo que ya existe es `terminada` o `fallida`?** Las instrucciones dicen `fallida`. No lo sabemos.
2. **¿Qué tolera `lista_blanca`?** En las pruebas de práctica viene vacía; asumimos el caso estricto.
3. **Exporte cuando la app no permite el filtro exacto.** No hay regla escrita: decide el modelo. No sabemos cómo lo califica el evaluador.
4. **¿Hay volumen en `/data` en Railway?** Si no, un redespliegue borra tareas y notas.
5. **¿Cuánto cuesta de verdad una tarea?** Falta sumar el revisor y las notas al costo que reporta `pi`.
