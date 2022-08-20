import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, VisualizationSettings } from '../shared';
import { getExtension, clamp, filterFileTree } from '../util';
import { cropLine, ellipsisElementText, Point } from './rendering';

/**
 * This is the class that renders the actual diagram.
 */
export default class CBRVWebview {
    canvas: SVGSVGElement
    settings: VisualizationSettings
    codebase: Directory
    connections: Connection[]

    // Settings and constants for the diagram

    /** Margins of the svg diagram */
    margins = { top: 10, right: 5, bottom: 5, left: 5 }
    /** Padding between file circles */
    filePadding = 20
    /** Directory outline stroke color */
    directoryStrokeColor = "#bbb"
    /** Directory outline stroke width */
    directoryStrokeWidth = 1;
    /** Padding between labels and the outline of each file circle */
    textPadding = 2

    // Some rendering variables
    /** Size (width and height) of the svg viewbox (not the actual pixel size, that's dynamic) */
    width = 1000
    height = 1000
    
    /** Maps keys to uniq ids */
    ids = new Map<string, number>()


    /** Pass the selector for the canvas */
    constructor(canvas: string, codebase: Directory, settings: VisualizationSettings, connections: Connection[]) {
        this.canvas = document.querySelector(canvas)!;
        // filter empty directories
        this.codebase = filterFileTree(codebase, f => !(f.type == FileType.Directory && f.children.length == 0));
        this.settings = settings;
        this.connections = connections;
        this.draw();
    }

    draw() {
        this.drawDiagram();
    }

    drawDiagram() {
        const root = d3.hierarchy<AnyFile>(this.codebase, d => d.type == FileType.Directory ? d.children : undefined);

        // Compute size of folders
        root.sum(d => d.type == FileType.File ? clamp(d.size, 16, 1024 ** 2) : 0);

        // Sort by descending size for pleasing layout
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Compute colors based on file extensions
        const extensions = new Set(root.descendants().map(d => getExtension(d.data.name)));
        const colorScale = d3.scaleOrdinal(extensions, d3.quantize(d3.interpolateRainbow, extensions.size));
        const fileColor = (d: AnyFile) => d.type == FileType.Directory ? "#fff" : colorScale(getExtension(d.name));

        const margins = this.margins;

        // Make the circle packing diagram
        const packed = d3.pack<AnyFile>()
            .size([this.width - margins.left - margins.right, this.height - margins.top - margins.bottom ])
            .padding(this.filePadding)(root);
    
        const pathMap: Map<string, d3.HierarchyCircularNode<AnyFile>> = new Map();
        packed.each((d) =>
            pathMap.set(this.fullPath(d), d)
        );

        // render it to a SVG
        const svg = d3.select(this.canvas)
            // use negatives to add margin since pack() starts at 0 0.
            .attr("viewBox", [ -margins.left, - margins.top, this.width, this.height ]) // minX, minY, width, height
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", 'middle')
            .attr("font-family", "sans-serif")
            .attr("font-size", 10);

        const defs = svg.append("defs");
        const arrowColors = [...new Set(this.connections.map(c => c.color ?? this.settings.color))];

        const arrows = defs.selectAll("marker")
            .data(arrowColors)
            .join("marker")
                .classed("arrow-head", true)
                .attr("id", color => this.getId(color, 'arrow'))
                .attr("viewBox", "0 0 10 10")
                .attr("refX", 5)
                .attr("refY", 5)
                .attr("markerWidth", 6)
                .attr("markerHeight", 6)
                .attr("orient", "auto-start-reverse");
        arrows.append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z")
            .attr("fill", d => d);
    
        const svgBody = svg.append("g");

        const fileSection = svgBody.append('g')
            .classed("file-section", true);

        const nodes = fileSection.selectAll(".file, .directory")
            .data(packed.descendants())
            .join("g")
                .classed("file", d => d.data.type == FileType.File)
                .classed("directory", d => d.data.type == FileType.Directory)
                .attr("transform", d => `translate(${d.x},${d.y})`);

        // Draw the circles.
        const arc = d3.arc();
        nodes.append("path")
            .attr("id", d => this.getId(this.fullPath(d)))
            // Use path instead of circle so we can use textPath on it for the folder name. -pi to pi so that the path
            // starts at the bottom and we don't cut off the name
            .attr("d", d => arc({innerRadius: 0, outerRadius: d.r, startAngle: -Math.PI, endAngle: Math.PI}))
            .attr("stroke", d => d.data.type == FileType.Directory ? this.directoryStrokeColor : "none") // only directories have an outline
            .attr("stroke-width", d => d.data.type == FileType.Directory ? this.directoryStrokeWidth : null)
            .attr("fill", d => fileColor(d.data))
            .attr("fill-opacity", d => d.data.type == FileType.Directory ? 0.0 : 1.0); // directories are transparent

        nodes.append("title")
            .text(d => this.fullPath(d));
    
        const files = nodes.filter(d => d.data.type == FileType.File); 
        files.append("text")
            .append("tspan")
                .attr("x", 0)
                .attr("y", 0)
                .text(d => d.data.name)
                .each((d, i, nodes) => ellipsisElementText(nodes[i], d.r * 2, d.r * 2, this.textPadding));

        const folders = nodes.filter(d => d.data.type == FileType.Directory);

        // Add a "background" copy of the text with a stroke to provide contrast with the circle outline
        folders.append("text")
            .style("fill", "none")
            .style("stroke", "var(--vscode-editor-background)")
            .style("dominant-baseline", 'middle')
            .attr("stroke-width", 6)
            .append("textPath")
                .attr("href", d => `#${this.getId(this.fullPath(d))}`)
                .attr("startOffset", "50%")
                .text(d => d.data.name)
                .each((d, i, nodes) => ellipsisElementText(nodes[i], Math.PI * d.r /* 1/2 circumference */));

        // add a folder name at the top
        folders.append("text")
            .style("fill", "var(--vscode-editor-foreground)")
            .style("dominant-baseline", 'middle')
            .append("textPath")
                .attr("href", d => `#${this.getId(this.fullPath(d))}`)
                .attr("startOffset", "50%")
                .text(d => d.data.name)
                .each((d, i, nodes) => ellipsisElementText(nodes[i], Math.PI * d.r /* 1/2 circumference */));


        const connectionSection = svgBody.append('g')
            .classed("connection-section", true);

        const link = d3.link(d3.curveCatmullRom); // TODO find a better curve
        const connections = connectionSection.selectAll(".connection")
            .data(this.connections)
            .join("path")
                .classed("connection", true)
                .attr("stroke-width", conn => conn.strokeWidth ?? this.settings.strokeWidth)
                .attr("stroke", conn => conn.color ?? this.settings.color)
                .attr("fill", "none")
                .attr("marker-end",
                    conn => this.settings.directed ? `url(#${this.getId(conn.color ?? this.settings.color, 'arrow')})` : null
                )
                .attr("d", conn => {
                    // TODO normalize conn before this and check for valid from/to
                    const from = pathMap.get(typeof conn.from == 'string' ? conn.from : conn.from.file)!;
                    const to = pathMap.get(typeof conn.to == 'string' ? conn.to : conn.to.file)!;
                    const [source, target] = cropLine([[from.x, from.y], [to.x, to.y]], from.r, to.r);
                    return link({ source, target });
                });

        const zoom = d3.zoom().on('zoom', (e) => this.handleZoom(e));
        zoom(svg as any);
    }

    // TODO maybe factor this out into its own id generator class
    getId(key: string, prefix = "") {
        if (!this.ids.has(key)) this.ids.set(key, this.ids.size);
        return `${prefix}${this.ids.get(key)}`;
    }

    fullPath(d: d3.HierarchyNode<AnyFile>): string {
        return d.ancestors().reverse().slice(1).map(d => d.data.name).join("/");
    }

    handleZoom(e: d3.D3ZoomEvent<SVGSVGElement, Connection>) {
        d3.select(this.canvas).select("g").attr('transform', e.transform.toString());
    }
}
