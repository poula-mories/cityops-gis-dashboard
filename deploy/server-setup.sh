#!/bin/bash
# One-time setup of a fresh Ubuntu server (e.g. Oracle Cloud Always Free, Ampere A1) for the demo,
# then start it. Run on the server from the geo-stack folder:
#   bash deploy/server-setup.sh <public-ip>
# The site comes up at https://cityops.<ip-with-dashes>.sslip.io (sslip.io maps that name to the IP,
# so no domain purchase is needed). Set SITE_ADDRESS instead to use your own domain.
set -euo pipefail
IP=${1:?usage: server-setup.sh <public-ip>}
SITE_ADDRESS=${SITE_ADDRESS:-cityops.${IP//./-}.sslip.io}

echo "== Installing Docker"
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
sudo systemctl enable --now docker

# Oracle's Ubuntu images only allow SSH through the server's own firewall: open HTTP and HTTPS too.
# (The cloud network's security list must allow TCP 80 and 443 as well; that is set in the console.)
echo "== Opening ports 80 and 443"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

echo "== Building and starting the demo (the first build takes several minutes)"
echo "SITE_ADDRESS=$SITE_ADDRESS" > deploy/.env
sudo docker compose -f deploy/docker-compose.yml up -d --build

echo "== Waiting for the dashboard"
for _ in $(seq 1 60); do
  if sudo docker compose -f deploy/docker-compose.yml logs app 2>/dev/null | grep -q "Dashboard is up"; then break; fi
  sleep 5
done
sudo docker compose -f deploy/docker-compose.yml logs app | grep "\[cityops\]" || true
echo "== Done: https://$SITE_ADDRESS"
