#!/usr/bin/env bash
set -o errexit

echo "📦 Installing dependencies..."
npm install

echo "🌐 Installing Correct Chrome Version..."
npx puppeteer browsers install chrome@131

echo "🔧 Setting permissions..."
chmod -R 755 /opt/render/.cache/puppeteer 2>/dev/null || true

echo "✅ Build completed successfully"