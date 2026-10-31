// Conexión RFB 3.8 sobre el WebSocket de websockify. Soporta autenticación VNC
// (DES, requiere `--openssl-legacy-provider`), actualizaciones Raw y CopyRect,
// puntero y teclado. La imagen se guarda como RGBX, 4 bytes por píxel.
import { createCipheriv } from "node:crypto";

const CODIF_RAW = 0;
const CODIF_COPIA = 1;

/** Cola de bytes que llenan los mensajes del WebSocket y vacían lecturas de tamaño exacto. */
class ColaBytes {
  #trozos: Uint8Array[] = [];
  #total = 0;
  #despertar: (() => void) | null = null;
  falla: Error | null = null;

  meter(datos: Uint8Array): void {
    this.#trozos.push(datos);
    this.#total += datos.length;
    this.#avisar();
  }

  romper(error: Error): void {
    this.falla ??= error;
    this.#avisar();
  }

  #avisar(): void {
    const fn = this.#despertar;
    this.#despertar = null;
    fn?.();
  }

  async sacar(n: number): Promise<Uint8Array> {
    while (this.#total < n) {
      if (this.falla) throw this.falla;
      await new Promise<void>((r) => (this.#despertar = r));
    }
    const salida = new Uint8Array(n);
    let lleno = 0;
    while (lleno < n) {
      const primero = this.#trozos[0];
      const cuantos = Math.min(primero.length, n - lleno);
      salida.set(primero.subarray(0, cuantos), lleno);
      lleno += cuantos;
      if (cuantos === primero.length) this.#trozos.shift();
      else this.#trozos[0] = primero.subarray(cuantos);
    }
    this.#total -= n;
    return salida;
  }

  async byte(): Promise<number> {
    return (await this.sacar(1))[0];
  }

  async corto(): Promise<number> {
    const b = await this.sacar(2);
    return (b[0] << 8) | b[1];
  }

  async largo(): Promise<number> {
    const b = await this.sacar(4);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  }

  async largoConSigno(): Promise<number> {
    const b = await this.sacar(4);
    return (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  }

  async texto(n: number): Promise<string> {
    return new TextDecoder().decode(await this.sacar(n));
  }
}

export class ConexionVnc {
  ancho = 0;
  alto = 0;
  nombre = "";
  /** Píxeles RGBX por filas. */
  pixeles = new Uint8Array(0);
  /** performance.now() de la última imagen recibida. */
  ultimoCambio = 0;
  /** Cuántas actualizaciones de imagen han llegado. */
  imagenes = 0;

  #ws: WebSocket | null = null;
  #cola = new ColaBytes();
  #botones = 0;

  static async conectar(
    url: string,
    clave: string,
    esperaMs = 15_000,
  ): Promise<ConexionVnc> {
    const c = new ConexionVnc();
    const reloj = setTimeout(
      () =>
        c.#cola.romper(new Error("VNC: el escritorio no respondió a tiempo")),
      esperaMs,
    );
    try {
      await c.#abrirSocket(url);
      await c.#saludo(clave);
    } catch (e) {
      c.cerrar();
      throw e;
    } finally {
      clearTimeout(reloj);
    }
    c.#escuchar().catch((e: Error) => c.#cola.romper(e));
    c.pedirImagen(false);
    return c;
  }

  get cerrada(): boolean {
    return this.#cola.falla !== null;
  }

  cerrar(): void {
    this.#cola.romper(new Error("VNC: conexión cerrada"));
    try {
      this.#ws?.close();
    } catch {
      // ya se estaba cerrando
    }
  }

  pedirImagen(incremental: boolean): void {
    const m = new Uint8Array(10);
    const v = new DataView(m.buffer);
    v.setUint8(0, 3);
    v.setUint8(1, incremental ? 1 : 0);
    v.setUint16(6, this.ancho);
    v.setUint16(8, this.alto);
    this.#enviar(m);
  }

  /** Mueve el puntero; `botones` es la máscara RFB (1 izquierdo, 4 derecho, 8/16 rueda). */
  puntero(x: number, y: number, botones = this.#botones): void {
    this.#botones = botones;
    const m = new Uint8Array(6);
    const v = new DataView(m.buffer);
    v.setUint8(0, 5);
    v.setUint8(1, botones);
    v.setUint16(2, acotar(Math.round(x), 0, this.ancho - 1));
    v.setUint16(4, acotar(Math.round(y), 0, this.alto - 1));
    this.#enviar(m);
  }

  tecla(keysym: number, abajo: boolean): void {
    const m = new Uint8Array(8);
    const v = new DataView(m.buffer);
    v.setUint8(0, 4);
    v.setUint8(1, abajo ? 1 : 0);
    v.setUint32(4, keysym);
    this.#enviar(m);
  }

  #enviar(m: Uint8Array): void {
    if (this.#cola.falla) throw this.#cola.falla;
    this.#ws!.send(m);
  }

  #abrirSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, ["binary"]);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => resolve();
      ws.onerror = () => {
        const e = new Error(`VNC: no se pudo conectar a ${new URL(url).host}`);
        this.#cola.romper(e);
        reject(e);
      };
      ws.onclose = () =>
        this.#cola.romper(new Error("VNC: el escritorio cerró la conexión"));
      ws.onmessage = (ev) =>
        this.#cola.meter(new Uint8Array(ev.data as ArrayBuffer));
      this.#ws = ws;
    });
  }

  async #saludo(clave: string): Promise<void> {
    const cola = this.#cola;
    const version = await cola.texto(12);
    if (!version.startsWith("RFB "))
      throw new Error("VNC: el servidor no habla RFB");
    this.#ws!.send(new TextEncoder().encode("RFB 003.008\n"));

    const cuantos = await cola.byte();
    if (cuantos === 0)
      throw new Error(
        `VNC: el servidor rechazó la conexión: ${await cola.texto(await cola.largo())}`,
      );
    const tipos = await cola.sacar(cuantos);
    if (tipos.includes(2)) {
      this.#ws!.send(new Uint8Array([2]));
      this.#ws!.send(respuestaDesafio(await cola.sacar(16), clave));
    } else if (tipos.includes(1)) {
      this.#ws!.send(new Uint8Array([1]));
    } else {
      throw new Error(
        `VNC: ningún tipo de seguridad soportado (${[...tipos].join(",")})`,
      );
    }
    if ((await cola.largo()) !== 0)
      throw new Error("VNC: autenticación rechazada");

    this.#ws!.send(new Uint8Array([1])); // ClientInit compartido
    this.ancho = await cola.corto();
    this.alto = await cola.corto();
    await cola.sacar(16); // formato del servidor; imponemos el nuestro abajo
    this.nombre = await cola.texto(await cola.largo());
    this.pixeles = new Uint8Array(this.ancho * this.alto * 4);

    // SetPixelFormat: 32 bpp, profundidad 24, little endian, color verdadero, R en el bit 0 → bytes RGBX.
    const formato = new Uint8Array(20);
    const f = new DataView(formato.buffer);
    f.setUint8(0, 0);
    f.setUint8(4, 32);
    f.setUint8(5, 24);
    f.setUint8(6, 0);
    f.setUint8(7, 1);
    f.setUint16(8, 255);
    f.setUint16(10, 255);
    f.setUint16(12, 255);
    f.setUint8(14, 0);
    f.setUint8(15, 8);
    f.setUint8(16, 16);
    this.#enviar(formato);

    // SetEncodings: CopyRect y Raw.
    const codifs = new Uint8Array(12);
    const c = new DataView(codifs.buffer);
    c.setUint8(0, 2);
    c.setUint16(2, 2);
    c.setInt32(4, CODIF_COPIA);
    c.setInt32(8, CODIF_RAW);
    this.#enviar(codifs);
  }

  async #escuchar(): Promise<void> {
    const cola = this.#cola;
    for (;;) {
      const tipo = await cola.byte();
      if (tipo === 0) {
        await cola.sacar(1);
        const rects = await cola.corto();
        for (let i = 0; i < rects; i++) await this.#rectangulo();
        this.imagenes++;
        this.ultimoCambio = performance.now();
        this.pedirImagen(true);
      } else if (tipo === 1) {
        await cola.sacar(3);
        await cola.sacar((await cola.corto()) * 6); // mapa de colores, sin uso en color verdadero
      } else if (tipo === 2) {
        // campana
      } else if (tipo === 3) {
        await cola.sacar(3);
        await cola.sacar(await cola.largo()); // portapapeles del servidor
      } else {
        throw new Error(`VNC: mensaje desconocido del servidor (${tipo})`);
      }
    }
  }

  async #rectangulo(): Promise<void> {
    const cola = this.#cola;
    const x = await cola.corto();
    const y = await cola.corto();
    const w = await cola.corto();
    const h = await cola.corto();
    const codif = await cola.largoConSigno();
    const fila = this.ancho * 4;
    if (codif === CODIF_RAW) {
      const px = await cola.sacar(w * h * 4);
      for (let r = 0; r < h; r++)
        this.pixeles.set(
          px.subarray(r * w * 4, (r + 1) * w * 4),
          (y + r) * fila + x * 4,
        );
    } else if (codif === CODIF_COPIA) {
      const sx = await cola.corto();
      const sy = await cola.corto();
      const bloque = new Uint8Array(w * h * 4);
      for (let r = 0; r < h; r++) {
        const desde = (sy + r) * fila + sx * 4;
        bloque.set(this.pixeles.subarray(desde, desde + w * 4), r * w * 4);
      }
      for (let r = 0; r < h; r++)
        this.pixeles.set(
          bloque.subarray(r * w * 4, (r + 1) * w * 4),
          (y + r) * fila + x * 4,
        );
    } else {
      throw new Error(`VNC: codificación no soportada (${codif})`);
    }
  }
}

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Autenticación VNC: DES-ECB del desafío con la clave como llave, cada byte con los bits en espejo. */
export function respuestaDesafio(
  desafio: Uint8Array,
  clave: string,
): Uint8Array {
  const llave = Buffer.alloc(8);
  Buffer.from(clave, "latin1").copy(llave, 0, 0, 8);
  for (let i = 0; i < 8; i++) llave[i] = invertirBits(llave[i]);
  const des = createCipheriv("des-ecb", llave, null);
  des.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([des.update(desafio), des.final()]));
}

export function invertirBits(b: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
}
