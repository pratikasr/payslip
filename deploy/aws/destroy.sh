#!/usr/bin/env bash
# Removes everything deploy/aws/provision.sh created for one stack: found by the tags
# Project=payslip and Stack=<STACK>, with the ids in outputs.env tried first. The backup bucket
# and its archives are kept unless --delete-backups is given. Asks once before it starts.
#
#   deploy/aws/destroy.sh                      # keeps the backup bucket
#   deploy/aws/destroy.sh --delete-backups     # also empties and deletes the bucket
#   STACK=testnet deploy/aws/destroy.sh        # another stack
set -euo pipefail

AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_REGION
STACK=${STACK:-payslip}
PROJECT_TAG=payslip
KEY_NAME=$STACK
ROLE_NAME=$STACK-instance
AUTH_FUNCTION=$STACK-app-basic-auth
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=$HERE/outputs.env
[[ $STACK == payslip ]] || OUT=$HERE/outputs-$STACK.env
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

DELETE_BACKUPS=0
YES=0
for arg in "$@"; do
  case $arg in
    --delete-backups) DELETE_BACKUPS=1 ;;
    --yes) YES=1 ;;
    *) echo "unknown argument $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n== %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || die "aws CLI is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required"

BOOKS_DISTRIBUTION_ID=
APP_DISTRIBUTION_ID=
BACKUP_BUCKET=
if [[ -f $OUT ]]; then
  # shellcheck disable=SC1090
  . "$OUT"
fi
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BACKUP_BUCKET=${BACKUP_BUCKET:-$STACK-backups-$ACCOUNT-$AWS_REGION}
TAG_FILTERS=("Name=tag:Project,Values=$PROJECT_TAG" "Name=tag:Stack,Values=$STACK")

# Everything tagged for this stack, so the owner sees the list before anything is removed.
INSTANCE_IDS=$(aws ec2 describe-instances --filters "${TAG_FILTERS[@]}" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
ALLOC_IDS=$(aws ec2 describe-addresses --filters "${TAG_FILTERS[@]}" --query 'Addresses[].AllocationId' --output text)
SG_IDS=$(aws ec2 describe-security-groups --filters "${TAG_FILTERS[@]}" --query 'SecurityGroups[].GroupId' --output text)
DIST_IDS=$(
  {
    for arn in $(aws resourcegroupstaggingapi get-resources --region us-east-1 --resource-type-filters cloudfront:distribution \
        --tag-filters "Key=Project,Values=$PROJECT_TAG" "Key=Stack,Values=$STACK" \
        --query 'ResourceTagMappingList[].ResourceARN' --output text); do
      echo "${arn##*/}"
    done
    [[ -n $BOOKS_DISTRIBUTION_ID ]] && echo "$BOOKS_DISTRIBUTION_ID"
    [[ -n $APP_DISTRIBUTION_ID ]] && echo "$APP_DISTRIBUTION_ID"
  } | sort -u | tr '\n' ' '
)
BUCKET_EXISTS=0
aws s3api head-bucket --bucket "$BACKUP_BUCKET" >/dev/null 2>&1 && BUCKET_EXISTS=1

cat <<PLAN
Stack $STACK in $AWS_REGION (account $ACCOUNT) will lose:
  CloudFront distributions: ${DIST_IDS:-none}
  CloudFront function:      $AUTH_FUNCTION (if present)
  EC2 instances:            ${INSTANCE_IDS:-none}   (and their root volumes: the data lives in Docker volumes on them)
  Elastic IPs:              ${ALLOC_IDS:-none}
  security groups:          ${SG_IDS:-none}
  key pair:                 $KEY_NAME
  IAM role and profile:     $ROLE_NAME
  backup bucket:            s3://$BACKUP_BUCKET $([[ $DELETE_BACKUPS -eq 1 ]] && echo '(DELETED with every archive in it)' || echo '(kept; pass --delete-backups to remove it)')
PLAN
if [[ $YES -ne 1 ]]; then
  read -rp "Type the stack name ($STACK) to continue: " answer
  [[ $answer == "$STACK" ]] || die "cancelled"
fi

log "CloudFront distributions (disable, wait for the change to deploy, delete)"
for id in $DIST_IDS; do
  if ! aws cloudfront get-distribution-config --id "$id" > "$WORK/$id.json" 2>/dev/null; then
    echo "$id: already gone"
    continue
  fi
  etag=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$WORK/$id.json")
  enabled=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["DistributionConfig"]["Enabled"])' "$WORK/$id.json")
  if [[ $enabled == True ]]; then
    python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); c=d["DistributionConfig"]; c["Enabled"]=False; json.dump(c, open(sys.argv[2],"w"))' "$WORK/$id.json" "$WORK/$id.disabled.json"
    aws cloudfront update-distribution --id "$id" --if-match "$etag" --distribution-config "file://$WORK/$id.disabled.json" >/dev/null
    echo "$id: disabled, waiting for deployment (about 5 minutes)"
  fi
  aws cloudfront wait distribution-deployed --id "$id"
  etag=$(aws cloudfront get-distribution-config --id "$id" --query ETag --output text)
  aws cloudfront delete-distribution --id "$id" --if-match "$etag"
  echo "$id: deleted"
done

log "CloudFront function $AUTH_FUNCTION"
if etag=$(aws cloudfront describe-function --name "$AUTH_FUNCTION" --query ETag --output text 2>/dev/null); then
  aws cloudfront delete-function --name "$AUTH_FUNCTION" --if-match "$etag"
  echo "deleted"
else
  echo "not present"
fi

log "EC2 instances"
if [[ -n $INSTANCE_IDS ]]; then
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --instance-ids $INSTANCE_IDS >/dev/null
  echo "terminating $INSTANCE_IDS"
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $INSTANCE_IDS
  echo "terminated"
else
  echo "none"
fi

log "Elastic IPs"
for alloc in $ALLOC_IDS; do
  assoc=$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].AssociationId' --output text)
  if [[ -n $assoc && $assoc != None ]]; then
    aws ec2 disassociate-address --association-id "$assoc"
  fi
  aws ec2 release-address --allocation-id "$alloc"
  echo "released $alloc"
done
[[ -n $ALLOC_IDS ]] || echo "none"

log "security groups"
for sg in $SG_IDS; do
  # Network interfaces of a terminated instance linger for a short while.
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if aws ec2 delete-security-group --group-id "$sg" 2>"$WORK/sg.err"; then
      echo "deleted $sg"
      break
    fi
    if [[ $attempt -eq 12 ]]; then
      die "could not delete $sg: $(cat "$WORK/sg.err")"
    fi
    sleep 10
  done
done
[[ -n $SG_IDS ]] || echo "none"

log "key pair $KEY_NAME"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  aws ec2 delete-key-pair --key-name "$KEY_NAME"
  echo "deleted"
else
  echo "not present"
fi

log "IAM role and instance profile $ROLE_NAME"
aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME" 2>/dev/null || true
aws iam delete-instance-profile --instance-profile-name "$ROLE_NAME" 2>/dev/null && echo "instance profile deleted" || echo "instance profile not present"
aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name backup-bucket 2>/dev/null || true
aws iam delete-role --role-name "$ROLE_NAME" 2>/dev/null && echo "role deleted" || echo "role not present"

log "backup bucket s3://$BACKUP_BUCKET"
if [[ $BUCKET_EXISTS -eq 0 ]]; then
  echo "not present"
elif [[ $DELETE_BACKUPS -eq 1 ]]; then
  aws s3 rb "s3://$BACKUP_BUCKET" --force
  echo "deleted with its archives"
else
  echo "kept (pass --delete-backups to remove it)"
fi

if [[ -f $OUT ]]; then
  rm -f "$OUT"
  echo "removed $OUT"
fi
echo "Done."
