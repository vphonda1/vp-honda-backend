#!/usr/bin/env bash
set -o errexit

echo "📦 Installing dependencies..."
npm install

echo "🌐 Installing Chrome..."
npx puppeteer browsers install chrome

echo "✅ Build completed"