#!/usr/bin/env bash
# Run once, interactively, as szb8480 on the existing VPS checkout.
set -Eeuo pipefail
umask 077
repo=szaib-dev/ai-whatsapp-support
[[ "$(id -un)" == szb8480 ]] || { echo 'Run as szb8480, not root.' >&2; exit 1; }
cd /opt/codetic
[[ -f .env.production && -f compose.production.yaml && -f compose.vps.yaml ]] || { echo 'Existing production config/override required. No files were overwritten.' >&2; exit 1; }
sudo apt-get update
sudo apt-get install -y gh jq openssh-client util-linux
command -v docker >/dev/null
# Docker access is root-equivalent. Restrict this account and protect main.
if ! docker info >/dev/null 2>&1; then
 if id -nG | tr ' ' '\n' | grep -qx docker; then
  echo 'Docker is unavailable despite group access. Restore the existing Docker service before setup.' >&2
  exit 1
 fi
 sudo usermod -aG docker szb8480
 echo 'Activating Docker group membership for this setup session.'
 exec sg docker -c 'cd /opt/codetic && bash scripts/setup-cicd.sh'
fi
created_auth=0
if ! gh auth status >/dev/null 2>&1; then gh auth login --hostname github.com --git-protocol ssh --skip-ssh-key --web; created_auth=1; fi
install -d -m 700 "$HOME/.ssh" .deploy
readkey="$HOME/.ssh/codetic_repository"
if [[ ! -f "$readkey" ]]; then
 ssh-keygen -q -t ed25519 -N '' -C codetic-vps-repository -f "$readkey"
fi
chmod 600 "$readkey"
pub="$(cat "$readkey.pub")"
if ! gh api "repos/$repo/keys" --jq '.[].key' | grep -Fq "$(awk '{print $2}' "$readkey.pub")"; then
 gh api --method POST "repos/$repo/keys" -f title=codetic-vps-read-only -f key="$pub" -F read_only=true >/dev/null
fi
# GitHub's own HTTPS metadata supplies host keys; no unauthenticated ssh-keyscan.
gh api meta --jq '.ssh_keys[] | "github.com " + .' > "$HOME/.ssh/codetic_github_known_hosts"
chmod 600 "$HOME/.ssh/codetic_github_known_hosts"
git remote set-url origin git@github.com:szaib-dev/ai-whatsapp-support.git
git config core.sshCommand "ssh -i $readkey -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/codetic_github_known_hosts"
git fetch --quiet origin main
git diff --quiet && git diff --cached --quiet || { echo 'Tracked files are dirty; resolve them before setup.' >&2; exit 1; }
git merge --ff-only origin/main
# The forced-command entry point is installed separately so checkout rollback cannot remove it.
sudo install -d -m 755 /usr/local/lib/codetic
sudo install -m 755 deploy/ssh-entrypoint.sh /usr/local/lib/codetic/ssh-entrypoint.sh
key="$HOME/.ssh/codetic_actions"
if [[ ! -f "$key" ]]; then ssh-keygen -q -t ed25519 -N '' -C codetic-actions -f "$key"; fi
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys" "$key"
if ! grep -Fq "$(awk '{print $2}' "$key.pub")" "$HOME/.ssh/authorized_keys"; then
 printf 'restrict,command="/usr/bin/bash /usr/local/lib/codetic/ssh-entrypoint.sh" %s\n' "$(cat "$key.pub")" >> "$HOME/.ssh/authorized_keys"
fi
gh secret set VPS_SSH_KEY --repo "$repo" < "$key"
awk '{print "193.181.223.127 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub | gh secret set VPS_KNOWN_HOSTS --repo "$repo"
# The CI private key is transferred directly to Actions secrets, never printed.
# Keep its protected local copy for rotation; do not copy it into the repository.
echo 'SSH identity and pinned VPS host key installed in GitHub repository secrets.'
echo 'Complete the exact repository/branch settings in CICD.md.'
gh workflow run ci.yml --repo "$repo" --ref main
echo 'Queued initial validated deployment. Follow progress in GitHub Actions.'
if [[ "$created_auth" == 1 ]]; then gh auth logout --hostname github.com --user "$(gh api user --jq .login)"; fi
