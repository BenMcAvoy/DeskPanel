# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /build/control_frontend

COPY control_frontend/package.json ./package.json
RUN npm install

COPY control_frontend/ ./
RUN --mount=type=secret,id=control_frontend_env,required=false,target=/run/secrets/control_frontend_env \
    sh -c 'if [ -f /run/secrets/control_frontend_env ]; then tr -d "\r" < /run/secrets/control_frontend_env > /tmp/control_frontend_env && set -a && . /tmp/control_frontend_env && set +a; fi; npm run build'


FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CONTROL_AGENT_HOST=0.0.0.0 \
    CONTROL_AGENT_PORT=6789 \
    FRONTEND_HOST=0.0.0.0 \
    FRONTEND_PORT=4173

WORKDIR /app

RUN pip install --no-cache-dir "websockets>=16.0"

COPY control_agent/ /app/control_agent/
COPY control_frontend/serve_dist.py /app/control_frontend/serve_dist.py
COPY --from=frontend-builder /build/control_frontend/dist /app/control_frontend/dist
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh

EXPOSE 4173 6789

ENTRYPOINT ["/app/docker/entrypoint.sh"]