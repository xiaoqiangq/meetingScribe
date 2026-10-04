# Huiji P application runtime. Model environments and weights are prepared separately.
FROM node:22.12.0-bookworm-slim AS frontend
WORKDIR /src/web/frontend
COPY web/frontend/package.json web/frontend/package-lock.json ./
RUN npm ci
COPY web/frontend/ ./
RUN npm run build

FROM golang:1.24.4-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
COPY --from=frontend /src/web/frontend/dist/ ./internal/web/dist/
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${BUILD_DATE}" -o /out/huiji-p ./cmd/server

FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ffmpeg libsndfile1 build-essential python3 python3-venv python3-dev
RUN python3 -m venv /opt/tools && /opt/tools/bin/pip install --no-cache-dir uv==0.8.22 yt-dlp
ENV PATH="/opt/tools/bin:${PATH}" PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080 APP_ENV=production WHISPERX_ENV=/app/whisperx-env HOME=/app/data
WORKDIR /app
COPY --from=backend /out/huiji-p /app/huiji-p
COPY scripts/ /app/scripts/
COPY runtime/ /app/runtime/
RUN mkdir -p /app/data /app/whisperx-env && chown 1000:1000 /app/data /app/whisperx-env
USER 1000:1000
EXPOSE 8080
CMD ["/app/huiji-p"]
