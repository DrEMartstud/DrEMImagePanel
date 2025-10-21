import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let imagePanel: vscode.WebviewPanel | undefined = undefined;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('DREM Image Panel activated');

    // Создаем кнопку в Status Bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(file-media)";
    statusBarItem.tooltip = "Open Image Panel";
    statusBarItem.command = 'drem-image-panel.openImagePanel';
    statusBarItem.show();

    // Регистрируем команду для открытия панели
    const openImagePanelCommand = vscode.commands.registerCommand('drem-image-panel.openImagePanel', () => {
        createImagePanel(context);
    });

    // Регистрируем провайдер для Activity Bar
    const settingsViewProvider = new SettingsViewProvider(context.extensionUri);
    const settingsViewRegistration = vscode.window.registerWebviewViewProvider(
        SettingsViewProvider.viewType,
        settingsViewProvider
    );

    // Зарегистрировать провайдер для вкладки в Explorer — показываем картинку в explorer view
    const explorerImageProvider = new ExplorerImageViewProvider(context.extensionUri);
    const explorerViewRegistration = vscode.window.registerWebviewViewProvider(
        'drem-image-explorer',
        explorerImageProvider
    );

    context.subscriptions.push(
        openImagePanelCommand,
        settingsViewRegistration,
        explorerViewRegistration,
        statusBarItem
    );
}

function createImagePanel(context: vscode.ExtensionContext) {
    if (imagePanel) {
        imagePanel.reveal();
        return;
    }

    imagePanel = vscode.window.createWebviewPanel(
        'dremImagePanel',
        'DREM Image',
        vscode.ViewColumn.Beside,
        {
            enableScripts: false,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(context.extensionPath),
                ...(vscode.workspace.workspaceFolders ? 
                    vscode.workspace.workspaceFolders.map(f => f.uri) : [])
            ]
        }
    );

    updateImagePanelContent(context);

    imagePanel.onDidDispose(
        () => {
            imagePanel = undefined;
        },
        null,
        context.subscriptions
    );

    // Обновляем контент при изменении конфигурации (уточнено ключевая настройка)
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('dremImagePanel.imagePath') && imagePanel) {
            updateImagePanelContent(context);
        }
    });
}

function updateImagePanelContent(context: vscode.ExtensionContext) {
    if (!imagePanel) {
        return;
    }

    const config = vscode.workspace.getConfiguration('dremImagePanel');
    const imagePath = config.get('imagePath') as string;

    let imageHtml: string;

    if (imagePath && isValidImageSource(imagePath)) {
        if (imagePath.startsWith('http')) {
            // Для URL изображений используем напрямую
            imageHtml = `<img src="${imagePath}" alt="DREM Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
        } else {
            // Для локальных файлов используем asWebviewUri
            try {
                const imageUri = vscode.Uri.file(imagePath);

                // Ensure the image folder is allowed by the webview
                const imageFolder = vscode.Uri.file(path.dirname(imagePath));
                const existingRoots = imagePanel.webview.options.localResourceRoots || [];
                const alreadyHas = existingRoots.some(u => u.toString() === imageFolder.toString());
                if (!alreadyHas) {
                    const newRoots = [...existingRoots, imageFolder];
                    // Assign a new options object — localResourceRoots is readonly on the options object itself
                    imagePanel.webview.options = {
                        ...imagePanel.webview.options,
                        localResourceRoots: newRoots
                    };
                }

                const webviewUri = imagePanel.webview.asWebviewUri(imageUri);
                imageHtml = `<img src="${webviewUri}" alt="DREM Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
            } catch (error) {
                // Если ошибка преобразования URI, используем дефолтное изображение
                imageHtml = getDefaultImageHtml(context);
            }
        }
    } else {
        // Используем дефолтную картинку
        imageHtml = getDefaultImageHtml(context);
    }

    imagePanel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background-color: var(--vscode-editor-background);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    overflow: hidden;
                }
            </style>
        </head>
        <body>
            ${imageHtml}
        </body>
        </html>`;
}

function getDefaultImageHtml(context: vscode.ExtensionContext): string {
    // Создаем дефолтное изображение как data URI (простейший PNG)
    const defaultImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    return `<img src="${defaultImage}" alt="Default Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
}

// Класс для панели настроек в Activity Bar
class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'drem-image-config';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this._updateWebview();

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'selectImage':
                    await this.selectImageFile();
                    break;
                case 'updateImagePath':
                    await this.updateImagePath(data.value);
                    break;
                case 'clearImagePath':
                    await this.updateImagePath('');
                    break;
            }
        });
    }

    private _updateWebview() {
        if (this._view) {
            const config = vscode.workspace.getConfiguration('dremImagePanel');
            const currentImagePath = config.get('imagePath') as string;

            this._view.webview.html = this._getHtmlForWebview(currentImagePath);
        }
    }

    private _getHtmlForWebview(currentImagePath: string): string {
        const hasImage = currentImagePath && currentImagePath.length > 0;
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 20px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: 13px;
                        line-height: 1.4;
                    }
                    h2 {
                        margin-top: 0;
                        color: var(--vscode-titleBar-activeForeground);
                    }
                    .section {
                        margin-bottom: 20px;
                    }
                    .current-path {
                        background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        padding: 8px;
                        border-radius: 2px;
                        margin: 10px 0;
                        word-break: break-all;
                        font-size: 12px;
                        min-height: 20px;
                    }
                    .path-valid {
                        border-color: var(--vscode-testing-iconPassed);
                    }
                    .path-invalid {
                        border-color: var(--vscode-testing-iconFailed);
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 2px;
                        cursor: pointer;
                        margin-right: 8px;
                        margin-bottom: 8px;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    button.secondary {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                    .status {
                        font-size: 12px;
                        margin: 5px 0;
                        padding: 4px;
                        border-radius: 2px;
                    }
                    .status-success {
                        background: var(--vscode-inputValidation-infoBackground);
                        color: var(--vscode-inputValidation-infoForeground);
                    }
                    .status-error {
                        background: var(--vscode-inputValidation-errorBackground);
                        color: var(--vscode-inputValidation-errorForeground);
                    }
                    .instructions {
                        background: var(--vscode-textBlockQuote-background);
                        border-left: 3px solid var(--vscode-textBlockQuote-border);
                        padding: 10px;
                        margin: 15px 0;
                    }
                    .instruction-step {
                        margin: 8px 0;
                    }
                </style>
            </head>
            <body>
                <h2>DREM Image Panel Settings</h2>
                
                <div class="section">
                    <h3>Current Image Path</h3>
                    <div class="current-path ${hasImage ? 'path-valid' : 'path-invalid'}" id="currentPath">
                        ${currentImagePath || 'No image configured (using default)'}
                    </div>
                    
                    <div class="status ${hasImage ? 'status-success' : 'status-error'}" id="statusMessage">
                        ${hasImage ? '✓ Image path is configured' : 'ℹ Using default image'}
                    </div>
                    
                    <button onclick="selectImage()">Select Local Image</button>
                    <button onclick="showUrlInput()">Enter Image URL</button>
                    ${hasImage ? '<button class="secondary" onclick="clearImagePath()">Clear Image Path</button>' : ''}
                </div>

                <div class="section">
                    <h3>How to Use</h3>
                    <div class="instructions">
                        <div class="instruction-step">1. Click the image icon in the Status Bar (bottom right) to open the image panel</div>
                        <div class="instruction-step">2. Use the buttons above to set your image source</div>
                        <div class="instruction-step">3. Supported formats: JPG, PNG, GIF, WebP, SVG, BMP</div>
                        <div class="instruction-step">4. GIF animations are supported and will play automatically</div>
                        <div class="instruction-step">5. The image panel can be moved to any editor area</div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function selectImage() {
                        vscode.postMessage({ type: 'selectImage' });
                    }

                    function showUrlInput() {
                        const url = prompt('Enter image URL (http/https):');
                        if (url) {
                            vscode.postMessage({ type: 'updateImagePath', value: url });
                        }
                    }

                    function clearImagePath() {
                        if (confirm('Clear current image path?')) {
                            vscode.postMessage({ type: 'clearImagePath' });
                        }
                    }
                </script>
            </body>
            </html>`;
    }

    private async selectImageFile() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Select Image',
            filters: {
                'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'],
                'All Files': ['*']
            }
        });

        if (uris && uris[0]) {
            await this.updateImagePath(uris[0].fsPath);
        }
    }

    private async updateImagePath(newPath: string) {
        await vscode.workspace.getConfiguration('dremImagePanel')
            .update('imagePath', newPath, vscode.ConfigurationTarget.Global);
        
        if (newPath) {
            vscode.window.showInformationMessage(`Image path updated: ${path.basename(newPath)}`);
        } else {
            vscode.window.showInformationMessage('Image path cleared - using default image');
        }

        this._updateWebview();
    }
}

function isValidImageSource(imagePath: string): boolean {
    if (!imagePath) {
        return false;
    }

    if (imagePath.startsWith('http')) {
        return true;
    }

    try {
        return fs.existsSync(imagePath);
    } catch {
        return false;
    }
}

export function deactivate() {
    if (imagePanel) {
        imagePanel.dispose();
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}

// Класс для отображения изображения в виде вкладки в Explorer
// Провайдер для отображения картинки в view Explorer (contributes.views -> explorer)
class ExplorerImageViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token?: vscode.CancellationToken
    ) {
        // Разрешаем доступ к локальным ресурсам (extension + workspace)
        webviewView.webview.options = {
            ...webviewView.webview.options,
            enableScripts: false,
            localResourceRoots: [
                this._extensionUri,
                ...(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map(f => f.uri) : [])
            ]
        };

        const config = vscode.workspace.getConfiguration('dremImagePanel');
        const imagePath = config.get('imagePath') as string;

        let imageHtml: string;
        const defaultImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

        if (imagePath && isValidImageSource(imagePath)) {
            if (imagePath.startsWith('http')) {
                imageHtml = `<img src="${imagePath}" alt="DREM Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
            } else {
                try {
                    const imageUri = vscode.Uri.file(imagePath);
                    // Добавляем папку изображения в локальные корни (переопределяем options)
                    const imageFolder = vscode.Uri.file(path.dirname(imagePath));
                    const existingRoots = webviewView.webview.options.localResourceRoots || [];
                    const alreadyHas = existingRoots.some(u => u.toString() === imageFolder.toString());
                    const newRoots = alreadyHas ? existingRoots : [...existingRoots, imageFolder];

                    webviewView.webview.options = {
                        ...webviewView.webview.options,
                        localResourceRoots: newRoots
                    };

                    const webviewUri = webviewView.webview.asWebviewUri(imageUri);
                    imageHtml = `<img src="${webviewUri}" alt="DREM Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
                } catch {
                    imageHtml = `<img src="${defaultImage}" alt="Default Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
                }
            }
        } else {
            imageHtml = `<img src="${defaultImage}" alt="Default Image" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
        }

        webviewView.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { margin:0; padding:0; display:flex; align-items:center; justify-content:center; height:100vh; background:var(--vscode-editor-background); }
                </style>
            </head>
            <body>
                ${imageHtml}
            </body>
            </html>
        `;

        // Обновление при изменении конфигурации
        const disposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('dremImagePanel.imagePath')) {
                // повторно отрисовать
                this.resolveWebviewView(webviewView, _context, _token);
            }
        });

        webviewView.onDidDispose(() => disposable.dispose());
    }
}