// Servidor HTTP del reto: GET /health, POST /tasks y GET /tasks/{task_id}.
//
// El ejecutor de tareas se inyecta con createApp para que los tests usen uno falso. Solo el
// arranque real (este archivo ejecutado como main) importa src/agent/*.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunOptions, TaskInput, TaskResult } from "./agent/run-task.ts";

export type Config = {
  port: number;
  teamToken: string;
  openrouterKey: string;
  dataDir: string;
  piBin: string;
  agentModel: string;
  guardModel: string;
  thinking: string;
  /** Tiempo total de una tarea, medido desde que llegó el POST. */
  deadlineMs: number;
  maxCostUsd: number;
  /**
   * Respaldo: si el ejecutor sigue a los deadlineMs + graceMs/2 se le pide parar, y si no devolvió a
   * los deadlineMs + graceMs la tarea se da por fallida. Primero parar, después reportar.
   */
  graceMs: number;
  /** Cuánto espera una tarea a que se detenga la anterior del mismo escritorio. */
  abortWaitMs: number;
};

export type Runner = (
  id: string,
  input: TaskInput,
  opt: RunOptions,
) => Promise<TaskResult>;
export type ManualUpdater = (
  app: string,
  traceDir: string,
  resumen: string,
  opt: { piBin: string; openrouterKey: string; model: string; dataDir: string },
) => Promise<void>;

export type AppDeps = {
  config: Config;
  runner: Runner;
  /** manualsForPrompt: se lee al lanzar cada tarea. */
  manualText: (dataDir: string) => string;
  updateManual: ManualUpdater;
  /** Recibe cada línea de log (JSON, ya redactada). Por defecto, stdout. */
  log?: (line: string) => void;
};

export type App = {
  server: Server;
  /** Espera a que terminen las tareas en marcha y las actualizaciones de manual. */
  idle(): Promise<void>;
  /** Cierra el servidor sin tocar las tareas en marcha (en disco quedan en_curso). */
  close(): Promise<void>;
  /** Aborta las tareas en marcha, espera a que se detengan (con tope) y cierra el servidor. */
  shutdown(reason: string, waitMs?: number): Promise<void>;
};

type Estado = "en_curso" | "terminada" | "fallida";

type TaskRecord = {
  id: string;
  estado: Estado;
  resumen: string;
  tarea: string; // redactada
  createdAt: string;
  finishedAt: string | null;
  costUsd: number | null;
  stopReason: string | null;
  error: string | null;
  app: string | null;
};

type Outcome = {
  estado: "terminada" | "fallida";
  resumen: string;
  stopReason: string;
  costUsd?: number | null;
  error?: string | null;
  app?: string | null;
};

const MAX_BODY_BYTES = 64 * 1024;
const LOG_TASK_CHARS = 80;
const HIDDEN = "[oculto]";
const TASK_ID = /^[A-Za-z0-9-]{1,64}$/;

const RUNNING_SUMMARY = "La tarea está en curso.";
const SUPERSEDED = "llegó otra tarea para el mismo escritorio";
const TIMEOUT = "se acabó el tiempo";
const RESTARTED = "el servicio se reinició durante la tarea";

// ── Configuración ────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

function text(env: Env, name: string, fallback: string): string {
  const v = env[name]?.trim();
  return v ? v : fallback;
}

function positive(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} tiene que ser un número positivo`);
  return n;
}

/** Lee la configuración del entorno. Lanza un error claro si falta algo obligatorio. */
export function loadConfig(env: Env = process.env): Config {
  const missing = ["TEAM_TOKEN", "OPENROUTER_API_KEY"].filter(
    (k) => !env[k]?.trim(),
  );
  if (missing.length)
    throw new Error(
      `faltan variables de entorno obligatorias: ${missing.join(", ")}`,
    );
  const port = Number(text(env, "PORT", "8080"));
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT tiene que ser un puerto válido");
  return {
    port,
    teamToken: env.TEAM_TOKEN!.trim(),
    openrouterKey: env.OPENROUTER_API_KEY!.trim(),
    dataDir: text(env, "DATA_DIR", "data"),
    piBin: text(env, "PI_BIN", "pi"),
    agentModel: text(env, "AGENT_MODEL", "anthropic/claude-sonnet-5.5"),
    guardModel: text(env, "GUARD_MODEL", "anthropic/claude-haiku-5.5"),
    thinking: text(env, "AGENT_THINKING", "high"),
    deadlineMs: positive(env, "TASK_DEADLINE_MS", 280_000),
    maxCostUsd: positive(env, "MAX_COST_USD", 0.6),
    graceMs: positive(env, "TASK_GRACE_MS", 10_000),
    abortWaitMs: positive(env, "ABORT_WAIT_MS", 15_000),
  };
}

// ── Redacción ────────────────────────────────────────────────────────────────

/** Reemplaza cada secreto (y su forma codificada para URL) por "[oculto]", en una sola pasada. */
export function redact(input: string, secrets: readonly string[]): string {
  const variants = new Set<string>();
  for (const s of secrets) {
    if (!s) continue;
    variants.add(s);
    variants.add(encodeURIComponent(s));
  }
  if (!variants.size) return input;
  const pattern = [...variants]
    .sort((a, b) => b.length - a.length)
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return input.replace(new RegExp(pattern, "g"), HIDDEN);
}

/** Primera línea del mensaje de un error, redactada y corta: nunca el stack. */
function shortError(e: unknown, secrets: readonly string[]): string {
  const raw = e instanceof Error ? e.message : String(e);
  const line =
    redact(raw, secrets).split("\n")[0].trim() || "error desconocido";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

// ── Validación del cuerpo ────────────────────────────────────────────────────

type TaskBody = { tarea: string; url: string; password: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateTaskBody(
  body: unknown,
): { ok: true; value: TaskBody } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isObject(body))
    return fail(
      'el cuerpo tiene que ser un objeto JSON con "tarea" y "escritorio"',
    );
  const { tarea, escritorio } = body;
  if (typeof tarea !== "string" || !tarea.trim())
    return fail('"tarea" tiene que ser un texto no vacío');
  if (!isObject(escritorio))
    return fail('"escritorio" tiene que ser un objeto con "url" y "password"');
  const { url, password } = escritorio;
  if (typeof url !== "string" || !validWsUrl(url.trim())) {
    return fail('"escritorio.url" tiene que ser una URL ws:// o wss://');
  }
  if (typeof password !== "string")
    return fail('"escritorio.password" tiene que ser un texto');
  return {
    ok: true,
    value: { tarea: tarea.trim(), url: url.trim(), password },
  };
}

function validWsUrl(url: string): boolean {
  if (!/^wss?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "ws:" || u.protocol === "wss:") && u.hostname !== "";
  } catch {
    return false;
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(data)),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}

/** Lee el cuerpo completo. Si pasa de max, lo descarta (lo drena igual) y devuelve null. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    let ended = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > max) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      ended = true;
      ok(tooLarge ? null : Buffer.concat(chunks));
    });
    req.on("error", fail);
    req.on("close", () => {
      if (!ended)
        fail(new Error("la conexión se cerró antes de terminar el cuerpo"));
    });
  });
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/**
 * Ruta de la petición sin query, con las barras repetidas colapsadas y sin barra final. Así
 * `https://host/` + `/tasks` (= `//tasks`) y `/tasks/<id>/` llegan a su ruta. `new URL("//tasks", …)`
 * no sirve: lee `tasks` como host.
 */
export function routePath(rawUrl: string): string {
  let path = rawUrl.split(/[?#]/, 1)[0];
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  }
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path.startsWith("/") ? path : `/${path}`;
}

// ── Aplicación ───────────────────────────────────────────────────────────────

type Slot = { ctl: AbortController; done: Promise<void> };

export function createApp(deps: AppDeps): App {
  const { config } = deps;
  const globalSecrets = [config.teamToken, config.openrouterKey];
  const write =
    deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const log = (
    entry: Record<string, unknown>,
    secrets: readonly string[] = globalSecrets,
  ) =>
    write(
      redact(
        JSON.stringify({ t: new Date().toISOString(), ...entry }),
        secrets,
      ),
    );

  const tasksDir = join(config.dataDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const tasks = new Map<string, TaskRecord>();
  const desktops = new Map<string, Slot>(); // url del escritorio → tarea que lo ocupa
  const active = new Set<Promise<void>>();
  let manualChain: Promise<void> = Promise.resolve();
  const wantedToken = digest(`Bearer ${config.teamToken}`);

  function save(rec: TaskRecord): void {
    const file = join(tasksDir, `${rec.id}.json`);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(rec));
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      log({
        evento: "error_guardando",
        id: rec.id,
        error: shortError(e, globalSecrets),
      });
    }
  }

  // Al arrancar: las tareas que quedaron en curso murieron con el proceso anterior.
  for (const name of readdirSync(tasksDir)) {
    if (name.endsWith(".tmp")) {
      rmSync(join(tasksDir, name), { force: true });
      continue;
    }
    if (!name.endsWith(".json")) continue;
    let rec: TaskRecord;
    try {
      rec = JSON.parse(
        readFileSync(join(tasksDir, name), "utf8"),
      ) as TaskRecord;
    } catch (e) {
      log({
        evento: "tarea_ilegible",
        archivo: name,
        error: shortError(e, globalSecrets),
      });
      continue;
    }
    rec.id = name.slice(0, -".json".length);
    if (rec.estado === "en_curso") {
      Object.assign(rec, {
        estado: "fallida",
        resumen: `La tarea no terminó: ${RESTARTED}.`,
        stopReason: "reinicio",
        finishedAt: new Date().toISOString(),
      });
      save(rec);
    }
    tasks.set(rec.id, rec);
  }

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    const normalized = header.replace(/^bearer\s+/i, "Bearer ");
    return timingSafeEqual(digest(normalized), wantedToken);
  }

  function preview(tarea: string, secrets: readonly string[]): string {
    const clean = redact(tarea, secrets).replace(/\s+/g, " ");
    return clean.length > LOG_TASK_CHARS
      ? `${clean.slice(0, LOG_TASK_CHARS - 1)}…`
      : clean;
  }

  /** Publica el resultado final. Solo la primera llamada cuenta; devuelve si fue esta. */
  function finish(
    rec: TaskRecord,
    out: Outcome,
    secrets: readonly string[],
    receivedAt: number,
  ): boolean {
    if (rec.estado !== "en_curso") return false;
    rec.estado = out.estado;
    rec.resumen = redact(out.resumen, secrets);
    rec.stopReason = out.stopReason;
    rec.costUsd = out.costUsd ?? null;
    rec.error = out.error ? redact(out.error, secrets) : null;
    rec.app = out.app ?? null;
    rec.finishedAt = new Date().toISOString();
    save(rec);
    log(
      {
        evento: "tarea",
        id: rec.id,
        estado: rec.estado,
        stopReason: rec.stopReason,
        costUsd: rec.costUsd,
        duracionMs: Date.now() - receivedAt,
        tarea: preview(rec.tarea, secrets),
        ...(rec.error ? { error: rec.error } : {}),
      },
      secrets,
    );
    return true;
  }

  function queueManualUpdate(
    app: string,
    traceDir: string,
    resumen: string,
  ): void {
    // En serie, para que dos tareas no escriban el mismo manual a la vez.
    manualChain = manualChain
      .then(() =>
        deps.updateManual(app, traceDir, resumen, {
          piBin: config.piBin,
          openrouterKey: config.openrouterKey,
          model: config.guardModel,
          dataDir: config.dataDir,
        }),
      )
      .catch((e: unknown) =>
        log({
          evento: "manual_error",
          app,
          error: shortError(e, globalSecrets),
        }),
      );
  }

  async function execute(
    rec: TaskRecord,
    input: TaskInput,
    ctl: AbortController,
    prev: Slot | undefined,
    secrets: string[],
    receivedAt: number,
  ): Promise<void> {
    if (prev) {
      // Nunca dos agentes sobre el mismo escritorio: se espera a que el anterior se detenga.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        prev.done,
        new Promise<void>((r) => (timer = setTimeout(r, config.abortWaitMs))),
      ]);
      clearTimeout(timer);
    }
    if (rec.estado !== "en_curso") return; // el respaldo ya la cerró mientras esperaba
    if (ctl.signal.aborted) {
      const timedOut = ctl.signal.reason === TIMEOUT;
      finish(
        rec,
        timedOut
          ? {
              estado: "fallida",
              resumen: `No se terminó: ${TIMEOUT}.`,
              stopReason: "tiempo",
            }
          : {
              estado: "fallida",
              resumen: `No se ejecutó: ${SUPERSEDED}.`,
              stopReason: "cancelada",
            },
        secrets,
        receivedAt,
      );
      return;
    }
    const remaining = config.deadlineMs - (Date.now() - receivedAt);
    if (remaining <= 0) {
      finish(
        rec,
        {
          estado: "fallida",
          resumen: `No se terminó: ${TIMEOUT}.`,
          stopReason: "tiempo",
        },
        secrets,
        receivedAt,
      );
      return;
    }
    let manual = "";
    try {
      manual = deps.manualText(config.dataDir);
    } catch (e) {
      log({ evento: "manual_ilegible", error: shortError(e, globalSecrets) });
    }

    let result: TaskResult;
    try {
      result = await deps.runner(rec.id, input, {
        piBin: config.piBin,
        openrouterKey: config.openrouterKey,
        model: config.agentModel,
        guardModel: config.guardModel,
        thinking: config.thinking,
        manual,
        dataDir: config.dataDir,
        deadlineMs: remaining,
        maxCostUsd: config.maxCostUsd,
        secrets,
        signal: ctl.signal,
      });
    } catch (e) {
      const error = shortError(e, secrets);
      finish(
        rec,
        {
          estado: "fallida",
          resumen: `La tarea falló por un error interno: ${error}`,
          stopReason: "error_interno",
          error,
        },
        secrets,
        receivedAt,
      );
      return;
    }

    const estado = result?.estado === "terminada" ? "terminada" : "fallida";
    const resumen =
      typeof result?.resumen === "string" && result.resumen.trim()
        ? result.resumen.trim()
        : "";
    const costUsd =
      typeof result?.costUsd === "number" && Number.isFinite(result.costUsd)
        ? result.costUsd
        : null;
    const published = finish(
      rec,
      {
        estado,
        resumen:
          resumen ||
          (estado === "terminada"
            ? "La tarea terminó."
            : "La tarea no se pudo completar."),
        stopReason: result?.stopReason ?? "desconocido",
        costUsd,
        error: result?.error ?? null,
        app: result?.app ?? null,
      },
      secrets,
      receivedAt,
    );
    if (!published) {
      log(
        {
          evento: "resultado_tardio",
          id: rec.id,
          stopReason: result?.stopReason ?? null,
          costUsd,
        },
        secrets,
      );
    }
    if (result?.app)
      queueManualUpdate(result.app, result.traceDir, redact(resumen, secrets));
  }

  function launch(rec: TaskRecord, input: TaskInput, receivedAt: number): void {
    const secrets = [
      input.password,
      config.teamToken,
      config.openrouterKey,
    ].filter((s) => s !== "");
    const ctl = new AbortController();
    const { promise: done, resolve: markDone } = Promise.withResolvers<void>();
    const slot: Slot = { ctl, done };
    const prev = desktops.get(input.wsUrl);
    desktops.set(input.wsUrl, slot);
    prev?.ctl.abort(SUPERSEDED);

    // Respaldo en dos pasos, para no reportar con el agente aún operando: primero se le pide parar
    // y, si a los graceMs/2 siguientes no devolvió, se publica fallida (y se insiste en el abort).
    const left = (ms: number) => Math.max(0, ms - (Date.now() - receivedAt));
    const stopper = setTimeout(
      () => ctl.abort(TIMEOUT),
      left(config.deadlineMs + config.graceMs / 2),
    );
    stopper.unref();
    const backup = setTimeout(() => {
      finish(
        rec,
        {
          estado: "fallida",
          resumen: `No se terminó: ${TIMEOUT}.`,
          stopReason: "tiempo",
        },
        secrets,
        receivedAt,
      );
      ctl.abort(TIMEOUT);
    }, left(config.deadlineMs + config.graceMs));
    backup.unref();

    const run: Promise<void> = execute(
      rec,
      input,
      ctl,
      prev,
      secrets,
      receivedAt,
    )
      .catch((e: unknown) => {
        const error = shortError(e, secrets);
        finish(
          rec,
          {
            estado: "fallida",
            resumen: `La tarea falló por un error interno: ${error}`,
            stopReason: "error_interno",
            error,
          },
          secrets,
          receivedAt,
        );
      })
      .finally(() => {
        clearTimeout(stopper);
        clearTimeout(backup);
        if (desktops.get(input.wsUrl) === slot) desktops.delete(input.wsUrl);
        markDone();
        active.delete(run);
      });
    active.add(run);
  }

  async function postTask(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const receivedAt = Date.now();
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) {
      return send(
        res,
        413,
        { error: `el cuerpo pasa de ${MAX_BODY_BYTES / 1024} KB` },
        { Connection: "close" },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(res, 400, { error: "el cuerpo no es JSON válido" });
    }
    const parsed = validateTaskBody(body);
    if (!parsed.ok) return send(res, 400, { error: parsed.error });

    const { tarea, url, password } = parsed.value;
    const secrets = [password, ...globalSecrets];
    const rec: TaskRecord = {
      id: randomUUID(),
      estado: "en_curso",
      resumen: RUNNING_SUMMARY,
      tarea: redact(tarea, secrets),
      createdAt: new Date(receivedAt).toISOString(),
      finishedAt: null,
      costUsd: null,
      stopReason: null,
      error: null,
      app: null,
    };
    tasks.set(rec.id, rec);
    save(rec);
    send(res, 200, { task_id: rec.id });
    launch(rec, { tarea, wsUrl: url, password }, receivedAt);
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const path = routePath(req.url ?? "/");
    const method = req.method ?? "GET";

    if (path === "/health") {
      if (method !== "GET" && method !== "HEAD")
        return send(
          res,
          405,
          { error: "método no permitido" },
          { Allow: "GET, HEAD" },
        );
      return send(res, 200, { ok: true });
    }

    if (path === "/tasks" || path.startsWith("/tasks/")) {
      if (!authorized(req)) {
        return send(
          res,
          401,
          { error: "falta el token del equipo o no coincide" },
          { "WWW-Authenticate": "Bearer" },
        );
      }
      if (path === "/tasks") {
        if (method !== "POST")
          return send(
            res,
            405,
            { error: "método no permitido" },
            { Allow: "POST" },
          );
        return postTask(req, res);
      }
      if (method !== "GET")
        return send(
          res,
          405,
          { error: "método no permitido" },
          { Allow: "GET" },
        );
      const id = path.slice("/tasks/".length);
      const rec = TASK_ID.test(id) ? tasks.get(id) : undefined;
      if (!rec)
        return send(res, 404, { error: "no existe una tarea con ese task_id" });
      return send(res, 200, { estado: rec.estado, resumen: rec.resumen });
    }

    send(res, 404, { error: "ruta no encontrada" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      log({
        evento: "error_http",
        ruta: req.url ?? "",
        error: shortError(e, globalSecrets),
      });
      if (!res.headersSent) send(res, 500, { error: "error interno" });
      else res.destroy();
    });
  });
  server.requestTimeout = 60_000;

  async function idle(): Promise<void> {
    while (active.size) await Promise.all([...active]);
    await manualChain;
  }

  function close(): Promise<void> {
    return new Promise((ok) => {
      if (!server.listening) return ok();
      server.close(() => ok());
      server.closeAllConnections();
    });
  }

  async function shutdown(reason: string, waitMs = 10_000): Promise<void> {
    for (const slot of desktops.values()) slot.ctl.abort(reason);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([...active]),
      new Promise<void>((r) => (timer = setTimeout(r, waitMs))),
    ]);
    clearTimeout(timer);
    await close();
  }

  return { server, idle, close, shutdown };
}

// ── Arranque real ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    console.error(`No arranca el servidor: ${(e as Error).message}.`);
    process.exitCode = 1;
    return;
  }
  const { runTask } = await import("./agent/run-task.ts");
  const { manualsForPrompt, updateManual } = await import("./agent/manual.ts");
  const app = createApp({
    config,
    runner: runTask,
    manualText: manualsForPrompt,
    updateManual,
  });
  app.server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        evento: "escuchando",
        puerto: config.port,
      }),
    );
  });
  const stop = () => {
    app.shutdown("el servicio se está apagando").finally(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

const isMain =
  (import.meta as { main?: boolean }).main ??
  (process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) await main();
