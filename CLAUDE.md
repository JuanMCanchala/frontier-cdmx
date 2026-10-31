# frontier-cdmx

Agente del reto Frontier CDMX (31-oct-2026): recibe una tarea en lenguaje natural y la ejecuta en una
app de escritorio sin API, viendo solo la pantalla por VNC. El reto y su contrato están en
`material/README.md`; las interfaces entre módulos, en `docs/contratos.md`.

## Referencia

El diseño sigue a `cuisangelo/frontier-screen-agent` (51/56 en el set oculto de octubre), clonado
en `~/Programacion/frontier-screen-agent-ref`. Ese repo **no tiene licencia**: se lee para entender
el diseño, pero el código de este repo se escribe aquí, sin copiar archivos ni bloques textuales.

## Crédito de OpenRouter

La key del evento tiene **$45 sin recarga** (`CDMX_OPENROUTER` en la bóveda).
- Los tests automáticos nunca llaman a OpenRouter: usan un ejecutor falso.
- Lo que no necesita modelo (VNC, servidor, resumen, redacción de secretos) se prueba sin modelo.
- Antes de una corrida que gasta, consultar el saldo y empezar con **una** tarea. Si la corrida
  estimada pasa de $1, pedir confirmación.
- Cada corrida que gasta se anota en `eval/gasto.md`.
- Tope duro: cada tarea se aborta si pasa de `MAX_COST_USD` (por defecto $0.50).

## Reglas

- `pi` (`@earendil-works/pi-coding-agent@1.1.0`) es el harness del agente.
- Nada específico de SIGECOM en el código ni en los prompts: la evaluación corre sobre otra app.
- Secretos: `.env` fuera de git. La contraseña del escritorio nunca entra al contexto del modelo, a
  un log ni a un resumen. Variables locales: `eval "$(cdmx-env)"` (lee la bóveda).
- El escritorio de pruebas tiene **una sola ranura** VNC: nunca dos procesos sobre él a la vez.
  `POST /__reset` antes de cada prueba y `POST /__check` para juzgar.
- Commits atómicos en español con Conventional Commits (`feat(vnc): …`), uno por cambio lógico, sin
  trailers de coautoría.
