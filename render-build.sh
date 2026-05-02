#!/usr/bin/env bash
set -o errexit

echo "📦 Installing dependencies..."
npm install

echo "🌐 Installing Chrome for Puppeteer..."
npx puppeteer browsers install chrome

# Extra safety for Render
echo "🔧 Setting permissions..."
chmod -R 755 /opt/render/.cache/puppeteer || true

echo "✅ Build completed successfully"