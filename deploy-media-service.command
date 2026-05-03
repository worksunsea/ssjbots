#!/bin/bash
# Gemtre Media Service — one-click deploy
# Double-click this file to run it

set -e
echo "=== Gemtre Media Service Deploy ==="
echo ""

# Try to find the NAS SSH host
NAS_USER="admin"
NAS_FOUND=""

echo "Looking for NAS..."

for host in \
  "DiskStation.local" \
  "122.177.105.141" \
  "192.168.1.1" "192.168.1.100" "192.168.1.101" "192.168.1.102" \
  "192.168.0.1" "192.168.0.100" "192.168.0.101" \
  "10.0.0.1" "10.0.0.2"; do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o BatchMode=yes \
       "${NAS_USER}@${host}" "echo ok" 2>/dev/null; then
    NAS_FOUND="$host"
    echo "✅ Found NAS at $host"
    break
  fi
done

if [ -z "$NAS_FOUND" ]; then
  echo ""
  echo "Could not auto-detect NAS. Enter the NAS IP/hostname:"
  read -p "NAS host: " NAS_FOUND
fi

echo ""
echo "Deploying to ${NAS_USER}@${NAS_FOUND}..."

ssh -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_FOUND}" bash <<'REMOTE'
set -e
echo "--- Checking repo ---"
cd /volume1/docker/ssjbots/media-service || { echo "ERROR: path not found"; exit 1; }

echo "--- Writing .env ---"
cat > .env << 'ENV'
SERVICE_SECRET=1027bba48e81f724481baf1919ce81c0375fca170152167233c52d481ad10c0b
PUBLIC_URL=https://media.gemtre.in
ENV

echo "--- Starting container ---"
docker compose up -d --build

echo "--- Waiting 5s for startup ---"
sleep 5

echo "--- Container status ---"
docker ps | grep gemtre-media-service && echo "✅ Container is running!" || echo "❌ Container not found"
REMOTE

echo ""
echo "=== Done! Check https://media.gemtre.in/health ==="
read -p "Press Enter to close..."
