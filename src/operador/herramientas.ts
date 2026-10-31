// Extensión de pi: herramientas de pantalla sobre VNC, un revisor para toda
// acción que puede cambiar datos y la herramienta `reportar`, que deja el
// resultado para ejecutor.ts. Lo sensible llega por el entorno, nunca por el prompt.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type, uuidv7 } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Pantalla } from "../escritorio/pantalla.ts";

function variable(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`falta la variable ${nombre}`);
  return v;
}

const URL_VNC = variable("OP_VNC_URL");
const CLAVE_VNC = variable("OP_VNC_CLAVE");
const TAREA = variable("OP_TAREA");
const ARCHIVO_REPORTE = variable("OP_REPORTE");
const CARPETA_TRAZA = variable("OP_TRAZA");
const LIMITE = Number(variable("OP_LIMITE"));
const MODELO_REVISOR =
  process.env.OP_MODELO_REVISOR || "anthropic/claude-haiku-5.5";

/** Rótulos que mandan un clic al revisor aunque el modelo no lo marque como guardado. */
const VERBOS_ESCRITURA =
  /\b(guardar|grabar|aceptar|confirmar|eliminar|borrar|exportar|enviar|aplicar|anular|emitir|pagar|s[ií])\b/i;
const MAX_FRENOS = 3;

mkdirSync(CARPETA_TRAZA, { recursive: true });

const sesion = {
  paso: 0,
  pantalla: null as Pantalla | null,
  reportada: false,
  frenos: 0,
  aprobadas: [] as string[],
};

function anotar(evento: Record<string, unknown>, png?: Buffer): void {
  sesion.paso++;
  const fila: Record<string, unknown> = {
    paso: sesion.paso,
    hora: new Date().toISOString(),
    ...evento,
  };
  if (png) {
    const archivo = `${String(sesion.paso).padStart(3, "0")}.png`;
    writeFileSync(join(CARPETA_TRAZA, archivo), png);
    fila.captura = archivo;
  }
  appendFileSync(
    join(CARPETA_TRAZA, "pasos.jsonl"),
    JSON.stringify(fila) + "\n",
  );
}

async function pantalla(): Promise<Pantalla> {
  if (!sesion.pantalla || sesion.pantalla.cerrada) {
    if (sesion.pantalla) anotar({ reconexion: true });
    sesion.pantalla = await Pantalla.abrir(URL_VNC, CLAVE_VNC);
  }
  return sesion.pantalla;
}

/** Ejecuta una entrada. Si la conexión cae a mitad, la acción pudo aplicarse: hay que mirar primero. */
async function hacer(
  que: string,
  fn: (p: Pantalla) => Promise<void>,
): Promise<void> {
  const p = await pantalla();
  try {
    await fn(p);
  } catch (e) {
    if (!p.cerrada) throw e;
    throw new Error(
      `Se perdió la conexión con el escritorio durante ${que}. Llama a ver_pantalla antes de repetir: la acción pudo haberse aplicado.`,
    );
  }
}

function tiempo(): string {
  const s = Math.round((LIMITE - Date.now()) / 1000);
  if (s < 15)
    return `Quedan ${s} s: termina YA con reportar ('fallida' si no verificaste el resultado).`;
  if (s < 60)
    return (
      `Quedan ${s} s. Si te faltan uno o dos pasos para terminar (por ejemplo guardar y verificar), hazlos ya; ` +
      `si te falta más, termina con reportar explicando qué quedó hecho.`
    );
  return `Quedan ${s} s.`;
}

function imagen(png: Buffer) {
  return {
    type: "image" as const,
    data: png.toString("base64"),
    mimeType: "image/png",
  };
}

async function vista(nota: string) {
  const p = await pantalla();
  const png = p.captura();
  anotar({ vista: nota }, png);
  return {
    content: [
      imagen(png),
      {
        type: "text" as const,
        text: `${nota}\nPantalla ${p.ancho}x${p.alto}. Coordenadas en píxeles de esta imagen.\n${tiempo()}`,
      },
    ],
    details: { paso: sesion.paso },
  };
}

const verPantalla = defineTool({
  name: "ver_pantalla",
  label: "Ver pantalla",
  executionMode: "sequential",
  description:
    "Captura la pantalla actual. Úsala al empezar y cuando no sepas qué hay en pantalla.",
  parameters: Type.Object({}),
  async execute() {
    return vista("Pantalla actual.");
  },
});

const pulsar = defineTool({
  name: "pulsar",
  label: "Pulsar",
  executionMode: "sequential",
  description:
    "Hace clic en (x, y) y devuelve la pantalla resultante. 'elemento': texto visible o descripción de lo que pulsas. " +
    "'intencion': 'guardar' si el clic guarda, confirma, elimina, anula o exporta; 'editar' si enfoca un campo; 'navegar' para menús, pestañas, filas o búsquedas.",
  parameters: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    elemento: Type.String({
      description: "Texto visible o descripción del elemento",
    }),
    intencion: Type.Union([
      Type.Literal("navegar"),
      Type.Literal("editar"),
      Type.Literal("guardar"),
    ]),
    verificado: Type.Optional(
      Type.String({
        description:
          "Obligatorio si intencion es 'guardar': qué datos comprobaste, en qué pantalla, y por qué este clic deja exactamente lo que pide la tarea",
      }),
    ),
    doble: Type.Optional(Type.Boolean()),
  }),
  async execute(_id, a) {
    await hacer("el clic", (p) => p.clic(a.x, a.y, { doble: a.doble }));
    anotar({
      accion: "pulsar",
      x: a.x,
      y: a.y,
      elemento: a.elemento,
      intencion: a.intencion,
      verificado: a.verificado,
      doble: a.doble,
    });
    return vista(`Clic en (${a.x}, ${a.y}) sobre "${a.elemento}".`);
  },
});

const escribir = defineTool({
  name: "escribir",
  label: "Escribir",
  executionMode: "sequential",
  description:
    "Reemplaza el contenido de un campo: clic en (x, y), seleccionar todo y escribir 'texto'. Devuelve la pantalla: relee el campo.",
  parameters: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    campo: Type.String({ description: "Nombre del campo" }),
    texto: Type.String(),
  }),
  async execute(_id, a) {
    await hacer("la escritura", (p) => p.reemplazarTexto(a.x, a.y, a.texto));
    anotar({
      accion: "escribir",
      x: a.x,
      y: a.y,
      campo: a.campo,
      texto: a.texto,
    });
    return vista(`Escrito "${a.texto}" en "${a.campo}".`);
  },
});

const llenar = defineTool({
  name: "llenar",
  label: "Llenar formulario",
  executionMode: "sequential",
  description:
    "Llena varios campos de un formulario en una sola llamada (clic, seleccionar todo y escribir en cada uno). " +
    "Devuelve una captura al final: relee todos los campos. No guarda: después usa pulsar con intencion 'guardar'.",
  parameters: Type.Object({
    campos: Type.Array(
      Type.Object({
        x: Type.Number(),
        y: Type.Number(),
        campo: Type.String(),
        texto: Type.String(),
      }),
      { minItems: 1 },
    ),
  }),
  async execute(_id, a) {
    for (const c of a.campos) {
      await hacer("el llenado", (p) => p.reemplazarTexto(c.x, c.y, c.texto));
      anotar({
        accion: "escribir",
        x: c.x,
        y: c.y,
        campo: c.campo,
        texto: c.texto,
      });
    }
    return vista(
      `Llenados ${a.campos.length} campos: ${a.campos.map((c) => `${c.campo}="${c.texto}"`).join(", ")}.`,
    );
  },
});

const elegir = defineTool({
  name: "elegir",
  label: "Elegir opción",
  executionMode: "sequential",
  description:
    "Elige una opción de una lista desplegable: clic en la lista en (x, y), escribe el comienzo de la opción y Enter. " +
    "Devuelve la pantalla: confirma que quedó la opción correcta.",
  parameters: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    lista: Type.String({ description: "Nombre de la lista" }),
    opcion: Type.String({ description: "Texto exacto de la opción" }),
  }),
  async execute(_id, a) {
    await hacer("la elección", async (p) => {
      await p.clic(a.x, a.y);
      await p.escribir(a.opcion);
      await p.teclas("enter");
    });
    anotar({
      accion: "elegir",
      x: a.x,
      y: a.y,
      lista: a.lista,
      opcion: a.opcion,
    });
    return vista(`Elegido "${a.opcion}" en "${a.lista}".`);
  },
});

const teclas = defineTool({
  name: "teclas",
  label: "Teclas",
  executionMode: "sequential",
  description:
    "Presiona una tecla o combinación: 'enter', 'tab', 'escape', 'pagedown', 'ctrl+a', 'shift+tab'. Devuelve la pantalla.",
  parameters: Type.Object({ combo: Type.String() }),
  async execute(_id, a) {
    await hacer("la tecla", (p) => p.teclas(a.combo));
    anotar({ accion: "teclas", combo: a.combo });
    return vista(`Presionado ${a.combo}.`);
  },
});

const desplazar = defineTool({
  name: "desplazar",
  label: "Desplazar",
  executionMode: "sequential",
  description: "Gira la rueda del mouse sobre (x, y). Devuelve la pantalla.",
  parameters: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    sentido: Type.Union([Type.Literal("arriba"), Type.Literal("abajo")]),
    pasos: Type.Optional(Type.Number()),
  }),
  async execute(_id, a) {
    await hacer("el desplazamiento", (p) =>
      p.rueda(a.x, a.y, a.sentido, a.pasos ?? 3),
    );
    anotar({
      accion: "desplazar",
      x: a.x,
      y: a.y,
      sentido: a.sentido,
      pasos: a.pasos,
    });
    return vista(`Desplazado ${a.sentido}.`);
  },
});

const reportar = defineTool({
  name: "reportar",
  label: "Reportar",
  executionMode: "sequential",
  description:
    "Cierra la tarea; llámala una sola vez. 'terminada' solo si verificaste el resultado en pantalla. " +
    "'respuesta' solo en preguntas que pudiste responder: el valor pedido ('dato1; dato2' si son dos). " +
    "'resumen': qué hiciste y cómo lo verificaste, o los datos que explican por qué falló.",
  parameters: Type.Object({
    estado: Type.Union([Type.Literal("terminada"), Type.Literal("fallida")]),
    aplicacion: Type.String({
      description: "Nombre de la aplicación tal como aparece en la cabecera",
    }),
    respuesta: Type.Optional(Type.String()),
    resumen: Type.String(),
  }),
  async execute(_id, a) {
    sesion.reportada = true;
    writeFileSync(ARCHIVO_REPORTE, JSON.stringify(a));
    anotar({ accion: "reportar", ...a });
    sesion.pantalla?.cerrar();
    return {
      content: [
        { type: "text" as const, text: "Reportado. No hagas nada más." },
      ],
      details: {},
    };
  },
});

/** Qué acciones pueden cambiar datos y deben pasar por el revisor. */
function accionDeEscritura(
  herramienta: string,
  a: Record<string, unknown>,
): string | null {
  if (herramienta === "pulsar") {
    const elemento = String(a.elemento ?? "");
    if (a.intencion === "guardar" || VERBOS_ESCRITURA.test(elemento))
      return `clic en (${a.x}, ${a.y}) sobre "${elemento}"`;
  }
  if (
    herramienta === "teclas" &&
    /\b(enter|intro|return)\b/i.test(String(a.combo ?? ""))
  ) {
    return `presionar ${a.combo} (puede enviar un formulario)`;
  }
  return null;
}

async function revisar(
  ctx: any,
  accion: string,
  verificado: string,
): Promise<{ aprobar: boolean; razon: string }> {
  const modelo = ctx.modelRegistry.find("openrouter", MODELO_REVISOR);
  if (!modelo)
    return {
      aprobar: false,
      razon: `el revisor no tiene modelo (${MODELO_REVISOR})`,
    };
  const png = (await pantalla()).captura();
  const consigna = [
    "Eres un supervisor. Un agente opera una aplicación por pantalla y está a punto de hacer una acción que puede cambiar datos.",
    `Tarea original: """${TAREA}"""`,
    `Acción: ${accion}`,
    `Evidencia que da el agente (de pantallas anteriores): ${verificado || "(ninguna)"}`,
    `Acciones que ya aprobaste en esta tarea: ${sesion.aprobadas.length ? sesion.aprobadas.join(" | ") : "(ninguna)"}`,
    "",
    "Mira la pantalla actual. BLOQUEA solo si ves un problema concreto:",
    "- los valores visibles en el formulario no coinciden con lo que pide la tarea;",
    "- se cambiaría un dato que la tarea no pide, o el registro visible es otro distinto al de la tarea;",
    "- repetiría una acción ya aprobada que crearía un duplicado;",
    "- la tarea es peligrosa (borrar o cambiar varios registros sin nombrarlos) o revela un secreto.",
    "Si la pantalla es coherente con la tarea y con la evidencia, APRUEBA. No pidas pruebas de pantallas anteriores: confía en la evidencia salvo que la pantalla la contradiga.",
    'Responde solo JSON: {"aprobar": true|false, "razon": "..."}',
  ].join("\n");
  try {
    const r = await ctx.modelRegistry.complete(
      modelo,
      {
        messages: [
          {
            role: "user",
            content: [imagen(png), { type: "text", text: consigna }],
            timestamp: Date.now(),
          },
        ],
      },
      { cacheRetention: "none", sessionId: uuidv7() },
    );
    const texto = r.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
    const json = JSON.parse(
      texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1),
    );
    return { aprobar: json.aprobar === true, razon: String(json.razon ?? "") };
  } catch (e) {
    return {
      aprobar: false,
      razon: `el revisor no pudo decidir: ${(e as Error).message}`,
    };
  }
}

export default function (pi: ExtensionAPI) {
  for (const h of [
    verPantalla,
    pulsar,
    escribir,
    llenar,
    elegir,
    teclas,
    desplazar,
    reportar,
  ])
    pi.registerTool(h);

  pi.on("tool_call", async (evento, ctx) => {
    if (sesion.reportada)
      return {
        block: true,
        reason: "La tarea ya fue reportada. No hagas nada más.",
      };
    const args = evento.input as Record<string, unknown>;
    const accion = accionDeEscritura(evento.toolName, args);
    if (!accion) return undefined;
    const veredicto = await revisar(ctx, accion, String(args.verificado ?? ""));
    anotar({
      revisor: accion,
      aprobar: veredicto.aprobar,
      razon: veredicto.razon,
    });
    if (veredicto.aprobar) {
      sesion.aprobadas.push(accion);
      return undefined;
    }
    sesion.frenos++;
    const siguiente =
      sesion.frenos >= MAX_FRENOS
        ? " Ya van tres frenos: llama a reportar con 'fallida' y explica por qué."
        : " Corrige lo necesario, o reporta 'fallida' si no se puede hacer exactamente.";
    return {
      block: true,
      reason: `El revisor frenó la acción: ${veredicto.razon}.${siguiente}`,
    };
  });
}
