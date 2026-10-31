// Escritorio de práctica para los scripts: URL del websocket y los endpoints /__reset y /__check.
function base(): string {
  const url = process.env.DESKTOP_URL;
  if (!url) throw new Error('DESKTOP_URL no está definido: eval "$(cdmx-env)"');
  return url.replace(/\/+$/, "");
}

export function urlVncPruebas(): string {
  return base().replace(/^http/, "ws") + "/websockify";
}

async function administrar(ruta: string, cuerpo?: unknown): Promise<any> {
  const r = await fetch(base() + ruta, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DESKTOP_TOKEN}`, "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}`);
  return r.json().catch(() => ({}));
}

export const reiniciarEscritorio = () => administrar("/__reset");
export const juzgarEscritorio = (prueba: unknown) => administrar("/__check", prueba);
