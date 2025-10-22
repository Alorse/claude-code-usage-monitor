import * as vscode from 'vscode';
import { StatusBarManager } from './statusBar';

let statusBarManager: StatusBarManager;
let autoRefreshTimer: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Claude Code Usage Monitor is now active!');

    // Create status bar manager
    statusBarManager = new StatusBarManager(context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('claude-code-usage.fetchNow', async () => {
            try {
                await statusBarManager.fetchUsage();
            } catch (error) {
                console.error('Error fetching Claude Code usage:', error);
            }
        })
    );

    // Get configuration
    const config = vscode.workspace.getConfiguration('claudeCodeUsage');

    // Fetch on startup if configured
    if (config.get('fetchOnStartup', true)) {
        setTimeout(async () => {
            try {
                await statusBarManager.fetchUsage();
            } catch (error) {
                console.error('Failed to fetch usage on startup:', error);
            }
        }, 2000); // Wait 2 seconds after activation
    }

    // Set up auto-refresh
    const autoRefreshMinutes = config.get('autoRefreshMinutes', 5);
    if (autoRefreshMinutes > 0) {
        autoRefreshTimer = setInterval(async () => {
            try {
                await statusBarManager.fetchUsage();
            } catch (error) {
                console.error('Failed to auto-refresh usage:', error);
            }
        }, autoRefreshMinutes * 60 * 1000);

        console.log(`Auto-refresh enabled: checking usage every ${autoRefreshMinutes} minutes`);
    }

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('claudeCodeUsage.autoRefreshMinutes')) {
                // Clear existing timer
                if (autoRefreshTimer) {
                    clearInterval(autoRefreshTimer);
                    autoRefreshTimer = undefined;
                }

                // Restart with new configuration
                const newConfig = vscode.workspace.getConfiguration('claudeCodeUsage');
                const newAutoRefresh = newConfig.get('autoRefreshMinutes', 5);

                if (newAutoRefresh > 0) {
                    autoRefreshTimer = setInterval(async () => {
                        try {
                            await statusBarManager.fetchUsage();
                        } catch (error) {
                            console.error('Failed to auto-refresh usage:', error);
                        }
                    }, newAutoRefresh * 60 * 1000);

                    console.log(`Auto-refresh interval updated to ${newAutoRefresh} minutes`);
                }
            }
        })
    );
}

export function deactivate() {
    // Clean up timer
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = undefined;
    }

    // Clean up status bar
    if (statusBarManager) {
        statusBarManager.dispose();
    }
}