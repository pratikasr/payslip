#!/usr/bin/env bash
# Creates the AWS resources for one Payslip host and writes deploy/aws/outputs.env.
# Run it on your own machine with your own credentials; it is idempotent: every step looks for
# what an earlier run made (by tag or by name) and completes or skips it. It never touches the
# software on the instance; that is deploy/install.sh over SSH (deploy/README.md).
#
# Needs: aws CLI v2 with a configured profile (AWS_PROFILE; AWS_REGION, default us-east-1),
# curl, python3, openssl, and the SSH public key at ~/.ssh/payslip-hetzner.pub (or SSH_PUBKEY=path).
# Optional: INSTANCE_TYPE (default t3.small; t3.medium builds faster), VOLUME_GB (30),
# STACK (default payslip; another name makes a second, independent stack, for example testnet),
# APP_BASIC_AUTH_USER / APP_BASIC_AUTH_PASSWORD (else asked), ROTATE_APP_AUTH=1 to change them.
#
# Creates, each tagged Project=payslip and Stack=<STACK>:
#   key pair <STACK> from the public key
#   security group <STACK>: 22/tcp from this machine's public IP; 3001-8082/tcp from the CloudFront
#     origin-facing managed prefix list, as one rule (that list weighs 55 of the 60-rule quota)
#   IAM role and instance profile <STACK>-instance: PutObject and ListBucket on the backup bucket
#   one EC2 instance (Ubuntu 24.04 LTS amd64 from Canonical's SSM parameter, gp3 root volume,
#     IMDSv2 required) with an Elastic IP
#   S3 bucket <STACK>-backups-<account>-<region>, public access blocked
#   CloudFront function <STACK>-app-basic-auth: HTTP Basic auth in front of the company console
#   CloudFront distributions books and app on the default *.cloudfront.net certificate, each with
#     two origins on the instance (web and /api/*), caching off, every viewer header and query
#     string forwarded, and the secret X-Payslip-Origin header that deploy/Caddyfile requires
set -euo pipefail

AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_REGION
STACK=${STACK:-payslip}
PROJECT_TAG=payslip
INSTANCE_TYPE=${INSTANCE_TYPE:-t3.small}
VOLUME_GB=${VOLUME_GB:-30}
SSH_PUBKEY=${SSH_PUBKEY:-$HOME/.ssh/payslip-hetzner.pub}
KEY_NAME=$STACK
SG_NAME=$STACK
ROLE_NAME=$STACK-instance
AUTH_FUNCTION=$STACK-app-basic-auth
AMI_PARAM=/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id
PREFIX_LIST_NAME=com.amazonaws.global.cloudfront.origin-facing
# Managed policy ids (docs.aws.amazon.com, CloudFront developer guide, checked 11 Oct 2026).
CACHING_DISABLED=4135ea2d-6df8-44a3-9df3-4b5a84be39ad
ALL_VIEWER=216adef6-5c7f-47e4-b989-5492eafa07d3
SECURITY_HEADERS=67f7725c-6f97-4210-82d7-5512b31e9d03

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=$HERE/outputs.env
[[ $STACK == payslip ]] || OUT=$HERE/outputs-$STACK.env
TAGS="{Key=Project,Value=$PROJECT_TAG},{Key=Stack,Value=$STACK}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

log() { printf '\n== %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
need aws; need curl; need python3; need openssl
aws --version 2>&1 | grep -q '^aws-cli/2' || die "aws CLI v2 is required"
[[ -r $SSH_PUBKEY ]] || die "SSH public key not found at $SSH_PUBKEY (set SSH_PUBKEY=path)"

# Values from an earlier run: the same origin secret and the same distribution ids are reused.
if [[ -f $OUT ]]; then
  # shellcheck disable=SC1090
  . "$OUT"
fi
ORIGIN_SECRET=${ORIGIN_SECRET:-$(openssl rand -hex 32)}

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
log "account $ACCOUNT, region $AWS_REGION, stack $STACK, profile ${AWS_PROFILE:-default}"

log "key pair $KEY_NAME"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "exists"
else
  aws ec2 import-key-pair --key-name "$KEY_NAME" --public-key-material "fileb://$SSH_PUBKEY" \
    --tag-specifications "ResourceType=key-pair,Tags=[$TAGS]" >/dev/null
  echo "imported $SSH_PUBKEY"
fi

log "network"
VPC_ID=${VPC_ID:-$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}
[[ -n $VPC_ID && $VPC_ID != None ]] || die "no default VPC in $AWS_REGION: run 'aws ec2 create-default-vpc' or set VPC_ID and SUBNET_ID"
if [[ -z ${SUBNET_ID:-} ]]; then
  SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text)
  if [[ -z $SUBNET_ID || $SUBNET_ID == None ]]; then
    SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[0].SubnetId' --output text)
  fi
fi
[[ -n $SUBNET_ID && $SUBNET_ID != None ]] || die "no subnet in VPC $VPC_ID"
echo "vpc $VPC_ID, subnet $SUBNET_ID"

log "security group $SG_NAME"
SG_ID=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$SG_NAME" --query 'SecurityGroups[0].GroupId' --output text)
if [[ -z $SG_ID || $SG_ID == None ]]; then
  SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "Payslip origin: SSH from the operator, origin ports from CloudFront" \
    --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" --query GroupId --output text)
  echo "created $SG_ID"
else
  echo "exists $SG_ID"
fi
# authorize-security-group-ingress is not idempotent; a duplicate rule is fine.
authorize() {
  local err
  if ! err=$(aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions "$1" 2>&1); then
    [[ $err == *InvalidPermission.Duplicate* ]] || die "$err"
  fi
}
MY_IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
[[ $MY_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not read this machine's public IPv4 address"
authorize "[{\"IpProtocol\":\"tcp\",\"FromPort\":22,\"ToPort\":22,\"IpRanges\":[{\"CidrIp\":\"$MY_IP/32\",\"Description\":\"operator ssh\"}]}]"
echo "22/tcp from $MY_IP/32 (a rule for an older address stays; remove it with revoke-security-group-ingress)"
PL_ID=$(aws ec2 describe-managed-prefix-lists --filters "Name=prefix-list-name,Values=$PREFIX_LIST_NAME" --query 'PrefixLists[0].PrefixListId' --output text)
[[ -n $PL_ID && $PL_ID != None ]] || die "managed prefix list $PREFIX_LIST_NAME not found in $AWS_REGION"
authorize "[{\"IpProtocol\":\"tcp\",\"FromPort\":3001,\"ToPort\":8082,\"PrefixListIds\":[{\"PrefixListId\":\"$PL_ID\",\"Description\":\"CloudFront origin-facing servers\"}]}]"
echo "3001-8082/tcp from $PL_ID ($PREFIX_LIST_NAME); only 3001, 8081, 3002 and 8082 listen"

log "backup bucket"
BACKUP_BUCKET=$STACK-backups-$ACCOUNT-$AWS_REGION
if aws s3api head-bucket --bucket "$BACKUP_BUCKET" >/dev/null 2>&1; then
  echo "exists s3://$BACKUP_BUCKET"
else
  if [[ $AWS_REGION == us-east-1 ]]; then
    aws s3api create-bucket --bucket "$BACKUP_BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BACKUP_BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  echo "created s3://$BACKUP_BUCKET"
fi
aws s3api put-public-access-block --bucket "$BACKUP_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-tagging --bucket "$BACKUP_BUCKET" --tagging "TagSet=[$TAGS]"

log "instance role $ROLE_NAME (uploads to the backup bucket, nothing else)"
cat > "$WORK/trust.json" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
cat > "$WORK/policy.json" <<JSON
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:PutObject"],"Resource":"arn:aws:s3:::$BACKUP_BUCKET/*"},
  {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::$BACKUP_BUCKET"}
]}
JSON
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "file://$WORK/trust.json" \
    --tags "Key=Project,Value=$PROJECT_TAG" "Key=Stack,Value=$STACK" >/dev/null
  echo "created role"
fi
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name backup-bucket --policy-document "file://$WORK/policy.json"
if ! aws iam get-instance-profile --instance-profile-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE_NAME" \
    --tags "Key=Project,Value=$PROJECT_TAG" "Key=Stack,Value=$STACK" >/dev/null
  echo "created instance profile"
fi
if ! aws iam get-instance-profile --instance-profile-name "$ROLE_NAME" --query 'InstanceProfile.Roles[].RoleName' --output text | grep -qw "$ROLE_NAME"; then
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME"
fi

log "instance"
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Stack,Values=$STACK" "Name=tag:Name,Values=$STACK" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [[ -z $INSTANCE_ID || $INSTANCE_ID == None ]]; then
  AMI=$(aws ssm get-parameters --names "$AMI_PARAM" --query 'Parameters[0].Value' --output text)
  [[ $AMI == ami-* ]] || die "could not resolve $AMI_PARAM"
  ROOT_DEV=$(aws ec2 describe-images --image-ids "$AMI" --query 'Images[0].RootDeviceName' --output text)
  echo "ami $AMI (Ubuntu 24.04 LTS amd64, root device $ROOT_DEV), $INSTANCE_TYPE, ${VOLUME_GB} GB gp3"
  # A new instance profile takes a few seconds to become usable: retry on that error only.
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if INSTANCE_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
        --key-name "$KEY_NAME" --security-group-ids "$SG_ID" --subnet-id "$SUBNET_ID" \
        --iam-instance-profile "Name=$ROLE_NAME" \
        --block-device-mappings "DeviceName=$ROOT_DEV,Ebs={VolumeSize=$VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true}" \
        --metadata-options HttpTokens=required,HttpEndpoint=enabled \
        --tag-specifications "ResourceType=instance,Tags=[$TAGS,{Key=Name,Value=$STACK}]" "ResourceType=volume,Tags=[$TAGS,{Key=Name,Value=$STACK}]" \
        --count 1 --query 'Instances[0].InstanceId' --output text 2>"$WORK/run.err"); then
      break
    fi
    if grep -q "Invalid IAM Instance Profile" "$WORK/run.err" && [[ $attempt -lt 12 ]]; then
      echo "instance profile not ready yet, retrying ($attempt)"
      sleep 5
    else
      die "$(cat "$WORK/run.err")"
    fi
  done
  echo "launched $INSTANCE_ID, waiting for it to run"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
else
  STATE=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
  echo "exists $INSTANCE_ID ($STATE)"
  if [[ $STATE == stopped ]]; then
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  fi
fi

log "elastic IP"
read -r ALLOC_ID INSTANCE_IP ASSOC_INSTANCE <<<"$(aws ec2 describe-addresses --filters "Name=tag:Stack,Values=$STACK" \
  --query 'Addresses[0].[AllocationId,PublicIp,InstanceId]' --output text)"
if [[ -z ${ALLOC_ID:-} || $ALLOC_ID == None ]]; then
  read -r ALLOC_ID INSTANCE_IP <<<"$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[$TAGS,{Key=Name,Value=$STACK}]" \
    --query '[AllocationId,PublicIp]' --output text)"
  ASSOC_INSTANCE=None
  echo "allocated $INSTANCE_IP"
fi
if [[ ${ASSOC_INSTANCE:-None} != "$INSTANCE_ID" ]]; then
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
  echo "associated $INSTANCE_IP with $INSTANCE_ID"
else
  echo "$INSTANCE_IP already on $INSTANCE_ID"
fi
# CloudFront needs a DNS name for the origin: the instance's public DNS name follows the EIP.
INSTANCE_DNS=
for _ in $(seq 1 24); do
  INSTANCE_DNS=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicDnsName' --output text)
  [[ $INSTANCE_DNS == *"${INSTANCE_IP//./-}"* ]] && break
  sleep 5
done
[[ $INSTANCE_DNS == *"${INSTANCE_IP//./-}"* ]] || die "no public DNS name for $INSTANCE_IP yet: enable DNS hostnames on $VPC_ID (aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames '{\"Value\":true}') and run this again"
echo "public DNS $INSTANCE_DNS"

log "CloudFront function $AUTH_FUNCTION (HTTP Basic auth in front of the company console)"
FN_EXISTS=0
aws cloudfront describe-function --name "$AUTH_FUNCTION" >/dev/null 2>&1 && FN_EXISTS=1
if [[ $FN_EXISTS -eq 0 || -n ${APP_BASIC_AUTH_PASSWORD:-} || ${ROTATE_APP_AUTH:-0} == 1 ]]; then
  APP_BASIC_AUTH_USER=${APP_BASIC_AUTH_USER:-payslip}
  if [[ -z ${APP_BASIC_AUTH_PASSWORD:-} ]]; then
    [[ -t 0 ]] || die "set APP_BASIC_AUTH_PASSWORD (no terminal to ask on)"
    read -rsp "Password for the company console (user $APP_BASIC_AUTH_USER, 12+ characters): " APP_BASIC_AUTH_PASSWORD
    echo
  fi
  [[ ${#APP_BASIC_AUTH_PASSWORD} -ge 12 ]] || die "use a password of at least 12 characters"
  EXPECTED=$(printf '%s:%s' "$APP_BASIC_AUTH_USER" "$APP_BASIC_AUTH_PASSWORD" | base64 | tr -d '\n')
  cat > "$WORK/auth.js" <<JS
// Payslip company console gate: HTTP Basic auth until the sign-in layer lands. Written by provision.sh.
function handler(event) {
  var expected = 'Basic $EXPECTED';
  var header = event.request.headers.authorization;
  if (!header || header.value !== expected) {
    return {
      statusCode: 401,
      statusDescription: 'Unauthorized',
      headers: { 'www-authenticate': { value: 'Basic realm="Payslip console", charset="UTF-8"' } }
    };
  }
  return event.request;
}
JS
  if [[ $FN_EXISTS -eq 0 ]]; then
    aws cloudfront create-function --name "$AUTH_FUNCTION" \
      --function-config "Comment=Payslip company console basic auth,Runtime=cloudfront-js-2.0" \
      --function-code "fileb://$WORK/auth.js" >/dev/null
    echo "created"
  else
    ETAG=$(aws cloudfront describe-function --name "$AUTH_FUNCTION" --query ETag --output text)
    aws cloudfront update-function --name "$AUTH_FUNCTION" --if-match "$ETAG" \
      --function-config "Comment=Payslip company console basic auth,Runtime=cloudfront-js-2.0" \
      --function-code "fileb://$WORK/auth.js" >/dev/null
    echo "updated credentials"
  fi
  ETAG=$(aws cloudfront describe-function --name "$AUTH_FUNCTION" --query ETag --output text)
  aws cloudfront publish-function --name "$AUTH_FUNCTION" --if-match "$ETAG" >/dev/null
  echo "published"
else
  echo "exists (set APP_BASIC_AUTH_PASSWORD or ROTATE_APP_AUTH=1 to change the password)"
fi
AUTH_FUNCTION_ARN=$(aws cloudfront describe-function --name "$AUTH_FUNCTION" --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)

# DistributionConfig for one role, as JSON for create-distribution-with-tags.
# args: role web_port api_port function_arn_or_empty
dist_config() {
  python3 -I - "$1" "$2" "$3" "$4" "$STACK" "$PROJECT_TAG" "$INSTANCE_DNS" "$ORIGIN_SECRET" "$CACHING_DISABLED" "$ALL_VIEWER" "$SECURITY_HEADERS" <<'PY'
import json, sys, time
role, web_port, api_port, fn_arn, stack, project, origin_dns, secret, caching_disabled, all_viewer, security_headers = sys.argv[1:]
def origin(oid, port):
    return {
        "Id": oid,
        "DomainName": origin_dns,
        "CustomHeaders": {"Quantity": 1, "Items": [{"HeaderName": "X-Payslip-Origin", "HeaderValue": secret}]},
        "CustomOriginConfig": {
            "HTTPPort": int(port),
            "HTTPSPort": 443,
            "OriginProtocolPolicy": "http-only",
            "OriginReadTimeout": 120,
            "OriginKeepaliveTimeout": 60,
            "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
        },
    }
def behavior(target, methods, pattern=None):
    b = {
        "TargetOriginId": target,
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {"Quantity": len(methods), "Items": methods, "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}},
        "Compress": False,
        "CachePolicyId": caching_disabled,
        "OriginRequestPolicyId": all_viewer,
        "ResponseHeadersPolicyId": security_headers,
        "FunctionAssociations": {"Quantity": 1, "Items": [{"FunctionARN": fn_arn, "EventType": "viewer-request"}]} if fn_arn else {"Quantity": 0},
    }
    if pattern:
        b["PathPattern"] = pattern
    return b
config = {
    "CallerReference": f"{stack}-{role}-{int(time.time())}",
    "Comment": f"Payslip {role} ({stack})",
    "Enabled": True,
    "PriceClass": "PriceClass_100",
    "HttpVersion": "http2",
    "IsIPV6Enabled": True,
    "Origins": {"Quantity": 2, "Items": [origin("web", web_port), origin("api", api_port)]},
    "DefaultCacheBehavior": behavior("web", ["GET", "HEAD", "OPTIONS"]),
    "CacheBehaviors": {"Quantity": 1, "Items": [behavior("api", ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"], "/api/*")]},
    "ViewerCertificate": {"CloudFrontDefaultCertificate": True},
    "Restrictions": {"GeoRestriction": {"RestrictionType": "none", "Quantity": 0}},
}
tags = {"Items": [{"Key": "Project", "Value": project}, {"Key": "Stack", "Value": stack}, {"Key": "Role", "Value": role}]}
json.dump({"DistributionConfig": config, "Tags": tags}, sys.stdout, indent=1)
PY
}

# Finds this stack's distribution for a role: the id from outputs.env first, then the tags.
find_distribution() {
  local role=$1 known=$2 arn id
  if [[ -n $known ]] && aws cloudfront get-distribution --id "$known" >/dev/null 2>&1; then
    echo "$known"
    return
  fi
  for arn in $(aws resourcegroupstaggingapi get-resources --region us-east-1 --resource-type-filters cloudfront:distribution \
      --tag-filters "Key=Project,Values=$PROJECT_TAG" "Key=Stack,Values=$STACK" "Key=Role,Values=$role" \
      --query 'ResourceTagMappingList[].ResourceARN' --output text); do
    id=${arn##*/}
    if aws cloudfront get-distribution --id "$id" >/dev/null 2>&1; then
      echo "$id"
      return
    fi
  done
}

# Creates or confirms one distribution. args: role web_port api_port function_arn known_id; prints "id host"
ensure_distribution() {
  local role=$1 web=$2 api=$3 fn=$4 known=$5 id host origin_dns
  id=$(find_distribution "$role" "$known")
  if [[ -z $id ]]; then
    dist_config "$role" "$web" "$api" "$fn" > "$WORK/$role.json"
    read -r id host <<<"$(aws cloudfront create-distribution-with-tags \
      --distribution-config-with-tags "file://$WORK/$role.json" --query 'Distribution.[Id,DomainName]' --output text)"
    echo "created $role: $id https://$host (deploying, 5 to 10 minutes)" >&2
  else
    read -r host origin_dns <<<"$(aws cloudfront get-distribution --id "$id" \
      --query 'Distribution.[DomainName,DistributionConfig.Origins.Items[0].DomainName]' --output text)"
    echo "exists $role: $id https://$host" >&2
    if [[ $origin_dns != "$INSTANCE_DNS" ]]; then
      echo "WARNING: $role points at $origin_dns, not $INSTANCE_DNS. Run destroy.sh and provision.sh to rebuild it." >&2
    fi
  fi
  echo "$id $host"
}

log "CloudFront distributions"
read -r BOOKS_DISTRIBUTION_ID BOOKS_HOST <<<"$(ensure_distribution books 3001 8081 "" "${BOOKS_DISTRIBUTION_ID:-}")"
read -r APP_DISTRIBUTION_ID APP_HOST <<<"$(ensure_distribution app 3002 8082 "$AUTH_FUNCTION_ARN" "${APP_DISTRIBUTION_ID:-}")"

cat > "$OUT" <<ENV
# Written by deploy/aws/provision.sh on $(date -u +%FT%TZ). Git-ignored: ORIGIN_SECRET is a secret.
AWS_REGION=$AWS_REGION
STACK=$STACK
ACCOUNT=$ACCOUNT
KEY_NAME=$KEY_NAME
SECURITY_GROUP_ID=$SG_ID
INSTANCE_ID=$INSTANCE_ID
INSTANCE_IP=$INSTANCE_IP
INSTANCE_DNS=$INSTANCE_DNS
BACKUP_BUCKET=$BACKUP_BUCKET
BOOKS_DISTRIBUTION_ID=$BOOKS_DISTRIBUTION_ID
BOOKS_HOST=$BOOKS_HOST
APP_DISTRIBUTION_ID=$APP_DISTRIBUTION_ID
APP_HOST=$APP_HOST
AUTH_FUNCTION_ARN=$AUTH_FUNCTION_ARN
ORIGIN_SECRET=$ORIGIN_SECRET
ENV
chmod 600 "$OUT"

cat <<SUMMARY

Done. Written to $OUT

  books      https://$BOOKS_HOST      (statements page, public)
  app        https://$APP_HOST      (company console, basic auth)
  instance   $INSTANCE_IP  $INSTANCE_DNS  ($INSTANCE_ID)
  backups    s3://$BACKUP_BUCKET

Next (deploy/README.md):
  ssh -i ${SSH_PUBKEY%.pub} ubuntu@$INSTANCE_IP
  then copy the repository there, run sudo deploy/install.sh, fill deploy/payslip.env from this file,
  and docker compose --env-file payslip.env up -d.
The distributions answer 502 until the containers are up; check with
  aws cloudfront get-distribution --id $BOOKS_DISTRIBUTION_ID --query Distribution.Status --output text
SUMMARY
