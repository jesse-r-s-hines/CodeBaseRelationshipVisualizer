import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, NormalizedConnection, MergedConnections,
         NormalizedVisualizationSettings, AddRule, ValueRule } from '../shared';
import { getExtension, filterFileTree } from '../util';
import { cropLine, ellipsisText, uniqId, getRect, Point, Box, closestPointOnBorder } from './rendering';
import _, { isEqual } from "lodash";

type Node = d3.HierarchyCircularNode<AnyFile>;

/**
 * This is the class that renders the actual diagram.
 */
export default class CBRVWebview {
    settings: NormalizedVisualizationSettings
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
    fileLayer: d3.Selection<SVGGElement, unknown, null, undefined>
    connectionLayer: d3.Selection<SVGGElement, unknown, null, undefined>

    // Some rendering variables

    /** Actual pixel width and height of the svg diagram */
    width = 0; height = 0
    transform: d3.ZoomTransform = new d3.ZoomTransform(1, 0, 0);
    /** Maps file paths to their rendered circle (or first visible circle if they are hidden) */
    pathMap: Map<string, Node> = new Map()

    static mergers: Record<string, (items: any[], rule: any) => any> = {
        least: items => _(items).min(),
        greatest: items => _(items).max(),
        // find the most/least common item. items is gauranteed to be non-empty
        leastCommon: items => _(items).countBy().toPairs().minBy(([item, count]) => count)![0],
        mostCommon: items => _(items).countBy().toPairs().maxBy(([item, count]) => count)![0],
        add: (items, rule: AddRule) => Math.min(_(items).sum(), rule.max),
        value: (items, rule: ValueRule) => items.length <= 1 ? items[0] : rule.value,
    }

    /** Pass the selector for the canvas svg */
    constructor(diagram: string, codebase: Directory, settings: NormalizedVisualizationSettings, connections: Connection[]) {
        // filter empty directories
        this.codebase = filterFileTree(codebase, f => !(f.type == FileType.Directory && f.children.length == 0));
        this.settings = settings;
        this.connections = connections;

        // Create the SVG
        this.diagram = d3.select(document.querySelector(diagram) as SVGSVGElement)
            .attr("viewBox", this.getViewbox());

        this.defs = this.diagram.append("defs");
        this.zoomWindow = this.diagram.append("g").classed("zoom-window", true);
        this.fileLayer = this.zoomWindow.append("g").classed("file-layer", true);
        this.connectionLayer = this.zoomWindow.append("g").classed("connection-layer", true);

        // Add event listeners
        this.throttledUpdate = _.throttle(() => this.update(), 250, {trailing: true})

        const [x, y, width, height] = this.getViewbox();
        const extent: [Point, Point] = [[x, y], [x + width, y + height]]
        const zoom = d3.zoom()
            .on('zoom', (e) => this.onZoom(e))
            .extent(extent)
            .scaleExtent([1, Infinity])
            .translateExtent(extent);
        zoom(this.diagram as any);
        d3.select(window).on('resize', (e) => this.onResize(e));

        [this.width, this.height] = getRect(this.diagram.node()!);

        this.update(this.codebase, this.settings, this.connections);
    }

    getViewbox(): Box {
        const { top, right, bottom, left } = this.margins;
        // use negatives to add margin since pack() starts at 0 0. Viewbox is [minX, minY, width, height]
        return [ -left, -top, left + this.diagramSize + right, top + this.diagramSize + bottom]
    }

    throttledUpdate: () => void

    update(codebase?: Directory, settings?: NormalizedVisualizationSettings, connections?: Connection[]) {
        if (settings) {
            this.settings = settings;
            this.updateCodebase(codebase ?? this.codebase); // force rerender
            this.updateConnections(connections ?? this.connections);
        } else {
            this.updateCodebase(codebase);
            this.updateConnections(connections);
        }
    }

    updateCodebase(codebase?: Directory) {
        if (codebase) {
            this.codebase = codebase;
        }

        const root = d3.hierarchy<AnyFile>(this.codebase, f => f.type == FileType.Directory ? f.children : undefined);
        // Compute size of files and folders
        root.sum(d => d.type == FileType.File ? _.clamp(d.size, this.minFileSize, this.maxFileSize) : 0);
        // Sort by descending size for layout purposes
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Use d3 to calculate the circle packing layout
        const packLayout = d3.pack<AnyFile>()
            .size([this.diagramSize, this.diagramSize])
            .padding(this.filePadding)(root);

        const arc = d3.arc();
        const colorScale = this.getColorScale(packLayout);
        // Calculate unique key for each data. Use `type:path/to/file` so that changing file <-> directory is treated as
        // creating a new node rather than update the existing one, which simplifies the logic.
        const keyFunc = (d: Node) => `${d.data.type}:${this.filePath(d)}`;

        const data = packLayout.descendants().filter(d => !d.parent || !this.shouldHideContents(d.parent));

        const all = this.fileLayer.selectAll(".file, .directory")
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

        const merged = this.mergeConnections();
        // If directed == false, we don't need any markers
        let markers = this.settings.directed ? _(merged).map(c => c.color).uniq().value() : []

        this.defs.selectAll("marker.arrow")
            .data(markers, color => color as string)
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
        this.connectionLayer.selectAll(".connection")
            // TODO normalize or convert from/to
            .data(merged, conn => (conn as MergedConnections).id)
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("stroke-width", conns => conns.width)
                    .attr("stroke", conns => conns.color)
                    .attr("marker-end", conns => this.settings.directed ? `url(#${uniqId(conns.color)})` : null)
                    .attr("marker-start", conns =>
                        this.settings.directed && conns.bidirectional ? `url(#${uniqId(conns.color)})` : null
                    )
                    .attr("d", conn => {
                        const [from, to] = [conn.from, conn.to].map(e => e ? this.pathMap.get(e.file)! : undefined)

                        let viewbox = this.getViewbox()
                        let source: Point = from ? [from.x, from.y] : closestPointOnBorder([to!.x, to!.y],     viewbox);
                        let target: Point = to   ? [to.x,   to.y  ] : closestPointOnBorder([from!.x, from!.y], viewbox);
                        [source, target] = cropLine([source, target], (from ? from.r : 0), (to ? to.r : 0));

                        return link({ source, target });
                    }),
                update => update,
                exit => exit.remove(),
            );
    }

    mergeConnections(): MergedConnections[] {
        let merged: MergedConnections[] = []
        
        // Each keyFunc will split up connections in to smaller groups
        const rules = this.normalizedMergeRules()
        const mergeDirections = rules && (!this.settings.directed || rules.direction?.rule == "ignore")
        let groupKeyFuncs: ((c: NormalizedConnection, raised: NormalizedConnection) => any)[] = []

        if (rules) {
            groupKeyFuncs.push(
                (c, raised) => this.connKey(raised, {lines: false, ordered: !mergeDirections})
            )
            if (rules.file?.rule == "same") {
                groupKeyFuncs.push(
                    c => this.connKey(c, {lines: rules.line?.rule == "same", ordered: !mergeDirections})
                )
            }
            groupKeyFuncs.push(
                ..._(rules)
                    .omit(['file', 'line', 'direction']) // these were handled already
                    .pickBy(rule => rule?.rule == "same")
                    .map((rule, prop) => ((c: Connection) => c[prop]))
                    .value()
            )
        } else {
            groupKeyFuncs.push(c => c) // don't group any connections
        }

        // Create a tree to split out all the groups
        type Tree = Map<any, Tree|MergedConnections>
        let groupMap: Tree = new Map()
        // We can't use [from, to] as a d3 id since there can be duplicates, so we'll add an index to the key to 
        // differentiate connections between the same files, but still keep the key consistent most the time so d3 will
        // reuse the DOM. Keep a map of [from, to] => number of merged connections between those files
        let countMap = new Map<string, number>()
        for (let conn of this.connections) {
            const normConn = this.normalizeConn(conn)
            const [from, to] = [normConn.from, normConn.to].map(
                f => f ? this.filePath(this.pathMap.get(f.file)!) : undefined
            )
            const raised = this.normalizeConn({ from, to })
            const groupKeys = groupKeyFuncs.map(func => func(normConn, raised))

            // TODO For now just ignore self loops.
            // TODO handle missing files
            if (from === to) continue;

            let group = groupMap;
            for (const key of groupKeys.slice(0, -1)) {
                if (!group.has(key))
                    group.set(key, new Map())
                group = group.get(key) as Tree
            }

            // last level has the MergedConnection
            const key = groupKeys.at(-1)! // groupKeys will never be empty
            if (!group.has(key)) {
                let idPrefix = this.connKey(raised)
                let count = countMap.get(idPrefix) ?? 0
                let mergedConn: MergedConnections = {
                    id: `${idPrefix}:${count}`,
                    from: raised.from, to: raised.to,
                    width: 0, color: '', // We'll set these in the next step
                    bidirectional: false, // this may be overridden later
                    connections: [],
                }

                group.set(key, mergedConn)
                countMap.set(idPrefix, count + 1)
                merged.push(mergedConn) // so we don't have to flatten the tree after
            }
            let mergedConn = group.get(key) as MergedConnections
            mergedConn.connections.push(conn)
            if (isEqual([raised.from, raised.to], [mergedConn.to, mergedConn.from])) {
                mergedConn.bidirectional = true // Connections going both directions
            }
        }

        for (let mergedConn of merged) {
            // use greatest to just the the only entry if merging if off
            mergedConn.width = CBRVWebview.mergers[rules ? rules.width!.rule : "greatest"]( 
                mergedConn.connections.map(conn => conn.width ?? this.settings.connectionDefaults.width),
                rules ? rules.width! : null,
            )

            mergedConn.color = CBRVWebview.mergers[rules ? rules.color!.rule : "greatest"](
                mergedConn.connections.map(conn => conn.color ?? this.settings.connectionDefaults.color),
                rules ? rules.color! : null,
            )
        }

        return merged;
    }

    // TODO should probably do this in Visualization
    normalizedMergeRules() {
        if (this.settings.mergeRules) {
            return _(this.settings.mergeRules).mapValues(r => (typeof r == "string" ? {rule: r} : r)).value()
        } else {
            return false
        }
    }

    /** Returns a function used to compute color from file extension */
    getColorScale(nodes: Node): (d: AnyFile) => string | null {
        const exts = _(nodes.descendants()) // lodash is lazy
            .filter(n => n.data.type != FileType.Directory)
            .map(n => getExtension(n.data.name))
            .uniq()
            .value();
        // quantize requires > 1, so just set it to 2 if needed. It doesn't matter if there's extra "buckets"
        const colorScale = d3.scaleOrdinal(exts, d3.quantize(d3.interpolateRainbow, Math.max(exts.length, 2)));
        return (d: AnyFile) => d.type == FileType.Directory ? null : colorScale(getExtension(d.name));
    }

    filePath(d: Node): string {
        return d.ancestors().reverse().slice(1).map(d => d.data.name).join("/");
    }

    normalizeConn(conn: Connection): NormalizedConnection {
        if (!conn.from && !conn.to) {
            throw Error("Connections must have at least one of from or to defined")
        }
        return { // TODO normalize file paths as well
            ...conn,
            from: (typeof conn.from == 'string') ? {file: conn.from} : conn.from,
            to: (typeof conn.to == 'string') ? {file: conn.to} : conn.to,
        }
    }

    connKey(conn: NormalizedConnection, options: {lines?: boolean, ordered?: boolean} = {}): string {
        options = {lines: true, ordered: true, ...options}
        let key = [conn?.from, conn?.to].map(e => e ? `${e.file}:${options.lines && e.line ? e.line : ''}` : '')
        if (!options.ordered) {
            key = key.sort()
        }
        return JSON.stringify(key)
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
        const oldK = this.transform.k;
        this.transform = e.transform;
        this.zoomWindow.attr('transform', this.transform.toString());
        if (e.transform.k != oldK) { // zoom also triggers for pan.
            this.throttledUpdate();
        }
    }

    onResize(e: Event) {
        [this.width, this.height] = getRect(this.diagram.node()!);
        this.throttledUpdate();
    }
}
