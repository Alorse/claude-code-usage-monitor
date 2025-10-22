# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based VSCode extension that monitors Claude Code CLI usage directly in VS Code. It's part of a dual-extension structure:
- **Parent directory** (`../`): JavaScript-based extension using Puppeteer to scrape Claude.ai web interface (v2.0.13)
- **This directory**: TypeScript-based extension using shell script to capture Claude Code CLI usage (v0.0.1)

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
  "claudeCodeUsage.autoRefreshMinutes": 5      // Refresh interval
}
```

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
- `vscode.window.createStatusBarItem()` - Status bar UI
- `vscode.commands.registerCommand()` - Command registration
- `vscode.workspace.getConfiguration()` - Settings access
- `vscode.window.showInformationMessage()` - User notifications
- Timer-based auto-refresh using `setInterval()`

## Testing Considerations

When testing this extension:
1. Ensure Claude Code CLI is installed and authenticated
2. Verify tmux is available on system
3. Check that shell script has execute permissions
4. Test both manual fetch and auto-refresh
5. Verify status bar updates correctly
6. Test configuration changes take effect
7. Check error handling when CLI is unavailable

## Known Limitations

- Requires Claude Code CLI to be installed and authenticated
- Shell script approach is Unix/Linux/macOS specific (tmux dependency)
- No Windows support without WSL or similar Unix environment
- Single metric (CLI usage) vs parent's dual metrics

## Relationship to Parent Extension

This is an experimental TypeScript variant of the main extension. Users should choose:
- **Parent extension** (`../`): Full-featured with dual metrics, cross-platform, production-ready
- **This extension**: Lightweight CLI-based approach, Unix-only, experimental

Both extensions can coexist but may show different usage values (Claude.ai monthly vs CLI session).
