import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { aPng } from "./imagen.ts";
import { invertirBits, respuestaDesafio } from "./protocolo.ts";
import { leerCombinacion, teclaDe } from "./pantalla.ts";

test("invertirBits pone los bits de un byte en espejo", () => {
  assert.equal(invertirBits(0b00000001), 0b10000000);
  assert.equal(invertirBits(0b11010000), 0b00001011);
});

test("respuestaDesafio devuelve 16 bytes que dependen de la clave", () => {
  const desafio = new Uint8Array(16).map((_, i) => i);
  const a = respuestaDesafio(desafio, "secreto1");
  const b = respuestaDesafio(desafio, "secreto2");
  assert.equal(a.length, 16);
  assert.notDeepEqual(a, b);
});

test("aPng recorta y amplía una zona RGBX", () => {
  // imagen 2x2: rojo, verde / azul, blanco
  const px = new Uint8Array([
    255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0,
  ]);
  const png = aPng(px, 2, { x: 1, y: 0, ancho: 1, alto: 2 }, 2);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 4);
  const largo = png.readUInt32BE(33);
  const crudo = inflateSync(png.subarray(41, 41 + largo));
  assert.deepEqual([...crudo.subarray(0, 7)], [0, 0, 255, 0, 0, 255, 0]); // fila verde
  assert.deepEqual(
    [...crudo.subarray(14, 21)],
    [0, 255, 255, 255, 255, 255, 255],
  ); // fila blanca
});

test("teclaDe usa Latin-1 directo y Unicode para el resto", () => {
  assert.equal(teclaDe("a"), 0x61);
  assert.equal(teclaDe("ñ"), 0xf1);
  assert.equal(teclaDe("€"), 0x010020ac);
});

test("leerCombinacion entiende combinaciones y rechaza teclas desconocidas", () => {
  assert.deepEqual(leerCombinacion("ctrl+a"), [0xffe3, 0x61]);
  assert.deepEqual(leerCombinacion("Shift+Tab"), [0xffe1, 0xff09]);
  assert.throws(() => leerCombinacion("hyper"));
});
