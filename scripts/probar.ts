// Prueba de punta a punta en el escritorio de práctica: reinicia, corre el agente sobre una prueba,
// juzga con /__check y con las reglas del resumen, y anota el gasto en eval/gasto.md.
// Uso: eval "$(cdmx-env)"; node --openssl-legacy-provider scripts/probar.ts material/pruebas/E2-*.json
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { ejecutarTarea } from "../src/operador/ejecutor.ts";
import { aprenderDeTarea, pistasDeApps } from "../src/operador/memoria.ts";
import { juzgarEscritorio, reiniciarEscritorio, urlVncPruebas } from "./escritorio-pruebas.ts";
import { juzgar } from "./juicio.ts";

const archivo = process.argv[2];
if (!archivo) throw new Error("uso: probar.ts <prueba.json>");
const prueba = JSON.parse(readFileSync(archivo, "utf8"));
const key = process.env.OPENROUTER_API_KEY ?? "";
const clave = process.env.DESKTOP_PASSWORD ?? "";
const modelo = process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-5.5";
const modeloRevisor = process.env.GUARD_MODEL ?? "anthropic/claude-haiku-5.5";
const razonamiento = process.env.AGENT_THINKING ?? "high";
const carpetaDatos = process.env.DATA_DIR ?? "data/local";
const pi = process.env.PI_BIN ?? "pi";
const conMemoria = process.env.MEMORIA === "1";

await reiniciarEscritorio();
await new Promise((r) => setTimeout(r, 3000));
const t = Date.now();
const d = await ejecutarTarea(`${prueba.id}-${t}`, { tarea: prueba.instruccion, urlVnc: urlVncPruebas(), clave }, {
  pi,
  keyOpenrouter: key,
  modelo,
  modeloRevisor,
  razonamiento,
  pistas: conMemoria ? pistasDeApps(carpetaDatos) : "",
  carpetaDatos,
  plazoMs: Number(process.env.TASK_DEADLINE_MS ?? 285_000),
  topeUsd: Number(process.env.MAX_COST_USD ?? 0.5),
  secretos: [clave, key, process.env.TEAM_TOKEN ?? "", process.env.DESKTOP_TOKEN ?? ""],
});
const segundos = Math.round((Date.now() - t) / 1000);
const juicio = await juzgarEscritorio(prueba);

const fallas = juzgar(prueba, d.estado, d.resumen, juicio);
const pasa = fallas.length === 0;
console.log(JSON.stringify({ prueba: prueba.id, pasa, fallas, segundos, costoUsd: Number(d.costoUsd.toFixed(4)), motivo: d.motivo, estado: d.estado, resumen: d.resumen, traza: d.carpetaTraza }, null, 2));
appendFileSync("eval/gasto.md", `| ${new Date().toISOString()} | ${basename(archivo)} (${pasa ? "pasa" : "falla"}, ${segundos}s) | ${modelo} (${razonamiento}) | $${d.costoUsd.toFixed(4)} |\n`);
if (conMemoria && d.aplicacion) await aprenderDeTarea(d.aplicacion, d.carpetaTraza, d.resumen, { pi, keyOpenrouter: key, modelo: modeloRevisor, carpetaDatos });
