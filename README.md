# frontier-cdmx · operador de pantallas

Agente para el reto Frontier CDMX: recibe una tarea en lenguaje natural y la ejecuta en una
aplicación de escritorio que no tiene API, viéndola solo por VNC, como lo haría una persona nueva en
la empresa.

## Resultados

| Corrida del set oculto (app nunca vista) | Puntaje |
| --- | --- |
| 1 | **34 / 34** · fáciles 10/10, regulares 14/14, difíciles 10/10 · mediana 1 min |

Banco de práctica por el contrato HTTP en Railway: 5 de 5. Tras el cambio de tema de la app (incidente FR-0153): 5 de 5 sin cambiar el código; detalle en [`docs/incidente-FR-0153.md`](docs/incidente-FR-0153.md). El gasto de cada corrida está en `eval/gasto.md`.

## Cómo funciona

1. **Servidor** (`src/servidor.ts`): implementa el contrato del reto y lanza un proceso de `pi` por
   tarea, con plazo (285 s) y tope de costo (0.50 USD) por defecto.
2. **Operador** (`src/operador/`): `pi` con Sonnet 5.5 decide cada paso sobre la captura del momento,
   con herramientas propias: `ver_pantalla`, `pulsar`, `escribir`, `llenar`, `elegir`, `teclas`,
   `desplazar` y `reportar`.
3. **Revisor** (Haiku 5.5): mira la pantalla antes de cada acción que reconoce como escritura (un clic
   marcado como guardar o con un verbo de escritura en el rótulo, o un Enter) y la frena solo si la
   pantalla contradice la tarea.
4. **Notas por app** (`src/operador/memoria.ts`): al terminar una tarea se anotan rutas y botones de
   la interfaz, nunca datos ni coordenadas, y las tareas siguientes las reciben como pistas.
5. **Escritorio** (`src/escritorio/`): cliente RFB 3.8 propio sobre WebSocket, sin dependencias.

Diseño basado en el agente de [cuisangelo/frontier-screen-agent](https://github.com/cuisangelo/frontier-screen-agent),
que sacó 51/56 en el set oculto de octubre. Para la primera corrida oficial, el comportamiento se
alineó a propósito con esa versión: el procedimiento de las instrucciones, el revisor, el ritmo de
pantalla, el plazo y el tope. Las mejoras propias, como ampliar una zona de la pantalla, quedan para
después de medir ([diseño, sección 2](docs/diseno.md#2-por-qué-cambiamos-respecto-a-aprendiz)).

## Diseño

- [Documento de diseño](docs/diseno.md): problema, decisiones (ADR), revisor, memoria, presupuesto de
  tiempo y costo, seguridad, riesgos, cómo medimos y por qué cambiamos respecto al diseño Aprendiz.
- [Diagramas de arquitectura](docs/arquitectura.md): contenedores y límites de confianza, ciclo de
  una tarea y secuencia desde `POST /tasks` hasta publicar.
- [Contratos entre módulos](docs/contratos.md).

## Correrlo en local

Requisitos: Node 24 o más nuevo y `pi` (`pnpm add -g @earendil-works/pi-coding-agent@1.1.0`).

```sh
npm test                                                     # sin red ni crédito
node --openssl-legacy-provider scripts/humo-vnc.ts out/humo  # captura del escritorio
node --openssl-legacy-provider scripts/probar.ts material/pruebas/E2-direccion-con-nota.json
```

Las variables están en `.env.example`. El gasto de cada corrida queda en `eval/gasto.md`.
