FROM node:24-slim

# pi (harness del agente) instalado global con pnpm, que trae corepack.
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
    && corepack prepare pnpm@10.29.3 --activate \
    && pnpm add -g @earendil-works/pi-coding-agent@1.1.0 \
    && test -x "$PNPM_HOME/pi"

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY material/pruebas ./material/pruebas
RUN mkdir -p /data

# Railway inyecta PORT; el servidor lo respeta. TEAM_TOKEN y OPENROUTER_API_KEY van como secretos.
# NODE_OPTIONS: la autenticación VNC usa DES, que en Node 24 solo existe con el proveedor legacy de
# OpenSSL. La conexión VNC vive en el proceso de pi (la extensión), no en el servidor: el flag del
# CMD no le llega, la variable sí (si run-task le pasa un env propio, que conserve NODE_OPTIONS).
ENV NODE_ENV=production \
    NODE_OPTIONS=--openssl-legacy-provider \
    PORT=8080 \
    DATA_DIR=/data \
    PI_BIN=/pnpm/pi \
    AGENT_MODEL=anthropic/claude-sonnet-5.5 \
    GUARD_MODEL=anthropic/claude-haiku-5.5 \
    AGENT_THINKING=high
EXPOSE 8080
CMD ["node", "--openssl-legacy-provider", "src/servidor.ts"]
