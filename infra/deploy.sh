#!/usr/bin/env bash
# Deploy AlohaLive site infrastructure for an environment
# (S3 + CloudFront + ACM + Route53, template: infra/site.yaml).
#   usage: ./infra/deploy.sh <dev|prod>
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  dev)  DOMAIN="dev.alohalive.net"; CREATE_WWW="false" ;;
  prod) DOMAIN="alohalive.net";     CREATE_WWW="true" ;;
  *) echo "usage: $0 <dev|prod>" >&2; exit 1 ;;
esac

REGION="us-east-1"
PROJECT="alohalive"
HOSTED_ZONE_ID="Z07263701EFGE2972ASGC"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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
    HostedZoneId="$HOSTED_ZONE_ID"

echo "==> [$ENV] Outputs"
aws cloudformation describe-stacks --stack-name "${PROJECT}-site-${ENV}" --region "$REGION" \
  --query "Stacks[0].Outputs" --output table
