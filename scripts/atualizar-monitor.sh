#!/usr/bin/env bash
# Atualiza o repositório do monitor já criado (sem recriar nem apagar o histórico das varreduras).
# Uso (no Cloud Shell, dentro da pasta extraída): bash scripts/atualizar-monitor.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="aferium-legal-monitor"
command -v gh >/dev/null 2>&1 || { echo "O GitHub CLI (gh) não foi encontrado."; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login -h github.com -p https -w
OWNER="$(gh api user -q .login)"
TMP="$(mktemp -d)"
gh repo clone "$OWNER/$REPO" "$TMP/repo" -- -q
cp -r scripts cloud-brasil .github package.json README.md "$TMP/repo/"
cd "$TMP/repo"
git config user.name "$OWNER"; git config user.email "$OWNER@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then echo "Nada para atualizar."; else git commit -q -m "Atualiza o monitor legal"; git push -q; fi
gh workflow run legal-monitor.yml -R "$OWNER/$REPO"
echo "Atualizado. Uma nova varredura foi iniciada em $OWNER/$REPO."
