import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, VisualizationSettings } from '../shared';
import { getExtension, clamp, filterFileTree, Lazy, UniqIdGenerator } from '../util';
import { cropLine, ellipsisElementText } from './rendering';

/**
 * This is the class that renders the actual diagram.
 */
export default class CBRVWebview {
    settings: VisualizationSettings
    codebase: Directory
    connections: Connection[]

    // Settings and constants for the diagram

    /** Size (width and height) of the diagram within the svg viewbox (in viewbox units) */
    diagramSize = 1000
    /** Margins of the svg diagram (in viewbox units). The viewbox will be diagramSize plus these. */
    margins = { top: 10, right: 5, bottom: 5, left: 5 }
    /** Padding between file circles */
    filePadding = 20
    /** Padding between labels and the outline of each file circle */
    textPadding = 2
    /** Maximum area of file circles (in viewbox units) */
    minFileSize = 16
    /** Minimum area of file circles (in viewbox units) */
    maxFileSize = 1024 ** 2
    /** Radius when a directory's contents will be hidden (in px) */
    dynamicZoomBreakPoint = 16

    // Parts of the d3 diagram

    diagram: d3.Selection<SVGSVGElement, unknown, null, undefined>
    defs: d3.Selection<SVGDefsElement, unknown, null, undefined>
    zoomWindow: d3.Selection<SVGGElement, unknown, null, undefined>
    fileGroup: d3.Selection<SVGGElement, unknown, null, undefined>
    connectionGroup: d3.Selection<SVGGElement, unknown, null, undefined>

    // Some rendering variables

    /** Actual pixel width of the svg diagram */
    width = 0
    /** Actual pixel height of the svg diagram */
    height = 0
    /** Maps keys to uniq ids */
    ids: UniqIdGenerator = new UniqIdGenerator();
    /** Maps filepaths to hierarchy nodes */
    pathMap: Map<string, d3.HierarchyCircularNode<AnyFile>> = new Map();


    /** Pass the selector for the canvas svg */
    constructor(diagram: string, codebase: Directory, settings: VisualizationSettings, connections: Connection[]) {
        // filter empty directories
        this.codebase = filterFileTree(codebase, f => !(f.type == FileType.Directory && f.children.length == 0));
        this.settings = settings;
        this.connections = connections;

        // Create the SVG
        const { top, right, bottom, left } = this.margins;
        this.diagram = d3.select(document.querySelector(diagram) as SVGSVGElement)
            // use negatives to add margin since pack() starts at 0 0. Viewbox is [minX, minY, width, height]
            .attr("viewBox", [ -left, -top, left + this.diagramSize + right, top + this.diagramSize + bottom]);

        this.defs = this.diagram.append("defs");

        this.zoomWindow = this.diagram.append("g").classed("zoom-window", true);

        this.fileGroup = this.zoomWindow.append("g").classed("file-group", true);
        this.connectionGroup = this.zoomWindow.append("g").classed("connection-group", true);

        const zoom = d3.zoom().on('zoom', (e) => this.handleZoom(e));
        zoom(this.diagram as any);

        this.updateFiles();
    }

    updateFiles() {
        const root = d3.hierarchy<AnyFile>(this.codebase, f => f.type == FileType.Directory ? f.children : undefined);
        // Compute size of files and folders
        root.sum(d => d.type == FileType.File ? clamp(d.size, this.minFileSize, this.maxFileSize) : 0);
        // Sort by descending size for layout purposes
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Use d3 to calculate the circle packing layout
        const packed = d3.pack<AnyFile>()
            .size([this.diagramSize, this.diagramSize])
            .padding(this.filePadding)(root);
    
        // Store a map of paths to nodes for future use in connections
        this.pathMap = new Map();
        packed.each((d) =>
            this.pathMap.set(this.fullPath(d), d)
        );
        // TODO maybe wipe id map?

        this.updateSize(); // get the actual size of the svg

        const nodes = this.fileGroup.selectAll(".file, .directory")
            .data(packed.descendants().filter(d => !d.parent || !this.shouldHideContents(d.parent)))
            .join("g")
                .classed("file", d => d.data.type == FileType.File)
                .classed("directory", d => d.data.type == FileType.Directory)
                .attr("transform", d => `translate(${d.x},${d.y})`);

        // Draw the circles.
        const arc = d3.arc();
        const colorScale = this.getColorScale(new Lazy(root.descendants()).map(x => x.data));
        nodes.append("path")
            .attr("id", d => this.ids.get(this.fullPath(d)))
            // Use path instead of circle so we can use textPath on it for the folder name. -pi to pi so that the path
            // starts at the bottom and we don't cut off the name
            .attr("d", d => arc({innerRadius: 0, outerRadius: d.r, startAngle: -Math.PI, endAngle: Math.PI}))
            .attr("fill", d => colorScale(d.data));


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

        // add a folder name at the top
        // Add a "background" copy of the label first with a wider stroke to provide contrast with the circle outline
        // If we weren't using textPath, we could use paint-order to make stroke an outline, but textPath causes the
        // stroke to cover other characters
        folders.append("text")
            .classed("label-background", true)
            .append("textPath")
                .attr("href", d => `#${this.ids.get(this.fullPath(d))}`)
                .attr("startOffset", "50%")
                .text(d => d.data.name)
                .each((d, i, nodes) => ellipsisElementText(nodes[i], Math.PI * d.r /* 1/2 circumference */));

        folders.append("text")
            .classed("label-foreground", true)
            .append("textPath")
                .attr("href", d => `#${this.ids.get(this.fullPath(d))}`)
                .attr("startOffset", "50%")
                .text(d => d.data.name)
                .each((d, i, nodes) => ellipsisElementText(nodes[i], Math.PI * d.r /* 1/2 circumference */));
        // TODO could ellipsisElementText return different values for background and foreground?
        // TODO the labels look weird on small folders, and can overlap other folders labels

        // TODO make this show an elipsis or something
        folders
            .classed("contents-hidden", this.shouldHideContents);

        this.updateConnections();
    }

    updateConnections() {
        const arrowColors = [...new Set(new Lazy(this.connections).map(c => c.color ?? this.settings.color))];

        const arrows = this.defs.selectAll("marker.arrow")
            .data(arrowColors)
            .join("marker")
                .classed("arrow", true)
                .attr("id", color => this.ids.get(color, 'arrow'))
                .attr("viewBox", "0 0 10 10")
                .attr("refX", 5)
                .attr("refY", 5)
                .attr("markerWidth", 6)
                .attr("markerHeight", 6)
                .attr("orient", "auto-start-reverse");
        arrows.append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z")
            .attr("fill", d => d);

        const link = d3.link(d3.curveCatmullRom); // TODO find a better curve
        const connections = this.connectionGroup.selectAll(".connection")
            .data(this.connections)
            .join("path")
                .classed("connection", true)
                .attr("stroke-width", conn => conn.strokeWidth ?? this.settings.strokeWidth)
                .attr("stroke", conn => conn.color ?? this.settings.color)
                .attr("marker-end",
                    conn => this.settings.directed ? `url(#${this.ids.get(conn.color ?? this.settings.color, 'arrow')})` : null
                )
                .attr("d", conn => {
                    // TODO normalize conn before this and check for valid from/to
                    const from = this.pathMap.get(typeof conn.from == 'string' ? conn.from : conn.from.file)!;
                    const to = this.pathMap.get(typeof conn.to == 'string' ? conn.to : conn.to.file)!;
                    const [source, target] = cropLine([[from.x, from.y], [to.x, to.y]], from.r, to.r);
                    return link({ source, target });
                });
    }

    /** Returns a function used to compute color from file extension */
    getColorScale(files: Iterable<AnyFile>): (d: AnyFile) => string | null {
        const extensions = new Set<string>();
        for (const file of files) {
            extensions.add(getExtension(file.name));
        }
        const colorScale = d3.scaleOrdinal(extensions, d3.quantize(d3.interpolateRainbow, extensions.size));
        return (d: AnyFile) => {
            return d.type == FileType.Directory ? null : colorScale(getExtension(d.name));
        };
    }

    fullPath(d: d3.HierarchyNode<AnyFile>): string {
        return d.ancestors().reverse().slice(1).map(d => d.data.name).join("/");
    }

    shouldHideContents(d: d3.HierarchyCircularNode<AnyFile>) {
        return false;
        const viewToRenderedRatio = Math.min(this.width, this.height) / this.diagramSize;
        return d.data.type == FileType.Directory && !!d.parent && d.r * viewToRenderedRatio <= this.dynamicZoomBreakPoint;
    }

    updateSize() {
        const rect = this.diagram.node()!.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
    }

    handleZoom(e: d3.D3ZoomEvent<SVGSVGElement, Connection>) {
        this.zoomWindow.attr('transform', e.transform.toString());
    }
}
