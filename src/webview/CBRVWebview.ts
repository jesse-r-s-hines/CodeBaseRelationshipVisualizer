import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, VisualizationSettings, NormalizedConnection, MergedConnections, NormalizedEndpoint } from '../shared';
import { getExtension, clamp, filterFileTree, Lazy } from '../util';
import { cropLine, ellipsisText, uniqId, getRect } from './rendering';
import { throttle } from "lodash";

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
    hideContentsRadius = 16
    /** Radius when a directory's or file's labels will be hidden (in px) */
    hideLabelsRadius = 20
    /** Size of the labels at the highest level. */
    labelFontSize = 12

    // Parts of the d3 diagram

    diagram: d3.Selection<SVGSVGElement, unknown, null, undefined>
    defs: d3.Selection<SVGDefsElement, unknown, null, undefined>
    zoomWindow: d3.Selection<SVGGElement, unknown, null, undefined>
    fileGroup: d3.Selection<SVGGElement, unknown, null, undefined>
    connectionGroup: d3.Selection<SVGGElement, unknown, null, undefined>

    // Some rendering variables

    /** Actual pixel width and height of the svg diagram */
    width = 0; height = 0
    transform: d3.ZoomTransform = new d3.ZoomTransform(1, 0, 0);
    /** Maps file paths to their rendered circle (or first visible circle if they are hidden) */
    pathMap: Map<string, d3.HierarchyCircularNode<AnyFile>> = new Map()

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

        // Add event listeners
        this.throttledUpdate = throttle(this.update.bind(this), 250, {trailing: true})

        const zoom = d3.zoom().on('zoom', (e) => this.onZoom(e));
        zoom(this.diagram as any);
        d3.select(window).on('resize', (e) => this.onResize(e));

        [this.width, this.height] = getRect(this.diagram.node()!);

        this.update(this.codebase, this.connections);
    }

    throttledUpdate: (codebase?: Directory, connections?: Connection[]) => void

    update(codebase?: Directory, connections?: Connection[]) {
        this.updateCodebase(codebase);
        this.updateConnections(connections);
    }

    updateCodebase(codebase?: Directory) {
        if (codebase) {
            this.codebase = codebase;
        }

        const root = d3.hierarchy<AnyFile>(this.codebase, f => f.type == FileType.Directory ? f.children : undefined);
        // Compute size of files and folders
        root.sum(d => d.type == FileType.File ? clamp(d.size, this.minFileSize, this.maxFileSize) : 0);
        // Sort by descending size for layout purposes
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Use d3 to calculate the circle packing layout
        const packLayout = d3.pack<AnyFile>()
            .size([this.diagramSize, this.diagramSize])
            .padding(this.filePadding)(root);

        const arc = d3.arc();
        const colorScale = this.getColorScale(new Lazy(packLayout.descendants()).map(x => x.data));
        // Calculate unique key for each data. Use `type:path/to/file` so that changing file <-> directory is treated as
        // creating a new node rather than update the existing one, which simplifies the logic.
        const keyFunc = (d: d3.HierarchyCircularNode<AnyFile>) => `${d.data.type}:${this.filePath(d)}`;

        const data = packLayout.descendants().filter(d => !d.parent || !this.shouldHideContents(d.parent));

        const all = this.fileGroup.selectAll(".file, .directory")
            .data(data, keyFunc as any) // the typings here seem to be incorrect
            .join(
                enter => {
                    const all = enter.append('g')
                        .attr('data-filepath', d => this.filePath(d))
                        .classed("file", d => d.data.type == FileType.File)
                        .classed("directory", d => d.data.type == FileType.Directory)
                        .classed("new", true); // We'll use this to reselect newly added nodes later.

                    // Draw the circles for each file and directory. Use path instead of circle so we can use textPath
                    // on it for the folder name
                    all.append("path")
                        .classed("circle", true)
                        .attr("id", d => uniqId(this.filePath(d)));

                    // Add a tooltip
                    all.append("title")
                        .text(d => this.filePath(d));

                    const files = all.filter(d => d.data.type == FileType.File);
                    const directories = all.filter(d => d.data.type == FileType.Directory);

                    // Add labels
                    files.append("text")
                        .append("tspan")
                            .classed("label", true)
                            .attr("x", 0)
                            .attr("y", 0)
                            .attr("font-size", d => this.labelFontSize - d.depth);

                    // Add a folder name at the top. Add a "background" path behind the text to contrast with the circle
                    // outline. We'll set the path in update after we've created the label so we can get the computed
                    // text length and so it updates on changes to d.r. If we weren't using textPath, we could use
                    // paint-order to stroke an outline, but textPath causes the stroke to cover other characters
                    directories.append("path")
                        .classed("label-background", true);

                    directories.append("text")
                        .append("textPath")
                            .classed("label", true)
                            .attr("href", d => `#${uniqId(this.filePath(d))}`)
                            .attr("startOffset", "50%")
                            .attr("font-size", d => this.labelFontSize - d.depth);
  
                    return all;
                },
                update => { // TODO transitions
                    return update.classed("new", false);
                },
                exit => exit.remove(),
            )

        all
            .classed("contents-hidden", d => this.shouldHideContents(d)) // TODO make this show an elipsis or something
            .classed("labels-hidden", d => this.shouldHideLabels(d));

        // we only need to recalculate these for new elements unless the file structure changed (not just zoom)
        const changed = codebase ? all : all.filter(".new");
        
        changed.attr("transform", d => `translate(${d.x},${d.y})`);

        changed.select("path.circle")
            .attr("d", d => arc({
                innerRadius: 0, outerRadius: d.r,
                // -pi to pi so the path starts at the bottom and we don't cut off the directory label
                startAngle: -Math.PI, endAngle: Math.PI, 
            }))
            .attr("fill", d => colorScale(d.data));

        const files = changed.filter(".file");
        const directories = changed.filter(".directory");

        files.select<SVGTSpanElement>(".label")
            .text(d => d.data.name)
            .each((d, i, nodes) => ellipsisText(nodes[i], d.r * 2, d.r * 2, this.textPadding));

        const directoryLabels = directories.select<SVGTextPathElement>(".label")
            .text(d => d.data.name)
            .each((d, i, nodes) => ellipsisText(nodes[i], Math.PI * d.r /* 1/2 circumference */));

        // Set the label background to the length of the labels
        directories.select<SVGTextElement>(".label-background")
            .each((d, i, nodes) => {
                const length = directoryLabels.nodes()[i].getComputedTextLength() + 4;
                const angle = length / d.r;
                const pathData = arc({
                    innerRadius: d.r, outerRadius: d.r,
                    startAngle: -angle / 2, endAngle: angle / 2,
                })!;
                nodes[i].setAttribute('d', pathData);
            });

        // Store a map of paths to nodes for future use in connections
        this.pathMap = new Map(); // TODO refactor this
        packLayout.each((d) => {
            // get d or the first ancestor that is visible
            const firstVisible = d.ancestors().find(p => !p.parent || !this.shouldHideContents(p.parent))!;
            this.pathMap.set(this.filePath(d), firstVisible);
        });
    }

    updateConnections(connections?: Connection[]) {
        if (connections) {
            this.connections = connections;
        }

        /** Return unique string key for a connection */
        const keyFunc = (conn: NormalizedConnection): string => {
            return JSON.stringify([`${conn.from.file}:${conn.from.line ?? ''}`, `${conn.to.file}:${conn.to.line ?? ''}`]);
        };

        const merged = new Map<string, MergedConnections>();
        this.connections.forEach(conn => {
            const from = this.pathMap.get(this.normalizeConn(conn).from.file)!;
            const to = this.pathMap.get(this.normalizeConn(conn).to.file)!;
            // TODO For now just ignore self loops. Also need to figure out what I should do for self loops caused by merging
            // TODO handle missing files
            if (from === to) return;

            // Make a new connection raised to point to the visible ancestors, then merge with any others
            const raisedConn = this.normalizeConn({from: this.filePath(from), to: this.filePath(to)})
            const key = keyFunc(raisedConn);
            if (!merged.has(key)) { 
                merged.set(key, {
                    ...raisedConn,

                    // TODO do merging logic

                    connections: [],
                });
            }
            merged.get(key)!.connections.push(conn);
        }, new Map<string, Connection[]>());

        const mergedConnections = [...merged.values()];

        const arrowColors = [...new Set(new Lazy(mergedConnections).map(c => c.connections[0].color ?? this.settings.color))];

        this.defs.selectAll("marker.arrow")
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
        this.connectionGroup.selectAll(".connection")
            // TODO normalize or convert from/to
            .data(mergedConnections, keyFunc as any)
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("stroke-width", conns => conns.connections[0].strokeWidth ?? this.settings.strokeWidth)
                    .attr("stroke", conns => conns.connections[0].color ?? this.settings.color)
                    .attr("marker-end",
                        conns => this.settings.directed ? `url(#${uniqId(conns.connections[0].color ?? this.settings.color)})` : null
                    )
                    .attr("d", conn => {
                        const from = this.pathMap.get(conn.from.file)!;
                        const to = this.pathMap.get(conn.to.file)!;
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

    normalizeConn(conn: Connection): NormalizedConnection {
        return { // TODO normalize file paths as well
            ...conn,
            from: (typeof conn.from == 'string') ? {file: conn.from} : conn.from,
            to: (typeof conn.to == 'string') ? {file: conn.to} : conn.to,
        }
    }

    /** Convert svg viewport units to actual rendered pixel length  */
    calcPixelLength(viewPortLength: number) {
        const viewToRenderedRatio = Math.min(this.width, this.height) / (this.diagramSize / this.transform.k);
        return viewPortLength * viewToRenderedRatio;
    }

    shouldHideContents(d: d3.HierarchyCircularNode<AnyFile>) {
        return d.data.type == FileType.Directory && this.calcPixelLength(d.r) <= this.hideContentsRadius;
    }

    shouldHideLabels(d: d3.HierarchyCircularNode<AnyFile>) {
        return this.calcPixelLength(d.r) <= this.hideLabelsRadius;
    }

    onZoom(e: d3.D3ZoomEvent<SVGSVGElement, Connection>) {
        this.zoomWindow.attr('transform', e.transform.toString());
        const oldK = this.transform.k;
        this.transform = e.transform;
        if (e.transform.k != oldK) { // zoom also triggers for pan.
            this.throttledUpdate();
        }
    }

    onResize(e: Event) {
        [this.width, this.height] = getRect(this.diagram.node()!);
        this.throttledUpdate();
    }
}
