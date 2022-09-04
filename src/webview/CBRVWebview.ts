import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, VisualizationSettings } from '../shared';
import { getExtension, clamp, filterFileTree, Lazy } from '../util';
import { cropLine, ellipsisElementText, uniqId } from './rendering';

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
    /** Size of the labels at the highest level. */
    labelFontSize = 12

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
    pathMap: Map<string, d3.HierarchyCircularNode<AnyFile>> = new Map()
    packLayout: d3.HierarchyCircularNode<AnyFile>
    transform: d3.ZoomTransform = new d3.ZoomTransform(1, 0, 0);

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

        const root = d3.hierarchy<AnyFile>(this.codebase, f => f.type == FileType.Directory ? f.children : undefined);
        // Compute size of files and folders
        root.sum(d => d.type == FileType.File ? clamp(d.size, this.minFileSize, this.maxFileSize) : 0);
        // Sort by descending size for layout purposes
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Use d3 to calculate the circle packing layout
        this.packLayout = d3.pack<AnyFile>()
            .size([this.diagramSize, this.diagramSize])
            .padding(this.filePadding)(root);
    
        this.updateFiles();
    }

    updateFiles() {
        // TODO maybe wipe id map?
        this.updateSize(); // get the actual size of the svg

        const arc = d3.arc();
        const colorScale = this.getColorScale(new Lazy(this.packLayout.descendants()).map(x => x.data));

        const data = this.packLayout.descendants().filter(d => !d.parent || !this.shouldHideContents(d.parent));

        this.fileGroup.selectAll(".file, .directory")
            .data(data, d => this.filePath(d as any))
            .join(
                enter => {
                    const all = enter.append('g')
                        // .attr('data-filepath', d => this.filePath(d))
                        .classed("file", d => d.data.type == FileType.File)
                        .classed("directory", d => d.data.type == FileType.Directory)
                        .classed("contents-hidden", d => this.shouldHideContents(d)) // TODO make this show an elipsis or something
                        .attr("transform", d => `translate(${d.x},${d.y})`);

                    // Draw the circles for each file and directory.
                    all.append("path")
                        .attr("id", d => uniqId(this.filePath(d)))
                        // Use path instead of circle so we can use textPath on it for the folder name. -pi to pi so the
                        // path starts at the bottom and we don't cut off the name
                        .attr("d", d => arc({
                            innerRadius: 0, outerRadius: d.r,
                            startAngle: -Math.PI, endAngle: Math.PI,
                        }))
                        .attr("fill", d => colorScale(d.data));

                    // Add a tooltip
                    all.append("title")
                        .text(d => this.filePath(d));

                    const files = all.filter(d => d.data.type == FileType.File); 
                    const directories = all.filter(d => d.data.type == FileType.Directory);

                    // Add labels
                    const fileLabels = files.append("text")
                        .append("tspan")
                            .attr("x", 0)
                            .attr("y", 0)
                            .attr("font-size", d => this.labelFontSize - d.depth)
                            .text(d => d.data.name)
                            .each((d, i, nodes) => ellipsisElementText(nodes[i], d.r * 2, d.r * 2, this.textPadding));

                    // Add a folder name at the top. Add a "background" path behind the text to contrast with the circle
                    // outline. We'll set the background path after we've created the label so we can get the computed
                    // text length. If we weren't using textPath, we could use paint-order to stroke an outline, but
                    // textPath causes the stroke to cover other characters
                    const directoryLabelBackgrounds = directories.append("path")
                        .classed("label-background", true);

                    const directoryLabel = directories.append("text")
                        .classed("label", true)
                        .append("textPath")
                            .attr("href", d => `#${uniqId(this.filePath(d))}`)
                            .attr("startOffset", "50%")
                            .attr("font-size", d => this.labelFontSize - d.depth)
                            .text(d => d.data.name)
                            .each((d, i, nodes) => ellipsisElementText(nodes[i], Math.PI * d.r /* 1/2 circumference */));
                    
                    // Set the label background to the length of the labels (do it after so that its behind the text)
                    directoryLabelBackgrounds.each((d, i, nodes) => {
                        const length = directoryLabel.nodes()[i].getComputedTextLength() + 4;
                        const angle = length / d.r;
                        const pathData = arc({
                            innerRadius: d.r, outerRadius: d.r,
                            startAngle: - angle / 2, endAngle: angle / 2,
                        })!;
                        nodes[i].setAttribute('d', pathData);
                    });


                    return all;
                },
                update => {
                    // TODO when I add a file watcher I'll need to address other things changing
                    update.classed("contents-hidden", d => this.shouldHideContents(d));
                    update.filter(".directory").each((d, i, nodes) => {

                        const el = nodes[i] as Element;
                        const label = el.querySelector<SVGTextPathElement>(".label")!;
                        const background = el.querySelector<SVGPathElement>(".label-background")!;

                        const length = label.getComputedTextLength() + 4;
                        const angle = length / d.r;
                        const pathData = arc({
                            innerRadius: d.r, outerRadius: d.r,
                            startAngle: - angle / 2, endAngle: angle / 2,
                        })!;
                        background.setAttribute('d', pathData);
                    });

                    return update;
                },
                exit => exit.remove(),
            );

        // Store a map of paths to nodes for future use in connections
        this.pathMap = new Map();
        this.packLayout.each((d) => {
            // get d or the first ancestor that is visible
            const firstVisible = d.ancestors().find(p => !p.parent || !this.shouldHideContents(p.parent))!;
            this.pathMap.set(this.filePath(d), firstVisible);
        });

        this.updateConnections();
    }

    updateConnections() {
        const merged = new Map<string, Connection[]>();
        this.connections.forEach(conn => {
            const from = this.pathMap.get(typeof conn.from == 'string' ? conn.from : conn.from.file);
            const to = this.pathMap.get(typeof conn.to == 'string' ? conn.to : conn.to.file);
            // TODO For now just ignore self loops. Also need to figure out what I should do for self loops caused by merging
            if (from === to) return;

            const key = this.connectionKey(conn);
            if (!merged.has(key)) merged.set(key, []);
            merged.get(key)!.push(conn);
        }, new Map<string, Connection[]>());

        // TODO do merging logic here
        const mergedConnections = [...merged.values()].map(m => m[0]);

        const arrowColors = [...new Set(new Lazy(mergedConnections).map(c => c.color ?? this.settings.color))];

        const arrows = this.defs.selectAll("marker.arrow")
            .data(arrowColors, color => color as string)
            .join(
                enter => enter.append('marker')
                    .classed("arrow", true)
                    .attr("id", color => uniqId(color))
                    .attr("viewBox", "0 0 10 10")
                    .attr("refX", 5)
                    .attr("refY", 5)
                    .attr("markerWidth", 6)
                    .attr("markerHeight", 6)
                    .attr("orient", "auto-start-reverse")
                    .append("path")
                        .attr("d", "M 0 0 L 10 5 L 0 10 z")
                        .attr("fill", color => color),
                update => update,
                exit => exit.remove(),
            );

        const link = d3.link(d3.curveCatmullRom); // TODO find a better curve
        const connections = this.connectionGroup.selectAll(".connection")
            // TODO normalize or convert from/to
            .data(mergedConnections, conn => this.connectionKey(conn as Connection))
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("stroke-width", conn => conn.strokeWidth ?? this.settings.strokeWidth)
                    .attr("stroke", conn => conn.color ?? this.settings.color)
                    .attr("marker-end",
                        conn => this.settings.directed ? `url(#${uniqId(conn.color ?? this.settings.color)})` : null
                    )
                    .attr("d", conn => {
                        // TODO normalize conn before this and check for valid from/to
                        const from = this.pathMap.get(typeof conn.from == 'string' ? conn.from : conn.from.file)!;
                        const to = this.pathMap.get(typeof conn.to == 'string' ? conn.to : conn.to.file)!;
                        const [source, target] = cropLine([[from.x, from.y], [to.x, to.y]], from.r, to.r);
                        return link({ source, target });
                    }),
                update => update,
                exit => exit.remove(),
            );
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

    filePath(d: d3.HierarchyNode<AnyFile>): string {
        return d.ancestors().reverse().slice(1).map(d => d.data.name).join("/");
    }

    /** Return unique string key for a connection */
    connectionKey(conn: Connection): string {
        // TODO normalize connections
        const from = this.pathMap.get(typeof conn.from == 'string' ? conn.from : conn.from.file)!;
        const to = this.pathMap.get(typeof conn.to == 'string' ? conn.to : conn.to.file)!;
        return JSON.stringify([this.filePath(from), this.filePath(to)]);
    }

    /** Convert svg viewport units to actual rendered pixel length  */
    calcPixelLength(viewPortLength: number) {
        const viewToRenderedRatio = Math.min(this.width, this.height) / (this.diagramSize / this.transform.k);
        return viewPortLength * viewToRenderedRatio;
    }

    shouldHideContents(d: d3.HierarchyCircularNode<AnyFile>) {
        return d.data.type == FileType.Directory && !!d.parent && this.calcPixelLength(d.r) <= this.dynamicZoomBreakPoint;
    }

    updateSize() {
        const rect = this.diagram.node()!.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
    }

    handleZoom(e: d3.D3ZoomEvent<SVGSVGElement, Connection>) {
        this.zoomWindow.attr('transform', e.transform.toString());
        if (this.transform.k != e.transform.k) {
            this.transform = e.transform;
            this.updateFiles();
        } else {
            this.transform = e.transform;
        }
    }
}
