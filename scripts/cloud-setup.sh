#!/usr/bin/env bash
# Install and check the backend service CLIs for a Claude Code cloud session.
#
# Usage:
#   bash scripts/cloud-setup.sh          Install the CLIs, then run the read-only checks.
#   bash scripts/cloud-setup.sh --check  Run the read-only checks only.
#
# Each CLI reads its token from the environment. Set the tokens as environment secrets,
# never in git:
#   VERCEL_TOKEN    Vercel access token (vercel.com/account/tokens).
#   NEON_API_KEY    Neon API key (console.neon.tech, Account settings, API keys).
#   GOLDSKY_TOKEN   Goldsky API key for the Namepass project (app.goldsky.com, Settings).
# Optional:
#   VERCEL_SCOPE    Vercel team slug for the namepass-v2 project.
#
# The checks only read account and project data. They do not deploy, apply a pipeline or
# change a database. The script does not print token values.
set -uo pipefail

export PATH="$HOME/.goldsky/bin:$PATH"

install_clis() {
	echo "Installing vercel, neonctl and the Goldsky CLI..."
	npm install -g --no-fund --no-audit vercel neonctl @goldskycom/cli || return 1
	# `goldsky turbo` needs a separate binary. --force skips the interactive prompt.
	goldsky turbo install --force || return 1
}

check() {
	local name=$1 var=$2
	shift 2
	if [ -z "${!var:-}" ]; then
		echo "SKIP  $name: $var is not set."
		return 0
	fi
	if "$@" >/dev/null 2>&1; then
		echo "OK    $name"
	else
		echo "FAIL  $name: the request failed. Check $var and the network policy."
		failed=1
	fi
}

run_checks() {
	failed=0
	echo "CLI versions:"
	echo "  vercel  $(vercel --version 2>/dev/null | tail -n1)"
	echo "  neonctl $(neonctl --version 2>/dev/null)"
	echo "  goldsky $(goldsky --version 2>/dev/null | grep -E '^[0-9]' | head -n1)"
	echo "  turbo   $(goldsky turbo --version 2>/dev/null | tail -n1)"

	local scope=()
	[ -n "${VERCEL_SCOPE:-}" ] && scope=(--scope "$VERCEL_SCOPE")
	check "Vercel (whoami)" VERCEL_TOKEN vercel whoami --token "${VERCEL_TOKEN:-}" "${scope[@]}"
	check "Neon (projects list)" NEON_API_KEY neonctl projects list --api-key "${NEON_API_KEY:-}"
	check "Goldsky (login)" GOLDSKY_TOKEN goldsky login --token "${GOLDSKY_TOKEN:-}" --no-browser
	check "Goldsky Turbo (list)" GOLDSKY_TOKEN goldsky turbo list
	return "$failed"
}

if [ "${1:-}" != "--check" ]; then
	install_clis || { echo "CLI installation failed." >&2; exit 1; }
fi
# A missing or rejected token must not fail session setup. Report it and continue.
run_checks || echo "One or more service checks failed. See the lines above."
exit 0
