import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, NormalizedConnection, MergedConnection,
         NormalizedVisualizationSettings, AddRule, ValueRule } from '../shared';
import { getExtension, filterFileTree, normalizedJSONStringify } from '../util';
import { ellipsisText, uniqId, getRect, Point, Box, closestPointOnBorder, snapAngle, snap, polarToRect } from './rendering';
import _, { isEqual, isUndefined } from "lodash";

type Node = d3.HierarchyCircularNode<AnyFile>;
/** A connection along with placement and rendering data. */
type AnchoredConnection = { 
    conn: MergedConnection,
    from: {
        /** The center of the node or position on the border of the screen this connection logically connects to. */
        target: Point,
        /** Radius of the from node. */
        r?: number,
        /** The point on the circumference (or the border of the screen) where the rendered connection will end. */
        anchor: Point,
    },
    to: {
        target: Point,
        r?: number,
        anchor: Point,
    }
    /**
     * A number indicating an the offset ratio for bezier curve controls, so duplicate connections won't render
     * completely on top of each other.
     */
    control: number,
}

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
    /** Space between connections to the same files */
    spaceBetweenConns = 25

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

        const merged = this.mergeConnections(this.connections);
        const anchored = this.anchorConnections(merged);

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

        this.connectionLayer.selectAll(".connection")
            .data(anchored, conn => (conn as any).id)
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("stroke-width", ({conn}) => conn.width)
                    .attr("stroke", ({conn}) => conn.color)
                    .attr("marker-end", ({conn}) => this.settings.directed ? `url(#${uniqId(conn.color)})` : null)
                    .attr("marker-start", ({conn}) =>
                        this.settings.directed && conn.bidirectional ? `url(#${uniqId(conn.color)})` : null
                    )
                    .attr("d", ({conn, from, to, control}) => {
                        const path = d3.path();
                        path.moveTo(...from.anchor);
                        
                        // make control points fill out the corners a rect with from.anchor and to.anchor as the other
                        // corners, with the closest control point to from.anchor being first, and points being spread
                        // out further than that by the control param
                        const [[fromX, fromY], [toX, toY]] = [from.anchor, to.anchor];
                        let [control1, control2] = _<Point>([[fromX, toY], [toX, fromY]])
                            .sortBy(([x, y]) => Math.abs(fromX - x) + Math.abs(fromY - y)).value()

                        path.bezierCurveTo(...control1, ...control2, ...to.anchor)

                        // TODO Account for arrow width if needed
                        // TODO self loops. How to handle them and spacing?
                        // TODO I still don't like how the controls look here. They need to come out tangental to the circle
                        // So, calculate in previous step. add control1 and control2 to anchored point.
                        // controls should be -1, 1 with no 0 if even
                        // so each control is constrained on the line tangental to the circle at the point.
                        // then we move it along either a constant value, increased if needed to tell between duplicates
                        // or maybe a value based on the distance between.

                        return path.toString();
                    }),
                update => update,
                exit => exit.remove(),
            );
    }

    /**
     * Merge all the connections to combine connections going between the same files after being raised to the first
     * visible file/folder, using mergeRules.
     */
    mergeConnections(connections: Connection[]): MergedConnection[] {
        // Each keyFunc will split up connections in to smaller groups
        const rules = this.normalizedMergeRules()

        let groupKeyFuncs: ((c: NormalizedConnection, raised: NormalizedConnection, index: number) => any)[] = []
        if (rules) {
            // top level group is the from/to after being raised to the first visible files/folders
            groupKeyFuncs.push((c, raised) => this.connKey(raised, {lines: false, ordered: false}))

            if (this.settings.directed && rules.direction?.rule == "same") {
                groupKeyFuncs.push(c => (c.from?.file ?? '') <= (c.to?.file ?? '')) // split by order
            }
            if (rules.file?.rule == "same") {
                groupKeyFuncs.push(c => this.connKey(c, {lines: rules.line?.rule == "same", ordered: false}))
            }

            groupKeyFuncs.push(
                ..._(rules)
                    .omit(['file', 'line', 'direction']) // these were handled already
                    .pickBy(rule => rule?.rule == "same")
                    .map((rule, prop) => ((c: Connection) => c[prop]))
                    .value()
            )
        } else {
            groupKeyFuncs.push((c, r, index) => index) // hack to not group anything
        }

        return _(connections)
            .map((conn, index) => {
                const normConn = this.normalizeConn(conn)
                // TODO handle missing files
                const [from, to] = [normConn.from, normConn.to].map(
                    f => f ? this.filePath(this.pathMap.get(f.file)!) : undefined
                )
                const raised = this.normalizeConn({ from, to })
                return {conn: normConn, raised, index}
            })
            .filter(({conn, raised}) => raised.from?.file != raised.to?.file)  // TODO For now just ignore self loops.
            .groupBy(({conn, raised, index}) =>
                normalizedJSONStringify(groupKeyFuncs.map(func => func(conn, raised, index)))
            )
            .values()
            .map<MergedConnection>((pairs, key) => {
                const raised = pairs[0].raised;
                const reversed = {to: raised.from, from: raised.to}
                const bidirectional = _(pairs).some(pair => isEqual(pair.raised, reversed))
                const connections = pairs.map(pair => pair.conn)

                // use greatest to just get the only entry if merging if off
                const width = CBRVWebview.mergers[rules ? rules.width!.rule : "greatest"](
                    connections.map(conn => conn.width ?? this.settings.connectionDefaults.width),
                    rules ? rules.width! : null,
                )

                const color = CBRVWebview.mergers[rules ? rules.color!.rule : "greatest"](
                    connections.map(conn => conn.color ?? this.settings.connectionDefaults.color),
                    rules ? rules.color! : null,
                )

                return {
                    ...raised,
                    width, color, bidirectional,
                    connections,
                }
            })
            .value()
    }

    /** Create a list of "anchored" with positioning data. */
    anchorConnections(merged: MergedConnection[]): AnchoredConnection[] {
        const viewbox = this.getViewbox()

        const anchored = merged.map(conn => {
            let [from, to] = [conn.from, conn.to]
                .map(e => e ? this.pathMap.get(e.file)! : undefined)
                .map((node, i, arr) => {
                    if (node) {
                        return {
                            target: [node.x, node.y] as Point,
                            r: node.r,
                            anchor: undefined as Point|undefined, // will fill this below
                        }
                    } else {
                        const other = arr[+!i]! // hack to get other node in the array
                        return {
                            target: closestPointOnBorder([other.x, other.y], viewbox),
                            r: undefined,
                            anchor: undefined as Point|undefined,
                        }
                    }
                })

            /** Return a partially completed AnchoredConnection  */
            return {
                conn,
                from,
                to,
                control: undefined as number|undefined,
            }
        })
        type PartialAnchoredConnection = typeof anchored[number];

        _(anchored)
            // split out each "end" of the connections
            .flatMap((conn) => [{file: conn.conn.from?.file, conn}, {file: conn.conn.to?.file, conn}])
            .groupBy(end => end.file ?? '') // group all connections that connect to each file
            .forEach((endsToFile, file) => {
                const connsToFile = endsToFile.map(({file, conn}) => conn) // remove redundant grouping data
                const node = file ? this.pathMap.get(file)! : undefined;

                let assignPoint: (conn: PartialAnchoredConnection) => void;
                if (node) {
                    // Calculate number of anchor points by using the spaceBetweenConns arc length, but snapping to a
                    // number that is divisible by 4 so we get nice angles.
                    const numAnchors = Math.max(snap((2 * Math.PI * node.r) / this.spaceBetweenConns, 4), 4);
                    const deltaTheta = (2*Math.PI) / numAnchors;
                    let anchorPoints: PartialAnchoredConnection[][] = _.range(numAnchors).map(i => []);

                    const hasArrow = (conn: PartialAnchoredConnection) =>
                        this.settings.directed && ((conn.conn.to?.file ?? '') == file || conn.conn.bidirectional)
            
                    // assign to an anchor point and update the actual rendered point. Makes sure that connections going
                    // opposite directions don't go to the same anchor point.
                    assignPoint = (conn) => {
                        const direction = (conn.conn.to?.file ?? '') == file ? "to" : "from";
                        const otherTarget = conn[(direction == "from") ? "to" : "from"].target;

                        const rawTheta = Math.atan2(otherTarget[1] - node.y, otherTarget[0] - node.x);

                        // Check if connection has an arrow to this file
                        const connHasArrow = hasArrow(conn);
                        
                        // Snap to angle, round to index to account for any floating point error
                        const theta1 = snapAngle(rawTheta, deltaTheta);
                        const index1 = Math.round(theta1 / deltaTheta);
                        const hasArrow1 = anchorPoints[index1].length ? hasArrow(anchorPoints[index1][0]) : undefined;

                        // no conflict on first choice
                        if (hasArrow1 == undefined || hasArrow1 == connHasArrow) {
                            // NOTE: Mutating conn, which is also in the anchored array
                            conn[direction].anchor = polarToRect(theta1, node.r, [node.x, node.y]);
                            anchorPoints[index1].push(conn);
                        } else {
                            // fallback index if conflict. Assign in to even, and out to odd anchors.
                            // May be same as index1
                            const theta2 = snapAngle(rawTheta, 2 * deltaTheta, connHasArrow ? 0 : deltaTheta);
                            const index2 = Math.round(theta2 / deltaTheta);
                            const existing = anchorPoints[index2];
                            const hasArrow2 = existing.length ? hasArrow(existing[0]) : undefined;

                            // NOTE: Mutating conn, which is also in the anchored array
                            conn[direction].anchor = polarToRect(theta2, node.r, [node.x, node.y]);

                            // no conflict on second choice
                            if (hasArrow2 == undefined || hasArrow2 == connHasArrow) {
                                anchorPoints[index2].push(conn);
                            } else { // conflict on second choice
                                anchorPoints[index2] = [conn];

                                for (let conn of existing) {
                                    assignPoint(conn); // may need to resolve conflicts recursively
                                }
                            }
                        }
                    }
                } else {
                    assignPoint = (conn) => {
                        const direction = (conn.conn.from?.file ?? '') == file ? "from" : "to";
                        const otherTarget = conn[(direction == "from") ? "to" : "from"].target;
                        // NOTE: Mutating conn, which is also in the anchored array
                        conn[direction].anchor = closestPointOnBorder(otherTarget, viewbox);
                    }
                }


                _(connsToFile)
                    // group by pairs and direction (if directed).
                    .groupBy(conn => this.connKey(conn.conn, {lines: false, ordered: this.settings.directed}))
                    .forEach(connsBetweenFiles => {
                        const startControl = -Math.floor(connsBetweenFiles.length / 2)
                        connsBetweenFiles.forEach((conn, i) => {
                            // Add unique control so that conns between the same two files don't overlap completely
                            // NOTE: were mutating the conn object, which is also in the anchored array.
                            conn.control = startControl + i;
                            assignPoint(conn);
                        })
                    });
            })

        return anchored as AnchoredConnection[]; // we've filled everything out.
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
        return JSON.stringify(key);
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
