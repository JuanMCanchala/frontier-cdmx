// Reglas de evaluación del reto sobre el resumen y el estado, más el veredicto de /__check.
export type Prueba = {
  id: string;
  instruccion: string;
  estado_esperado: "terminada" | "fallida";
  respuesta_esperada?: string;
  claves_razon?: string[];
};

export function juzgar(prueba: Prueba, estado: string, resumen: string, check: { pass: boolean; checks: { nombre: string; ok: boolean }[] }): string[] {
  const fallas: string[] = [];
  if (!check.pass) fallas.push(`app: ${check.checks.filter((c) => !c.ok).map((c) => c.nombre).join(", ")}`);
  if (estado !== prueba.estado_esperado) fallas.push(`estado ${estado}, se esperaba ${prueba.estado_esperado}`);
  const linea = resumen.split("\n").find((l) => /^respuesta:/i.test(l));
  if (prueba.respuesta_esperada !== undefined) {
    const esperada = String(prueba.respuesta_esperada);
    const numero = linea?.match(/-?\d+(?:[.,]\d+)?/)?.[0];
    const ok = /^-?\d/.test(esperada)
      ? numero?.replace(",", ".") === esperada.replace(",", ".")
      : linea?.toLowerCase().includes(esperada.toLowerCase());
    if (!ok) fallas.push(`respuesta "${linea ?? "(sin línea)"}", se esperaba ${esperada}`);
  }
  for (const c of prueba.claves_razon ?? []) if (!resumen.includes(c)) fallas.push(`el resumen no nombra ${c}`);
  return fallas;
}
