# The deployed app (SPEC.md Phase 6): one container where the GenUI agent server answers /api and serves
# the built XR app from the same origin. API keys come from the host's secrets, never from the image.
#
# Build the XR app first, then the image, from the repo root:
#   (cd apps/xr && npm run build)
#   docker build -t spatial-genui .
#   docker run -p 8080:8080 -e LLM_API_KEY=... -e META_API_KEY=... spatial-genui
FROM node:22-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    GENUI_PORT=8080 \
    STATIC_DIR=/app/apps/xr/dist
WORKDIR /app

# Dependencies first, so code changes don't reinstall them. tsx (a dev dependency) runs the server.
COPY apps/server/package.json apps/server/package-lock.json apps/server/
RUN cd apps/server && npm ci --no-audit --no-fund

COPY apps/server/ apps/server/
# Model catalogue (ids, endpoints, prices) and the 3D library lessons use.
COPY bench/models.json bench/models.json
COPY data/library/ data/library/
COPY apps/xr/dist/ apps/xr/dist/

EXPOSE 8080
WORKDIR /app/apps/server
CMD ["npx", "tsx", "src/server.ts"]
