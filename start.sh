#!/bin/bash
# ─── QUANT TERMINAL — Lanceur local ──────────────────────────────────────────
set -e

cd "$(dirname "$0")"

echo ""
echo "  ██████  ██    ██  █████  ███    ██ ████████"
echo " ██    ██ ██    ██ ██   ██ ████   ██    ██   "
echo " ██    ██ ██    ██ ███████ ██ ██  ██    ██   "
echo " ██ ▄▄ ██ ██    ██ ██   ██ ██  ██ ██    ██   "
echo "  ██████   ██████  ██   ██ ██   ████    ██   "
echo "  ▀▀                                         "
echo "  TERMINAL — Portfolio Manager"
echo ""

# Vérifier Node.js
if ! command -v node &> /dev/null; then
  echo "❌  Node.js introuvable."
  echo "    Installez-le depuis https://nodejs.org/ (version 18+)"
  exit 1
fi

NODE_VER=$(node -e "process.exit(parseInt(process.versions.node.split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
if [ "$NODE_VER" = "old" ]; then
  echo "⚠️   Node.js $(node --version) détecté. Version 18+ recommandée."
fi

# Installer les dépendances si nécessaire
if [ ! -d "node_modules" ]; then
  echo "📦  Installation des dépendances (première fois, ~1 min)..."
  npm install --silent
  echo "✅  Dépendances installées."
fi

# Build si dist/ absent
if [ ! -d "dist" ]; then
  echo "🔨  Build de production..."
  npm run build
  echo "✅  Build terminé."
fi

echo "🚀  Démarrage du serveur sur http://localhost:5000"
echo "    Appuyez sur Ctrl+C pour arrêter."
echo ""

# Ouvrir le navigateur automatiquement (si possible)
if command -v open &> /dev/null; then       # macOS
  sleep 1.5 && open "http://localhost:5000" &
elif command -v xdg-open &> /dev/null; then # Linux
  sleep 1.5 && xdg-open "http://localhost:5000" &
fi

NODE_ENV=production node dist/index.cjs
