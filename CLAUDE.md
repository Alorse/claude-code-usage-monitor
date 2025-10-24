# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based VSCode extension that monitors Claude Code CLI usage directly in VS Code. It's part of a dual-extension structure:
- **Parent directory** (`../`): JavaScript-based extension using Puppeteer to scrape Claude.ai web interface (v2.0.13)
- **This directory**: TypeScript-based extension using shell script to capture Claude Code CLI usage (v0.0.5)

Both extensions share similar architecture but use different data sources:
- Parent: Web scraping via Puppeteer → Claude.ai monthly usage
- This: Shell script via tmux → Claude Code CLI session usage

## Build & Development Commands

```bash
# Development
npm install                 # Install dependencies
npm run compile             # Compile TypeScript to JavaScript
npm run watch              # Watch mode for development (auto-recompile)

# Quality Assurance
npm run lint               # Run ESLint on TypeScript files
npm run pretest            # Run compile + lint (pre-test setup)
npm test                   # Run test suite

# Packaging
npm run vscode:prepublish  # Prepare for publishing (runs compile)
vsce package              # Package extension as .vsix file
```

## TypeScript Configuration

- **Target**: ES2020
- **Module**: CommonJS
- **Output**: `./out/` directory
- **Source**: `./src/` directory
- **Strict mode**: Enabled
- **Source maps**: Generated for debugging

## Architecture & Key Components

### Extension Entry Point (`src/extension.ts`)

The main extension file that:
- Activates on VS Code startup (`onStartupFinished`)
- Registers commands (`claude-code-usage.fetchNow`)
- Manages status bar UI
- Coordinates data fetching via shell script
- Handles configuration changes

### Status Bar Manager (`src/statusBar.ts`)

Manages the status bar UI component that displays usage information:
- Shows token usage percentage
- Color-coded indicators (green/orange/red based on usage)
- Clickable to trigger manual refresh
- Tooltip with detailed information

**Key Methods:**
- `executeUsageScript()`: Spawns the shell script, handles both success and error responses
- `handleScriptError()`: Maps error codes from the shell script to user-friendly messages
- `fetchUsage()`: Public API to trigger a fetch operation; handles errors gracefully
- `updateStatusBar()`: Renders the status bar with usage data, progress bars, and tooltips
- `createProgressBar()`: Generates a visual bar representation of usage percentages

### Data Flow & Error Handling

The extension implements a sophisticated error handling system with specific error codes:

**Happy Path**: Extension activation → Shell script execution → JSON parsing → Status bar update

**Error Handling**: When the shell script encounters issues, it returns JSON with `ok: false` and an error code:
- `tui_failed_to_boot`: Claude TUI didn't initialize (requires `claude` init in workspace)
- `auth_required_or_cli_prompted_login`: Claude CLI authentication needed (`claude login`)
- `claude_cli_not_found`: Claude CLI not installed on system
- `tmux_not_found`: tmux package not available
- `parsing_failed`: Unable to parse usage data from CLI output

Each error code maps to a helpful tooltip with instructions for the user, displayed in the status bar with appropriate icons and colors.

### Data Fetching Strategy

Unlike the parent extension's Puppeteer approach, this variant uses:
- **Shell script**: `claude_usage_capture.sh` (bash script in root)
- **tmux sessions**: Detached headless session management
- **CLI parsing**: Regex extraction from `claude` CLI output
- **JSON output**: Returns structured data with error codes

The shell script approach is lighter-weight than Puppeteer but requires:
- Claude Code CLI installed and authenticated
- tmux available on system
- bash shell environment

## Configuration Options

Available in VS Code settings under "Claude Code Usage Monitor":

```json
{
  "claudeCodeUsage.fetchOnStartup": true,      // Auto-fetch on startup
  "claudeCodeUsage.autoRefreshMinutes": 5      // Refresh interval (0 disables auto-refresh)
}
```

## Environment Variables

The extension passes environment variables to the shell script:
- `WORKDIR`: Set to the user's workspace folder to ensure `claude` commands run from the correct directory. This prevents "Do you trust this folder?" prompts and ensures the CLI operates in the expected context.

## Extension Integration Points

The extension integrates with VS Code through these mechanisms:
- **Activation Event**: `onStartupFinished` - Activates after VS Code fully initializes
- **Status Bar**: Right-aligned item with priority 100, clickable to trigger manual refresh
- **Commands**: `claude-code-usage.fetchNow` - Exposed in command palette as "Fetch Claude Code Usage Now"
- **Configuration**: Workspace-aware settings that update live via `onDidChangeConfiguration` listener
- **Auto-refresh**: Timer-based polling that respects configuration changes without restarting extension

## Key Architectural Differences from Parent

1. **Data Source**:
   - Parent: Web scraping (Claude.ai settings page)
   - This: CLI parsing (Claude Code CLI output)

2. **Browser Dependency**:
   - Parent: Requires Puppeteer + Chromium (~150-200MB)
   - This: Requires tmux + Claude Code CLI (minimal)

3. **Authentication**:
   - Parent: Browser session persistence with cookies
   - This: Uses existing Claude Code CLI authentication

4. **Fetch Speed**:
   - Parent: 2-10 seconds (browser launch + navigation)
   - This: ~1-3 seconds (shell script execution)

5. **Session Tracking**:
   - Parent: Dual metrics (Claude.ai + session-data.json)
   - This: Single metric (Claude Code CLI usage)

## Important Files

- `extension.ts` - Main extension logic
- `statusBar.ts` - Status bar UI component
- `tsconfig.json` - TypeScript compiler configuration
- `package.json` - Extension manifest and dependencies
- `../claude_usage_capture.sh` - Shell script for CLI usage capture (shared with parent)

## Development Workflow

1. Make changes to TypeScript files in `src/`
2. Run `npm run compile` (or `npm run watch` for auto-compile)
3. Press F5 in VS Code to launch Extension Development Host
4. Test the extension functionality
5. Run `npm run lint` to check code quality
6. Update version in `package.json`
7. Run `vsce package` to create `.vsix`
8. Test installation of packaged extension

## Packaging Workflow

After packaging a new version:

```bash
# Package new version
vsce package

# Move old versions to archive (keep latest in root)
mv claude-code-usage-monitor-*.vsix ../archive/
# But keep the latest version in current directory
```

This maintains a clean directory structure with version history preserved.

## Extension Activation

- **Trigger**: `onStartupFinished` - Activates after VS Code fully loads
- **Lazy loading**: Extension only activates when needed (minimal impact on startup)
- **Commands**: Registered in `package.json` and bound to TypeScript functions

## VS Code API Usage

This extension uses:
- `vscode.window.createStatusBarItem()` - Status bar UI with theme colors and markdown tooltips
- `vscode.commands.registerCommand()` - Command registration for manual refresh
- `vscode.workspace.getConfiguration()` - Settings access with live change listeners
- `vscode.workspace.workspaceFolders` - Retrieves workspace folder for WORKDIR environment variable
- `vscode.ThemeColor()` - Color-coded status bar based on usage levels
- `vscode.MarkdownString()` - Rich formatted tooltips with progress bars and emojis
- Timer-based auto-refresh using `setInterval()` with proper cleanup on deactivation

## Debugging the Extension

To debug the extension:

1. **Open Extension Development Host**: Press F5 in VS Code (with the extension folder open)
2. **View Console Output**: In the development host window, open Developer Tools (Help → Toggle Developer Tools)
3. **Check Extension Logs**: Look for logs from `console.log()` calls in `extension.ts` and `statusBar.ts`
4. **Debug Script Execution**: The shell script output is parsed as JSON; check `statusBar.ts` line ~100-106 for parsing logic
5. **Error Investigation**: When errors occur, the extension logs them with `console.error()` - check the console for detailed error messages
6. **Configuration Changes**: Test configuration updates by opening VS Code Settings and changing `autoRefreshMinutes` - watch the console for "Auto-refresh interval updated" messages

**Common Issues During Development:**
- If the extension doesn't activate, verify `onStartupFinished` event is firing
- If status bar doesn't update, check that `StatusBarManager.fetchUsage()` completes without throwing
- If tooltips don't show, verify `UsageData` interface matches shell script JSON output
- If auto-refresh doesn't work, check that timer intervals are calculated correctly (`minutes * 60 * 1000`)

## Testing Considerations

When testing this extension:
1. Ensure Claude Code CLI is installed and authenticated
2. Verify tmux is available on system
3. Check that shell script has execute permissions
4. Test both manual fetch and auto-refresh
5. Verify status bar updates correctly
6. Test configuration changes take effect
7. Check error handling when CLI is unavailable

## Key Architectural Decisions

**Why Shell Script Instead of Direct CLI?**
Using a tmux-based shell script approach (rather than spawning Claude CLI directly) provides:
- Headless TUI interaction without blocking the extension
- Ability to control stdin/stdout in a detached session
- Isolation of CLI state from the extension process
- Graceful timeout handling and process cleanup

**Error Propagation Pattern:**
The shell script returns JSON for both success and error cases. The extension doesn't throw exceptions on CLI errors (authentication, init required, etc.) but instead displays helpful tooltips. This provides a better UX than error notifications.

**Status Bar Priority & Alignment:**
The status bar item is right-aligned with priority 100 to ensure visibility next to other common items like notifications and language mode indicator.

**Tooltip Formatting:**
Tooltips use VS Code's MarkdownString with theme icons (`$(error)`, `$(warning)`, etc.) and emojis for intuitive visual feedback. Progress bars are rendered with Unicode characters (● for filled, ○ for empty) which display correctly in all contexts.

## Known Limitations

- Requires Claude Code CLI to be installed and authenticated
- Shell script approach is Unix/Linux/macOS specific (tmux dependency)
- No Windows support without WSL or similar Unix environment
- Single metric (CLI usage) vs parent's dual metrics
- Extension state is not persisted; usage data is re-fetched on each refresh

## Relationship to Parent Extension

This is an experimental TypeScript variant of the main extension. Users should choose:
- **Parent extension** (`../`): Full-featured with dual metrics, cross-platform, production-ready
- **This extension**: Lightweight CLI-based approach, Unix-only, experimental

Both extensions can coexist but may show different usage values (Claude.ai monthly vs CLI session).
