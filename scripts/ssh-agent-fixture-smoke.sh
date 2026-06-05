#!/usr/bin/env bash
set -euo pipefail

# Tiny local SSH fixture for Simple Vibe IDE auth debugging.
#
# It starts an unprivileged localhost sshd with a passphrase-protected client
# key, verifies that noninteractive BatchMode SSH fails before ssh-add, then
# verifies that the same BatchMode SSH succeeds after the key is unlocked in an
# agent. This reproduces the Explorer/File-job shape without requiring a real
# remote host.

PASS="${SVIDE_SSH_FIXTURE_PASSPHRASE:-svi-passphrase-test}"
PORT="${SVIDE_SSH_FIXTURE_PORT:-}"
KEEP="${SVIDE_SSH_FIXTURE_KEEP:-0}"
WORKDIR="${SVIDE_SSH_FIXTURE_DIR:-}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 127
  }
}

need ssh
need ssh-add
need ssh-agent
need ssh-keygen
need python3

SSHD="$(command -v sshd || true)"
if [ -z "$SSHD" ]; then
  echo "missing required command: sshd" >&2
  exit 127
fi

if [ -z "$PORT" ]; then
  PORT="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
fi

if [ -z "$WORKDIR" ]; then
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/svi-ssh-fixture.XXXXXX")"
else
  mkdir -p "$WORKDIR"
  WORKDIR="$(cd "$WORKDIR" && pwd)"
fi

AGENT_STARTED=0
SSHD_PID=""

cleanup() {
  if [ -n "$SSHD_PID" ] && kill -0 "$SSHD_PID" >/dev/null 2>&1; then
    kill "$SSHD_PID" >/dev/null 2>&1 || true
    wait "$SSHD_PID" >/dev/null 2>&1 || true
  fi
  if [ "$AGENT_STARTED" = 1 ]; then
    ssh-agent -k >/dev/null 2>&1 || true
  fi
  if [ "$KEEP" != 1 ]; then
    rm -rf "$WORKDIR"
  else
    echo "kept fixture dir: $WORKDIR"
  fi
}
trap cleanup EXIT

USER_NAME="$(id -un)"
HOST_KEY="$WORKDIR/ssh_host_ed25519_key"
CLIENT_KEY="$WORKDIR/client_ed25519"
AUTHORIZED_KEYS="$WORKDIR/authorized_keys"
SSHD_CONFIG="$WORKDIR/sshd_config"
SSH_CONFIG="$WORKDIR/ssh_config"
ASKPASS="$WORKDIR/askpass.sh"
SSHD_LOG="$WORKDIR/sshd.log"

ssh-keygen -q -t ed25519 -N "" -f "$HOST_KEY" -C "simple-vibe-ide-fixture-host"
ssh-keygen -q -t ed25519 -N "$PASS" -f "$CLIENT_KEY" -C "simple-vibe-ide-fixture-client"
cat "$CLIENT_KEY.pub" > "$AUTHORIZED_KEYS"

cat > "$SSHD_CONFIG" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $HOST_KEY
PidFile $WORKDIR/sshd.pid
AuthorizedKeysFile $AUTHORIZED_KEYS
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
UsePAM no
StrictModes no
PermitRootLogin no
AllowUsers $USER_NAME
Subsystem sftp internal-sftp
LogLevel DEBUG2
EOF

cat > "$SSH_CONFIG" <<EOF
Host svi-fixture
  HostName 127.0.0.1
  Port $PORT
  User $USER_NAME
  IdentityFile $CLIENT_KEY
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile $WORKDIR/known_hosts
  LogLevel ERROR
EOF

"$SSHD" -f "$SSHD_CONFIG" -E "$SSHD_LOG" -D &
SSHD_PID="$!"

python3 - "$PORT" <<'PY'
import socket, sys, time
port = int(sys.argv[1])
deadline = time.time() + 5
while time.time() < deadline:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            sys.exit(0)
    except OSError:
        time.sleep(0.05)
print("sshd did not become ready", file=sys.stderr)
sys.exit(1)
PY

cat > "$ASKPASS" <<EOF
#!/usr/bin/env sh
printf '%s\n' '$PASS'
EOF
chmod 700 "$ASKPASS"

echo "[1/5] BatchMode before ssh-add should fail"
set +e
env -u SSH_AUTH_SOCK -u SSH_AGENT_PID ssh -F "$SSH_CONFIG" -o BatchMode=yes svi-fixture true >"$WORKDIR/before.out" 2>&1
BEFORE_STATUS=$?
set -e
if [ "$BEFORE_STATUS" = 0 ]; then
  echo "expected BatchMode SSH to fail before ssh-add, but it succeeded" >&2
  exit 1
fi

echo "[2/5] Direct askpass without an agent should succeed"
env -u SSH_AUTH_SOCK -u SSH_AGENT_PID \
  "DISPLAY=${DISPLAY:-svi-fixture}" \
  "SSH_ASKPASS=$ASKPASS" \
  "SSH_ASKPASS_REQUIRE=force" \
  ssh -F "$SSH_CONFIG" \
    -o PreferredAuthentications=publickey \
    -o NumberOfPasswordPrompts=1 \
    svi-fixture 'printf askpass-ok' </dev/null >"$WORKDIR/askpass.out"
if ! grep -q 'askpass-ok' "$WORKDIR/askpass.out"; then
  echo "expected askpass-ok from remote command" >&2
  exit 1
fi

echo "[3/5] Unlock key in a fresh ssh-agent"
eval "$(ssh-agent -s)" >/dev/null
AGENT_STARTED=1
DISPLAY="${DISPLAY:-svi-fixture}" \
SSH_ASKPASS="$ASKPASS" \
SSH_ASKPASS_REQUIRE=force \
ssh-add "$CLIENT_KEY" </dev/null >/dev/null

ssh-add -l >/dev/null

echo "[4/5] BatchMode after ssh-add should succeed"
ssh -F "$SSH_CONFIG" -o BatchMode=yes svi-fixture 'printf fixture-ok' >"$WORKDIR/after.out"
if ! grep -q 'fixture-ok' "$WORKDIR/after.out"; then
  echo "expected fixture-ok from remote command" >&2
  exit 1
fi

echo "[5/5] Separate noninteractive job with agent env should succeed"
env -i \
  "PATH=${PATH:-/usr/bin:/bin}" \
  "HOME=${HOME:-}" \
  "SSH_AUTH_SOCK=$SSH_AUTH_SOCK" \
  "SSH_AGENT_PID=${SSH_AGENT_PID:-}" \
  "$(command -v ssh)" -F "$SSH_CONFIG" -o BatchMode=yes svi-fixture 'printf separate-job-ok' >"$WORKDIR/separate.out"
if ! grep -q 'separate-job-ok' "$WORKDIR/separate.out"; then
  echo "expected separate-job-ok from remote command" >&2
  exit 1
fi

echo "ok: passphrase-protected key works via direct askpass and via same-shell/separate agent-env jobs"
echo "fixture alias config: $SSH_CONFIG"
