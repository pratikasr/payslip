#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 EC2 instance for Payslip and is safe to run again later:
# Docker Engine from Docker's apt repository, the AWS CLI (backup uploads use the instance role),
# UFW, fail2ban, unattended security upgrades, age, a swap file and the nightly backup job.
#
# Run it from the repository copy on the instance:   sudo deploy/install.sh
# Then log out and back in (docker group), fill deploy/payslip.env and follow deploy/README.md.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi
REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_USER=${SUDO_USER:-ubuntu}
SWAP_GB=${SWAP_GB:-4}
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades age unzip rsync

echo "== Docker Engine (docs.docker.com/engine/install/ubuntu, checked 11 Oct 2026)"
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
if [[ ! -f /etc/apt/sources.list.d/docker.sources ]]; then
  # shellcheck disable=SC1091
  codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
  tee /etc/apt/sources.list.d/docker.sources >/dev/null <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
  apt-get update
fi
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker "$TARGET_USER"

echo "== AWS CLI v2 (awscli.amazonaws.com install script, system-wide)"
if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash -s -- --system
fi
aws --version

echo "== firewall"
# The security group is the real guard: it admits the four origin ports from CloudFront's ranges
# only and port 22 from the operator. Docker's published ports bypass UFW's INPUT chain, so UFW
# here protects the host itself and documents the intent.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
for port in 3001 8081 3002 8082; do
  ufw allow "$port/tcp"
done
ufw --force enable

echo "== fail2ban (the sshd jail is on by default in Ubuntu's jail.d/defaults-debian.conf)"
systemctl enable --now fail2ban

echo "== unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades

echo "== swap (${SWAP_GB} GB): the service image build and the company service peak above a t3.small's 2 GB"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo "== nightly backup at 03:17 UTC (deploy/backup.sh, needs BACKUP_* in deploy/payslip.env)"
cat > /etc/cron.d/payslip-backup <<CRON
17 3 * * * root $REPO_DIR/deploy/backup.sh >> /var/log/payslip-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/payslip-backup

cat <<DONE

Done. Next:
  1. Log out and back in so that $TARGET_USER can run docker without sudo.
  2. cp $REPO_DIR/deploy/payslip.env.example $REPO_DIR/deploy/payslip.env and fill it in
     (values from deploy/aws/outputs.env on your own machine, a new seed passphrase, the age recipient).
  3. cd $REPO_DIR/deploy && docker compose --env-file payslip.env config >/dev/null
  4. Build and start as in deploy/README.md.
DONE
