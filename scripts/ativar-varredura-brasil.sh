#!/usr/bin/env bash
# Liga a varredura automática pelo Brasil (Google Cloud, São Paulo), de 12 em 12 horas.
# Nada fica exposto à internet: um "job" acorda no horário, varre as fontes e grava o resultado no repositório.
# Uso (no Cloud Shell, dentro da pasta extraída): bash scripts/ativar-varredura-brasil.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_NAME="aferium-legal-monitor"; REGION="southamerica-east1"
JOB="aferium-varredura-legal"; SECRET="aferium-legal-deploy-key"
RUN_SA_NAME="aferium-varredura-job"; SCH_SA_NAME="aferium-varredura-agenda"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ -n "$PROJECT" ] || { echo "Nenhum projeto do Google Cloud selecionado. Rode: gcloud config set project aferiumdemo"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login -h github.com -p https -w
OWNER="$(gh api user -q .login)"; REPO="$OWNER/$REPO_NAME"
RUN_SA="$RUN_SA_NAME@$PROJECT.iam.gserviceaccount.com"; SCH_SA="$SCH_SA_NAME@$PROJECT.iam.gserviceaccount.com"
echo "Projeto: $PROJECT | Região: $REGION (São Paulo) | Repositório: $REPO"

echo "1/6 Ativando os serviços do Google Cloud..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com --quiet

echo "2/6 Criando contas de serviço com o mínimo de permissão..."
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 || gcloud iam service-accounts create "$RUN_SA_NAME" --display-name "Varredura legal (job)" --quiet
gcloud iam service-accounts describe "$SCH_SA" >/dev/null 2>&1 || gcloud iam service-accounts create "$SCH_SA_NAME" --display-name "Agenda da varredura legal" --quiet

echo "3/6 Criando a chave de acesso restrita a este repositório (deploy key)..."
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  KD="$(mktemp -d)"; ssh-keygen -q -t ed25519 -N "" -C "aferium-varredura-brasil" -f "$KD/key"
  gh repo deploy-key add "$KD/key.pub" -R "$REPO" -t "Varredura Brasil (Google Cloud)" -w
  gcloud secrets create "$SECRET" --replication-policy=automatic --data-file="$KD/key" --quiet
  rm -rf "$KD"
else
  echo "   (já existe; mantendo)"
fi
gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null

echo "4/6 Publicando o job em São Paulo (leva alguns minutos)..."
gcloud run jobs deploy "$JOB" --source cloud-brasil --region "$REGION" --service-account "$RUN_SA" \
  --set-env-vars "REPO=$REPO" --set-secrets "DEPLOY_KEY=$SECRET:latest" \
  --task-timeout 40m --max-retries 1 --memory 1Gi --quiet
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$SCH_SA" --role roles/run.invoker --quiet >/dev/null

echo "5/6 Agendando 06:17 e 18:17 (horário de Maceió)..."
URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
if gcloud scheduler jobs describe "$JOB-agenda" --location "$REGION" >/dev/null 2>&1; then CMD=update; else CMD=create; fi
gcloud scheduler jobs "$CMD" http "$JOB-agenda" --location "$REGION" --schedule "17 6,18 * * *" --time-zone "America/Maceio" \
  --uri "$URI" --http-method POST --oauth-service-account-email "$SCH_SA" --quiet
# A varredura do GitHub deixa de agendar, para as duas não se atropelarem. Pode ser religada com: gh workflow enable legal-monitor.yml
gh workflow disable legal-monitor.yml -R "$REPO" >/dev/null 2>&1 || true

echo "6/6 Rodando a primeira varredura agora (aguarde, pode levar uns 10 minutos)..."
gcloud run jobs execute "$JOB" --region "$REGION" --wait
echo ""
echo "Pronto. A varredura automática pelo Brasil está ativa. Confira o resultado em:"
echo "https://raw.githubusercontent.com/$REPO/main/public/legal/status.json"
