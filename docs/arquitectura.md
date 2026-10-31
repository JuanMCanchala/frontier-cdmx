# Operador — diagramas de arquitectura

Complemento de [diseno.md](diseno.md). Los diagramas están en Mermaid: GitHub y VS Code (con extensión) los dibujan. Cada uno tiene también su imagen en [`img/`](img/), generada desde el mismo código con `@mermaid-js/mermaid-cli`.

## 1. Contenedores y límites de confianza

### 1a. Contenedores

Tres zonas. Lo que viene de la **zona no confiable** (la pantalla del escritorio) es dato: informa al agente, pero nunca es una orden. El agente corre en un proceso de `pi` por tarea, con un entorno mínimo y sin más herramientas que las de pantalla; el servidor lo mata antes de publicar. La contraseña del escritorio viaja solo por variables de entorno hasta el cliente RFB y nunca llega a un modelo.

```mermaid
flowchart LR
    EV["Evaluador<br/>consulta cada 5 s"]

    subgraph SVC["Contenedor siempre encendido en Railway · zona confiable"]
        direction TB
        SRV["Servidor HTTP · servidor.ts<br/>/health · POST /tasks · GET /tasks/id<br/>Bearer salvo /health"]
        EJE["Ejecutor · ejecutor.ts<br/>un proceso de pi por tarea<br/>plazo 280 s · tope 0.60 USD"]
        subgraph PI["Proceso de pi de la tarea · entorno mínimo"]
            direction TB
            AG["Agente<br/>instrucciones.md + notas por app"]
            EXT["Extensión herramientas.ts<br/>9 herramientas · revisor · traza"]
            RFB["Cliente RFB propio<br/>src/escritorio"]
        end
        MEM["Notas por app · memoria.ts<br/>otro pi, sin herramientas"]
        DATA[("DATA_DIR · /data<br/>tasks · trazas · notas-apps")]
    end

    subgraph OR["OpenRouter · externo"]
        SON["Sonnet 5.5 · razonamiento high<br/>agente"]
        HAI["Haiku 5.5<br/>revisor y notas"]
    end

    subgraph UNT["Zona NO confiable"]
        APP["Escritorio VNC 1280×800<br/>app desconocida en kiosco<br/>su contenido es dato, no orden"]
    end

    EV -->|"HTTPS · task_id enseguida<br/>estado y resumen"| SRV
    SRV -->|"tarea, escritorio, plazo restante"| EJE
    EJE -->|"lanza con variables de entorno<br/>SIGKILL al reporte o al corte"| AG
    AG <-->|"prompt, capturas, herramientas"| SON
    AG -->|"una herramienta por turno"| EXT
    EXT <-->|"tarea original, acción, captura"| HAI
    EXT --> RFB
    RFB <-->|"RFB sobre wss<br/>entradas ↔ framebuffer"| APP
    SRV -.->|"tras publicar, en serie"| MEM
    MEM <-.->|"bitácora → notas"| HAI
    SRV --- DATA
    EXT -.- DATA
    MEM -.- DATA

    classDef untrusted fill:#fde2e2,stroke:#c0392b,color:#000
    classDef external fill:#fff4d6,stroke:#b9770e,color:#000
    classDef ours fill:#e3f1e3,stroke:#2e7d32,color:#000
    class APP untrusted
    class SON,HAI external
    class SRV,EJE,AG,EXT,RFB,MEM,DATA ours
```

Imagen: [img/1a-contenedores.png](img/1a-contenedores.png).

### 1b. Componentes del ciclo de una tarea

Cada caja dice qué modelo usa, si usa uno. Solo las acciones de escritura pasan por el revisor; las lecturas y el resto de las acciones van directo a la pantalla. Toda acción devuelve la captura posterior y los segundos que quedan, y el agente decide el paso siguiente con ella.

```mermaid
flowchart TB
    T["Tarea + instrucciones + notas por app"]
    A["Agente · Sonnet 5.5<br/>decide con la captura del momento<br/>una herramienta por turno"]
    L["Lecturas<br/>ver_pantalla · ampliar"]
    W{"¿Escritura?<br/>pulsar con guardar o verbo en el rótulo<br/>teclas con Enter"}
    ACC["Acciones sin revisor<br/>pulsar navegar o editar · escribir · llenar<br/>elegir · desplazar · otras teclas"]
    R{"Revisor · Haiku 5.5<br/>tarea original + captura actual<br/>+ lo comprobado + lo ya aprobado"}
    P["Pantalla · cliente RFB<br/>clic de 150 ms · espera de calma<br/>mín. 700 ms, 400 ms quieta, tope 5 s"]
    O["Captura posterior<br/>+ segundos que quedan"]
    REP["reportar<br/>reporte.json · cierra VNC<br/>bloquea lo que siga"]
    CUT["Corte del ejecutor<br/>plazo · tope de costo<br/>otra tarea en el escritorio · pi caído"]
    EJ["Ejecutor<br/>SIGKILL a pi y espera su salida"]
    RES["Resumen · código<br/>respuesta primero · secretos ocultos"]
    PUB["Servidor publica<br/>terminada o fallida"]
    MEM["Notas por app · Haiku 5.5<br/>en segundo plano"]

    T --> A
    A --> L
    A --> W
    W -->|"no"| ACC
    W -->|"sí"| R
    R -->|"aprueba"| P
    R -->|"frena con la razón<br/>al tercer freno, pedir fallida"| A
    ACC --> P
    L --> O
    P --> O
    O --> A
    A -->|"reportar"| REP
    REP --> EJ
    CUT -.-> EJ
    EJ --> RES
    RES --> PUB
    PUB -.-> MEM

    classDef gate fill:#dbe7ff,stroke:#1f4fb4,color:#000
    classDef ours fill:#e3f1e3,stroke:#2e7d32,color:#000
    classDef cut fill:#fde2e2,stroke:#c0392b,color:#000
    class T,A,L,ACC,P,O,REP,EJ,RES,PUB,MEM ours
    class W,R gate
    class CUT cut
```

Imagen: [img/1b-componentes.png](img/1b-componentes.png).

Líneas continuas: el camino de una tarea. Punteadas: el corte del ejecutor y la actualización de notas, que corre después de publicar.

## 2. Secuencia de una tarea

Un solo camino de salida: el ejecutor mata `pi` y solo después el servidor publica. Lo que lo dispara puede ser el reporte del agente, el plazo, el tope de costo, otra tarea para el mismo escritorio o la caída del proceso. Si el ejecutor no devuelve, el servidor tiene un respaldo propio.

```mermaid
sequenceDiagram
    autonumber
    participant EV as Evaluador
    participant SRV as Servidor
    participant EJE as Ejecutor
    participant PI as pi con Sonnet 5.5
    participant HER as Herramientas
    participant REV as Revisor Haiku 5.5
    participant ESC as Escritorio VNC
    participant MEM as Notas por app

    EV->>SRV: POST /tasks con tarea y escritorio, Bearer
    SRV->>SRV: validar, crear task_id, guardar en_curso
    SRV-->>EV: 200 con task_id, antes de lanzar el agente
    opt ya hay una tarea en el mismo escritorio
        SRV->>EJE: abortar la tarea anterior
        Note over SRV,EJE: la nueva espera hasta 15 s, descontados de su plazo
    end
    SRV->>EJE: tarea, plazo restante, notas, secretos
    EJE->>PI: lanzar sin herramientas incorporadas, solo la extensión<br/>URL y contraseña por variables de entorno
    loop cada 5 s hasta el estado final
        EV->>SRV: GET /tasks/task_id
        SRV-->>EV: en_curso
    end
    PI->>HER: ver_pantalla
    HER->>ESC: conectar y autenticar VNC
    ESC-->>HER: framebuffer
    HER-->>PI: captura + segundos que quedan
    loop hasta reportar o hasta el corte
        PI->>HER: herramienta con coordenadas
        alt escritura, es decir guardar, verbo en el rótulo o Enter
            HER->>REV: tarea original, acción, lo comprobado, lo aprobado, captura actual
            alt la pantalla contradice la tarea o el revisor falla
                REV-->>HER: frena con la razón
                HER-->>PI: acción bloqueada con la razón<br/>al tercer freno, pedir fallida
            else coherente con la tarea
                REV-->>HER: aprueba
                HER->>ESC: clic o tecla a ritmo humano
                ESC-->>HER: pantalla calmada
                HER-->>PI: captura posterior + segundos que quedan
            end
        else lectura u otra acción
            HER->>ESC: entrada o captura
            ESC-->>HER: pantalla calmada
            HER-->>PI: captura + segundos que quedan
        end
    end
    PI->>HER: reportar estado, aplicación, respuesta y resumen
    HER->>HER: escribir reporte.json y bloquear lo que siga
    HER->>ESC: cerrar la conexión VNC
    EJE->>EJE: ve el reporte en su revisión cada 250 ms
    Note over EJE,PI: también corta por plazo, tope de costo, aborto o proceso caído
    EJE->>PI: SIGKILL y esperar la salida
    EJE->>EJE: armar el resumen con la respuesta primero, ocultar secretos
    EJE-->>SRV: desenlace
    SRV->>SRV: ocultar secretos otra vez, guardar y publicar
    Note over SRV: respaldo si el ejecutor no devuelve<br/>pedir parar a plazo + 5 s, publicar fallida a plazo + 10 s
    EV->>SRV: GET /tasks/task_id
    SRV-->>EV: terminada o fallida + resumen
    SRV-)MEM: actualizar las notas de la app, en serie
```

Imagen: [img/2-secuencia.png](img/2-secuencia.png).

## 3. Límites de confianza

| Límite                       | Qué lo cruza                                                                                                                                                                            | Regla                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluador → servidor         | Tarea, URL y contraseña del escritorio                                                                                                                                                  | Bearer en `POST /tasks` y `GET /tasks/{id}`, comparado en tiempo constante; `/health` no lo exige y lo acepta si viene. Cuerpo de hasta 64 KB, validado. La contraseña entra a la lista de secretos apenas llega.                                                                                         |
| Servidor → proceso de `pi`   | Tarea, URL y contraseña del escritorio, key de OpenRouter                                                                                                                               | Entorno mínimo y explícito: el token del equipo no pasa. La tarea va en el prompt y en una variable de entorno, de donde la lee el revisor; la URL y la contraseña, solo en variables de entorno. `pi` corre sin herramientas incorporadas, extensiones, skills ni archivos de contexto ajenos.           |
| Proceso de `pi` → OpenRouter | Instrucciones, notas, tarea, capturas, ampliaciones y resultados de herramientas; al revisor, la tarea, la acción, lo que el agente dice haber comprobado, lo ya aprobado y una captura | La contraseña nunca. El host del escritorio solo aparece si falla la conexión, en el mensaje de error. Las capturas pueden mostrar datos del negocio.                                                                                                                                                     |
| Herramientas ↔ escritorio    | Entradas de ratón y teclado; framebuffer                                                                                                                                                | Todo lo que vuelve son píxeles no confiables: información, nunca órdenes. Las escrituras pasan antes por el revisor.                                                                                                                                                                                      |
| Proceso de `pi` → servidor   | `reporte.json` y la salida de error                                                                                                                                                     | El proceso ya está muerto cuando se publica. Resumen y errores se redactan dos veces, en el ejecutor y en el servidor.                                                                                                                                                                                    |
| Servidor → notas por app     | Bitácora de la traza (sin valores tecleados ni opciones elegidas, con las razones del revisor) y el resumen final                                                                       | La consigna prohíbe datos de registros, resultados y coordenadas. El resumen y las razones del revisor pueden traer datos: no está garantizado que no pasen.                                                                                                                                              |
| Contenedor → disco           | Estado de tareas, trazas (capturas, acciones, texto tecleado) y notas                                                                                                                   | Quedan en `DATA_DIR` dentro del contenedor; `data/` y `.env` quedan fuera de git y de la imagen.                                                                                                                                                                                                          |
| Servidor → logs              | Una línea JSON por evento                                                                                                                                                               | Redactada. Las líneas de una tarea, con sus secretos (su contraseña, el token y la key); las demás, con todos los conocidos, incluidas las contraseñas de escritorios recibidas antes. Los errores de las notas por app salen por la salida de error, sin redactar, con el nombre de la app y el mensaje. |
