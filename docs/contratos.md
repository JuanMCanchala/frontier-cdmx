# Contratos entre módulos

TypeScript que Node 24+ corre directo (solo borrado de tipos: nada de `enum`, `namespace` ni
propiedades en el constructor). Sin dependencias de npm: `pi` provee `@earendil-works/pi-ai` y
`@earendil-works/pi-coding-agent` a la extensión.

```
src/escritorio/   protocolo.ts (RFB), imagen.ts (PNG), pantalla.ts (acciones a ritmo humano)
src/operador/     instrucciones.md, herramientas.ts (extensión de pi), ejecutor.ts, memoria.ts
src/servidor.ts   contrato HTTP del reto
scripts/          humo del escritorio, prueba de punta a punta
```

## `src/escritorio/pantalla.ts`

```ts
export class Pantalla {
  static abrir(url: string, clave: string): Promise<Pantalla>;
  readonly ancho: number;
  readonly alto: number; // 1280×800 en el escritorio del reto
  get cerrada(): boolean;
  captura(): Buffer; // PNG de la pantalla completa
  ampliar(
    x: number,
    y: number,
    ancho: number,
    alto: number,
    factor?: number,
  ): Buffer;
  clic(
    x: number,
    y: number,
    op?: { doble?: boolean; derecho?: boolean },
  ): Promise<void>;
  rueda(
    x: number,
    y: number,
    sentido: "arriba" | "abajo",
    pasos?: number,
  ): Promise<void>;
  teclas(combo: string): Promise<void>; // "enter", "ctrl+a", "shift+tab"
  escribir(texto: string): Promise<void>;
  reemplazarTexto(x: number, y: number, texto: string): Promise<void>; // clic, seleccionar todo, escribir
  cerrar(): void;
}
```

Cada acción espera a que la pantalla se quede quieta antes de devolver.

## `src/operador/ejecutor.ts`

```ts
export type Encargo = { tarea: string; urlVnc: string; clave: string };
export type Motivo =
  "reporto" | "sin_tiempo" | "proceso_caido" | "abortada" | "sin_presupuesto";
export type Desenlace = {
  estado: "terminada" | "fallida";
  resumen: string; // ya sin secretos; si hay respuesta, la primera línea es "respuesta: <valor>"
  costoUsd: number;
  carpetaTraza: string;
  aplicacion: string | null; // nombre de la app según su cabecera, para la memoria por app
  motivo: Motivo;
  error: string | null;
};
export type OpcionesEjecucion = {
  pi: string;
  keyOpenrouter: string;
  modelo: string;
  modeloRevisor: string;
  razonamiento: string;
  pistas: string; // notas de apps conocidas, se agregan a las instrucciones
  carpetaDatos: string;
  plazoMs: number; // tiempo total del agente para esta tarea
  topeUsd: number;
  secretos: string[]; // textos que nunca pueden salir en un resumen
  senal?: AbortSignal; // abortar: llega otra tarea para el mismo escritorio
};
export function ejecutarTarea(
  id: string,
  encargo: Encargo,
  op: OpcionesEjecucion,
): Promise<Desenlace>;
```

`ejecutarTarea` mata el proceso de `pi` antes de devolver: nada actúa sobre el escritorio después del
reporte. La traza de cada tarea queda en `<carpetaDatos>/trazas/<id>/`: `pasos.jsonl` (acciones,
revisor, capturas `NNN.png`), `modelo.jsonl` (eventos de pi) y `reporte.json`.

## `src/operador/memoria.ts`

```ts
export function pistasDeApps(carpetaDatos: string): string;
export function aprenderDeTarea(
  aplicacion: string,
  carpetaTraza: string,
  resumen: string,
  op: {
    pi: string;
    keyOpenrouter: string;
    modelo: string;
    carpetaDatos: string;
  },
): Promise<void>;
```

Las notas viven en `<carpetaDatos>/notas-apps/<app>.md`.

## Herramientas que ve el modelo

`ver_pantalla`, `pulsar` (con `intencion` navegar | editar | guardar y `verificado`),
`escribir`, `llenar`, `elegir`, `teclas`, `desplazar` y `reportar`. Todo `pulsar` con intención
`guardar` o con un verbo de escritura en el rótulo, y todo Enter, pasa antes por el revisor.

## `src/servidor.ts`

Contrato HTTP de `material/README.md` ("Qué entregas a las 20:00"). Configuración por entorno:
`PORT`, `TEAM_TOKEN`, `OPENROUTER_API_KEY`, `DATA_DIR`, `PI_BIN`, `AGENT_MODEL`
(`anthropic/claude-sonnet-5.5`), `GUARD_MODEL` (`anthropic/claude-haiku-5.5`), `AGENT_THINKING`
(`high`), `TASK_DEADLINE_MS` (285000), `MAX_COST_USD` (0.5).
