#!/usr/bin/env bash
set -o errexit

npm install

PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

npx puppeteer browsers install chrome

mkdir -p /opt/render/project/src/.cache/puppeteer
cp -r $PUPPETEER_CACHE_DIR/chrome /opt/render/project/src/.cache/puppeteer/ 2>/dev/null || true

echo "✅ Chrome installed for Puppeteer"