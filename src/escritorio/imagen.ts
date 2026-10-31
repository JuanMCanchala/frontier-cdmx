// Convierte una zona de la imagen RGBX del escritorio en PNG, con ampliación
// por repetición de píxeles para que el texto pequeño se lea nítido.
import { deflateSync } from "node:zlib";

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(datos: Buffer): number {
  let c = 0xffffffff;
  for (const b of datos) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo: string, datos: Buffer): Buffer {
  const cabeza = Buffer.alloc(8);
  cabeza.writeUInt32BE(datos.length, 0);
  cabeza.write(tipo, 4, "ascii");
  const cola = Buffer.alloc(4);
  cola.writeUInt32BE(crc(Buffer.concat([cabeza.subarray(4), datos])), 0);
  return Buffer.concat([cabeza, datos, cola]);
}

export type Zona = { x: number; y: number; ancho: number; alto: number };

/** PNG RGB de `zona` dentro de una imagen RGBX de `anchoTotal` píxeles por fila, ampliada `factor` veces. */
export function aPng(
  pixeles: Uint8Array,
  anchoTotal: number,
  zona: Zona,
  factor = 1,
): Buffer {
  const { x, y, ancho, alto } = zona;
  const anchoSalida = ancho * factor;
  const altoSalida = alto * factor;
  const bytesFila = 1 + anchoSalida * 3;
  const crudo = Buffer.alloc(bytesFila * altoSalida);
  for (let fy = 0; fy < altoSalida; fy++) {
    const filaOrigen = (y + Math.floor(fy / factor)) * anchoTotal;
    let o = fy * bytesFila + 1; // byte de filtro 0 (ninguno)
    for (let fx = 0; fx < anchoSalida; fx++) {
      const p = (filaOrigen + x + Math.floor(fx / factor)) * 4;
      crudo[o++] = pixeles[p];
      crudo[o++] = pixeles[p + 1];
      crudo[o++] = pixeles[p + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(anchoSalida, 0);
  ihdr.writeUInt32BE(altoSalida, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    FIRMA,
    bloque("IHDR", ihdr),
    bloque("IDAT", deflateSync(crudo, { level: 6 })),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}
