#!/bin/sh
# Configures GeoServer entirely through its REST API:
#   namespace + workspace, PostGIS store, SLD styles, layers, parameterised SQL views
#   for spatial analysis, and write security (only ROLE_EDITOR may run WFS-T).
# Safe to re-run: existing objects are kept, styles are updated in place.
set -eu

AUTH="$GS_USER:$GS_PASS"
WS=demo
NS_URI=http://cityops.example/demo
STORE=postgis
PG_HOST=${PG_HOST:-postgis}          # database host as GeoServer sees it
SCRIPTS=${SCRIPTS_DIR:-/scripts}     # folder holding styles/ and views/

echo "Waiting for GeoServer REST API..."
until curl -sf -u "$AUTH" "$GS_URL/rest/about/version.json" >/dev/null; do sleep 5; done
echo "GeoServer is up."

call() { # method url content-type data
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" -X "$1" -H "Content-Type: $3" --data-binary "$4" "$2")
  printf '%-6s %s -> %s\n' "$1" "${2#$GS_URL}" "$code"
}

# ------------------------------------------------------------ workspace + store
call POST "$GS_URL/rest/namespaces" application/json \
  "{\"namespace\":{\"prefix\":\"$WS\",\"uri\":\"$NS_URI\"}}"

call POST "$GS_URL/rest/workspaces/$WS/datastores" application/json "{
  \"dataStore\": {
    \"name\": \"$STORE\",
    \"connectionParameters\": { \"entry\": [
      {\"@key\":\"dbtype\",\"\$\":\"postgis\"},
      {\"@key\":\"host\",\"\$\":\"$PG_HOST\"},
      {\"@key\":\"port\",\"\$\":\"5432\"},
      {\"@key\":\"database\",\"\$\":\"$PG_DB\"},
      {\"@key\":\"schema\",\"\$\":\"public\"},
      {\"@key\":\"user\",\"\$\":\"$PG_USER\"},
      {\"@key\":\"passwd\",\"\$\":\"$PG_PASS\"},
      {\"@key\":\"Expose primary keys\",\"\$\":\"true\"},
      {\"@key\":\"Loose bbox\",\"\$\":\"true\"},
      {\"@key\":\"Estimated extends\",\"\$\":\"false\"}
    ]}
  }
}"

# ----------------------------------------------------------------------- styles
for style in request_status district_open_requests; do
  call POST "$GS_URL/rest/workspaces/$WS/styles?name=$style" application/vnd.ogc.sld+xml \
    "$(cat $SCRIPTS/styles/$style.sld)"
  [ "$code" = "201" ] || call PUT "$GS_URL/rest/workspaces/$WS/styles/$style" \
    application/vnd.ogc.sld+xml "$(cat $SCRIPTS/styles/$style.sld)"
done

# ----------------------------------------------------------------------- layers
for layer in service_requests district_stats; do
  call POST "$GS_URL/rest/workspaces/$WS/datastores/$STORE/featuretypes" application/json \
    "{\"featureType\":{\"name\":\"$layer\",\"srs\":\"EPSG:4326\"}}"
done
call PUT "$GS_URL/rest/layers/$WS:service_requests" application/json \
  "{\"layer\":{\"defaultStyle\":{\"name\":\"$WS:request_status\"}}}"
call PUT "$GS_URL/rest/layers/$WS:district_stats" application/json \
  "{\"layer\":{\"defaultStyle\":{\"name\":\"$WS:district_open_requests\"}}}"

# -------------------------------------------- SQL views for spatial analysis
# Parameters arrive through WFS "viewparams" and are checked by regex validators.
for view in nearest_requests requests_within_radius; do
  call POST "$GS_URL/rest/workspaces/$WS/datastores/$STORE/featuretypes" text/xml \
    "$(cat $SCRIPTS/views/$view.xml)"
  [ "$code" = "201" ] || call PUT "$GS_URL/rest/workspaces/$WS/datastores/$STORE/featuretypes/$view" text/xml \
    "$(cat $SCRIPTS/views/$view.xml)"
done

# --------------------------------------------------------------- write security
# Read stays public; inserts/updates/deletes need ROLE_EDITOR.
call POST "$GS_URL/rest/security/usergroup/users" application/json \
  "{\"user\":{\"userName\":\"$EDITOR_USER\",\"password\":\"$EDITOR_PASSWORD\",\"enabled\":true}}"
call POST "$GS_URL/rest/security/roles/role/ROLE_EDITOR" application/json ""
call POST "$GS_URL/rest/security/roles/role/ROLE_EDITOR/user/$EDITOR_USER" application/json ""
call POST "$GS_URL/rest/security/acl/layers" application/json \
  "{\"$WS.*.r\":\"*\",\"$WS.*.w\":\"ROLE_EDITOR,ADMIN\"}"
[ "$code" = "200" ] || [ "$code" = "201" ] || call PUT "$GS_URL/rest/security/acl/layers" application/json \
  "{\"$WS.*.r\":\"*\",\"$WS.*.w\":\"ROLE_EDITOR,ADMIN\"}"

echo "Done. Dashboard: http://localhost:8088"
