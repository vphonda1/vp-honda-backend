#!/usr/bin/env bash
set -o errexit

echo "📦 Installing dependencies..."
npm install

echo "🌐 Installing Chrome..."
npx puppeteer browsers install chrome@131

echo "🔧 Fixing permissions..."
mkdir -p /opt/render/.cache/puppeteer
chmod -R 755 /opt/render/.cache/puppeteer 2>/dev/null || true

echo "✅ Build completed successfully"