import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { RunOptions, TaskInput, TaskResult } from "./agent/run-task.ts";
import {
  createApp,
  loadConfig,
  redact,
  type App,
  type AppDeps,
  type Config,
} from "./server.ts";

const TOKEN = "token-equipo-123";
const OR_KEY = "sk-or-falsa-456";
const PASSWORD = "clave-escritorio-789";
const DESK_A = "wss://escritorio-a.example/websockify";
const DESK_B = "ws://escritorio-b.example:6080/websockify";

type Call = {
  id: string;
  input: TaskInput;
  opt: RunOptions;
  resolve: (r: TaskResult) => void;
  reject: (e: unknown) => void;
};

function fakeRunner() {
  const calls: Call[] = [];
  const runner = (id: string, input: TaskInput, opt: RunOptions) =>
    new Promise<TaskResult>((resolve, reject) => {
      calls.push({ id, input, opt, resolve, reject });
    });
  return { runner, calls };
}

function result(over: Partial<TaskResult> = {}): TaskResult {
  return {
    estado: "terminada",
    resumen: "Listo.",
    costUsd: 0.12,
    traceDir: "/tmp/traza",
    app: null,
    stopReason: "finish",
    error: null,
    ...over,
  };
}

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  ms = 3000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end)
      throw new Error("la condición no se cumplió a tiempo");
    await delay(5);
  }
}

type Harness = {
  app: App;
  base: string;
  dataDir: string;
  calls: Call[];
  logs: string[];
  manualCalls: unknown[][];
  api: (
    path: string,
    init?: {
      method?: string;
      body?: unknown;
      token?: string | null;
      raw?: string;
    },
  ) => Promise<{ status: number; json: any; ms: number }>;
  post: (tarea: string, url?: string, password?: string) => Promise<string>;
  get: (id: string) => Promise<{ estado: string; resumen: string }>;
};

async function start(
  t: TestContext,
  over: Partial<Config> = {},
  deps: Partial<Pick<AppDeps, "updateManual" | "manualText">> = {},
): Promise<Harness> {
  const dataDir = over.dataDir ?? mkdtempSync(join(tmpdir(), "cdmx-servidor-"));
  if (!over.dataDir)
    t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const fake = fakeRunner();
  const logs: string[] = [];
  const manualCalls: unknown[][] = [];
  const config: Config = {
    port: 0,
    teamToken: TOKEN,
    openrouterKey: OR_KEY,
    dataDir,
    piBin: "pi",
    agentModel: "modelo/agente",
    guardModel: "modelo/guardia",
    thinking: "high",
    deadlineMs: 280_000,
    maxCostUsd: 0.6,
    graceMs: 10_000,
    abortWaitMs: 15_000,
    ...over,
  };
  const app = createApp({
    config,
    runner: fake.runner,
    manualText: deps.manualText ?? (() => "MANUAL DE PRUEBA"),
    updateManual:
      deps.updateManual ??
      (async (...args) => {
        manualCalls.push(args);
      }),
    log: (line) => logs.push(line),
  });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  const api: Harness["api"] = async (path, init = {}) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = init.token === undefined ? TOKEN : init.token;
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    const body =
      init.raw ??
      (init.body === undefined ? undefined : JSON.stringify(init.body));
    const t0 = Date.now();
    const res = await fetch(base + path, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
    });
    const text = await res.text();
    return {
      status: res.status,
      json: text ? JSON.parse(text) : null,
      ms: Date.now() - t0,
    };
  };
  const post = async (tarea: string, url = DESK_A, password = PASSWORD) => {
    const r = await api("/tasks", {
      body: { tarea, escritorio: { url, password } },
    });
    assert.equal(r.status, 200);
    return r.json.task_id as string;
  };
  const get = async (id: string) => {
    const r = await api(`/tasks/${id}`);
    assert.equal(r.status, 200);
    return r.json as { estado: string; resumen: string };
  };
  return {
    app,
    base,
    dataDir,
    calls: fake.calls,
    logs,
    manualCalls,
    api,
    post,
    get,
  };
}

test("GET /health responde 200 {ok:true} con o sin token", async (t) => {
  const h = await start(t);
  for (const token of [null, TOKEN, "otro"]) {
    const r = await h.api("/health", { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  }
});

test("las conexiones keep-alive duran más que el sondeo de 5 s y que el proxy de Railway", async (t) => {
  const h = await start(t);
  assert.ok(
    h.app.server.keepAliveTimeout > 60_000,
    `keepAliveTimeout = ${h.app.server.keepAliveTimeout}`,
  );
});

test("/tasks exige el token del equipo", async (t) => {
  const h = await start(t);
  const body = { tarea: "x", escritorio: { url: DESK_A, password: PASSWORD } };
  assert.equal((await h.api("/tasks", { body, token: null })).status, 401);
  assert.equal((await h.api("/tasks", { body, token: "malo" })).status, 401);
  assert.equal(
    (await h.api("/tasks", { body, token: `${TOKEN}x` })).status,
    401,
  );
  assert.equal((await h.api("/tasks/abc", { token: null })).status, 401);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.api("/tasks", { body })).status, 200);
});

test("POST /tasks valida el cuerpo con 400 y un mensaje claro", async (t) => {
  const h = await start(t);
  const cases: { raw?: string; body?: unknown; msg: RegExp }[] = [
    { raw: "{no es json", msg: /JSON/ },
    { raw: "", msg: /JSON/ },
    { body: [], msg: /objeto/ },
    { body: { escritorio: { url: DESK_A, password: "p" } }, msg: /tarea/ },
    {
      body: { tarea: "   ", escritorio: { url: DESK_A, password: "p" } },
      msg: /tarea/,
    },
    {
      body: { tarea: 5, escritorio: { url: DESK_A, password: "p" } },
      msg: /tarea/,
    },
    { body: { tarea: "x" }, msg: /escritorio/ },
    {
      body: {
        tarea: "x",
        escritorio: { url: "http://a/websockify", password: "p" },
      },
      msg: /ws:\/\/ o wss:\/\//,
    },
    {
      body: { tarea: "x", escritorio: { url: "wss://", password: "p" } },
      msg: /ws:\/\/ o wss:\/\//,
    },
    { body: { tarea: "x", escritorio: { url: DESK_A } }, msg: /password/ },
    {
      body: { tarea: "x", escritorio: { url: DESK_A, password: 123 } },
      msg: /password/,
    },
  ];
  for (const c of cases) {
    const r = await h.api(
      "/tasks",
      c.raw !== undefined ? { raw: c.raw } : { body: c.body },
    );
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.match(r.json.error, c.msg);
  }
  const big = await h.api("/tasks", {
    body: {
      tarea: "x".repeat(70 * 1024),
      escritorio: { url: DESK_A, password: "p" },
    },
  });
  assert.equal(big.status, 413);
  assert.equal(h.calls.length, 0);
});

test("POST /tasks responde enseguida y la tarea pasa de en_curso a terminada", async (t) => {
  const h = await start(t);
  const r = await h.api("/tasks", {
    body: {
      tarea: "Registra al cliente X",
      escritorio: { url: DESK_A, password: PASSWORD },
    },
  });
  assert.equal(r.status, 200);
  assert.ok(r.ms < 500, `tardó ${r.ms} ms`);
  const id = r.json.task_id as string;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(r.json), ["task_id"]);

  assert.deepEqual(await h.get(id), {
    estado: "en_curso",
    resumen: "La tarea está en curso.",
  });
  await waitFor(() => h.calls.length === 1);
  const call = h.calls[0];
  assert.equal(call.id, id);
  assert.deepEqual(call.input, {
    tarea: "Registra al cliente X",
    wsUrl: DESK_A,
    password: PASSWORD,
  });
  assert.equal(call.opt.manual, "MANUAL DE PRUEBA");
  assert.equal(call.opt.model, "modelo/agente");
  assert.equal(call.opt.guardModel, "modelo/guardia");
  assert.equal(call.opt.openrouterKey, OR_KEY);
  assert.equal(call.opt.maxCostUsd, 0.6);
  assert.ok(call.opt.deadlineMs > 279_000 && call.opt.deadlineMs <= 280_000);
  assert.deepEqual(
    new Set(call.opt.secrets),
    new Set([PASSWORD, TOKEN, OR_KEY]),
  );
  assert.equal(call.opt.signal?.aborted, false);

  call.resolve(result({ resumen: "respuesta: 42" }));
  await waitFor(async () => (await h.get(id)).estado !== "en_curso");
  assert.deepEqual(await h.get(id), {
    estado: "terminada",
    resumen: "respuesta: 42",
  });
});

test("el resumen, el error y los logs nunca llevan secretos", async (t) => {
  const h = await start(t);
  const tarea = `Entra con ${PASSWORD} y cambia la dirección del cliente Papelería Los Andes en la ciudad de Pereira`;
  const id = await h.post(tarea);
  await waitFor(() => h.calls.length === 1);
  h.calls[0].resolve(
    result({
      resumen: `respuesta: 42\nUsé la contraseña ${PASSWORD} (${encodeURIComponent(PASSWORD)}), el token ${TOKEN} y la key ${OR_KEY}.`,
      error: `algo con ${PASSWORD}`,
      stopReason: "finish",
    }),
  );
  await h.app.idle();
  const { estado, resumen } = await h.get(id);
  assert.equal(estado, "terminada");
  assert.ok(resumen.startsWith("respuesta: 42\n"));
  assert.ok(resumen.includes("[oculto]"));

  const id2 = await h.post("otra tarea", DESK_B);
  await waitFor(() => h.calls.length === 2);
  const boom = new Error(
    `no conecta con ${PASSWORD} ni con ${TOKEN}\nsegunda línea`,
  );
  h.calls[1].reject(boom);
  await h.app.idle();
  const failed = await h.get(id2);
  assert.equal(failed.estado, "fallida");
  assert.match(
    failed.resumen,
    /error interno: no conecta con \[oculto\] ni con \[oculto\]$/,
  );
  assert.ok(!failed.resumen.includes("segunda línea"));
  assert.ok(!failed.resumen.includes("    at "));

  const onDisk = readdirSync(join(h.dataDir, "tasks")).map((f) =>
    readFileSync(join(h.dataDir, "tasks", f), "utf8"),
  );
  const everything = [resumen, failed.resumen, ...h.logs, ...onDisk].join("\n");
  for (const secret of [PASSWORD, TOKEN, OR_KEY])
    assert.ok(!everything.includes(secret), `se filtró ${secret}`);

  const line = h.logs
    .map((l) => JSON.parse(l))
    .find((l) => l.evento === "tarea" && l.id === id);
  assert.equal(line.estado, "terminada");
  assert.equal(line.stopReason, "finish");
  assert.equal(line.costUsd, 0.12);
  assert.equal(typeof line.duracionMs, "number");
  assert.ok(line.tarea.length <= 80);
  assert.ok(h.logs.every((l) => !l.includes("\n")));
});

test("redact oculta cada secreto en una sola pasada y deja el resto igual", () => {
  assert.equal(redact("a clave b clave", ["clave"]), "a [oculto] b [oculto]");
  assert.equal(redact("x a/b y", ["a/b"]), "x [oculto] y");
  assert.equal(redact("x a%2Fb y", ["a/b"]), "x [oculto] y");
  assert.equal(redact("sin secretos", ["", "zzz"]), "sin secretos");
  assert.equal(redact("p.a+s", ["p.a+s"]), "[oculto]");
});

test("una tarea nueva para el mismo escritorio aborta la anterior y espera a que termine", async (t) => {
  const h = await start(t);
  const a = await h.post("tarea A", DESK_A);
  await waitFor(() => h.calls.length === 1);
  const first = h.calls[0];

  const b = await h.post("tarea B", DESK_A);
  assert.equal(first.opt.signal?.aborted, true);
  assert.equal(
    first.opt.signal?.reason,
    "llegó otra tarea para el mismo escritorio",
  );

  // Otro escritorio corre en paralelo, sin esperar.
  const c = await h.post("tarea C", DESK_B);
  await waitFor(() => h.calls.length === 2);
  assert.equal(h.calls[1].id, c);
  await delay(30);
  assert.equal(
    h.calls.length,
    2,
    "B no puede arrancar mientras A sigue sobre el escritorio",
  );

  first.resolve(
    result({
      estado: "fallida",
      resumen: "Cancelada.",
      stopReason: "cancelada",
    }),
  );
  await waitFor(() => h.calls.length === 3);
  assert.equal(h.calls[2].id, b);
  assert.equal(h.calls[2].opt.signal?.aborted, false);
  assert.deepEqual(await h.get(a), {
    estado: "fallida",
    resumen: "Cancelada.",
  });
  assert.equal((await h.get(b)).estado, "en_curso");

  h.calls[1].resolve(result());
  h.calls[2].resolve(result());
  await h.app.idle();
  assert.equal((await h.get(b)).estado, "terminada");
  assert.equal((await h.get(c)).estado, "terminada");
});

test("una tarea que quedó esperando y fue reemplazada no llega a correr", async (t) => {
  const h = await start(t);
  const a = await h.post("A");
  await waitFor(() => h.calls.length === 1);
  const b = await h.post("B");
  const c = await h.post("C");
  h.calls[0].resolve(result({ estado: "fallida", stopReason: "cancelada" }));
  await waitFor(() => h.calls.length === 2);
  assert.equal(h.calls[1].id, c);
  const gotB = await h.get(b);
  assert.equal(gotB.estado, "fallida");
  assert.match(gotB.resumen, /llegó otra tarea para el mismo escritorio/);
  h.calls[1].resolve(result());
  await h.app.idle();
  assert.equal((await h.get(a)).estado, "fallida");
});

test("si la anterior no se detiene, la nueva arranca tras abortWaitMs", async (t) => {
  const h = await start(t, { abortWaitMs: 40 });
  await h.post("A");
  await waitFor(() => h.calls.length === 1);
  const b = await h.post("B");
  await waitFor(() => h.calls.length === 2);
  assert.equal(h.calls[1].id, b);
});

test("respaldo: si el ejecutor no devuelve a tiempo, la tarea se publica fallida y se aborta", async (t) => {
  const h = await start(t, { deadlineMs: 60, graceMs: 60 });
  const id = await h.post("tarea lenta");
  await waitFor(() => h.calls.length === 1);
  const call = h.calls[0];
  assert.ok(call.opt.deadlineMs > 0 && call.opt.deadlineMs <= 60);
  await waitFor(async () => (await h.get(id)).estado !== "en_curso");
  const got = await h.get(id);
  assert.equal(got.estado, "fallida");
  assert.match(got.resumen, /se acabó el tiempo/);
  assert.equal(call.opt.signal?.aborted, true);
  assert.equal(call.opt.signal?.reason, "se acabó el tiempo");

  // Un resultado tardío no pisa lo publicado.
  call.resolve(result({ resumen: "terminé tarde" }));
  await h.app.idle();
  assert.equal((await h.get(id)).estado, "fallida");
  assert.ok(h.logs.some((l) => JSON.parse(l).evento === "resultado_tardio"));
});

test("respaldo: primero pide parar y solo después reporta; si el ejecutor para a tiempo, cuenta su resultado", async (t) => {
  const h = await start(t, { deadlineMs: 40, graceMs: 400 });
  const id = await h.post("tarea que se pasa del tiempo");
  await waitFor(() => h.calls.length === 1);
  const call = h.calls[0];
  await waitFor(() => call.opt.signal?.aborted === true);
  assert.equal(call.opt.signal?.reason, "se acabó el tiempo");
  assert.equal(
    (await h.get(id)).estado,
    "en_curso",
    "no se reporta mientras el agente puede seguir operando",
  );
  call.resolve(
    result({
      estado: "fallida",
      resumen: "Me detuve por tiempo.",
      stopReason: "tiempo",
    }),
  );
  await h.app.idle();
  assert.deepEqual(await h.get(id), {
    estado: "fallida",
    resumen: "Me detuve por tiempo.",
  });
});

test("las tareas se guardan en disco y las que quedaron en curso pasan a fallida al reiniciar", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "cdmx-servidor-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const first = await start(t, { dataDir });
  const done = await first.post("tarea que termina", DESK_A);
  const pending = await first.post("tarea que queda a medias", DESK_B);
  await waitFor(() => first.calls.length === 2);
  first.calls
    .find((c) => c.id === done)!
    .resolve(result({ resumen: "Cliente creado." }));
  await waitFor(async () => (await first.get(done)).estado === "terminada");

  const files = readdirSync(join(dataDir, "tasks"));
  assert.deepEqual(files.sort(), [`${done}.json`, `${pending}.json`].sort());
  const stored = JSON.parse(
    readFileSync(join(dataDir, "tasks", `${done}.json`), "utf8"),
  );
  assert.equal(stored.estado, "terminada");
  assert.equal(stored.resumen, "Cliente creado.");
  assert.equal(stored.stopReason, "finish");
  await first.app.close(); // el proceso "muere" con la segunda tarea en curso

  const second = await start(t, { dataDir });
  assert.deepEqual(await second.get(done), {
    estado: "terminada",
    resumen: "Cliente creado.",
  });
  const restarted = await second.get(pending);
  assert.equal(restarted.estado, "fallida");
  assert.match(restarted.resumen, /el servicio se reinició durante la tarea/);
  const rewritten = JSON.parse(
    readFileSync(join(dataDir, "tasks", `${pending}.json`), "utf8"),
  );
  assert.equal(rewritten.estado, "fallida");
  assert.equal(rewritten.stopReason, "reinicio");
  assert.equal(second.calls.length, 0);
});

test("404 para un task_id que no existe y para rutas desconocidas", async (t) => {
  const h = await start(t);
  assert.equal((await h.api("/tasks/no-existe")).status, 404);
  assert.equal((await h.api("/tasks/../../etc/passwd")).status, 404);
  assert.equal((await h.api("/otra-cosa")).status, 404);
  assert.equal((await h.api("/tasks/abc", { method: "DELETE" })).status, 405);
});

test("las rutas aceptan barras repetidas o finales (entrypoint registrado con '/' al final)", async (t) => {
  const h = await start(t);
  const body = { tarea: "x", escritorio: { url: DESK_A, password: PASSWORD } };
  for (const path of ["//tasks", "/tasks/", "//tasks/"]) {
    // Un escritorio distinto por tarea: ninguna queda esperando a otra.
    const url = `wss://${path.replace(/\W/g, "x")}.example/websockify`;
    const r = await h.api(path, {
      body: { ...body, escritorio: { url, password: PASSWORD } },
    });
    assert.equal(r.status, 200, path);
    assert.match(r.json.task_id, /^[0-9a-f-]{36}$/);
  }
  const id = (
    await h.api("//tasks", {
      body: { ...body, escritorio: { url: DESK_B, password: PASSWORD } },
    })
  ).json.task_id;
  for (const path of [`//tasks/${id}`, `/tasks/${id}/`, `/tasks/${id}?x=1`]) {
    const r = await h.api(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.json.estado, "en_curso");
  }
  assert.deepEqual((await h.api("//health", { token: null })).json, {
    ok: true,
  });
  assert.equal((await h.api("//tasks", { body, token: null })).status, 401);
});

test("con app conocida actualiza el manual en segundo plano; sin app, no", async (t) => {
  const h = await start(t);
  const a = await h.post("A", DESK_A);
  const b = await h.post("B", DESK_B);
  await waitFor(() => h.calls.length === 2);
  h.calls
    .find((c) => c.id === a)!
    .resolve(
      result({
        app: "AppDemo",
        traceDir: "/data/traces/a",
        resumen: `ok ${PASSWORD}`,
      }),
    );
  h.calls.find((c) => c.id === b)!.resolve(result({ app: null }));
  await h.app.idle();
  assert.equal(h.manualCalls.length, 1);
  const [app, traceDir, resumen, opt] = h.manualCalls[0] as [
    string,
    string,
    string,
    Record<string, string>,
  ];
  assert.equal(app, "AppDemo");
  assert.equal(traceDir, "/data/traces/a");
  assert.equal(resumen, "ok [oculto]");
  assert.deepEqual(opt, {
    piBin: "pi",
    openrouterKey: OR_KEY,
    model: "modelo/guardia",
    dataDir: h.dataDir,
  });
});

test("si actualizar el manual falla, la tarea queda terminada y el servidor sigue", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const h = await start(
    t,
    {},
    {
      updateManual: async () => {
        await gate;
        throw new Error(`falló el manual con ${OR_KEY}`);
      },
    },
  );
  const id = await h.post("A");
  await waitFor(() => h.calls.length === 1);
  h.calls[0].resolve(result({ app: "AppDemo" }));
  // La respuesta no espera al manual.
  await waitFor(async () => (await h.get(id)).estado === "terminada");
  release();
  await h.app.idle();
  assert.equal((await h.api("/health")).status, 200);
  const err = h.logs.find((l) => JSON.parse(l).evento === "manual_error");
  assert.ok(err && !err.includes(OR_KEY));
});

test("si leer el manual falla, la tarea corre igual con manual vacío", async (t) => {
  const h = await start(
    t,
    {},
    {
      manualText: () => {
        throw new Error("sin manual");
      },
    },
  );
  await h.post("A");
  await waitFor(() => h.calls.length === 1);
  assert.equal(h.calls[0].opt.manual, "");
});

test("loadConfig aplica los valores por defecto y exige TEAM_TOKEN y OPENROUTER_API_KEY", () => {
  assert.throws(() => loadConfig({}), /TEAM_TOKEN, OPENROUTER_API_KEY/);
  assert.throws(() => loadConfig({ TEAM_TOKEN: "t" }), /OPENROUTER_API_KEY/);
  const c = loadConfig({ TEAM_TOKEN: "t", OPENROUTER_API_KEY: "k" });
  assert.equal(c.port, 8080);
  assert.equal(c.piBin, "pi");
  assert.equal(c.agentModel, "anthropic/claude-sonnet-5.5");
  assert.equal(c.guardModel, "anthropic/claude-haiku-5.5");
  assert.equal(c.thinking, "high");
  assert.equal(c.deadlineMs, 280_000);
  assert.equal(c.maxCostUsd, 0.6);
  assert.equal(c.graceMs, 10_000);
  const custom = loadConfig({
    TEAM_TOKEN: "t",
    OPENROUTER_API_KEY: "k",
    PORT: "3000",
    TASK_DEADLINE_MS: "1000",
    PI_BIN: "/x/pi",
  });
  assert.equal(custom.port, 3000);
  assert.equal(custom.deadlineMs, 1000);
  assert.equal(custom.piBin, "/x/pi");
  assert.throws(
    () =>
      loadConfig({
        TEAM_TOKEN: "t",
        OPENROUTER_API_KEY: "k",
        MAX_COST_USD: "-1",
      }),
    /MAX_COST_USD/,
  );
});

test("arrancar como main sin TEAM_TOKEN ni OPENROUTER_API_KEY termina con un error claro", () => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: "0",
    DATA_DIR: tmpdir(),
  };
  delete env.TEAM_TOKEN;
  delete env.OPENROUTER_API_KEY;
  const server = fileURLToPath(new URL("./server.ts", import.meta.url));
  const r = spawnSync(process.execPath, [server], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /TEAM_TOKEN, OPENROUTER_API_KEY/);
  assert.ok(existsSync(server));
});
