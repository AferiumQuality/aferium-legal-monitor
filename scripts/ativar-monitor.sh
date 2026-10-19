#!/usr/bin/env bash
# Ativa o monitor legal: cria o repositório público no GitHub, envia estes arquivos e roda a primeira varredura.
# Uso (no Cloud Shell, dentro da pasta extraída): bash scripts/ativar-monitor.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="aferium-legal-monitor"
if ! command -v gh >/dev/null 2>&1; then echo "O GitHub CLI (gh) não foi encontrado. Instale em https://cli.github.com e rode de novo."; exit 1; fi
if ! gh auth status >/dev/null 2>&1; then echo "Vamos entrar na sua conta do GitHub (abre um código para colar no navegador)."; gh auth login -h github.com -p https -w; fi
OWNER="$(gh api user -q .login)"
echo "Conta do GitHub: $OWNER"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then echo "O repositório $OWNER/$REPO já existe; vou atualizar."; else gh repo create "$OWNER/$REPO" --public --description "Monitor legal da Aferium (dados públicos de legislação)"; fi
[ -d .git ] || git init -q -b main
git config user.name "$OWNER"; git config user.email "$OWNER@users.noreply.github.com"
git add -A; git commit -q -m "Monitor legal Aferium" || true
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$REPO.git"
gh auth setup-git >/dev/null 2>&1 || true
git push -u origin main --force-with-lease || git push -u origin main
gh workflow enable legal-monitor.yml >/dev/null 2>&1 || true
gh workflow run legal-monitor.yml -R "$OWNER/$REPO"
echo "Primeira varredura iniciada. Isso leva alguns minutos."
sleep 15
RUN="$(gh run list -R "$OWNER/$REPO" --workflow legal-monitor.yml --limit 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$RUN" -R "$OWNER/$REPO" --exit-status || { echo "A varredura falhou. Veja: gh run view $RUN -R $OWNER/$REPO --log-failed"; exit 1; }
echo ""
echo "Pronto. Repositório: $OWNER/$REPO"
echo "Anote este texto para ligar no site: $OWNER/$REPO"
