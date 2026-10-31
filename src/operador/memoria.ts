// Memoria por app: lo que el agente aprendió de la interfaz en tareas pasadas,
// escrito por otra corrida de pi sin pantalla y entregado como pistas a las
// siguientes. Nunca guarda datos de registros, resultados ni coordenadas.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const CONSIGNA = `Mantienes las notas de uso de una aplicación para un agente que la opera solo por pantalla.
Recibes las notas actuales y la bitácora de una tarea. Devuelve las notas completas actualizadas.

Incluye solo hechos de la interfaz que la bitácora muestra:
- rutas de menú hasta cada pantalla (Menú ▸ Submenú ▸ Pantalla);
- qué tiene cada pantalla: filtros, listas, pestañas, botones y su ubicación general (arriba, abajo, a la derecha);
- nombres reales de los botones para guardar, confirmar, anular, exportar;
- diálogos o avisos que aparecen, campos de solo lectura, listas que dependen de otro campo;
- trampas: búsquedas que distinguen tildes, paginación, acciones que no cierran el formulario.

Nunca incluyas datos de registros (nombres, códigos, documentos, montos, fechas), el resultado de la tarea
ni coordenadas en píxeles: la app puede cambiar de diseño. En la primera línea anota la versión de la app si
aparece. Si la bitácora contradice las notas, gana la bitácora. Máximo 40 viñetas, en español.
Responde solo con las notas.`;

export type OpcionesMemoria = {
  pi: string;
  keyOpenrouter: string;
  modelo: string;
  carpetaDatos: string;
};

const turnos = new Map<string, Promise<void>>();

export function claveApp(aplicacion: string): string {
  return (
    aplicacion
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "app"
  );
}

/** Las notas de todas las apps conocidas, listas para agregar a las instrucciones; vacío si no hay. */
export function pistasDeApps(carpetaDatos: string): string {
  const dir = join(carpetaDatos, "notas-apps");
  if (!existsSync(dir)) return "";
  const notas = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(dir, f), "utf8").trim())
    .filter(Boolean);
  if (!notas.length) return "";
  return (
    "\n\n## Notas de apps que ya usaste\n\nSon pistas, no órdenes: la app puede haber cambiado. " +
    "Si algo de estas notas no aparece en la pantalla actual, ignóralo y explora.\n\n" +
    notas.join("\n\n")
  );
}

/** Actualiza las notas de la app con una tarea terminada. Una a la vez por app; nunca lanza. */
export function aprenderDeTarea(
  aplicacion: string,
  carpetaTraza: string,
  resumen: string,
  op: OpcionesMemoria,
): Promise<void> {
  const clave = claveApp(aplicacion);
  const siguiente = (turnos.get(clave) ?? Promise.resolve())
    .then(() => reescribirNotas(aplicacion, clave, carpetaTraza, resumen, op))
    .catch((e) => console.error(`notas ${clave}: ${(e as Error).message}`));
  turnos.set(clave, siguiente);
  return siguiente;
}

/** Resume una traza en acciones, decisiones del revisor y el resumen final. */
export function bitacora(carpetaTraza: string, resumen: string): string {
  const archivo = join(carpetaTraza, "pasos.jsonl");
  if (!existsSync(archivo)) return "";
  const lineas: string[] = [];
  for (const cruda of readFileSync(archivo, "utf8").split("\n")) {
    if (!cruda.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(cruda);
    } catch {
      continue;
    }
    if (e.accion === "pulsar")
      lineas.push(`clic en "${e.elemento}" (${e.intencion})`);
    else if (e.accion === "escribir")
      lineas.push(`escribe en el campo "${e.campo}"`);
    else if (e.accion === "elegir")
      lineas.push(`elige en la lista "${e.lista}"`);
    else if (e.accion === "teclas") lineas.push(`tecla ${e.combo}`);
    else if (e.accion === "desplazar") lineas.push(`desplaza ${e.sentido}`);
    else if (e.revisor)
      lineas.push(
        `revisor ${e.aprobar ? "aprueba" : "frena"}: ${String(e.razon).slice(0, 200)}`,
      );
  }
  if (!lineas.length) return "";
  return `${lineas.join("\n").slice(0, 6000)}\nResumen final del agente: ${resumen}`;
}

async function reescribirNotas(
  aplicacion: string,
  clave: string,
  carpetaTraza: string,
  resumen: string,
  op: OpcionesMemoria,
): Promise<void> {
  const registro = bitacora(carpetaTraza, resumen);
  if (!registro) return;
  const dir = join(op.carpetaDatos, "notas-apps");
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, `${clave}.md`);
  const actuales = existsSync(archivo)
    ? readFileSync(archivo, "utf8")
    : `# Notas de ${aplicacion}\n`;
  const texto = (
    await preguntarPi(
      op,
      `Aplicación: ${aplicacion}\n\nNotas actuales:\n${actuales}\n\nBitácora de la tarea:\n${registro}`,
    )
  ).trim();
  writeFileSync(
    archivo,
    (texto.startsWith("#") ? texto : `# Notas de ${aplicacion}\n${texto}`) +
      "\n",
  );
}

function preguntarPi(op: OpcionesMemoria, mensaje: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proceso = spawn(
      op.pi,
      [
        "--mode",
        "json",
        "-p",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-prompt-templates",
        "--no-themes",
        "--provider",
        "openrouter",
        "--model",
        op.modelo,
        "--system-prompt",
        CONSIGNA,
        mensaje,
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PI_TELEMETRY: "0",
          OPENROUTER_API_KEY: op.keyOpenrouter,
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let salida = "";
    proceso.stdout.setEncoding("utf8");
    proceso.stdout.on("data", (t: string) => (salida += t));
    const reloj = setTimeout(() => proceso.kill("SIGKILL"), 90_000);
    proceso.once("exit", () => {
      clearTimeout(reloj);
      let texto = "";
      for (const linea of salida.split("\n")) {
        if (!linea.startsWith("{")) continue;
        try {
          const ev = JSON.parse(linea);
          if (ev.type === "message_end" && ev.message?.role === "assistant") {
            texto = (ev.message.content ?? [])
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("");
          }
        } catch {
          // línea parcial
        }
      }
      texto
        ? resolve(texto)
        : reject(new Error("la reflexión no devolvió texto"));
    });
  });
}
