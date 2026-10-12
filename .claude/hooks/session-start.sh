#!/usr/bin/env bash
# Install and check the backend service CLIs at the start of each Claude Code cloud session.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# Put the goldsky proxy wrapper and the turbo binary first in PATH for the session's commands.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
	echo 'export PATH="$HOME/.local/bin:$HOME/.goldsky/bin:$PATH"' >>"$CLAUDE_ENV_FILE"
fi

# The script reports failed checks and exits 0, so a service problem does not block the session.
bash "${CLAUDE_PROJECT_DIR:-.}/scripts/cloud-setup.sh"
