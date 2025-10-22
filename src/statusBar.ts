import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

interface UsageData {
    session_5h: {
        pct_used: number;
        resets: string;
    };
    week_all_models: {
        pct_used: number;
        resets: string;
    };
    week_opus: {
        pct_used: number;
        resets: string;
    } | null;
    timestamp: Date;
}

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private usageData: UsageData | null = null;
    private extensionPath: string;

    constructor(context: vscode.ExtensionContext) {
        this.extensionPath = context.extensionPath;

        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        this.statusBarItem.command = 'claude-code-usage.fetchNow';
        this.statusBarItem.text = '$(cloud) Claude Code';
        this.statusBarItem.tooltip = 'Click to fetch Claude Code usage data';
        this.statusBarItem.show();

        context.subscriptions.push(this.statusBarItem);
    }

    /**
     * Create a visual progress bar string
     */
    private createProgressBar(percentage: number): string {
        const totalBars = 20;
        const filledBars = Math.round((percentage / 100) * totalBars);
        const emptyBars = totalBars - filledBars;

        const filled = '●'.repeat(filledBars);
        const empty = '○'.repeat(emptyBars);

        return filled + empty;
    }

    /**
     * Execute the claude_usage_capture.sh script and parse the output
     */
    private async executeUsageScript(): Promise<UsageData> {
        try {
            // Use the script from the extension directory, not the user's workspace
            const scriptPath = path.join(this.extensionPath, 'claude_usage_capture.sh');

            // Get the user's workspace directory to run claude CLI from there
            // This prevents "Do you trust this folder?" prompts
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            // Set WORKDIR env variable so the script executes 'claude' in user's workspace
            const env = {
                ...process.env,
                WORKDIR: workspaceFolder || process.cwd()
            };

            const { stdout } = await execAsync(scriptPath, { env });

            const parsed = JSON.parse(stdout.trim());

            if (!parsed.ok) {
                // Create a more specific error with the error code
                const errorWithCode = new Error(parsed.hint || 'Unknown error');
                (errorWithCode as any).code = parsed.error;
                throw errorWithCode;
            }

            return {
                session_5h: parsed.session_5h,
                week_all_models: parsed.week_all_models,
                week_opus: parsed.week_opus,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('Failed to execute usage script:', error);
            throw error;
        }
    }

    /**
     * Fetch usage data from Claude Code CLI
     */
    public async fetchUsage(): Promise<void> {
        try {
            this.usageData = await this.executeUsageScript();
            this.updateStatusBar();
        } catch (error) {
            console.error('Error fetching Claude Code usage:', error);

            const errorCode = (error as any).code;
            let statusText = '$(error) Claude Code Error';
            let tooltip = '';

            // Handle specific error cases with helpful messages
            if (errorCode === 'tui_failed_to_boot') {
                statusText = '$(warning) Claude Code Init Required';
                tooltip = [
                    '⚠️ Claude Code needs to be initialized in this workspace',
                    '',
                    'To fix this:',
                    '1. Open a terminal in VS Code',
                    '2. Run: claude',
                    '3. Accept the "Do you trust the files in this folder?" prompt',
                    '4. Exit Claude Code (Ctrl+C)',
                    '5. Click here to refresh usage data',
                    '',
                    'This only needs to be done once per workspace.'
                ].join('\n');
            } else if (errorCode === 'auth_required_or_cli_prompted_login') {
                statusText = '$(key) Claude Code Auth Required';
                tooltip = [
                    '🔑 Authentication required',
                    '',
                    'To fix this:',
                    '1. Open a terminal',
                    '2. Run: claude login',
                    '3. Follow the authentication steps',
                    '4. Click here to refresh usage data'
                ].join('\n');
            } else if (errorCode === 'claude_cli_not_found') {
                statusText = '$(warning) Claude CLI Not Found';
                tooltip = [
                    '⚠️ Claude CLI is not installed',
                    '',
                    'To fix this:',
                    '1. Install Claude CLI from:',
                    '   https://docs.claude.com',
                    '2. Restart VS Code',
                    '3. Click here to refresh usage data'
                ].join('\n');
            } else if (errorCode === 'tmux_not_found') {
                statusText = '$(warning) tmux Not Found';
                tooltip = [
                    '⚠️ tmux is required but not installed',
                    '',
                    'To fix this:',
                    '1. Install tmux:',
                    '   macOS: brew install tmux',
                    '   Linux: sudo apt install tmux',
                    '2. Click here to refresh usage data'
                ].join('\n');
            } else {
                // Generic error
                tooltip = `Failed to fetch usage: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }

            this.statusBarItem.text = statusText;
            this.statusBarItem.tooltip = tooltip;
            this.statusBarItem.color = new vscode.ThemeColor('editorWarning.foreground');

            // Don't re-throw to prevent error notifications
        }
    }

    /**
     * Update the status bar with current usage data
     */
    private updateStatusBar(): void {
        if (!this.usageData) {
            this.statusBarItem.text = '$(cloud) Claude Code';
            this.statusBarItem.tooltip = 'Click to fetch Claude Code usage data';
            this.statusBarItem.color = undefined;
            return;
        }

        // Choose icon and color based on session usage
        let icon = '$(check)';
        let color: vscode.ThemeColor | undefined;

        const sessionPercent = this.usageData.session_5h.pct_used;
        if (sessionPercent >= 90) {
            icon = '$(error)';
            color = new vscode.ThemeColor('errorForeground');
        } else if (sessionPercent >= 80) {
            icon = '$(warning)';
            color = new vscode.ThemeColor('editorWarning.foreground');
        } else {
            icon = '$(check)';
            color = new vscode.ThemeColor('editorInfo.foreground');
        }

        // Build status bar text
        this.statusBarItem.text = `${icon} Claude Code: ${sessionPercent}%`;
        this.statusBarItem.color = color;

        // Create detailed tooltip
        const tooltipLines: string[] = [];

        // Current session (5-hour) progress bar
        const sessionBar = this.createProgressBar(sessionPercent);
        tooltipLines.push(`Current session (5h)`);
        tooltipLines.push(`${sessionBar} ${sessionPercent}% used`);
        tooltipLines.push(`Resets: ${this.usageData.session_5h.resets}`);

        tooltipLines.push(''); // Empty line for spacing

        // Current week (all models) progress bar
        const weekPercent = this.usageData.week_all_models.pct_used;
        const weekBar = this.createProgressBar(weekPercent);
        tooltipLines.push(`Current week (all models)`);
        tooltipLines.push(`${weekBar} ${weekPercent}% used`);
        tooltipLines.push(`Resets: ${this.usageData.week_all_models.resets}`);

        // Add Opus usage if available and user has access (resets not empty)
        if (this.usageData.week_opus && this.usageData.week_opus.resets) {
            tooltipLines.push('');
            const opusPercent = this.usageData.week_opus.pct_used;
            const opusBar = this.createProgressBar(opusPercent);
            tooltipLines.push(`Current week (Opus)`);
            tooltipLines.push(`${opusBar} ${opusPercent}% used`);
            tooltipLines.push(`Resets: ${this.usageData.week_opus.resets}`);
        }

        // Add timestamp
        tooltipLines.push('');
        tooltipLines.push(`Last updated: ${this.usageData.timestamp.toLocaleTimeString()}`);

        this.statusBarItem.tooltip = tooltipLines.join('\n');
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.statusBarItem.dispose();
    }
}