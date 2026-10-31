import { test } from "node:test";
import assert from "node:assert/strict";
import { armarResumen, ocultarSecretos } from "./ejecutor.ts";
import { bitacora, claveApp } from "./memoria.ts";

test("armarResumen pone la respuesta primero y sola", () => {
  const r = armarResumen({ estado: "terminada", respuesta: "45", resumen: "Conté 45 facturas vencidas." });
  assert.equal(r.split("\n")[0], "respuesta: 45");
});

test("armarResumen omite la respuesta cuando la tarea falla", () => {
  const r = armarResumen({ estado: "fallida", respuesta: "3", resumen: "Hay dos clientes con ese nombre." });
  assert.ok(!/respuesta:/i.test(r));
});

test("armarResumen quita líneas 'respuesta:' que el modelo dejó en el cuerpo", () => {
  const r = armarResumen({ estado: "terminada", respuesta: "7", resumen: "respuesta: 8\nRevisé dos páginas." });
  assert.deepEqual(r.split("\n"), ["respuesta: 7", "Revisé dos páginas."]);
});

test("ocultarSecretos reemplaza cada secreto y deja pasar los vacíos", () => {
  assert.equal(ocultarSecretos("clave 971x y 971x", ["971x", ""]), "clave [oculto] y [oculto]");
});

test("claveApp normaliza tildes y símbolos", () => {
  assert.equal(claveApp("SIGECOM · Distribuidora Andina"), "sigecom-distribuidora-andina");
  assert.equal(claveApp("Clínica Los Cerezos"), "clinica-los-cerezos");
});

test("bitacora devuelve vacío si no hay traza", () => {
  assert.equal(bitacora("/no/existe", "x"), "");
});

test("armarResumen rescata la respuesta que el modelo dejó solo en el resumen", () => {
  const r = armarResumen({ estado: "terminada", resumen: "Revisé tres páginas.\nrespuesta: 45" });
  assert.deepEqual(r.split("\n"), ["respuesta: 45", "Revisé tres páginas."]);
});
