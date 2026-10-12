#!/usr/bin/env bash
# Attaches a domain whose DNS lives at the registrar (Cloudflare, for example) to the two
# CloudFront distributions provision.sh created: the apex and www to the public statements
# page, app.<domain> to the company console. Run it twice:
#
#   deploy/aws/attach-domain.sh payslip.cash request    # asks ACM for a certificate, prints the
#                                                       # DNS records to create at the registrar
#   deploy/aws/attach-domain.sh payslip.cash attach     # once the certificate is issued: puts the
#                                                       # names on the distributions, prints the
#                                                       # final DNS records
#
# Needs: aws CLI v2 with credentials (AWS_PROFILE), python3, and deploy/aws/outputs.env from
# provision.sh. Everything is in us-east-1, which is where CloudFront reads certificates from.
set -euo pipefail

DOMAIN=${1:?usage: attach-domain.sh <domain> request|attach}
STEP=${2:?usage: attach-domain.sh <domain> request|attach}
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$HERE/outputs.env"
export AWS_REGION=us-east-1
STATE=$HERE/domain-$DOMAIN.env

case $STEP in
request)
  CERT_ARN=$(aws acm request-certificate --domain-name "$DOMAIN" \
    --subject-alternative-names "www.$DOMAIN" "app.$DOMAIN" --validation-method DNS \
    --query CertificateArn --output text)
  echo "CERT_ARN=$CERT_ARN" > "$STATE"
  echo "Certificate requested: $CERT_ARN"
  echo "Waiting for ACM to publish the validation records"
  for _ in $(seq 1 30); do
    n=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
      --query 'length(Certificate.DomainValidationOptions[?ResourceRecord])' --output text)
    [ "$n" -ge 3 ] && break
    sleep 5
  done
  echo
  echo "Create these CNAME records at the registrar (Cloudflare: DNS, Add record, proxy OFF / DNS only):"
  aws acm describe-certificate --certificate-arn "$CERT_ARN" \
    --query 'Certificate.DomainValidationOptions[].ResourceRecord.[Name,Value]' --output text \
    | awk '{printf "  CNAME  %-60s  ->  %s\n", $1, $2}' | sort -u
  echo
  echo "Then run: $0 $DOMAIN attach"
  ;;
attach)
  # shellcheck disable=SC1090
  . "$STATE"
  echo "Waiting for the certificate to be issued (the registrar's records must exist)"
  aws acm wait certificate-validated --certificate-arn "$CERT_ARN"
  echo "Issued."
  attach() {
    local id=$1; shift
    local tmp; tmp=$(mktemp)
    aws cloudfront get-distribution-config --id "$id" > "$tmp"
    local etag; etag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$tmp")
    python3 - "$tmp" "$CERT_ARN" "$@" <<'PY'
import json, sys
path, cert, *aliases = sys.argv[1:]
d = json.load(open(path))["DistributionConfig"]
d["Aliases"] = {"Quantity": len(aliases), "Items": aliases}
d["ViewerCertificate"] = {"ACMCertificateArn": cert, "SSLSupportMethod": "sni-only",
                          "MinimumProtocolVersion": "TLSv1.2_2021"}
json.dump(d, open(path + ".update", "w"))
PY
    aws cloudfront update-distribution --id "$id" --if-match "$etag" \
      --distribution-config "file://$tmp.update" --query 'Distribution.DomainName' --output text
    rm -f "$tmp" "$tmp.update"
  }
  echo "books distribution ($BOOKS_DISTRIBUTION_ID): $(attach "$BOOKS_DISTRIBUTION_ID" "$DOMAIN" "www.$DOMAIN")"
  echo "app distribution ($APP_DISTRIBUTION_ID): $(attach "$APP_DISTRIBUTION_ID" "app.$DOMAIN")"
  echo
  echo "Create these records at the registrar (proxy OFF / DNS only); the apex needs CNAME flattening, which Cloudflare does:"
  printf "  CNAME  %-24s  ->  %s\n" "$DOMAIN" "$BOOKS_HOST" "www.$DOMAIN" "$BOOKS_HOST" "app.$DOMAIN" "$APP_HOST"
  echo
  echo "CloudFront takes 5 to 10 minutes to deploy. Then: https://$DOMAIN and https://app.$DOMAIN"
  echo "Remember: add https://app.$DOMAIN/api/auth/callback/google to the Google client, and set"
  echo "APP_HOST=app.$DOMAIN, BOOKS_HOST=$DOMAIN and EXTRA_ALLOWED_HOSTS=www.$DOMAIN in deploy/payslip.env on the server,"
  echo "then rebuild the two web images (deploy/README.md, Update)."
  ;;
*)
  echo "step must be request or attach" >&2; exit 2;;
esac
