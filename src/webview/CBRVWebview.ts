import * as d3 from 'd3';
import { FileType, Directory, AnyFile, Connection, NormalizedConnection, MergedConnection,
         NormalizedVisualizationSettings, AddRule, ValueRule } from '../shared';
import { getExtension, filterFileTree, normalizedJSONStringify } from '../util';
import * as rendering from './rendering';
import { Point, Box, uniqId } from './rendering';
import _, { isEqual } from "lodash";

type Node = d3.HierarchyCircularNode<AnyFile>;
/** A connection along with placement and rendering data. */
type AnchoredConnection = { 
    conn: MergedConnection,
    from: {
        /** The center of the node or position on the border of the screen this connection logically connects to. */
        target: Point,
        /** Radius of the from node. */
        r?: number,
        /* Angle from from.target to to.target */
        theta: number,
        /** The point on the circumference (or the border of the screen) where the rendered connection will end. */
        anchor: Point,
    },
    to: {
        target: Point,
        r?: number,
        theta: number,
        anchor: Point,
    },
    /**
     * An number that distinguishes connections that go between the same two files.
     * Is used to modify control points, and to make unique ids. Can be negative.
     */
    index: number,
    /** Control points for the bezier curve. */
    controls: Point[],
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
    /** Offset of control points in curves, as a percentage. */
    controlOffset = 0.20;
    /** Offset of control points for out-of-screen connections, as a percentage */
    outOfScreenControlOffset = 0.10;
    /** Duplicate connection offset, in pixels */
    duplicateConnectionOffset = 12;

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

        [this.width, this.height] = rendering.getRect(this.diagram.node()!);

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
            // use path instead of circle so we can textPath it. Start at PI/2 so that the path starts at the bottom of
            // the circle and we don't cut off the directory label with the textPath
            .attr("d", d => {
                // use path instead of circle so we can textPath it. Start at PI/2 so that the path starts at the bottom
                // of the circle and we don't cut off the directory label with the textPath
                const path = d3.path();
                path.arc(0, 0, d.r, Math.PI/2, 5*Math.PI/2);
                return path.toString();
            })
            .attr("fill", d => colorScale(d.data));

        const files = changed.filter(".file");
        const directories = changed.filter(".directory");

        files.select<SVGTSpanElement>(".label")
            .text(d => d.data.name)
            .each((d, i, nodes) => rendering.ellipsisText(nodes[i], d.r * 2, d.r * 2, this.textPadding));

        const directoryLabels = directories.select<SVGTextPathElement>(".label")
            .text(d => d.data.name)
            .each((d, i, nodes) => rendering.ellipsisText(nodes[i], Math.PI * d.r /* 1/2 circumference */));

        // Set the label background to the length of the labels
        directories.select<SVGTextElement>(".label-background")
            .each((d, i, nodes) => {
                const length = directoryLabels.nodes()[i].getComputedTextLength() + 4;
                const angle = length / d.r;
                const top = 3*Math.PI/2;
                const path = d3.path();
                path.arc(0, 0, d.r,  top - angle / 2, top + angle / 2);
                nodes[i].setAttribute('d', path.toString());
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

        // See https://observablehq.com/@d3/spline-editor to compare curves
        const curve = d3.line().curve(d3.curveBasis);
        this.connectionLayer.selectAll(".connection")
            .data(anchored, ((conn: AnchoredConnection) => `${this.connKey(conn.conn)}:${conn.index}`) as any)
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("stroke-width", ({conn}) => conn.width)
                    .attr("stroke", ({conn}) => conn.color)
                    .attr("marker-end", ({conn}) => this.settings.directed ? `url(#${uniqId(conn.color)})` : null)
                    .attr("marker-start", ({conn}) =>
                        this.settings.directed && conn.bidirectional ? `url(#${uniqId(conn.color)})` : null
                    )
                    .attr("d", ({conn, from, to, controls}) => {
                        // TODO Account for arrow width if needed
                        // TODO self loops. How to handle them and spacing?
                        return curve([from.anchor, ...controls, to.anchor])!.toString();
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
                const bidirectional = _(pairs).some(pair => !isEqual(pair.raised, raised)) // any a different direction
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
    anchorConnections(connections: MergedConnection[]): AnchoredConnection[] {
        const viewbox = this.getViewbox()

        const anchored = connections.map(conn => {
            const incomplete = {
                r: undefined as number|undefined, // will fill these below
                anchor: undefined as Point|undefined,
            }

            const [from, to] = [conn.from, conn.to]
                .map(e => e ? this.pathMap.get(e.file)! : undefined)
                .map((node, i, arr) => {
                    if (node) {
                        return {
                            ...incomplete,
                            target: [node.x, node.y] as Point,
                            r: node.r,
                            theta: 0, // set below
                        }
                    } else {
                        const other = arr[+!i]! // hack to get other node in the array
                        return {
                            ...incomplete,
                            target: rendering.closestPointOnBorder([other.x, other.y], viewbox),
                            theta: 0, // set below,
                        }
                    }
                })
            
            from.theta = Math.atan2(to.target[1] - from.target[1], to.target[0] - from.target[0]);
            // The other angle is just 180 deg around (saves us calculating atan2 again)
            to.theta = rendering.normalizeAngle(from.theta + Math.PI);

            /** Return a partially completed AnchoredConnection  */
            return {
                conn,
                from, to,
                index: undefined as number|undefined,
                controls: undefined as Point[]|undefined,
            }
        })
        type IncompleteAnchoredConnection = typeof anchored[number];
        type ConnEnd = {conn: IncompleteAnchoredConnection, end: "from"|"to"}

        // Group connections by each node they connect to. Each connection will show up twice, once for from and to.
        // Then we will do rendering calculations for each connection to the file and mutate anchored with the results.
        _(anchored)
            // split out each "end" of the connections
            .flatMap<ConnEnd>((conn) => [{conn, end: "from"}, {conn, end: "to"}])
            .groupBy(({conn, end}) => conn.conn[end]?.file ?? '') // group all ends that connect to each file
            .forEach((connsToFile, file) => {
                const node = file ? this.pathMap.get(file)! : undefined;

                let anchorConn: (connEnd: ConnEnd) => void;
                if (node) {
                    // Calculate number of anchor points by using the spaceBetweenConns arc length, but snapping to a
                    // number that is divisible by 4 so we get nice angles.
                    const numAnchors = Math.max(rendering.snap((2*Math.PI * node.r) / this.spaceBetweenConns, 4), 4);
                    const deltaTheta = (2*Math.PI) / numAnchors;
                    let anchorPoints: ConnEnd[][] = _.range(numAnchors).map(i => []);

                    const hasArrow = ({conn, end}: ConnEnd) =>
                        this.settings.directed && (end == "to" || conn.conn.bidirectional)
            
                    // assign to an anchor point and update the actual rendered point. Makes sure that connections going
                    // opposite directions don't go to the same anchor point.
                    anchorConn = (connEnd) => {
                        const {conn, end} = connEnd;
                        const rawTheta = conn[end].theta;

                        // Check if connection has an arrow to this file
                        const connHasArrow = hasArrow(connEnd);
                        
                        // Snap to angle, round to index to account for any floating point error
                        const theta1 = rendering.snapAngle(rawTheta, deltaTheta);
                        const index1 = Math.round(theta1 / deltaTheta);
                        const hasArrow1 = anchorPoints[index1].length ? hasArrow(anchorPoints[index1][0]) : undefined;

                        // no conflict on first choice
                        if (hasArrow1 == undefined || hasArrow1 == connHasArrow) {
                            // NOTE: Mutating conn, which is also in the anchored array
                            conn[end].anchor = rendering.polarToRect(theta1, node.r, [node.x, node.y]);
                            anchorPoints[index1].push(connEnd);
                        } else {
                            // fallback index if conflict. Assign in to even, and out to odd anchors.
                            // May be same as index1
                            const theta2 = rendering.snapAngle(rawTheta, 2 * deltaTheta, connHasArrow ? 0 : deltaTheta);
                            const index2 = Math.round(theta2 / deltaTheta);
                            const connEnds2 = anchorPoints[index2];
                            const hasArrow2 = connEnds2.length ? hasArrow(connEnds2[0]) : undefined;

                            // NOTE: Mutating conn, which is also in the anchored array
                            conn[end].anchor = rendering.polarToRect(theta2, node.r, [node.x, node.y]);

                            // no conflict on second choice
                            if (hasArrow2 == undefined || hasArrow2 == connHasArrow) {
                                anchorPoints[index2].push(connEnd);
                            } else { // conflict on second choice
                                anchorPoints[index2] = [connEnd];

                                for (let connEnd of connEnds2) {
                                    anchorConn(connEnd); // may need to resolve conflicts recursively
                                }
                            }
                        }
                    }
                } else {
                    anchorConn = ({conn, end}) => {
                        // anchor is just the same as target, which is the closestPointOnBorder
                        // NOTE: Mutating conn, which is also in the anchored array
                        conn[end].anchor = [...conn[end].target];
                    };
                }

                _(connsToFile).forEach(connEnd => {
                    anchorConn(connEnd)
                })

                if (connsToFile[0].conn.index === undefined) {
                    _(connsToFile)
                    // group by pairs and direction (if directed).
                    .groupBy(({conn, end}) => this.connKey(conn.conn, {lines: false, ordered: this.settings.directed}))
                    .forEach(connsBetweenFiles => {
                        const even = (connsBetweenFiles.length % 2 == 0);
                        const startControl = -Math.floor(connsBetweenFiles.length / 2)
                        // Set a index offset. We'll use this to make sure connections between the same files don't
                        // overlap completely, and to make uniq id for the connection.
                        // We'll make index symmetrically distributed around 0 to make control points symmetrical, e.g.
                        // 3 conns -> -1, 0, 1
                        // 4 conns -> -2, -1, 1, 2 (skipping 0 to make it symmetrical)
                        connsBetweenFiles.forEach((connEnd, i) => {
                            const {conn, end} = connEnd;

                            // NOTE: were mutating the conn object, which is also in the anchored array.
                            conn.index = startControl + i;
                            if (even && conn.index >= 0) {
                                conn.index += 1; // offset by 1 to skip 0 to make symmetrical
                            }
                        });
                    });
                }
            })

        // Set up control points
        // do this in a second loop since we need all of the anchors defined to calculate these
        _(anchored)
            .forEach(conn => {
                const [fromAnchor, toAnchor] = [conn.from.anchor!, conn.to.anchor!];
                const dist = rendering.distance(fromAnchor, toAnchor);

                let controls: Point[] = [];

                if (conn.conn.from && conn.conn.to) { // connection from file to file
                    // calculate control points such that the bezier curve will be perpendicular to the circle by
                    // extending the line from the center of the circle to the anchor point.
                    const control1 = rendering.extendLine([conn.from.target, fromAnchor], dist * this.controlOffset);
                    const control2 = rendering.extendLine([conn.to.target, toAnchor], dist * this.controlOffset);
                    controls.push(control1, control2);
                } else {
                    // with an out-of-screen connection add controls on a straight line. We could leave these out, but
                    // this makes the arrows line up if we have an offset for duplicate connections down below.
                    const offset = dist * this.outOfScreenControlOffset;
                    const control1 = rendering.extendLine([fromAnchor, toAnchor], -(dist - offset));
                    const control2 = rendering.extendLine([fromAnchor, toAnchor], -offset);
                    controls.push(control1, control2);
                }

                if (conn.index != 0) {
                    // If we have connections between the same two files, calculate another control point based on the
                    // index so that the connections don't overlap completely. The control point will a distance from
                    // the line between from and to at the midpoint.
                    const midpoint: Point = [(fromAnchor[0] + toAnchor[0]) / 2, (fromAnchor[1] + toAnchor[1]) / 2];
                    // Vector in direction of line between from and to
                    const vec = [toAnchor[0] - fromAnchor[0], toAnchor[1] - fromAnchor[1]];
                    // calculate the perpendicular unit vector (perp vectors have dot product of 0)
                    let perpVec = rendering.unitVector([1, -vec[0] / vec[1]]);

                    const dist = this.duplicateConnectionOffset * conn.index!;
                    const control: Point = [midpoint[0] + perpVec[0] * dist, midpoint[1] + perpVec[1] * dist]

                    controls.splice(controls.length > 0 ? 1 : 0, 0, control); // insert in middle.

                    // TODO I still don't quite like how this looks, maybe don't do the other two control points
                    // if we have this one? But then the arrows don't line up perpendicular. Maybe just reducing the dist
                    // to the control point?
                }

                // NOTE: were mutating the conn object, which is also in the anchored array.
                conn.controls = controls;
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
        [this.width, this.height] = rendering.getRect(this.diagram.node()!);
        this.throttledUpdate();
    }
}
