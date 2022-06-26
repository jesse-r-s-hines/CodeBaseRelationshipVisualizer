import * as d3 from 'd3';
import { FileType, Directory, AnyFile, getExtension } from '../util';

/**
 * This is the class that renders the actual diagram.
 */
export default class CBRVWebview {
    canvas: SVGSVGElement
    codebase: Directory

    // Settings and constants for the diagram

    /** Size (width and height) of the svg viewbox (not the actual pixel size, that's dynamic) */
    viewBoxSize = 1000
    /** Margins of the svg diagram [top, right, bottom, left] */
    margins = [10, 5, 5, 5]
    /** Padding between file circles */
    filePadding = 3
    /** Directory outline stroke color */
    stroke = "#bbb"
    /** Directory outline stroke width */
    strokeWidth = 1;
    /** Padding between labels and the outline of each file circle */
    textPadding = 2

    /** Pass the selector for the canvas */
    constructor(canvas: string, codebase: Directory) {
        this.canvas = document.querySelector(canvas)!;
        this.codebase = codebase;
        this.draw();
    }

    draw() {
        this.drawDiagram();
    }

    drawDiagram() {
        const root = d3.hierarchy<AnyFile>(this.codebase, d => d.type == FileType.Directory ? d.children : undefined);

        // Compute size of folders
        root.sum(d => d.type == FileType.File ? d.size : 0);

        // Sort by descending size for pleasing layout
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Compute colors based on file extensions
        const extensions = new Set(root.descendants().map(d => getExtension(d.data.name)));
        const colorScale = d3.scaleOrdinal(extensions, d3.quantize(d3.interpolateRainbow, extensions.size));
        const fileColor = (d: AnyFile) => d.type == FileType.Directory ? "#fff" : colorScale(getExtension(d.name));

        // Compute stuff about the file
        const fullPath = (d: d3.HierarchyNode<AnyFile>) => d.ancestors().reverse().map(d => d.data.name).join("/");
        const ids = new Map<string, string>();
        const id = (d: d3.HierarchyNode<AnyFile>) => {
            const path = fullPath(d);
            if (!ids.has(path)) ids.set(path, `file-${ids.size}`);
            return ids.get(path)!;
        };

        // Make the circle packing diagram
        const [marginTop, marginRight, marginBottom, marginLeft] = this.margins;
        const packed = d3.pack<AnyFile>()
            .size([this.viewBoxSize - marginLeft - marginRight, this.viewBoxSize - marginTop - marginBottom])
            .padding(this.filePadding)(root);
    
        // render it to a SVG
        const svg = d3.select(this.canvas)
            // use negatives to add margin since pack() starts at 0 0
            .attr("viewBox", [-marginLeft, -marginTop, this.viewBoxSize, this.viewBoxSize])
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", 'middle')
            .attr("font-family", "sans-serif")
            .attr("font-size", 10);
    
        const node = svg.selectAll("g")
            .data(packed.descendants())
            .join("g")
            .attr("transform", d => `translate(${d.x},${d.y})`);

        // Draw the circles.
        const arc = d3.arc();
        node.append("path")
            .attr("id", d => id(d))
            // Use path instead of circle so we can use textPath on it for the folder name. -pi to pi so that the path
            // starts at the bottom and we don't cut off the name
            .attr("d", d => arc({innerRadius: 0, outerRadius: d.r, startAngle: -Math.PI, endAngle: Math.PI}))
            .attr("stroke", d => d.data.type == FileType.Directory ? this.stroke : "none") // only directories have an outline
            .attr("stroke-width", d => d.data.type == FileType.Directory ? this.strokeWidth : null)
            .attr("fill", d => fileColor(d.data))
            .attr("fill-opacity", d => d.data.type == FileType.Directory ? 0.0 : 1.0); // directories are transparent

        node.append("title")
            .text(d => fullPath(d));
    
        const files = node.filter(d => d.data.type == FileType.File); 
        files.append("text")
            .append("tspan")
                .attr("x", 0)
                .attr("y", 0)
                .text(d => d.data.name)
                .each((d, i, nodes) => this.ellipsisElementText(nodes[i], d.r * 2, this.textPadding));

        const folders = node.filter(d => d.data.type == FileType.Directory);

        // Add a "background" copy of the text with a stroke to provide contrast with the circle outline
        folders.append("text")
            .style("fill", "none")
            .style("stroke", "var(--vscode-editor-background)")
            .attr("stroke-width", 6)
            .append("textPath")
                .attr("href", d => `#${id(d)}`)
                .attr("startOffset", "50%")
                .text(d => d.data.name);

        // add a folder name at the top
        folders.append("text")
            .style("fill", "var(--vscode-editor-foreground)")
            .append("textPath")
                .attr("href", d => `#${id(d)}`)
                .attr("startOffset", "50%")
                .text(d => d.data.name);
    }
    
    /**
     * If el's text is wider than width, cut it and add an ellipsis until if fits. Returns the new text in the node.
     * There are pure CSS ways of doing this, but they don't seem to work in SVGs unless we do an foreignObject.
     */
    ellipsisElementText(el: SVGTextContentElement, width: number, padding = 0): string {
        let text = el.textContent ?? "";
        while (el.getComputedTextLength() > (width - 2 * padding) && text.length > 0) {
            text = text.slice(0, -1);
            el.textContent = text + "...";
        }
        return el.textContent!;
    }
}
