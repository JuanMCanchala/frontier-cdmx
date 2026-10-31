// Acciones sobre el escritorio remoto a ritmo humano. Cada acción espera a que
// la pantalla deje de cambiar: la app tarda hasta 1 s en repintar tras una entrada.
import { ConexionVnc } from "./protocolo.ts";
import { aPng } from "./imagen.ts";

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TECLAS: Record<string, number> = {
  enter: 0xff0d,
  intro: 0xff0d,
  return: 0xff0d,
  tab: 0xff09,
  escape: 0xff1b,
  esc: 0xff1b,
  backspace: 0xff08,
  retroceso: 0xff08,
  delete: 0xffff,
  supr: 0xffff,
  insert: 0xff63,
  home: 0xff50,
  inicio: 0xff50,
  end: 0xff57,
  fin: 0xff57,
  left: 0xff51,
  up: 0xff52,
  right: 0xff53,
  down: 0xff54,
  pageup: 0xff55,
  pagedown: 0xff56,
  space: 0x20,
  espacio: 0x20,
  ctrl: 0xffe3,
  control: 0xffe3,
  shift: 0xffe1,
  mayus: 0xffe1,
  alt: 0xffe9,
  meta: 0xffe7,
  f1: 0xffbe,
  f2: 0xffbf,
  f3: 0xffc0,
  f4: 0xffc1,
  f5: 0xffc2,
  f6: 0xffc3,
  f7: 0xffc4,
  f8: 0xffc5,
  f9: 0xffc6,
  f10: 0xffc7,
  f11: 0xffc8,
  f12: 0xffc9,
};

/** Keysym X11 de un carácter: Latin-1 va directo; el resto, por el rango Unicode. */
export function teclaDe(c: string): number {
  if (c === "\n") return TECLAS.enter;
  if (c === "\t") return TECLAS.tab;
  const cp = c.codePointAt(0)!;
  return cp <= 0xff ? cp : 0x01000000 + cp;
}

/** Keysyms de una combinación como "ctrl+a", "shift+tab" o "enter". */
export function leerCombinacion(combo: string): number[] {
  return combo
    .trim()
    .toLowerCase()
    .split("+")
    .map((t) => t.trim())
    .map((t) => {
      const sym = TECLAS[t] ?? ([...t].length === 1 ? teclaDe(t) : undefined);
      if (sym === undefined) throw new Error(`tecla desconocida: "${t}"`);
      return sym;
    });
}

export type Calma = { minimoMs?: number; quietoMs?: number; maximoMs?: number };

export class Pantalla {
  readonly conexion: ConexionVnc;

  constructor(conexion: ConexionVnc) {
    this.conexion = conexion;
  }

  static async abrir(url: string, clave: string): Promise<Pantalla> {
    const c = await ConexionVnc.conectar(url, clave);
    const inicio = performance.now();
    while (c.imagenes === 0) {
      if (c.cerrada)
        throw new Error("VNC: la conexión se cerró antes de la primera imagen");
      if (performance.now() - inicio > 10_000)
        throw new Error("VNC: no llegó la primera imagen");
      await pausa(50);
    }
    return new Pantalla(c);
  }

  get ancho(): number {
    return this.conexion.ancho;
  }

  get alto(): number {
    return this.conexion.alto;
  }

  get cerrada(): boolean {
    return this.conexion.cerrada;
  }

  cerrar(): void {
    this.conexion.cerrar();
  }

  /**
   * Espera a que la pantalla se quede quieta: mira al menos `minimoMs` desde la entrada, porque la
   * app tarda hasta 1 s en repintar y el destello de un botón llega antes que el repintado real;
   * luego exige `quietoMs` sin cambios, y nunca pasa de `maximoMs`.
   */
  async esperarCalma(desde: number, op: Calma = {}): Promise<void> {
    const { minimoMs = 1200, quietoMs = 400, maximoMs = 5000 } = op;
    for (;;) {
      await pausa(50);
      const ahora = performance.now();
      if (ahora - desde >= maximoMs) return;
      if (
        ahora - desde >= minimoMs &&
        ahora - Math.max(this.conexion.ultimoCambio, desde) >= quietoMs
      )
        return;
    }
  }

  captura(): Buffer {
    return aPng(this.conexion.pixeles, this.ancho, {
      x: 0,
      y: 0,
      ancho: this.ancho,
      alto: this.alto,
    });
  }

  /** Una zona de la pantalla ampliada `factor` veces, para leer texto pequeño. */
  ampliar(
    x: number,
    y: number,
    ancho: number,
    alto: number,
    factor = 2,
  ): Buffer {
    const zx = Math.max(0, Math.min(this.ancho - 1, Math.round(x)));
    const zy = Math.max(0, Math.min(this.alto - 1, Math.round(y)));
    const zw = Math.max(1, Math.min(this.ancho - zx, Math.round(ancho)));
    const zh = Math.max(1, Math.min(this.alto - zy, Math.round(alto)));
    return aPng(
      this.conexion.pixeles,
      this.ancho,
      { x: zx, y: zy, ancho: zw, alto: zh },
      Math.max(1, Math.min(4, Math.round(factor))),
    );
  }

  async clic(
    x: number,
    y: number,
    op: { doble?: boolean; derecho?: boolean } = {},
  ): Promise<void> {
    const mascara = op.derecho ? 4 : 1;
    const t = performance.now();
    this.conexion.puntero(x, y, 0);
    await pausa(50);
    const veces = op.doble ? 2 : 1;
    for (let i = 0; i < veces; i++) {
      this.conexion.puntero(x, y, mascara);
      await pausa(150); // la app ignora pulsaciones de menos de 100 ms
      this.conexion.puntero(x, y, 0);
      if (i < veces - 1) await pausa(90);
    }
    await this.esperarCalma(t);
  }

  async rueda(
    x: number,
    y: number,
    sentido: "arriba" | "abajo",
    pasos = 3,
  ): Promise<void> {
    const mascara = sentido === "arriba" ? 8 : 16;
    const t = performance.now();
    this.conexion.puntero(x, y, 0);
    for (let i = 0; i < pasos; i++) {
      this.conexion.puntero(x, y, mascara);
      await pausa(30);
      this.conexion.puntero(x, y, 0);
      await pausa(30);
    }
    await this.esperarCalma(t);
  }

  async teclas(combo: string): Promise<void> {
    const syms = leerCombinacion(combo);
    const t = performance.now();
    for (const s of syms) {
      this.conexion.tecla(s, true);
      await pausa(30);
    }
    for (const s of [...syms].reverse()) {
      this.conexion.tecla(s, false);
      await pausa(30);
    }
    await this.esperarCalma(t);
  }

  async escribir(texto: string): Promise<void> {
    const t = performance.now();
    for (const c of texto) {
      const sym = teclaDe(c);
      this.conexion.tecla(sym, true);
      await pausa(12);
      this.conexion.tecla(sym, false);
      await pausa(12);
    }
    await this.esperarCalma(t);
  }

  /** Reemplaza el contenido de un campo. Escribir sobre texto existente concatena: primero se selecciona todo. */
  async reemplazarTexto(x: number, y: number, texto: string): Promise<void> {
    await this.clic(x, y);
    await this.teclas("ctrl+a");
    if (texto === "") {
      await this.teclas("delete");
      return;
    }
    await this.escribir(texto);
  }
}
