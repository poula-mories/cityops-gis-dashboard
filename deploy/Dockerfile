# CityOps GIS dashboard as one container: PostGIS + GeoServer + Nginx.
# Built on plain Ubuntu so the same file works on Intel/AMD and on ARM servers (e.g. Oracle Cloud's
# free Ampere machines); the official GeoServer and PostGIS images are Intel/AMD only.
# Runs as an unprivileged user; every start begins with fresh sample data and new random passwords.
#
# Local test, from the geo-stack folder:
#   docker build -f deploy/Dockerfile -t cityops .
#   docker run --rm -p 7860:7860 cityops        ->  http://localhost:7860
FROM ubuntu:22.04

ARG GEOSERVER_VERSION=2.25.2
ENV DEBIAN_FRONTEND=noninteractive

# Java 17, Nginx, and PostgreSQL 16 + PostGIS 3 from the PostgreSQL project's apt repository.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip \
      openjdk-17-jre-headless fonts-dejavu-core nginx; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-16 postgresql-16-postgis-3; \
    pg_dropcluster --stop 16 main || true; \
    rm -rf /var/lib/apt/lists/*

# GeoServer's platform-independent release (bundled Jetty), without its demo data.
RUN set -eux; \
    curl -fsSL -o /tmp/geoserver.zip \
      "https://downloads.sourceforge.net/project/geoserver/GeoServer/${GEOSERVER_VERSION}/geoserver-${GEOSERVER_VERSION}-bin.zip"; \
    unzip -q /tmp/geoserver.zip -d /opt/geoserver; \
    rm -rf /tmp/geoserver.zip /opt/geoserver/data_dir

RUN useradd -m -u 1000 user \
 && chown -R user /opt/geoserver /var/lib/nginx /var/log/nginx

COPY --chown=user web/site /app/site
COPY --chown=user db/init /app/db
COPY --chown=user geoserver /app/geoserver
COPY --chown=user deploy/start.sh deploy/nginx.conf deploy/reset.sql /app/

ENV PATH=/usr/lib/postgresql/16/bin:$PATH

USER user
WORKDIR /app
EXPOSE 7860
ENTRYPOINT ["bash", "/app/start.sh"]
