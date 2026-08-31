#!/usr/bin/env bash
# Deploy AlohaLive site infrastructure for an environment
# (S3 + CloudFront + ACM + Route53, template: infra/site.yaml).
#   usage: ./infra/deploy.sh <dev|prod>
set -euo pipefail

ENV="${1:-}"
# ALT_DOMAIN serves the same distribution under a second apex (empty = none).
case "$ENV" in
  dev)  DOMAIN="dev.alohalive.net"; CREATE_WWW="false"; ALT_DOMAIN="";                ALT_ZONE_ID="" ;;
  prod) DOMAIN="alohalive.net";     CREATE_WWW="true";  ALT_DOMAIN="aloha-circle.com"; ALT_ZONE_ID="Z04064321OCFAQ8E2HIKK" ;;
  *) echo "usage: $0 <dev|prod>" >&2; exit 1 ;;
esac

REGION="us-east-1"
PROJECT="alohalive"
HOSTED_ZONE_ID="Z07263701EFGE2972ASGC"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The alt-domain pair must be set together (site.yaml's Rules enforce this at
# stack execution; failing here is immediate and costs nothing).
if { [ -n "$ALT_DOMAIN" ] && [ -z "$ALT_ZONE_ID" ]; } || { [ -z "$ALT_DOMAIN" ] && [ -n "$ALT_ZONE_ID" ]; }; then
  echo "error: ALT_DOMAIN and ALT_ZONE_ID must be provided together (got ALT_DOMAIN='$ALT_DOMAIN', ALT_ZONE_ID='$ALT_ZONE_ID')" >&2
  exit 1
fi

echo "==> [$ENV] Deploying site stack (${PROJECT}-site-${ENV}) — first run creates ACM + CloudFront, 15-25 min"
aws cloudformation deploy \
  --template-file "$ROOT/infra/site.yaml" \
  --stack-name "${PROJECT}-site-${ENV}" \
  --region "$REGION" \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    Environment="$ENV" \
    DomainName="$DOMAIN" \
    CreateWww="$CREATE_WWW" \
    HostedZoneId="$HOSTED_ZONE_ID" \
    AltDomainName="$ALT_DOMAIN" \
    AltHostedZoneId="$ALT_ZONE_ID"

echo "==> [$ENV] Deploying donations API stack (alohalive-donations)"
aws cloudformation deploy \
  --template-file "$ROOT/infra/donations/donations.yaml" \
  --stack-name "alohalive-donations" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

echo "==> [$ENV] Ensuring demo data and public-record contract fields"
AWS_REGION="$REGION" "$ROOT/infra/seed-demo-data.sh" alohalive

echo "==> [$ENV] Uploading donations Lambda code"
DEPLOY_TMP="$(mktemp -d -t alohalive-deploy-XXXXXX)"
DONATIONS_ZIP="$DEPLOY_TMP/donations.zip"
PREVIOUS_ZIP="$DEPLOY_TMP/previous.zip"
HEALTH_JSON="$DEPLOY_TMP/health.json"
NONPROFITS_JSON="$DEPLOY_TMP/nonprofits.json"
CAUSES_JSON="$DEPLOY_TMP/causes.json"
EXPERIENCES_JSON="$DEPLOY_TMP/experiences.json"
LAMBDA_UPDATED=0

cleanup_deploy() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$LAMBDA_UPDATED" -eq 1 ]]; then
    set +e
    echo "warning: deploy failed after Lambda upload; restoring the previous package" >&2
    aws lambda update-function-code \
      --function-name alohalive-donations \
      --zip-file "fileb://$PREVIOUS_ZIP" \
      --region "$REGION" >/dev/null
    local restore_status=$?
    if [[ "$restore_status" -eq 0 ]]; then
      aws lambda wait function-updated --function-name alohalive-donations --region "$REGION"
      restore_status=$?
    fi
    if [[ "$restore_status" -ne 0 ]]; then
      echo "error: automatic Lambda rollback failed; production requires immediate attention" >&2
    else
      echo "==> Previous Lambda package restored" >&2
    fi
  fi
  rm -rf "$DEPLOY_TMP"
  exit "$status"
}
trap cleanup_deploy EXIT

PREVIOUS_URL="$(aws lambda get-function \
  --function-name alohalive-donations \
  --region "$REGION" \
  --query 'Code.Location' \
  --output text)"
curl --fail --silent --show-error --max-time 90 "$PREVIOUS_URL" --output "$PREVIOUS_ZIP"

"$ROOT/infra/package-donations.sh" "$DONATIONS_ZIP"
LAMBDA_UPDATED=1
aws lambda update-function-code \
  --function-name alohalive-donations \
  --zip-file "fileb://$DONATIONS_ZIP" \
  --region "$REGION" >/dev/null
aws lambda wait function-updated \
  --function-name alohalive-donations \
  --region "$REGION"

API_ENDPOINT="$(aws cloudformation describe-stacks \
  --stack-name alohalive-donations \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text)"
echo "==> [$ENV] Verifying public API at $API_ENDPOINT"
curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --max-time 20 "$API_ENDPOINT/api/health" --output "$HEALTH_JSON"
curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --max-time 20 "$API_ENDPOINT/api/nonprofits" --output "$NONPROFITS_JSON"
curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --max-time 20 "$API_ENDPOINT/api/causes" --output "$CAUSES_JSON"
curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --max-time 20 "$API_ENDPOINT/experiences" --output "$EXPERIENCES_JSON"
python3 - "$HEALTH_JSON" "$NONPROFITS_JSON" "$CAUSES_JSON" "$EXPERIENCES_JSON" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    body = json.load(handle)
with open(sys.argv[2], encoding='utf-8') as handle:
    nonprofits = json.load(handle)
with open(sys.argv[3], encoding='utf-8') as handle:
    causes = json.load(handle)
with open(sys.argv[4], encoding='utf-8') as handle:
    experiences = json.load(handle).get('experiences', [])
counts = body.get('counts', {})
if body.get('ok') is not True:
    raise SystemExit(f'public API smoke failed: {body}')
if not isinstance(nonprofits, list) or not nonprofits:
    raise SystemExit(f'nonprofit API returned no published records: {nonprofits}')
if not isinstance(causes, list) or not causes:
    raise SystemExit(f'cause API returned no published records: {causes}')
required = {'id', 'source', 'url', 'title', 'causeTags', 'urgency', 'summary', 'fetchedAt', 'nonprofit', 'nonprofitId'}
if any(required - set(cause) for cause in causes):
    raise SystemExit('cause API returned an incomplete CauseSignal')
if not isinstance(experiences, list) or len(experiences) < 10:
    raise SystemExit(f'experience API returned fewer than 10 wheel prizes: {experiences}')
print(
    f"API smoke OK: nonprofits={len(nonprofits)} causes={len(causes)} "
    f"experiences={len(experiences)} raw_counts={counts}"
)
PY

echo "==> [$ENV] Outputs"
aws cloudformation describe-stacks --stack-name "${PROJECT}-site-${ENV}" --region "$REGION" \
  --query "Stacks[0].Outputs" --output table
