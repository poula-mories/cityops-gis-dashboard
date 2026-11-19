#!/bin/bash
# Starts the whole CityOps demo in one container: PostGIS, GeoServer and Nginx.
# Everything is built from scratch on each start, with random passwords that never leave the
# container, and the sample data is put back every night at 03:00 UTC.
set -euo pipefail

log() { echo "[cityops] $*"; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }

export PGDATA=/tmp/pgdata PGHOST=127.0.0.1 PGPORT=5432 PGUSER=gis PGDATABASE=gis
export PGPASSWORD=$(rand)
GEOSERVER_ADMIN_PASSWORD=$(rand)
GS=http://127.0.0.1:8080/geoserver
EDITOR_USER=editor
EDITOR_PASSWORD=$(rand)

# ------------------------------------------------------------------ PostGIS
log "Starting the database"
rm -rf "$PGDATA"
pwfile=$(mktemp); printf '%s' "$PGPASSWORD" > "$pwfile"
initdb -D "$PGDATA" -U gis --pwfile="$pwfile" --auth=scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
rm -f "$pwfile"
pg_ctl -D "$PGDATA" -w -s -l /tmp/postgres.log -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" start
psql -d postgres -qc "CREATE DATABASE gis"
psql -q -v ON_ERROR_STOP=1 -f /app/db/01_schema_and_data.sql
psql -q -v ON_ERROR_STOP=1 -f /app/reset.sql
log "Database ready: $(psql -Atc 'SELECT count(*) FROM service_requests') sample requests"

# ---------------------------------------------------------------- GeoServer
# GeoServer's own release with its bundled Jetty, on a fresh, empty configuration folder.
log "Starting the map server"
rm -rf /tmp/gsdata && mkdir -p /tmp/gsdata
(cd /opt/geoserver && exec java -Xms256m -Xmx1g -Djava.awt.headless=true -Dfile.encoding=UTF-8 \
   -DGEOSERVER_DATA_DIR=/tmp/gsdata -jar start.jar jetty.http.host=127.0.0.1 jetty.http.port=8080) &
GS_PID=$!

# A new configuration starts with GeoServer's well-known default login (admin / geoserver):
# replace it with a random password before anything else is set up.
until curl -sf -u admin:geoserver "$GS/rest/about/version.json" >/dev/null; do
  kill -0 "$GS_PID" 2>/dev/null || { log "Map server failed to start"; exit 1; }
  sleep 3
done
curl -sf -u admin:geoserver -X PUT -H "Content-Type: application/json" \
  --data "{\"newPassword\":\"$GEOSERVER_ADMIN_PASSWORD\"}" "$GS/rest/security/self/password"
# The new password takes a few seconds to apply. (The old login keeps working from GeoServer's login
# cache for some minutes, but the map server only listens inside the container and Nginx blocks its
# admin pages and REST API, so it is never reachable from outside.)
for i in $(seq 1 30); do
  curl -sf -o /dev/null -u "admin:$GEOSERVER_ADMIN_PASSWORD" "$GS/rest/about/version.json" && break
  [ "$i" = 30 ] && { log "Could not change the map server's admin password"; exit 1; }
  sleep 2
done
log "Map server admin password replaced"

GS_URL=$GS GS_USER=admin GS_PASS=$GEOSERVER_ADMIN_PASSWORD \
PG_HOST=127.0.0.1 PG_DB=gis PG_USER=gis PG_PASS=$PGPASSWORD SCRIPTS_DIR=/app/geoserver \
EDITOR_USER=$EDITOR_USER EDITOR_PASSWORD=$EDITOR_PASSWORD \
  sh /app/geoserver/publish.sh

# Warm up the edit path (the first edit after a start takes a few seconds): an update that matches
# no request, so the first visitor's save is quick.
curl -s -o /dev/null -u "$EDITOR_USER:$EDITOR_PASSWORD" -H "Content-Type: text/xml" \
  --data '<wfs:Transaction service="WFS" version="1.1.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc"><wfs:Update typeName="demo:service_requests"><wfs:Property><wfs:Name>priority</wfs:Name><wfs:Value>normal</wfs:Value></wfs:Property><ogc:Filter><ogc:FeatureId fid="service_requests.0"/></ogc:Filter></wfs:Update></wfs:Transaction>' \
  $GS/demo/wfs || true
curl -s -o /dev/null "$GS/demo/wms?service=WMS&version=1.1.1&request=GetMap&layers=demo:district_stats&bbox=31.2,30.0,31.36,30.09&width=256&height=256&srs=EPSG:4326&format=image/png" || true

# -------------------------------------------------------------------- Nginx
# Edits go through /api/wfst; Nginx adds the editor login there, so no password reaches the browser.
printf 'proxy_set_header Authorization "Basic %s";\n' \
  "$(printf '%s:%s' "$EDITOR_USER" "$EDITOR_PASSWORD" | base64 -w0)" > /tmp/editor-auth.conf
nginx -c /app/nginx.conf -g 'daemon off;' &
WEB_PID=$!
log "Dashboard is up on port 7860"

# ------------------------------------------------------- nightly data reset
(
  while true; do
    now=$(date -u +%s)
    next=$(( now / 86400 * 86400 + 3 * 3600 ))
    [ "$next" -gt "$now" ] || next=$(( next + 86400 ))
    sleep $(( next - now ))
    psql -qAtc "SELECT demo_seed.reset()" >/dev/null && log "Sample data reset"
  done
) &

# If the map server or the web server stops, stop the container so the platform restarts it.
wait -n "$GS_PID" "$WEB_PID"
log "A service stopped; exiting"
exit 1
