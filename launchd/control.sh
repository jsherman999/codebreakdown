#!/bin/bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.jay.codebreakdown
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Codebreakdown"

case "${1:-status}" in
  install)
    NODE_BIN="$(command -v node)"
    PORT="${CODEBREAKDOWN_PORT:-8788}"
    if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
      echo 'CODEBREAKDOWN_PORT must be between 1024 and 65535.' >&2
      exit 1
    fi
    cd "$APP_DIR"
    npm run build
    mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
    python3 - "$PLIST" "$APP_DIR" "$NODE_BIN" "$PORT" "$LOG_DIR" "$LABEL" <<'PY'
import os, plistlib, sys
plist, app, node, port, logs, label = sys.argv[1:]
config = {
    'Label': label,
    'ProgramArguments': ['/bin/bash', app + '/launchd/run.sh'],
    'WorkingDirectory': app,
    'EnvironmentVariables': {
        'PATH': os.path.dirname(node) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        'CODEBREAKDOWN_NODE': node,
        'CODEBREAKDOWN_PORT': port,
    },
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 30,
    'ExitTimeOut': 20,
    'Umask': 0o077,
    'StandardOutPath': logs + '/stdout.log',
    'StandardErrorPath': logs + '/stderr.log',
}
with open(plist + '.tmp', 'wb') as f:
    plistlib.dump(config, f)
os.chmod(plist + '.tmp', 0o600)
os.replace(plist + '.tmp', plist)
PY
    plutil -lint "$PLIST"
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL"
    fi
    launchctl enable "$DOMAIN/$LABEL"
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed $LABEL on port $PORT."
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    ;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL"
    ;;
  start)
    launchctl bootstrap "$DOMAIN" "$PLIST"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL"
    ;;
  logs)
    tail -n 60 "$LOG_DIR/stdout.log" "$LOG_DIR/stderr.log"
    ;;
  uninstall)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL"
    fi
    if [[ -f "$PLIST" ]]; then
      python3 - "$PLIST" <<'PY'
import os, sys
os.unlink(sys.argv[1])
PY
    fi
    echo 'LaunchAgent removed; source and logs retained.'
    ;;
  *)
    echo "Usage: $0 {install|start|stop|restart|status|logs|uninstall}" >&2
    exit 2
    ;;
esac
