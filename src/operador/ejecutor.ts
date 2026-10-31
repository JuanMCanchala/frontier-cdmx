// Corre una tarea en su propio proceso de pi. El proceso muere antes de que se
// devuelva el desenlace: nada actúa sobre el escritorio después del reporte.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "../..");
const EXTENSION = join(RAIZ, "src/operador/herramientas.ts");
const INSTRUCCIONES = readFileSync(
  join(RAIZ, "src/operador/instrucciones.md"),
  "utf8",
);
/** Margen entre el reloj que ve el modelo y el corte duro, para que alcance a reportar. */
const MARGEN_MS = 15_000;

export type Encargo = { tarea: string; urlVnc: string; clave: string };
export type Motivo =
  "reporto" | "sin_tiempo" | "proceso_caido" | "abortada" | "sin_presupuesto";
export type Desenlace = {
  estado: "terminada" | "fallida";
  /** Ya sin secretos; si hay respuesta, la primera línea es "respuesta: <valor>". */
  resumen: string;
  costoUsd: number;
  carpetaTraza: string;
  /** Nombre de la app según su cabecera, para la memoria por app. */
  aplicacion: string | null;
  motivo: Motivo;
  error: string | null;
};
export type OpcionesEjecucion = {
  pi: string;
  keyOpenrouter: string;
  modelo: string;
  modeloRevisor: string;
  razonamiento: string;
  /** Lo aprendido de apps conocidas; se agrega a las instrucciones. */
  pistas: string;
  carpetaDatos: string;
  plazoMs: number;
  topeUsd: number;
  /** Textos que nunca pueden salir en un resumen. */
  secretos: string[];
  /** Se aborta cuando llega otra tarea para el mismo escritorio. */
  senal?: AbortSignal;
};

type Reporte = {
  estado?: string;
  aplicacion?: string;
  respuesta?: string;
  resumen?: string;
};

export async function ejecutarTarea(
  id: string,
  encargo: Encargo,
  op: OpcionesEjecucion,
): Promise<Desenlace> {
  const carpetaTraza = join(op.carpetaDatos, "trazas", id);
  mkdirSync(carpetaTraza, { recursive: true });
  const archivoReporte = join(carpetaTraza, "reporte.json");
  const inicio = Date.now();

  const proceso = spawn(
    op.pi,
    [
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-builtin-tools",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-themes",
      "-e",
      EXTENSION,
      "--provider",
      "openrouter",
      "--model",
      op.modelo,
      "--thinking",
      op.razonamiento,
      "--system-prompt",
      INSTRUCCIONES + op.pistas,
      `Tarea: ${encargo.tarea}`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_OPTIONS: "--openssl-legacy-provider",
        PI_TELEMETRY: "0",
        OPENROUTER_API_KEY: op.keyOpenrouter,
        OP_VNC_URL: encargo.urlVnc,
        OP_VNC_CLAVE: encargo.clave,
        OP_TAREA: encargo.tarea,
        OP_REPORTE: archivoReporte,
        OP_TRAZA: carpetaTraza,
        OP_MODELO_REVISOR: op.modeloRevisor,
        OP_LIMITE: String(inicio + op.plazoMs - MARGEN_MS),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let costoUsd = 0;
  let pendiente = "";
  proceso.stdout.setEncoding("utf8");
  proceso.stdout.on("data", (trozo: string) => {
    pendiente += trozo;
    for (
      let nl = pendiente.indexOf("\n");
      nl >= 0;
      nl = pendiente.indexOf("\n")
    ) {
      const linea = pendiente.slice(0, nl);
      pendiente = pendiente.slice(nl + 1);
      costoUsd += costoDeLinea(linea);
      const util = lineaParaTraza(linea);
      if (util) appendFileSync(join(carpetaTraza, "modelo.jsonl"), util + "\n");
    }
  });
  let errores = "";
  proceso.stderr.setEncoding("utf8");
  proceso.stderr.on(
    "data",
    (t: string) => (errores = (errores + t).slice(-4000)),
  );
  const salio = new Promise<void>((r) => proceso.once("exit", () => r()));
  const vivo = () => proceso.exitCode === null && proceso.signalCode === null;

  let motivo: Motivo = "reporto";
  let porque = "";
  for (;;) {
    if (existsSync(archivoReporte)) break;
    if (!vivo()) {
      motivo = "proceso_caido";
      porque = "el agente terminó sin reportar";
      break;
    }
    if (Date.now() - inicio >= op.plazoMs) {
      motivo = "sin_tiempo";
      porque = "se acabó el tiempo de la tarea";
      break;
    }
    if (op.senal?.aborted) {
      motivo = "abortada";
      porque = String(op.senal.reason ?? "la tarea fue cancelada");
      break;
    }
    if (costoUsd >= op.topeUsd) {
      motivo = "sin_presupuesto";
      porque = `la tarea superó el tope de $${op.topeUsd}`;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Primero se detiene al agente; después se publica.
  if (vivo()) proceso.kill("SIGKILL");
  await salio;

  let estado: Desenlace["estado"] = "fallida";
  let aplicacion: string | null = null;
  let resumen = `No terminó: ${porque}.`;
  const reporte = leerReporte(archivoReporte);
  if (reporte) {
    motivo = "reporto";
    estado = reporte.estado === "terminada" ? "terminada" : "fallida";
    aplicacion = reporte.aplicacion?.trim() || null;
    resumen = armarResumen(reporte);
  }
  const error =
    motivo === "reporto"
      ? null
      : ocultarSecretos(
          errores.trim().split("\n").slice(-15).join("\n"),
          op.secretos,
        ) || null;
  return {
    estado,
    resumen: ocultarSecretos(resumen, op.secretos),
    costoUsd,
    carpetaTraza,
    aplicacion,
    motivo,
    error,
  };
}

function leerReporte(archivo: string): Reporte | null {
  if (!existsSync(archivo)) return null;
  try {
    return JSON.parse(readFileSync(archivo, "utf8")) as Reporte;
  } catch {
    return null;
  }
}

/** El evaluador compara el primer número de la línea `respuesta:`, así que va primero y sola. */
export function armarResumen(r: Reporte): string {
  const lineas: string[] = [];
  const respuesta = r.respuesta?.replace(/\s*\n\s*/g, " ").trim();
  if (respuesta && r.estado === "terminada")
    lineas.push(`respuesta: ${respuesta}`);
  const cuerpo = (r.resumen ?? "")
    .split("\n")
    .filter((l) => !/^\s*respuesta\s*:/i.test(l))
    .join("\n")
    .trim();
  lineas.push(
    cuerpo ||
      (r.estado === "terminada"
        ? "Tarea completada."
        : "No se pudo completar la tarea."),
  );
  return lineas.join("\n");
}

export function ocultarSecretos(texto: string, secretos: string[]): string {
  let salida = texto;
  for (const s of secretos)
    if (s && s.length >= 4) salida = salida.split(s).join("[oculto]");
  return salida;
}

/** Guarda lo necesario para depurar una tarea: sin deltas de streaming ni capturas en línea. */
function lineaParaTraza(linea: string): string | null {
  if (!linea.startsWith("{")) return null;
  try {
    const ev = JSON.parse(linea);
    if (ev.type === "message_update" || ev.type === "tool_execution_update")
      return null;
    return JSON.stringify(ev, (_k, v) =>
      v && typeof v === "object" && v.type === "image"
        ? { type: "image", data: "[captura aparte]" }
        : v,
    );
  } catch {
    return null;
  }
}

function costoDeLinea(linea: string): number {
  if (!linea.startsWith("{")) return 0;
  try {
    const ev = JSON.parse(linea);
    if (ev.type === "message_end" && ev.message?.role === "assistant")
      return Number(ev.message.usage?.cost?.total ?? 0);
  } catch {
    // línea parcial o ajena: sin costo
  }
  return 0;
}
