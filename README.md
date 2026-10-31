# frontier-cdmx · operador de pantallas

Agente para el reto Frontier CDMX: recibe una tarea en lenguaje natural y la ejecuta en una
aplicación de escritorio que no tiene API, viéndola solo por VNC, como lo haría una persona nueva en
la empresa.

## Cómo funciona

1. **Servidor** (`src/servidor.ts`): implementa el contrato del reto y lanza un proceso de `pi` por
   tarea, con plazo y tope de costo.
2. **Operador** (`src/operador/`): `pi` con Sonnet 5.5 decide cada paso sobre la captura del momento,
   con herramientas propias: `ver_pantalla`, `ampliar`, `pulsar`, `escribir`, `llenar`, `elegir`,
   `teclas`, `desplazar` y `reportar`.
3. **Revisor** (Haiku 5.5): mira la pantalla antes de cada acción que puede cambiar datos y la frena
   solo si la pantalla contradice la tarea.
4. **Notas por app** (`src/operador/memoria.ts`): al terminar una tarea se anotan rutas y botones de
   la interfaz, nunca datos ni coordenadas, y las tareas siguientes las reciben como pistas.
5. **Escritorio** (`src/escritorio/`): cliente RFB 3.8 propio sobre WebSocket, sin dependencias.

Diseño inspirado en el agente de [cuisangelo/frontier-screen-agent](https://github.com/cuisangelo/frontier-screen-agent),
con implementación propia.

## Correrlo en local

Requisitos: Node 24 o más nuevo y `pi` (`pnpm add -g @earendil-works/pi-coding-agent@1.1.0`).

```sh
npm test                                                     # sin red ni crédito
node --openssl-legacy-provider scripts/humo-vnc.ts out/humo  # captura del escritorio
node --openssl-legacy-provider scripts/probar.ts material/pruebas/E2-direccion-con-nota.json
```

Las variables están en `.env.example`. El gasto de cada corrida queda en `eval/gasto.md`.
