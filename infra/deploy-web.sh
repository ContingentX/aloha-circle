#!/usr/bin/env bash
# Build the www Vite app and publish it to an environment's site bucket, then
# invalidate CloudFront. Run after deploy.sh has created the site stack.
#   usage: ./infra/deploy-web.sh <dev|prod>
# Optional: VITE_API_BASE in the environment overrides the API endpoint.
# Otherwise the deployed alohalive-donations stack output is used automatically.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  dev|prod) ;;
  *) echo "usage: $0 <dev|prod>" >&2; exit 1 ;;
esac

REGION="us-east-1"
PROJECT="alohalive"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

stack_out() {
  aws cloudformation describe-stacks --stack-name "${PROJECT}-site-${ENV}" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(stack_out BucketName)"
DIST_ID="$(stack_out DistributionId)"

if [[ -z "${VITE_API_BASE:-}" ]]; then
  VITE_API_BASE="$(aws cloudformation describe-stacks \
    --stack-name alohalive-donations \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text)"
fi
if [[ -z "$VITE_API_BASE" || "$VITE_API_BASE" == "None" ]]; then
  echo "could not resolve the alohalive-donations ApiEndpoint" >&2
  exit 1
fi
export VITE_API_BASE

echo "==> [$ENV] Building www against $VITE_API_BASE"
( cd "$ROOT/www" && npm ci && npm run build )

echo "==> [$ENV] Syncing to s3://$BUCKET"
aws s3 sync "$ROOT/www/dist/" "s3://$BUCKET/" --delete

echo "==> [$ENV] Invalidating CloudFront $DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query "Invalidation.{Id:Id,Status:Status}" --output table
