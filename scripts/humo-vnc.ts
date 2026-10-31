// Se conecta al escritorio de práctica y guarda una captura y una zona ampliada. No gasta crédito.
// Uso: eval "$(cdmx-env)"; node --openssl-legacy-provider scripts/humo-vnc.ts out/humo
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pantalla } from "../src/escritorio/pantalla.ts";
import { urlVncPruebas } from "./escritorio-pruebas.ts";

const carpeta = process.argv[2] ?? "out/humo";
mkdirSync(carpeta, { recursive: true });
const t = performance.now();
const p = await Pantalla.abrir(urlVncPruebas(), process.env.DESKTOP_PASSWORD ?? "");
console.log(`conectado en ${Math.round(performance.now() - t)} ms: ${p.conexion.nombre} ${p.ancho}x${p.alto}`);
writeFileSync(join(carpeta, "pantalla.png"), p.captura());
writeFileSync(join(carpeta, "zona.png"), p.ampliar(0, 0, 640, 200, 2));
p.cerrar();
console.log(`capturas en ${carpeta}`);
