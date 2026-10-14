# The Commissaire governor image. Build context is the repository root of a clean release-tag checkout:
#
#   fly deploy . --config operations/fly/governor/fly.toml \
#     --dockerfile operations/fly/governor/Dockerfile --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
#     --ha=false --no-public-ips
#
# Only plugin/skills/faff and operations/fly/governor enter the image (Dockerfile.dockerignore).

FROM node:20-slim

ARG SOURCE_COMMIT
RUN echo "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40,64}$' \
 || { echo "build-arg SOURCE_COMMIT must be a full lowercase hex commit hash" >&2; exit 1; }

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin commissaire

ENV COMMISSAIRE_ROOT=/opt/commissaire/${SOURCE_COMMIT} \
    COMMISSAIRE_KEY_DIR=/data/commissaire

COPY plugin/skills/faff/ ${COMMISSAIRE_ROOT}/plugin/skills/faff/
COPY operations/fly/governor/ ${COMMISSAIRE_ROOT}/operations/fly/governor/
COPY operations/fly/governor/entrypoint.sh /usr/local/bin/commissaire-entrypoint

RUN chown -R root:root /opt/commissaire \
 && chmod -R go-w,a+rX /opt/commissaire \
 && chown root:root /usr/local/bin/commissaire-entrypoint \
 && chmod 0755 /usr/local/bin/commissaire-entrypoint \
 && ln -s ${COMMISSAIRE_ROOT}/plugin/skills/faff /opt/commissaire/current

LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}

EXPOSE 7650
ENTRYPOINT ["/usr/local/bin/commissaire-entrypoint"]
