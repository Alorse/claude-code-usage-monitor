#!/usr/bin/env bash
#
# claude_usage_capture.sh
# Headless collector for Claude CLI "/usage" using detached tmux session
#
# Usage: ./claude_usage_capture.sh
# Output: JSON to stdout
# Exit codes:
#   0  - Success
#   12 - TUI failed to boot
#   13 - Auth required or CLI prompted login
#   14 - Claude CLI not found
#   15 - tmux not found
#   16 - Parsing failed
#

set -euo pipefail

# ============================================================================
# Configuration (override via environment)
# ============================================================================
MODEL="${MODEL:-sonnet}"
TIMEOUT_SECS="${TIMEOUT_SECS:-10}"
SLEEP_BOOT="${SLEEP_BOOT:-0.4}"
SLEEP_AFTER_USAGE="${SLEEP_AFTER_USAGE:-1.2}"
WORKDIR="${WORKDIR:-$(pwd)}"
SESSION_TIMEOUT_HOURS="${SESSION_TIMEOUT_HOURS:-5}"  # Claude sessions last 5 hours

# Calculate session timeout in seconds
SESSION_TIMEOUT_SECS=$((SESSION_TIMEOUT_HOURS * 3600))

# ============================================================================
# Error handling
# ============================================================================
error_json() {
    local code="$1"
    local hint="$2"
    cat <<EOF
{"ok":false,"error":"$code","hint":"$hint"}
EOF
}

# ============================================================================
# Helper functions for session management
# ============================================================================

# Generate unique session name based on workspace directory
get_session_name() {
    local workdir="$1"
    # Use MD5 hash of workdir to create unique but consistent session name
    local hash=$(echo -n "$workdir" | md5 -q 2>/dev/null || echo -n "$workdir" | md5sum | cut -d' ' -f1)
    echo "claude-usage-${hash:0:8}"
}

# Get timestamp file path for a session
get_timestamp_file() {
    local session_name="$1"
    echo "/tmp/${session_name}.timestamp"
}

# Check if session exists and is valid (< 5 hours old)
is_session_valid() {
    local label="$1"
    local session_name="$2"
    local timestamp_file=$(get_timestamp_file "$session_name")

    # Check if session exists
    if ! tmux -L "$label" has-session -t "$session_name" 2>/dev/null; then
        echo "DEBUG: Session $session_name does not exist" >&2
        return 1
    fi

    # Check timestamp file
    if [ ! -f "$timestamp_file" ]; then
        echo "DEBUG: Timestamp file not found for $session_name" >&2
        return 1
    fi

    # Read timestamp and check age
    local session_timestamp=$(cat "$timestamp_file" 2>/dev/null || echo "0")
    local current_time=$(date +%s)
    local age=$((current_time - session_timestamp))

    if [ $age -gt $SESSION_TIMEOUT_SECS ]; then
        echo "DEBUG: Session $session_name is too old (${age}s > ${SESSION_TIMEOUT_SECS}s)" >&2
        return 1
    fi

    echo "DEBUG: Session $session_name is valid (age: ${age}s)" >&2
    return 0
}

# Perform health check on existing session
session_health_check() {
    local label="$1"
    local session_name="$2"

    # Capture current pane content
    local output=$(tmux -L "$label" capture-pane -t "$session_name:0.0" -p 2>/dev/null || echo "")

    # Check for Claude indicators (boot message, prompt, etc.)
    if echo "$output" | grep -qE '(Claude Code v|Try "|Thinking on|tab to toggle|Current session|Status.*Config.*Usage)'; then
        echo "DEBUG: Session $session_name health check PASSED" >&2
        return 0
    fi

    echo "DEBUG: Session $session_name health check FAILED - no Claude indicators found" >&2
    return 1
}

# Update timestamp file after successful usage
update_timestamp() {
    local session_name="$1"
    local timestamp_file=$(get_timestamp_file "$session_name")
    date +%s > "$timestamp_file"
    echo "DEBUG: Updated timestamp for $session_name" >&2
}

# Kill session if it exists
kill_session_if_exists() {
    local label="$1"
    local session_name="$2"

    if tmux -L "$label" has-session -t "$session_name" 2>/dev/null; then
        echo "DEBUG: Killing existing session $session_name" >&2
        tmux -L "$label" kill-session -t "$session_name" 2>/dev/null || true
    fi
}

# Extract status information from Status tab
extract_status_info() {
    local status_output="$1"

    # Extract Version
    local version=$(echo "$status_output" | grep "Version:" | sed 's/.*Version: *//' | xargs || echo "unknown")

    # Extract Login method
    local login_method=$(echo "$status_output" | grep "Login method:" | sed 's/.*Login method: *//' | xargs || echo "unknown")

    # Extract Organization
    local organization=$(echo "$status_output" | grep "Organization:" | sed 's/.*Organization: *//' | xargs || echo "unknown")

    # Extract MCP servers - this is more complex as it's a list
    local mcp_line=$(echo "$status_output" | grep "MCP servers:" | sed 's/.*MCP servers: *//' || echo "")
    # Parse MCP servers: "clickup ✔,chrome-devtools ✔,..." → ["clickup", "chrome-devtools", ...]
    local mcp_servers="[]"
    if [ -n "$mcp_line" ]; then
        # Remove checkmarks and split by comma
        local servers=$(echo "$mcp_line" | sed 's/ ✔//g' | sed 's/,/","/g')
        if [ -n "$servers" ]; then
            mcp_servers="[\"$servers\"]"
        fi
    fi

    # Return JSON object
    cat <<EOF
{
  "version": "$version",
  "login_method": "$login_method",
  "organization": "$organization",
  "mcp_servers": $mcp_servers
}
EOF
}

# ============================================================================
# Cleanup trap
# ============================================================================
# Global flag to track if we should cleanup
SHOULD_CLEANUP=1

cleanup() {
    if [ "$SHOULD_CLEANUP" -eq 1 ]; then
        echo "DEBUG: Cleaning up session due to error" >&2
        tmux -L "$LABEL" kill-server 2>/dev/null || true
    else
        echo "DEBUG: Preserving session for reuse" >&2
    fi
}
trap cleanup EXIT

# ============================================================================
# Dependency checks
# ============================================================================

# Check tmux
if ! command -v tmux &>/dev/null; then
    echo "$(error_json tmux_not_found 'Install tmux: brew install tmux')"
    echo "ERROR: tmux not found" >&2
    exit 15
fi

# Check claude CLI
if ! command -v claude &>/dev/null; then
    echo "$(error_json claude_cli_not_found 'Install Claude CLI from https://docs.claude.com')"
    echo "ERROR: claude CLI not found on PATH" >&2
    exit 14
fi

# ============================================================================
# Session management: Create or reuse existing session
# ============================================================================

# Generate session name based on workspace
SESSION=$(get_session_name "$WORKDIR")
LABEL="$SESSION"  # Use same name for socket label

echo "DEBUG: Using session name: $SESSION for workspace: $WORKDIR" >&2

# Check if we can reuse existing session
SESSION_CREATED=0
if is_session_valid "$LABEL" "$SESSION"; then
    echo "DEBUG: Found valid existing session, attempting to reuse" >&2

    # Perform health check
    if session_health_check "$LABEL" "$SESSION"; then
        echo "DEBUG: Session health check passed, reusing session" >&2
        SESSION_CREATED=0
    else
        echo "DEBUG: Session health check failed, recreating session" >&2
        kill_session_if_exists "$LABEL" "$SESSION"
        SESSION_CREATED=1
    fi
else
    echo "DEBUG: No valid session found, creating new session" >&2
    kill_session_if_exists "$LABEL" "$SESSION"
    SESSION_CREATED=1
fi

# Create new session if needed
if [ $SESSION_CREATED -eq 1 ]; then
    echo "DEBUG: Creating new Claude session..." >&2

    tmux -L "$LABEL" new-session -d -s "$SESSION" \
        "cd '$WORKDIR' && env TERM=xterm-256color claude --model $MODEL" 2>/dev/null

    # Resize pane for predictable rendering
    tmux -L "$LABEL" resize-pane -t "$SESSION:0.0" -x 120 -y 32 2>/dev/null

    # Update timestamp for new session
    update_timestamp "$SESSION"
fi

# ============================================================================
# Wait for TUI to boot (only if new session was created)
# ============================================================================

if [ $SESSION_CREATED -eq 1 ]; then
    echo "DEBUG: Waiting for new session to boot..." >&2

    iterations=0
    max_iterations=$((TIMEOUT_SECS * 10 / 4))  # Convert timeout to iterations
    booted=false

    while [ $iterations -lt $max_iterations ]; do
        sleep "$SLEEP_BOOT"
        ((iterations++))

        output=$(tmux -L "$LABEL" capture-pane -t "$SESSION:0.0" -p 2>/dev/null || echo "")

        # Check for trust prompt first (handle before boot check)
        if echo "$output" | grep -q "Do you trust the files in this folder?"; then
            tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "1" Enter
            sleep 1.0
            continue  # Re-check in next iteration
        fi

        # Check for boot indicators
        if echo "$output" | grep -qE '(Claude Code v|Try "|Thinking on|tab to toggle)'; then
            # Make sure we're not on the trust prompt
            if ! echo "$output" | grep -q "Do you trust the files in this folder?"; then
                booted=true
                break
            fi
        fi

        # Check for auth errors
        if echo "$output" | grep -qE '(sign in|login|authentication|unauthorized|Please run.*claude login)'; then
            echo "$(error_json auth_required_or_cli_prompted_login 'Run: claude login')"
            echo "ERROR: Authentication required" >&2
            echo "$output" >&2
            exit 13
        fi
    done

    if [ "$booted" = false ]; then
        echo "$(error_json tui_failed_to_boot "TUI did not boot within ${TIMEOUT_SECS}s")"
        echo "ERROR: TUI failed to boot within ${TIMEOUT_SECS}s" >&2
        last_output=$(tmux -L "$LABEL" capture-pane -t "$SESSION:0.0" -p 2>/dev/null || echo "(capture failed)")
        echo "Last output:" >&2
        echo "$last_output" >&2
        exit 12
    fi
else
    echo "DEBUG: Reusing existing session, skipping boot wait" >&2
fi

# ============================================================================
# Capture Claude status from main screen and /usage Status tab
# ============================================================================

# Capture main screen to get Claude version and status info
echo "DEBUG: Capturing Claude status from main screen..." >&2
main_screen=$(tmux -L "$LABEL" capture-pane -t "$SESSION:0.0" -p -S -300 2>/dev/null || echo "")

# Extract version from header (e.g., "Claude Code v2.0.26")
version=$(echo "$main_screen" | grep -oE "Claude Code v[0-9]+\.[0-9]+\.[0-9]+" | sed 's/Claude Code v//' || echo "unknown")

# Initialize defaults - will be overwritten from Status tab
organization="N/A"
login_info="unknown"
mcp_servers_str="[]"

# ============================================================================
# Send /usage command to get usage data
# ============================================================================

# Send /usage
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "/" 2>/dev/null
sleep 0.2
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "usage" 2>/dev/null
sleep 0.3
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" Enter 2>/dev/null

# Wait for usage dialog to open (opens directly on Usage tab)
sleep "$SLEEP_AFTER_USAGE"

# ============================================================================
# Capture Status information from /usage dialog output
# ============================================================================

echo "DEBUG: Waiting for /usage dialog to load completely..." >&2
sleep 1

# Navigate to Status tab to see Version, Login method, Organization, MCP servers
# Current position is Usage, need to go backwards to Status
echo "DEBUG: Navigating backwards to Status tab..." >&2
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "BTab" 2>/dev/null || tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "S-Tab" 2>/dev/null
sleep 0.5
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "BTab" 2>/dev/null || tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "S-Tab" 2>/dev/null
sleep 0.5

# Capture the Status tab screen (use -S -500 to capture more lines)
echo "DEBUG: Capturing Status tab output..." >&2
usage_screen=$(tmux -L "$LABEL" capture-pane -t "$SESSION:0.0" -p -S -500 2>/dev/null || echo "")

# Extract organization from captured output
if echo "$usage_screen" | grep -q "Organization:"; then
    organization=$(echo "$usage_screen" | grep "Organization:" | sed 's/.*Organization: *//' | xargs || echo "N/A")
    echo "DEBUG: Organization extracted: '$organization'" >&2
fi

# Extract login method from captured output
if echo "$usage_screen" | grep -q "Login method:"; then
    login_info=$(echo "$usage_screen" | grep "Login method:" | sed 's/.*Login method: *//' | xargs || echo "unknown")
    echo "DEBUG: Login method extracted: '$login_info'" >&2
fi

# Extract MCP servers from captured output
if echo "$usage_screen" | grep -q "MCP servers:"; then
    # Extract MCP servers line (e.g., "MCP servers: clickup ✔,chrome-devtools ✔,chrome-mcp-stdio ✔,n8n-mcp ✔")
    mcp_line=$(echo "$usage_screen" | grep "MCP servers:" | sed 's/.*MCP servers: *//' | xargs || echo "")
    echo "DEBUG: MCP line extracted: '$mcp_line'" >&2

    if [ -n "$mcp_line" ] && [ "$mcp_line" != "unknown" ]; then
        # Step 1: Remove checkmarks (✔)
        mcp_clean=$(echo "$mcp_line" | sed 's/ ✔//g')
        echo "DEBUG: After removing checkmarks: '$mcp_clean'" >&2

        # Step 2: Convert comma-separated to JSON array using awk
        if [ -n "$mcp_clean" ]; then
            mcp_servers_str=$(echo "$mcp_clean" | awk -F',' '{
                result = "["
                for(i=1; i<=NF; i++) {
                    # Trim whitespace from each server name
                    gsub(/^[ \t]+|[ \t]+$/, "", $i)
                    if (length($i) > 0) {
                        if (i > 1) result = result ","
                        result = result "\"" $i "\""
                    }
                }
                result = result "]"
                print result
            }')
            echo "DEBUG: Final MCP JSON: '$mcp_servers_str'" >&2
        fi

        # Verify we got a valid JSON array
        if [ -z "$mcp_servers_str" ] || ! echo "$mcp_servers_str" | grep -q '^\[.*\]$'; then
            echo "DEBUG: MCP parsing failed, using empty array" >&2
            mcp_servers_str="[]"
        fi
    fi
fi

echo "DEBUG: Status data extracted (org: $organization, mcp: $mcp_servers_str)" >&2

# Navigate back to Usage tab for parsing usage data
echo "DEBUG: Navigating back to Usage tab..." >&2
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "Tab" 2>/dev/null
sleep 0.5
tmux -L "$LABEL" send-keys -t "$SESSION:0.0" "Tab" 2>/dev/null
sleep 0.5

# Build final status JSON with all captured data
status_json="{\"version\": \"$version\", \"login_method\": \"$login_info\", \"organization\": \"$organization\", \"mcp_servers\": $mcp_servers_str}"

echo "DEBUG: Final status JSON: $status_json" >&2

# ============================================================================
# Wait for usage data to load and parse it
# ============================================================================

# Retry logic for loading data
MAX_RETRIES=3
RETRY_DELAY=2
retry_count=0

while [ $retry_count -lt $MAX_RETRIES ]; do
    # Capture the usage screen
    usage_output=$(tmux -L "$LABEL" capture-pane -t "$SESSION:0.0" -p -S -300 2>/dev/null || echo "")

    # Check if data is still loading
    if echo "$usage_output" | grep -q "Loading usage data"; then
        echo "DEBUG: Usage data still loading, waiting..." >&2
        sleep "$RETRY_DELAY"
        ((retry_count++))
        continue
    fi

    # Extract Current session
    session_pct=$(echo "$usage_output" | grep -A2 "Current session" | grep "% used" | sed -E 's/.*[^0-9]([0-9]+)% used.*/\1/' || echo "")
    session_resets=$(echo "$usage_output" | grep -A2 "Current session" | grep "Resets" | sed 's/.*Resets *//' | xargs || echo "")

    # Extract Current week (all models)
    week_all_pct=$(echo "$usage_output" | grep -A2 "Current week (all models)" | grep "% used" | sed -E 's/.*[^0-9]([0-9]+)% used.*/\1/' || echo "")
    week_all_resets=$(echo "$usage_output" | grep -A2 "Current week (all models)" | grep "Resets" | sed 's/.*Resets *//' | xargs || echo "")

    # Extract Current week (Opus) - may not exist
    if echo "$usage_output" | grep -q "Current week (Opus)"; then
        week_opus_pct=$(echo "$usage_output" | grep -A2 "Current week (Opus)" | grep "% used" | sed -E 's/.*[^0-9]([0-9]+)% used.*/\1/' || echo "")
        week_opus_resets=$(echo "$usage_output" | grep -A2 "Current week (Opus)" | grep "Resets" | sed 's/.*Resets *//' | xargs || echo "")
        week_opus_json="{\"pct_used\": $week_opus_pct, \"resets\": \"$week_opus_resets\"}"
    else
        week_opus_json="null"
    fi

    # Validate we got data
    if [ -z "$session_pct" ] || [ -z "$week_all_pct" ]; then
        echo "DEBUG: Failed to parse data (attempt $((retry_count + 1))/$MAX_RETRIES)" >&2
        sleep "$RETRY_DELAY"
        ((retry_count++))
        continue
    fi

    # Success - we have data!
    break
done

# Final validation after retries
if [ -z "$session_pct" ] || [ -z "$week_all_pct" ]; then
    echo "$(error_json parsing_failed 'Failed to extract usage data from TUI after retries')"
    echo "ERROR: Failed to parse usage data after $MAX_RETRIES retries" >&2
    echo "Captured output:" >&2
    echo "$usage_output" >&2
    exit 16
fi

# ============================================================================
# Output JSON
# ============================================================================

# Update timestamp for successful usage
update_timestamp "$SESSION"

# Don't cleanup session on successful exit - preserve for reuse
SHOULD_CLEANUP=0

cat <<EOF
{
  "ok": true,
  "source": "tmux-capture",
  "status": $status_json,
  "session_5h": {
    "pct_used": $session_pct,
    "resets": "$session_resets"
  },
  "week_all_models": {
    "pct_used": $week_all_pct,
    "resets": "$week_all_resets"
  },
  "week_opus": $week_opus_json
}
EOF

exit 0
