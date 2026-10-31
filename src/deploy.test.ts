// Invariantes del despliegue (Dockerfile y railway.json) que un cambio descuidado rompería sin que
// ningún test del servidor lo note.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");

/** Variables de los ENV del Dockerfile (formato clave=valor, con continuaciones de línea). */
function dockerEnv(text: string): Map<string, string> {
  const env = new Map<string, string>();
  const joined = text.replace(/\\\n/g, " ");
  for (const line of joined.split("\n")) {
    const m = line.match(/^ENV\s+(.*)$/);
    if (!m) continue;
    for (const pair of m[1].trim().split(/\s+/)) {
      const eq = pair.indexOf("=");
      if (eq > 0) env.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  return env;
}

test("Dockerfile: todo proceso node de la imagen (también pi) carga el proveedor legacy para DES", () => {
  const env = dockerEnv(dockerfile);
  assert.match(env.get("NODE_OPTIONS") ?? "", /--openssl-legacy-provider/);
  assert.equal(env.get("PI_BIN"), "/pnpm/pi");
  assert.equal(env.get("DATA_DIR"), "/data");
});

test("railway.json: una réplica despierta que siempre se reinicia y con chequeo de salud", () => {
  const railway = JSON.parse(
    readFileSync(new URL("railway.json", root), "utf8"),
  );
  assert.equal(railway.build.builder, "DOCKERFILE");
  // Las tareas viven en memoria: con dos réplicas, GET /tasks/{id} caería en la que no la tiene.
  assert.equal(railway.deploy.numReplicas, 1);
  // Dormida, el primer POST /tasks pagaría el arranque en frío y pasaría de 2 s.
  assert.equal(railway.deploy.sleepApplication, false);
  // ON_FAILURE deja de reiniciar tras N caídas: el agente quedaría fuera el resto del demo day.
  assert.equal(railway.deploy.restartPolicyType, "ALWAYS");
  assert.equal(railway.deploy.healthcheckPath, "/health");
});
