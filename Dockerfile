# The deployed app: the Python API answers /api and serves the built XR app from the same origin.
# apps/gate (Node 22) runs the static check and the dry run with the same three.js and kit.js as the headset.
# API keys come from the host, never the image.
#
#   (cd apps/xr && npm run build)
#   docker build -t spatial-genui .
#   docker run -p 8080:8080 -e LLM_API_KEY=... -e META_API_KEY=... spatial-genui
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    COURSE_MODELS=0 \
    GENUI_PORT=8080 \
    STATIC_DIR=/app/apps/xr/dist \
    UV_LINK_MODE=copy

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/
RUN cd apps/api && uv sync --frozen --no-dev

COPY apps/gate/package.json apps/gate/package-lock.json apps/gate/
RUN cd apps/gate && npm ci --no-audit --no-fund

COPY apps/api/ apps/api/
COPY apps/gate/ apps/gate/
COPY bench/models.json bench/models.json
COPY data/library/ data/library/
COPY apps/xr/dist/ apps/xr/dist/

EXPOSE 8080
WORKDIR /app/apps/api
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
