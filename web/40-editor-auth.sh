#!/bin/sh
# Runs before Nginx starts: turns the editor credentials into a proxy header snippet,
# so WFS-T requests are authenticated server-side and no password reaches the browser.
set -eu
mkdir -p /etc/nginx/snippets
TOKEN=$(printf '%s:%s' "$EDITOR_USER" "$EDITOR_PASSWORD" | base64 | tr -d '\n')
printf 'proxy_set_header Authorization "Basic %s";\n' "$TOKEN" > /etc/nginx/snippets/editor-auth.conf
