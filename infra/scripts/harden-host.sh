#!/usr/bin/env bash
# Host hardening for the neutral tier (BUILD_PLAN 12.4).
#
# Run once, as root, on a fresh Ubuntu 24.04 server:
#   ssh root@<ip> 'bash -s' < infra/scripts/harden-host.sh
#
# Idempotent: running it twice changes nothing.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PUBLIC_KEY="${SSH_PUBLIC_KEY:-}"

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  postgresql-client age rclone

echo "==> deploy user"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER" 2>/dev/null || true

if [ -n "$SSH_PUBLIC_KEY" ]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  echo "$SSH_PUBLIC_KEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

echo "==> ssh: keys only, no root"
cat > /etc/ssh/sshd_config.d/10-morapay.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
AllowAgentForwarding no
CONF
systemctl reload ssh || systemctl reload sshd

echo "==> firewall: deny by default"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http — acme and redirect'
ufw allow 443/tcp comment 'https'
ufw --force enable

echo "==> fail2ban"
cat > /etc/fail2ban/jail.d/morapay.conf <<'CONF'
[sshd]
enabled = true
maxretry = 3
findtime = 10m
bantime = 1h

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 20
findtime = 5m
bantime = 30m
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# Security updates only, and a reboot at 04:00 when the kernel requires one.
sed -i 's|^//\s*"\${distro_id}:\${distro_codename}-security";|        "${distro_id}:${distro_codename}-security";|' \
  /etc/apt/apt.conf.d/50unattended-upgrades || true
sed -i 's|^//Unattended-Upgrade::Automatic-Reboot "false";|Unattended-Upgrade::Automatic-Reboot "true";|' \
  /etc/apt/apt.conf.d/50unattended-upgrades || true
sed -i 's|^//Unattended-Upgrade::Automatic-Reboot-Time "02:00";|Unattended-Upgrade::Automatic-Reboot-Time "04:00";|' \
  /etc/apt/apt.conf.d/50unattended-upgrades || true

echo "==> docker, from the official repository"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  usermod -aG docker "$DEPLOY_USER"
fi

echo "==> kernel hardening"
cat > /etc/sysctl.d/60-morapay.conf <<'CONF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
kernel.dmesg_restrict = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
CONF
sysctl --system >/dev/null

echo "==> log rotation for the application logs"
cat > /etc/logrotate.d/morapay <<'CONF'
/var/log/nginx/*.log {
  daily
  rotate 30
  compress
  delaycompress
  missingok
  notifempty
  create 0640 www-data adm
  sharedscripts
  postrotate
    docker kill --signal=USR1 $(docker ps -q -f name=nginx) 2>/dev/null || true
  endscript
}
CONF

echo ""
echo "Done. Remaining, and deliberately not automated:"
echo "  1. Restrict port 22 to the office range in the Hetzner firewall."
echo "  2. Put the secrets in the vault and template .env.production from it."
echo "  3. Issue certificates (see infra/README.md)."
echo "  4. Add the CAA record and submit the domain for HSTS preload."
echo "  5. Run a restore drill before anyone relies on the backups."
