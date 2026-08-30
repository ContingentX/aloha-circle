#!/usr/bin/env bash
# Build the www Vite app and publish it to an environment's site bucket, then
# invalidate CloudFront. Run after deploy.sh has created the site stack.
#   usage: ./infra/deploy-web.sh <dev|prod>
# Optional: VITE_API_BASE in the environment points the built site at a hosted
# agentharness API (defaults to none — the live needs feed stays empty until set).
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

echo "==> [$ENV] Building www"
( cd "$ROOT/www" && npm ci && npm run build )

echo "==> [$ENV] Syncing to s3://$BUCKET"
# Hashed assets are immutable; everything else (index.html, root files) must
# revalidate — without Cache-Control, browsers heuristically cache index.html
# and keep serving stale bundles after a deploy.
aws s3 sync "$ROOT/www/dist/assets/" "s3://$BUCKET/assets/" --delete \
  --cache-control "public,max-age=31536000,immutable"
aws s3 sync "$ROOT/www/dist/" "s3://$BUCKET/" --delete --exclude "assets/*" \
  --cache-control "no-cache"

echo "==> [$ENV] Invalidating CloudFront $DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query "Invalidation.{Id:Id,Status:Status}" --output table
