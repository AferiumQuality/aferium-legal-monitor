#!/bin/sh
# Varredura legal rodando no Google Cloud em São Paulo (os sites oficiais respondem melhor a conexões do Brasil).
# Clona o repositório do monitor com a chave de implantação, roda a mesma varredura e publica o resultado.
set -eu
: "${REPO:?REPO não definido}"
: "${DEPLOY_KEY:?DEPLOY_KEY não definida}"
umask 077
printf '%s\n' "$DEPLOY_KEY" > /tmp/deploy_key
export GIT_SSH_COMMAND="ssh -i /tmp/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/ssh/github_known_hosts"
git clone --depth 20 "git@github.com:${REPO}.git" /tmp/repo
cd /tmp/repo
git config user.name "aferium-legal-monitor"
git config user.email "actions@users.noreply.github.com"
npm install --no-audit --no-fund --no-package-lock
node scripts/scan.mjs
git add public/legal
if git diff --cached --quiet; then
  echo "Sem mudanças para publicar."
else
  git commit -q -m "Varredura legal (São Paulo) $(date -u +%Y-%m-%dT%H:%MZ)"
  git pull --rebase -q origin main || true
  git push -q origin HEAD:main
  echo "Resultado publicado."
fi
rm -f /tmp/deploy_key
