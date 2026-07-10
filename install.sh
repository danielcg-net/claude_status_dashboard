#!/usr/bin/env bash
# Claude Status Dashboard — installer
# Usage: curl -fsSL https://raw.githubusercontent.com/danielcg-net/claude_status_dashboard/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/danielcg-net/claude_status_dashboard.git"
INSTALL_DIR="${CLAUDE_DASHBOARD_DIR:-$HOME/.claude-status-dashboard}"
DASHBOARD_URL="${CLAUDE_STATUS_API_URL:-http://localhost:8787}"

# ── colours ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; RESET='\033[0m'
else
  BOLD=''; GREEN=''; YELLOW=''; RED=''; RESET=''
fi

step()  { echo -e "\n${BOLD}${GREEN}==>${RESET}${BOLD} $*${RESET}"; }
info()  { echo -e "   ${YELLOW}→${RESET} $*"; }
error() { echo -e "\n${RED}Error:${RESET} $*" >&2; exit 1; }

# ── preflight ──────────────────────────────────────────────────────────────────
step "Checking prerequisites"

command -v git   >/dev/null 2>&1 || error "git is required but not installed."
command -v docker >/dev/null 2>&1 || error "Docker is required but not installed. See https://docs.docker.com/get-docker/"
command -v claude >/dev/null 2>&1 || error "Claude Code CLI is required but not installed. See https://claude.ai/code"

docker info >/dev/null 2>&1 || error "Docker daemon is not running. Please start Docker and try again."

info "git, docker, claude CLI — all present"

# ── clone or update ────────────────────────────────────────────────────────────
step "Setting up repository at $INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Already cloned — pulling latest changes"
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning $REPO_URL"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── start dashboard ────────────────────────────────────────────────────────────
step "Starting dashboard container"

CONTAINER_RUNNING=$(docker ps --filter "name=claude-status-dashboard" --filter "status=running" --quiet)
if [ -n "$CONTAINER_RUNNING" ]; then
  info "Container already running — skipping rebuild"
else
  # Build only when the container is not already up (avoids unnecessary rebuilds on re-runs)
  docker compose -f "$INSTALL_DIR/compose.yml" up --build -d
fi

info "Waiting for dashboard to be ready..."
for i in $(seq 1 20); do
  if curl -sf "$DASHBOARD_URL/api/sessions" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$i" -eq 20 ]; then
    error "Dashboard did not start within 20 seconds. Check logs with:\n  docker compose -f $INSTALL_DIR/compose.yml logs"
  fi
done

info "Dashboard is up at $DASHBOARD_URL"

# ── install claude code plugin ─────────────────────────────────────────────────
step "Installing Claude Code plugin"

if claude plugin list 2>/dev/null | grep -q "claude-status-dashboard"; then
  info "Plugin already installed — skipping"
else
  # Add marketplace only if not already present
  if ! claude plugin marketplace list 2>/dev/null | grep -q "danielcg-net/claude_status_dashboard"; then
    info "Adding marketplace"
    claude plugin marketplace add danielcg-net/claude_status_dashboard --scope user
  fi

  info "Installing plugin"
  claude plugin install claude-status-dashboard@claude-status-dashboard --scope user
fi

# ── done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}✓ Claude Status Dashboard installed successfully!${RESET}"
echo ""
echo -e "  Dashboard:    ${BOLD}$DASHBOARD_URL${RESET}"
echo -e "  Repo:         ${BOLD}$INSTALL_DIR${RESET}"
echo ""
echo -e "  Start a Claude Code session in any project and your dashboard"
echo -e "  will update automatically."
echo ""
echo -e "  To stop the dashboard:"
echo -e "    ${BOLD}docker compose -f $INSTALL_DIR/compose.yml down${RESET}"
echo ""
echo -e "  To start it again later:"
echo -e "    ${BOLD}docker compose -f $INSTALL_DIR/compose.yml up -d${RESET}"
echo ""
