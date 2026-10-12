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

SHIM_DIR="$HOME/.goldsky/proxy-shim"
export PATH="$HOME/.local/bin:$HOME/.goldsky/bin:$PATH"

# The Goldsky CLI bundles an axios release that sends absolute-form requests to HTTPS_PROXY.
# The cloud session proxy accepts only CONNECT tunnels. This preload sends Node HTTPS through
# a CONNECT agent, and makes axios skip its own proxy handling for Goldsky hosts.
install_goldsky_proxy_shim() {
	[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] || return 0
	mkdir -p "$SHIM_DIR" "$HOME/.local/bin" || return 1
	(cd "$SHIM_DIR" && npm init -y >/dev/null && npm install --no-fund --no-audit https-proxy-agent@7) || return 1
	cat >"$SHIM_DIR/preload.cjs" <<'EOF'
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
	const { HttpsProxyAgent } = require("https-proxy-agent");
	require("https").globalAgent = new HttpsProxyAgent(proxy);
	const hosts = ".goldsky.com,goldsky.com";
	for (const k of ["NO_PROXY", "no_proxy"]) process.env[k] = process.env[k] ? `${process.env[k]},${hosts}` : hosts;
}
EOF
	# ~/.local/bin precedes the npm global bin in PATH, so `goldsky` resolves to this wrapper.
	cat >"$HOME/.local/bin/goldsky" <<EOF
#!/usr/bin/env bash
NODE_OPTIONS="\${NODE_OPTIONS:-} --require $SHIM_DIR/preload.cjs" exec node "$(npm root -g)/@goldskycom/cli/bin/goldsky" "\$@"
EOF
	chmod +x "$HOME/.local/bin/goldsky"
}

install_clis() {
	echo "Installing vercel, neonctl and the Goldsky CLI..."
	npm install -g --no-fund --no-audit vercel neonctl @goldskycom/cli || return 1
	install_goldsky_proxy_shim || return 1
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
