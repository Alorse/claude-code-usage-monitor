import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

interface UsageData {
    status?: {
        version: string;
        login_method: string;
        organization: string;
        mcp_servers: string[];
    };
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
     * Create a beautiful SVG progress bar
     */
    private createProgressBar(percentage: number): string {
        const width = 200;
        const height = 8;
        const borderRadius = height / 2;

        const filledWidth = Math.max(0, Math.min(width, (percentage / 100) * width));
        const fillColor = this.getUsageColor(percentage);
        const backgroundColor = '#e0e0e0';

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}" fill="${backgroundColor}" />
  ${filledWidth > 0 ? `<rect x="0" y="0" width="${filledWidth}" height="${height}" rx="${borderRadius}" ry="${borderRadius}" fill="${fillColor}" />` : ''}
</svg>`;

        const svgBase64 = Buffer.from(svg.trim()).toString('base64');
        return `<img src="data:image/svg+xml;base64,${svgBase64}" alt="Progress ${percentage}%" width="${width}" height="${height}" />`;
    }

    /**
     * Get color based on usage percentage
     */
    private getUsageColor(percentage: number): string {
        if (percentage >= 90) return '#d63031'; // Danger red
        if (percentage >= 75) return '#f39c12'; // Warning orange
        if (percentage >= 50) return '#27ae60'; // Caution green
        return '#3498db'; // Normal blue
    }

    /**
     * Create a formatted usage section for the tooltip
     * @param title - Section title (e.g., "Current Session (5h)")
     * @param percentage - Usage percentage (0-100)
     * @param resetInfo - Reset time information
     * @returns Formatted HTML string for the section
     */
    private createUsageSection(title: string, percentage: number, resetInfo: string): string {

        const progressBar = this.createProgressBar(percentage);
        const sectionDiv = '<div style="padding:10px">';
        const titleLine = `<b>${title}</b><br/>`;
        const progressLine = `${progressBar}&nbsp;&nbsp;<strong>${percentage}% used</strong><br/>`;
        const resetLine = `<small style="font-size:10px;opacity:0.8;line-height:0.9;"><i>Resets ${resetInfo}</i></small>`;
        const closingDiv = '</div>';

        // Combine all parts
        return sectionDiv + titleLine + progressLine + resetLine + closingDiv + '\n\n';
    }

    /**
     * Create a formatted status section for the tooltip
     * Shows Claude version, plan, and active MCP servers
     * @returns Formatted HTML string for the status section
     */
    private createStatusSection(): string {
        if (!this.usageData?.status) {
            return '';
        }

        const status = this.usageData.status;

        const sectionDiv = '<br /><div style="padding:10px;border-top:1px solid #ddd;margin-top:10px">';
        const versionLine = `<small style="font-size:10px;line-height:1.5;"><strong>Claude Code </strong> v${status.version} | `;
        const planLine = ` ${status.login_method}<br/>`;

        let mcpLine = '';
        if (status.mcp_servers && status.mcp_servers.length > 0) {
            mcpLine = `<strong>MCP Servers:</strong> ${status.mcp_servers.join('✔ , ')}</small>`;
        } else {
            mcpLine = '</small>';
        }
        const closingDiv = '</div>';

        // Combine all parts
        return sectionDiv + versionLine + planLine + mcpLine + closingDiv + '\n\n';
    }

    /**
     * Execute the claude_usage_capture.sh script and parse the output
     */
    private async executeUsageScript(): Promise<UsageData> {
        let scriptOutput: string | undefined;

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
            scriptOutput = stdout;

        } catch (error: any) {
            // execAsync throws when exit code != 0, but script writes JSON to stdout
            // Check if error has stdout (script ran but exited with error code)
            if (error.stdout) {
                scriptOutput = error.stdout;
            } else {
                // Handle execution errors (script not found, permission denied, etc.)
                console.error('Failed to execute usage script:', error);
                this.statusBarItem.text = '$(error) Script Error';
                this.statusBarItem.tooltip = `Failed to execute script: ${error instanceof Error ? error.message : 'Unknown error'}`;
                this.statusBarItem.color = new vscode.ThemeColor('errorForeground');
                throw error;
            }
        }

        // Parse the JSON output (whether from success or error)
        if (!scriptOutput) {
            throw new Error('No output from script');
        }

        try {
            const parsed = JSON.parse(scriptOutput.trim());

            if (!parsed.ok) {
                // Handle error from script - error code comes as string from JSON
                const errorCode = parsed.error as string;
                this.handleScriptError(errorCode, parsed.hint);
                throw new Error(errorCode);
            }

            // Success - return the data
            return {
                status: parsed.status,
                session_5h: parsed.session_5h,
                week_all_models: parsed.week_all_models,
                week_opus: parsed.week_opus,
                timestamp: new Date()
            };

        } catch (parseError) {
            // If we already threw a script error, re-throw it
            if (parseError instanceof Error && parseError.message.startsWith('Script failed:')) {
                throw parseError;
            }

            // JSON parsing failed
            console.error('Failed to parse script output:', parseError);
            this.statusBarItem.text = '$(error) Parse Error';
            this.statusBarItem.tooltip = `Failed to parse script output: ${scriptOutput}`;
            this.statusBarItem.color = new vscode.ThemeColor('errorForeground');
            throw parseError;
        }
    }

    /**
     * Handle script error codes and update status bar with helpful messages
     */
    private handleScriptError(errorCode: string, hint?: string): void {
        let statusText = '$(error) Claude Code Error';
        let tooltip = '';

        // Map error codes from the bash script to user-friendly messages
        switch (errorCode) {
            case 'tui_failed_to_boot':
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
                break;

            case 'auth_required_or_cli_prompted_login':
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
                break;

            case 'claude_cli_not_found':
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
                break;

            case 'tmux_not_found':
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
                break;

            case 'parsing_failed':
                statusText = '$(error) Parsing Failed';
                tooltip = [
                    '⚠️ Failed to parse usage data from Claude CLI',
                    '',
                    'This may indicate:',
                    '- Claude CLI was updated and output format changed',
                    '- Network issues while fetching usage',
                    '',
                    'Try:',
                    '1. Run: claude',
                    '2. Manually check /usage command works',
                    '3. Click here to retry'
                ].join('\n');
                break;

            default:
                // Generic error with hint from script
                tooltip = hint || `Unknown error: ${errorCode}`;
                break;
        }

        this.statusBarItem.text = statusText;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.color = new vscode.ThemeColor('editorWarning.foreground');
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

            const errorCode = (error as any).message;
            console.log('Error code:', errorCode);
            let statusText = '$(error) Claude Code Error';
            let tooltip = '';

            // Handle specific error cases with helpful messages
            if (errorCode === 'tui_failed_to_boot') {
                statusText = '$(warning) Claude Code Init Required';
                tooltip = [
                    '⚠️ Claude Code needs to be initialized in this workspace',
                    '',
                    'To fix this:',
                    '1. Open a terminal in your editor',
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

        // Create rich tooltip with HTML and Markdown
        const tooltip = new vscode.MarkdownString();
        tooltip.supportThemeIcons = true;
        tooltip.isTrusted = true;
        tooltip.supportHtml = true;

        tooltip.appendMarkdown(`\n\n`);
        tooltip.appendMarkdown(`<b>$(pulse) Claude Code Usage</b>\n\n`);

        // Current session (5-hour)
        tooltip.appendMarkdown(
            this.createUsageSection(
                'Current Session (5h)',
                sessionPercent,
                this.usageData.session_5h.resets
            )
        );
        tooltip.appendMarkdown(`\n\n`);

        // Current week (all models)
        const weekPercent = this.usageData.week_all_models.pct_used;
        tooltip.appendMarkdown(
            this.createUsageSection(
                'Current Week (All Models)',
                weekPercent,
                this.usageData.week_all_models.resets
            )
        );
        tooltip.appendMarkdown(`\n\n`);

        // Add Opus usage if available and user has access (resets not empty)
        if (this.usageData.week_opus && this.usageData.week_opus.resets) {
            const opusPercent = this.usageData.week_opus.pct_used;
            tooltip.appendMarkdown(
                this.createUsageSection(
                    'Current Week (Opus)',
                    opusPercent,
                    this.usageData.week_opus.resets
                )
            );
            tooltip.appendMarkdown(`\n\n`);
        }

        // Add Claude status information if available
        tooltip.appendMarkdown(this.createStatusSection());

        // Footer with timestamp
        tooltip.appendMarkdown(`$(refresh) Last updated: ${this.usageData.timestamp.toLocaleTimeString()}`);

        this.statusBarItem.tooltip = tooltip;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.statusBarItem.dispose();
    }
}