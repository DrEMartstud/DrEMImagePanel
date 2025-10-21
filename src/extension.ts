import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let currentPanel: vscode.WebviewPanel | undefined = undefined;

    const disposable = vscode.commands.registerCommand('drem-image-panel.showImage', () => {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'imageViewer',
                'Image Viewer',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(path.join(context.extensionPath, 'media'))
                    ]
                }
            );

            const imagePath = vscode.Uri.file(
                path.join(context.extensionPath, 'media', 'image.jpg')
            );

            const imageSrc = currentPanel.webview.asWebviewUri(imagePath);

            currentPanel.webview.html = getWebviewContent(imageSrc);

            currentPanel.onDidDispose(
                () => {
                    currentPanel = undefined;
                },
                undefined,
                context.subscriptions
            );
        }
    });

    context.subscriptions.push(disposable);
}

function getWebviewContent(imageSrc: vscode.Uri): string {
    return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Image Viewer</title>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: var(--vscode-editor-background);
                }
                img {
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                }
            </style>
        </head>
        <body>
            <img src="${imageSrc}" alt="Example Image">
        </body>
        </html>`;
}