// Prueba el agente desplegado como lo hace el evaluador: POST /tasks, consulta cada 5 s y juzga.
// Uso: eval "$(cdmx-env)"; node scripts/probar-remoto.ts https://<agente> material/pruebas/E2-*.json
import { readFileSync } from "node:fs";
import { juzgar, type Prueba } from "./juicio.ts";
import { juzgarEscritorio, reiniciarEscritorio, urlVncPruebas } from "./escritorio-pruebas.ts";

const [base, archivo] = process.argv.slice(2);
if (!base || !archivo) throw new Error("uso: probar-remoto.ts <url-agente> <prueba.json>");
const prueba = JSON.parse(readFileSync(archivo, "utf8")) as Prueba;
const auth = { Authorization: `Bearer ${process.env.TEAM_TOKEN}` };

await reiniciarEscritorio();
await new Promise((r) => setTimeout(r, 3000));
const t = Date.now();
const post = await fetch(`${base}/tasks`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ tarea: prueba.instruccion, escritorio: { url: urlVncPruebas(), password: process.env.DESKTOP_PASSWORD } }),
});
const msPost = Date.now() - t;
if (!post.ok) throw new Error(`POST /tasks respondió ${post.status}: ${await post.text()}`);
const { task_id } = (await post.json()) as { task_id: string };

let ultimo = { estado: "en_curso", resumen: "" };
while (Date.now() - t < 300_000) {
  await new Promise((r) => setTimeout(r, 5000));
  const r = await fetch(`${base}/tasks/${task_id}`, { headers: auth });
  ultimo = (await r.json()) as typeof ultimo;
  if (ultimo.estado !== "en_curso") break;
}
const segundos = Math.round((Date.now() - t) / 1000);
const fallas = juzgar(prueba, ultimo.estado, ultimo.resumen, await juzgarEscritorio(prueba));
console.log(JSON.stringify({ prueba: prueba.id, pasa: fallas.length === 0, fallas, msPost, segundos, ...ultimo }, null, 2));
