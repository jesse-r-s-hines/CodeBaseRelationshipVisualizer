import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('codeStructureVisualization.start', () => {
            // Create and show panel
            const panel = vscode.window.createWebviewPanel(
                'codeStructureVisualization',
                'Code Structure Visualization',
                vscode.ViewColumn.One,
                {
                  enableScripts: true
                }
            );

            // And set its HTML content
            panel.webview.html = getWebviewContent();
          })
    );
}

function getWebviewContent() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Circle</title>
            <script src="https://d3js.org/d3.v7.min.js"></script>
        </head>
        <body>
            <svg id="canvas"></svg>
            <script>
                let [width, height] = [1000, 1000]
            
                const canvas = d3.select("#canvas")
                    .attr("viewBox", [0, 0, width, height])
                    .style("font", "10px sans-serif")
                    .attr("text-anchor", "middle");
        
                canvas.append("circle")
                    .attr("r", 450)
                    .attr("cx", 500).attr("cy", 500)
                    .attr("fill", "blue");
            </script>
        </body>
        </html>
  `  
}