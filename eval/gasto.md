# Gasto de OpenRouter

Key del evento: $45 sin recarga. Una fila por corrida que gasta.

## Set oculto

| Corrida | Hora (CDMX) | Resultado | Tareas | Costo del agente (pi) | Baja del saldo | Mediana | Máximo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 13:53 | **34 / 34** (fáciles 10/10, regulares 14/14, difíciles 10/10) | 28 terminadas, 6 fallidas a propósito | $3.58 | $3.67 | 51 s | 177 s |

La plataforma reporta la corrida 1 como el 60 % del set. Saldo después: $40.54.

## Práctica

| Fecha (UTC) | Qué | Modelo | Costo (pi) |
| --- | --- | --- | --- |
| 2026-10-31T18:15:39.671Z | E2-direccion-con-nota.json (pasa, 50s) | anthropic/claude-sonnet-5.5 (high) | $0.0691 |
| 2026-10-31T18:32:13.661Z | E2-direccion-con-nota.json (pasa, 48s) | anthropic/claude-sonnet-5.5 (high) | $0.0645 |
| 2026-10-31T18:33:26.362Z | E1-crear-cliente.json (pasa, 60s) | anthropic/claude-sonnet-5.5 (high) | $0.0723 |
| 2026-10-31T18:34:10.754Z | E3-facturas-vencidas.json (pasa, 39s) | anthropic/claude-sonnet-5.5 (high) | $0.0578 |
| 2026-10-31T18:34:54.277Z | E4-exportar-pedidos.json (pasa, 38s) | anthropic/claude-sonnet-5.5 (high) | $0.0490 |
| 2026-10-31T18:35:25.149Z | E5-homonimos.json (pasa, 25s) | anthropic/claude-sonnet-5.5 (high) | $0.0372 |
| 2026-10-31T18:40:53Z | E2 por el contrato HTTP en Railway (pasa, 43s, POST 279 ms) | anthropic/claude-sonnet-5.5 (high) | $0.0593 |
| 2026-10-31T19:02:22Z | E2 por el contrato HTTP en Railway, espera de repintado 1.2 s (pasa, 53s) | anthropic/claude-sonnet-5.5 (high) | $0.0640 |
| 2026-10-31T19:05:25Z | E1 por el contrato HTTP en Railway (pasa, 80s) | anthropic/claude-sonnet-5.5 (high) | $0.0832 |
| 2026-10-31T19:06:19Z | E2 por el contrato HTTP en Railway (pasa, 48s) | anthropic/claude-sonnet-5.5 (high) | $0.0622 |
| 2026-10-31T19:07:04Z | E3 por el contrato HTTP en Railway (pasa, 37s) | anthropic/claude-sonnet-5.5 (high) | $0.0588 |
| 2026-10-31T19:07:51Z | E4 por el contrato HTTP en Railway (pasa, 43s) | anthropic/claude-sonnet-5.5 (high) | $0.0501 |
| 2026-10-31T19:08:26Z | E5 por el contrato HTTP en Railway (pasa, 32s) | anthropic/claude-sonnet-5.5 (high) | $0.0414 |

Banco por el contrato HTTP en Railway: 5 de 5, POST entre 281 y 294 ms. Saldo después: $44.22.
| 2026-10-31T21:58:11.742Z | E1-crear-cliente.json (pasa, 60s) | anthropic/claude-sonnet-5.5 (high) | $0.0769 |
| 2026-10-31T21:59:10.629Z | E2-direccion-con-nota.json (pasa, 53s) | anthropic/claude-sonnet-5.5 (high) | $0.0625 |
| 2026-10-31T21:59:57.780Z | E3-facturas-vencidas.json (pasa, 42s) | anthropic/claude-sonnet-5.5 (high) | $0.0583 |
| 2026-10-31T22:00:53.945Z | E4-exportar-pedidos.json (pasa, 51s) | anthropic/claude-sonnet-5.5 (high) | $0.0608 |
| 2026-10-31T22:01:29.359Z | E5-homonimos.json (pasa, 30s) | anthropic/claude-sonnet-5.5 (high) | $0.0415 |
| 2026-10-31T22:13Z | E2 por el contrato HTTP en Railway sobre el tema nuevo, con la adaptación desplegada (pasa, 53s, POST 300 ms) | anthropic/claude-sonnet-5.5 (high) | $0.0707 |
