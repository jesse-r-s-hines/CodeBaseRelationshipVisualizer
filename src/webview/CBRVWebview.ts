import * as d3 from 'd3';

// d3-context-menu lacks types, so just manually requiring. This is working, but should consider better options:
// - VSCode built-in menu configuration
//     - Webview context menu support is new and zero documentation on how to get it working. See
//         - https://code.visualstudio.com/api/references/contribution-points#contributes.views
//         - https://github.com/microsoft/vscode/pull/154524
//         - https://github.com/microsoft/vscode/issues/156224
//         - https://github.com/gitkraken/vscode-gitlens/blob/main/package.json
// - Or 'vanilla-context-menu' has types
const d3ContextMenu = require("d3-context-menu")
import "d3-context-menu/css/d3-context-menu.css" // manually require the CSS

import tippy, {followCursor, Instance as Tippy} from 'tippy.js';
import 'tippy.js/dist/tippy.css'; // optional for styling

import { FileType, Directory, AnyFile, Connection, NormalizedConnection, MergedConnection,
         WebviewVisualizationSettings } from '../shared';
import { getExtension, filterFileTree, loopIndex, OptionalKeys } from '../util';
import * as geo from './geometry';
import { Point, Box } from './geometry';
import { uniqId, ellipsisText, getRect } from './rendering';
import { mergeByRules } from './merging';
import _, { isEqual } from "lodash";

type Node = d3.HierarchyCircularNode<AnyFile>;
type ConnPath = {id: string, conn: MergedConnection, path: string}
type ConnEnd = {
    conn: MergedConnection, end: "from"|"to",
    target: Point, // center of node or position on border of screen this connection logically connects to
    r?: number, // radius of the node (if applicable)
    anchor: Point // The point on the circumference or the border where the rendered connection will end
    anchorId: string, // a uniq id for the anchor we connected to
    theta?: number, // Angle from from.target to to.target
}
type IncompleteConnEnd = OptionalKeys<ConnEnd, "anchor"|"anchorId">

/**
 * This is the class that renders the actual diagram.
 */
export default class CBRVWebview {
    settings: WebviewVisualizationSettings
    codebase: Directory
    connections: Connection[]

    /**
     * Settings and constants for the diagram
     * These are in viewbox units unless specified otherwise
     */
    s = {
        /** Size (width and height) of the diagram within the svg viewbox */
        diagramSize: 1000,
        /** Margins of the svg diagram. The viewbox will be diagramSize plus these. */
        margin: { top: 10, right: 5, bottom: 5, left: 5 },
        file: {
            /** Padding between file circles */
            padding: 20,
            /** Minimum area of file circles */
            minSize: 16,
            /** Maximum area of file circles */
            maxSize: 1024 ** 2,
        },
        label: {
            /** Padding between labels and the outline of each file circle */
            padding: 2,
            /** Pixel size of the label font at the highest level. Size will shrink as we go down levels. */
            fontMax: 12,
            /** Minimum pixel size label font will shrink to at deepest depth. */
            fontMin: 12,
        },
        conn: {
            /** Space between connections to the same files distance along the circumference of the file circle  */
            anchorSpacing: 25,
            /** Duplicate connection offset, in pixels */
            dupConnPadding: 12,
            /** Distance between a circle outline and farthest side of a self loop */
            selfLoopSize: 20,
            /** Offset of control points in curves, as a percentage of the conn length */
            controlOffset: 0.20,
            /** Offset of control points for out-of-screen connections, as a percentage of the conn length */
            outOfScreenControlOffset: 0.10,
        },
        zoom: {
            /** Radius when a directory's contents will be hidden (in px) */
            hideContentsR: 16,
            /** Radius when a directory's or file's labels will be hidden (in px) */
            hideLabelsR: 20,
        },
    }
   
    // Parts of the d3 diagram
    diagram: d3.Selection<SVGSVGElement, unknown, HTMLElement, undefined>
    defs: d3.Selection<SVGDefsElement, unknown, HTMLElement, undefined>
    zoomWindow: d3.Selection<SVGGElement, unknown, HTMLElement, undefined>
    fileLayer: d3.Selection<SVGGElement, unknown, HTMLElement, undefined>
    connectionLayer: d3.Selection<SVGGElement, unknown, HTMLElement, undefined>
    connectionSelection?: d3.Selection<SVGPathElement, ConnPath, SVGGElement, unknown>

    includeInput: d3.Selection<HTMLInputElement, unknown, HTMLElement, undefined>
    excludeInput: d3.Selection<HTMLInputElement, unknown, HTMLElement, undefined>

    // Some d3 generation objects
    // See https://observablehq.com/@d3/spline-editor to compare curves
    curve = d3.line().curve(d3.curveBasis);

    // Some rendering variables

    /** Actual current pixel width and height of the svg diagram */
    width = 0; height = 0
    transform: d3.ZoomTransform = new d3.ZoomTransform(1, 0, 0);
    /** Maps file paths to their rendered circle (or first visible circle if they are hidden) */
    pathMap: Map<string, Node> = new Map()

    /** Pass the selector for the canvas svg */
    constructor(settings: WebviewVisualizationSettings, codebase: Directory, connections: Connection[]) {
        // filter empty directories
        this.codebase = filterFileTree(codebase, f => !(f.type == FileType.Directory && f.children.length == 0));
        this.settings = settings;
        this.connections = connections;

        // Create the SVG
        this.diagram = d3.select<SVGSVGElement, unknown>('#diagram')
            .attr("viewBox", this.getViewbox());
        this.defs = this.diagram.append("defs");
        this.zoomWindow = this.diagram.append("g")
            .classed("zoom-window", true);
        this.fileLayer = this.zoomWindow.append("g")
            .classed("file-layer", true);
        this.connectionLayer = this.zoomWindow.append("g")
            .classed("connection-layer", true);

        // Add event listeners
        this.throttledUpdate = _.throttle(() => this.update(), 250, {trailing: true})

        const [x, y, width, height] = this.getViewbox();
        const extent: [Point, Point] = [[x, y], [x + width, y + height]]
        const zoom = d3.zoom()
            .on('zoom', (e) => this.onZoom(e))
            .extent(extent)
            .scaleExtent([1, Infinity])
            .translateExtent(extent);
        this.diagram
            .call(zoom as any)
            .on("dblclick.zoom", null); // double-click zoom interferes with clicking on files and folders

        d3.select(window).on('resize', (e) => this.onResize(e));

        [this.width, this.height] = getRect(this.diagram.node()!);

        tippy.setDefaultProps({
            plugins: [followCursor],
        });

        this.includeInput = d3.select<HTMLInputElement, unknown>("#include")
        this.excludeInput = d3.select<HTMLInputElement, unknown>("#exclude")


        const updateFilters = () => this.emit('filter', {
            include: this.includeInput.property('value'),
            exclude: this.excludeInput.property('value'),
        })
        this.includeInput.on('change', updateFilters)
        this.excludeInput.on('change', updateFilters)

        this.update(this.settings, this.codebase, this.connections);
    }

    getViewbox(): Box {
        const { top, right, bottom, left } = this.s.margin;
        // use negatives to add margin since pack() starts at 0 0. Viewbox is [minX, minY, width, height]
        return [ -left, -top, left + this.s.diagramSize + right, top + this.s.diagramSize + bottom]
    }

    throttledUpdate: () => void

    update(settings?: WebviewVisualizationSettings, codebase?: Directory, connections?: Connection[]) {
        if (settings) {
            this.settings = settings;

            // if not directed, show all connections regardless of direction specified. 
            const showAll = settings.showOnHover == "both" || (settings.showOnHover && !this.settings.directed)

            // add some settings as data attributes for CSS access
            this.diagram
                .attr("data-show-on-hover", !!settings.showOnHover)
                .attr("data-show-on-hover-in", settings.showOnHover == "in" || showAll)
                .attr("data-show-on-hover-out", settings.showOnHover == "out" || showAll)

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

        root.sum(d => { // Compute size of files and folders.
            if (d.type == FileType.File) {
                return _.clamp(d.size, this.s.file.minSize, this.s.file.maxSize)
            } else { // only give empty folders a size (empty folders are normally filtered, but root can be empty)
                return d.children.length == 0 ? 1 : 0 
            }
        })

        // Sort by descending size for layout purposes
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Use d3 to calculate the circle packing layout
        const packLayout = d3.pack<AnyFile>()
            .size([this.s.diagramSize, this.s.diagramSize])
            .padding(this.s.file.padding)(root);

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
                        .attr('data-file', d => this.filePath(d))
                        .classed("file", d => d.data.type == FileType.File)
                        .classed("directory", d => d.data.type == FileType.Directory)
                        .classed("new", true); // We'll use this to reselect newly added nodes later.

                    // Draw the circles for each file and directory. Use path instead of circle so we can use textPath
                    // on it for the folder name
                    all.append("path")
                        .classed("circle", true)
                        .attr("id", d => uniqId(this.filePath(d)));

                    const files = all.filter(d => d.data.type == FileType.File);
                    const directories = all.filter(d => d.data.type == FileType.Directory);

                    // Add labels
                    files.append("text")
                        .append("tspan")
                            .classed("label", true)
                            .attr("x", 0)
                            .attr("y", 0)
                            .attr("font-size", d => Math.max(this.s.label.fontMax - d.depth, this.s.label.fontMin));

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
                            .attr("font-size", d => Math.max(this.s.label.fontMax - d.depth, this.s.label.fontMin));
  

                    const setHoverClasses = (node: Node, toggle: boolean) => {
                        const file = this.filePath(node)
                        // add hover classes to connected connections. CSS will hide/show connections
                        this.connectionSelection // selection will be set once we render connections
                            ?.filter(({conn}) =>
                                conn.from?.file == file || (conn.bidirectional && conn.to?.file == file)
                            )
                            .classed("hover-in", toggle)

                        this.connectionSelection
                            ?.filter(({conn}) =>
                                conn.to?.file == file || (conn.bidirectional && conn.from?.file == file)
                            )
                            .classed("hover-in", toggle)
                    }
                    
                    // Add event listeners.
                    all
                        .on("mouseover", (event, d) => setHoverClasses(d, true))
                        .on("mouseout", (event, d) => setHoverClasses(d, false))
                        .on("dblclick", (event, d) => {
                            if (d.data.type == FileType.Directory) {
                                this.emit("reveal-in-explorer", {file: this.filePath(d)})
                            } else {
                                this.emit("open", {file: this.filePath(d)})
                            }
                        })
                        .on("contextmenu", d3ContextMenu((d: Node) => this.contextMenu(d)))

                    files.each((d, i, nodes) => tippy(nodes[i], {
                        content: this.filePath(d),
                        delay: [1000, 0], // [show, hide]
                        followCursor: true,
                    }))
                    directories
                        .filter(d => d.depth > 0)
                        .select<SVGElement>(".label")
                        .each((d, i, nodes) => tippy(nodes[i], {
                            content: this.filePath(d),
                            delay: [1000, 0], // [show, hide]
                            followCursor: true,
                        }))

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
            .each((d, i, nodes) => ellipsisText(nodes[i], d.r * 2, d.r * 2, this.s.label.padding));

        const directoryLabels = directories.select<SVGTextPathElement>(".label")
            .text(d => d.data.name)
            .each((d, i, nodes) => ellipsisText(nodes[i], Math.PI * d.r /* 1/2 circumference */));

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
        this.pathMap = new Map();
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
        const paths = this.calculatePaths(merged);

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
            );

        this.connectionSelection = this.connectionLayer.selectAll<SVGPathElement, unknown>(".connection")
            .data(paths, ({id}: any) => id)
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("data-from", ({conn}) => conn.from?.file ?? "")
                    .attr("data-to", ({conn}) => conn.to?.file ?? "")
            )
                .attr("data-bidirectional", ({conn}) => conn.bidirectional)
                .attr("stroke-width", ({conn}) => conn.width)
                .attr("stroke", ({conn}) => conn.color)
                .attr("marker-end", ({conn}) => this.settings.directed ? `url(#${uniqId(conn.color)})` : null)
                .attr("marker-start", ({conn}) =>
                    this.settings.directed && conn.bidirectional ? `url(#${uniqId(conn.color)})` : null
                )
                .attr("d", ({path}) => path)
                .attr("data-tooltip-loaded", false) // clear this on update
                .each(({id, conn}, i, nodes) => tippy(nodes[i] as Element, {
                    content: "",
                    allowHTML: true,
                    delay: [250, 0], // [show, hide]
                    followCursor: true,
                    onShow: (instance) => {
                        const loaded = nodes[i].getAttribute("data-tooltip-loaded") == "true"
                        if (!loaded) this.emit("tooltip-request", {id, conn})
                        if (!loaded || !instance.props.content) return false // disabled or waiting until load
                    }
                }));
    }

    /**
     * Merge all the connections to combine connections going between the same files after being raised to the first
     * visible file/folder, using mergeRules.
     */
    mergeConnections(connections: Connection[]): MergedConnection[] {
        // Each keyFunc will split up connections in to smaller groups
        const raised = _(connections)
            .map(conn => this.normalizeConn(conn))
            .filter(conn => [conn.from, conn.to].every(e => !e || !!this.pathMap.get(e.file)))
            .map(conn => {
                const [from, to] = [conn.from, conn.to].map(
                    e => e ? this.filePath(this.pathMap.get(e.file)!) : undefined
                );
                const raised = this.normalizeConn({ from, to });
                return {conn: conn, raised};
            });

        if (this.settings.mergeRules) {
            return raised
                // top level is from/to after being raised to the first visible files/folders, regardless of merging
                .groupBy(({raised}) => this.connKey(raised, {lines: false, ordered: false}))
                .flatMap((pairs) => {
                    const obj = pairs.map(({conn, raised}) => ({
                        ...this.settings.connectionDefaults,
                        ...conn,
                        // special props for the special merge rules
                        file: this.connKey(conn, {lines: false, ordered: false}),
                        line: this.connKey(conn, {lines: true, ordered: false}),
                        direction: (raised.from?.file ?? '') <= (raised.to?.file ?? ''),
                        // We'll group these into arrays for use later
                        from: raised.from, to: raised.to, // override conn.from/to with raised
                        connections: conn,
                    }))

                    return mergeByRules(obj, {
                        ...this.settings.mergeRules,
                        from: "group", to: "group", connections: "group",
                    })
                })
                .map<MergedConnection>(obj => {
                    return {
                        ..._.omit(obj, ["file", "line", "direction"]),
                        from: obj.from[0], to: obj.to[0],
                        bidirectional: _(obj.from).some(from => isEqual(from, obj.to[0])),
                    } as MergedConnection
                })
                .value()
        } else { // no merging
            return raised
                .map(({conn, raised}) => ({
                    ...this.settings.connectionDefaults,
                    ...conn,
                    ...raised,
                    bidirectional: false,
                    connections: [conn],
                }))
                .value()
        }
    }

    /** Calculate the paths for each connection. */
    calculatePaths(connections: MergedConnection[]): ConnPath[] {
        const viewbox = this.getViewbox()

        // split out each "end" of the connections and calculate angles and target coords
        const ends = _(connections)
            .flatMap<IncompleteConnEnd>((conn) => {
                const [from, to] = [conn.from, conn.to]
                    .map(e => e ? this.pathMap.get(e.file)! : undefined)
                    .map((node, i, arr) => {
                        if (node) {
                            return { target: [node.x, node.y] as Point, r: node.r }
                        } else {
                            const other = arr[+!i]! // hack to get other node in the array
                            return { target: geo.closestPointOnBorder([other.x, other.y], viewbox) }
                        }
                    })
                
                let fromTheta: number|undefined
                let toTheta: number|undefined
                if (conn.from?.file != conn.to?.file) { // theta is meaningless for self loops
                    fromTheta = Math.atan2(to.target[1] - from.target[1], to.target[0] - from.target[0]);
                    // The other angle is just 180 deg around (saves us calculating atan2 again)
                    toTheta = geo.normalizeAngle(fromTheta + Math.PI);
                }

                return [
                    {conn, end: "from", ...from, theta: fromTheta},
                    {conn, end: "to", ...to, theta: toTheta},
                ]
            })
            .value()

        _(ends)
            // group all ends that connect to each file
            .groupBy(({conn, end}) => conn[end]?.file ?? '')
            .forEach(ends => this.anchorEnds(ends)) // anchor ends to actual coords

        return _(ends as ConnEnd[]) // we've completed the ConnEnds now
            .chunk(2) // combine from/to back together
            // group by connections between the same two anchor points
            .groupBy(([from, to]) => JSON.stringify([from.anchorId, to.anchorId]))
            .flatMap((pairs, key) =>
                pairs.map(([from, to], i) => ({
                    conn: from.conn,
                    id: `${key}:${i}`, // uniq id based on anchor points rather than from/to since that isn't unique
                    path: this.calculatePath(from, to, pairs.length, i), // calculate paths with control points etc.
                }))
            )
            .value()
    }

    /**
     * Pass list of incomplete conn ends that go to the same file, and it will anchor them all.
     * NOTE: It mutates the ends in ends.
     */
    anchorEnds(ends: IncompleteConnEnd[]): void {
        const {target, r: targetR, conn, end} = ends[0];
        const file = conn[end]?.file ?? '';

        if (targetR) { // This is an end to a normal file
            // Calculate number of anchor points by using the padding.connAnchorPoints arc length, but snapping
            // to a number that is divisible by 4 so we get nice angles.
            const numAnchors = Math.max(geo.snap((2*Math.PI*targetR) / this.s.conn.anchorSpacing, 4), 4);
            const deltaTheta = (2*Math.PI) / numAnchors;
            let anchorPoints: IncompleteConnEnd[][] = _.range(numAnchors).map(i => []);

            const hasArrow = ({conn, end}: IncompleteConnEnd) =>
                this.settings.directed && (end == "to" || conn.bidirectional)
    
            // assign to an anchor point and update the actual rendered point. Makes sure that connections going
            // opposite directions don't go to the same anchor point.
            const anchorConn = (connEnd: IncompleteConnEnd) => {
                const rawTheta = connEnd.theta!; // we know these aren't self loops

                // Check if connection has an arrow to this file
                const endHasArrow = hasArrow(connEnd);
                
                // Snap to angle, round to index to account for any floating point error
                const theta1 = geo.snapAngle(rawTheta, deltaTheta);
                const index1 = Math.round(theta1 / deltaTheta);
                const hasArrow1 = anchorPoints[index1].length ? hasArrow(anchorPoints[index1][0]) : undefined;

                // no conflict on first choice
                if (hasArrow1 == undefined || hasArrow1 == endHasArrow) {
                    anchorPoints[index1].push(connEnd);
                } else {
                    // fallback index if conflict. Assign in to even, and out to odd anchors.
                    // May be same as index1
                    const theta2 = geo.snapAngle(rawTheta, 2 * deltaTheta, endHasArrow ? 0 : deltaTheta);
                    const index2 = Math.round(theta2 / deltaTheta);
                    const connEnds2 = anchorPoints[index2];
                    const hasArrow2 = connEnds2.length ? hasArrow(connEnds2[0]) : undefined;

                    // no conflict on second choice
                    if (hasArrow2 == undefined || hasArrow2 == endHasArrow) {
                        anchorPoints[index2].push(connEnd);
                    } else { // conflict on second choice
                        anchorPoints[index2] = [connEnd];

                        for (let connEnd of connEnds2) {
                            anchorConn(connEnd); // may need to resolve conflicts recursively
                        }
                    }
                }
            }

            // should be called after all regular files are placed
            const anchorSelfLoop = (from: IncompleteConnEnd, to: IncompleteConnEnd) => {
                const len = anchorPoints.length;
                    
                // try to find two consecutive empty slots
                let toAnchor = anchorPoints.findIndex(
                    (a, i, arr) => arr[loopIndex(i - 1, len)].length == 0 && a.length == 0
                )
                
                // second best, find one empty even (to avoid arrow conflicts) slot for "to"
                if (toAnchor < 0) {
                    toAnchor = anchorPoints.findIndex((a, i) => i % 2 == 0 && a.length == 0);
                }

                // third best, even slot (to avoid arrow conflicts) with fewest self loops already
                if (toAnchor < 0) {
                    const min = _(anchorPoints)
                        .filter((p, i) => i % 2 == 0)
                        .minBy(anchor => // count number of self loops
                            _(anchor).sumBy(({conn}) => +(conn.from?.file == conn.to?.file))
                        )!
                    toAnchor = anchorPoints.findIndex(v => v == min)
                }

                const fromAnchor = loopIndex(toAnchor - 1, len);

                anchorPoints[fromAnchor].push(from)
                anchorPoints[toAnchor].push(to)
            }

            const [selfLoops, regular] = _(ends)
                .partition(({conn}) => conn.from?.file == conn.to?.file)
                .value()

            regular.forEach(connEnd => anchorConn(connEnd))

            // group and partition keep order, so we can just chunk to combine ends back together
            _(selfLoops).chunk(2).forEach(([from, to]) => anchorSelfLoop(from, to))

            // assign actual targets
            anchorPoints.forEach((ends, anchorI) => {
                ends.forEach(end => {
                    // NOTE: Mutating end
                    end.anchor = geo.polarToRect(deltaTheta * anchorI, targetR, target);
                    end.anchorId = JSON.stringify([file, anchorI]);
                })
            })
        } else { // out-of-screen connection
            ends.forEach(end => {
                // NOTE: Mutating end
                end.anchor = end.target; // anchor is just the same as target, which is closestPointOnBorder
                // use the file of the end that is connected to a real file as the anchorId
                end.anchorId = JSON.stringify(["", end.conn[end.end == "from" ? "to" : "from"]!.file]);
            })
        }
    }

    calculatePath(from: ConnEnd, to: ConnEnd, numDups: number, index: number): string {
        const conn = from.conn; // from/to should be same conn

        if (conn.from?.file != conn.to?.file) { // not a self loop
            return this.calculateRegularPath(from, to, numDups, index);
        } else { // self loop
            return this.calculateSelfLoopPath(from, to, numDups, index);
        }
    }

    calculateRegularPath(from: ConnEnd, to: ConnEnd, numDups: number, index: number): string {
        const conn = from.conn; // from/to should be same conn
        const dist = geo.distance(from.anchor, to.anchor);
        const even = (numDups % 2 == 0)

        let controls: Point[] = [];

        if (conn.from && conn.to) { // connection from file to file
            // calculate control points such that the bezier curve will be perpendicular to the
            // circle by extending the line from the center of the circle to the anchor point.
            const offset = dist * this.s.conn.controlOffset
            const control1 = geo.extendLine([from.target, from.anchor], offset);
            const control2 = geo.extendLine([to.target, to.anchor], offset);
            controls.push(control1, control2);
        } else {
            // For out-of-screen conns add controls on a straight line. We could leave these out but
            // but this makes the arrows line up if we have an offset for duplicate conns
            const offset = dist * this.s.conn.outOfScreenControlOffset;
            const control1 = geo.extendLine([from.anchor, to.anchor], -(dist - offset));
            const control2 = geo.extendLine([from.anchor, to.anchor], -offset);
            controls.push(control1, control2);
        }

        // Set a dupOffset. We'll use this to make sure connections between the same files don't overlap completely,
        // dupOffset will be symmetrically distributed around 0 so control points are symmetrical, e.g.
        // 3 conns -> -1, 0, 1
        // 4 conns -> -2, -1, 1, 2 (skipping 0 to make it symmetrical)
        let dupOffset = -Math.floor(numDups / 2) + index
        if (even && dupOffset >= 0) {
            dupOffset += 1;
        }

        if (dupOffset != 0) {
            // If we have multiple connections between the same two files, calculate another control
            // point based on the index so that the connections don't overlap completely. The
            // control point will be a distance from the line between from and to at the midpoint.
            const midpoint: Point = geo.midpoint(from.anchor, to.anchor);

            // Vector in direction of line between from and to
            const vec = [to.anchor[0] - from.anchor[0], to.anchor[1] - from.anchor[1]];
            // calculate the perpendicular unit vector (perp vectors have dot product of 0)
            let perpVec = geo.unitVector([1, -vec[0] / vec[1]]);

            const dist = this.s.conn.dupConnPadding * dupOffset;
            const control: Point = [
                midpoint[0] + perpVec[0] * dist,
                midpoint[1] + perpVec[1] * dist
            ]

            controls.splice(1, 0, control); // insert in middle.
        }

        return this.curve([from.anchor, ...controls, to.anchor])!.toString();
    }

    calculateSelfLoopPath(from: ConnEnd, to: ConnEnd, numDups: number, index: number): string {
        const dist = geo.distance(from.anchor, to.anchor);
        // The arc will start at from.anchor, pass point between selfLoopDistance from the edge of
        // the file circle, and then end at to.anchor

        // Calculate the angle between from/to.anchor and the center of the file circle. Different
        // than from.theta, which is between two targets (and isn't on self loops anyways).
        const fileCenter = from.target; // these are both the same
        const [[fromX, fromY], [toX, toY]] = [from.anchor, to.anchor]

        const fromTheta = Math.atan2(fromY - fileCenter[1], fromX - fileCenter[0]);
        const toTheta = Math.atan2(toY - fileCenter[1], toX - fileCenter[0]);
        // Calculate the angle between from and to
        let middleTheta = (fromTheta + toTheta) / 2
        if (Math.abs(fromTheta - toTheta) > Math.PI) { // bisect gets the "larger" angle
            middleTheta = middleTheta + Math.PI // need to rotate around 180
        }

        // Calculate the third point on the arc, that will be selfLoopDistance past the edge of the
        // file circle on the middle angle.
        const scaledDupOffset = index * this.s.conn.dupConnPadding;
        const distFromFileCenter = from.r! + this.s.conn.selfLoopSize + scaledDupOffset;
        const farPoint = geo.polarToRect(middleTheta, distFromFileCenter, fileCenter);

        // The center of the arc lies on the line between file center and farPoint and the
        // perpendicular bisector of the cord between from.target and farPoint
        // NOTE: neither slope can be vertical since numAnchors is divisible by 4, so top/bottom/left/right are anchors,
        // and the self loop will always connect to two adjacent anchors meaning it can't cross over the vertical to
        // make m1 vertical, or cross over the horizontal to make m2 vertical
        const m1 = geo.slope(fileCenter, farPoint);
        const m2 = -1 / geo.slope(from.anchor, farPoint); // perpendicular slope
        const midpoint = geo.midpoint(from.anchor, farPoint);
        const [midX, midY] = midpoint;

        const arcCenter: Point = [ // solve the two equations for their intersection
            (fromX * m1 - fromY - midX * m2 + midY) / (m1 - m2),
            (midY * m1 - m2 * (m1 * (midX - fromX) + fromY)) / (m1 - m2),
        ]

        const arcR = geo.distance(arcCenter, farPoint);

        // whether the arc is greater than 180 or not. This will be large-arc-flag
        const large = dist < 2 * arcR ? 1 : 0;
        // sweep-flag will always be 1 (positive angle or clockwise) to go outside of the file

        // d3 paths take angles, so its actually easier to just make an svg path string directly
        // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
        return `M ${fromX} ${fromY} A ${arcR},${arcR} 0 ${large} 1 ${toX},${toY}`;
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
        const ancestors = d.ancestors().reverse().slice(1).map(d => d.data.name)
        // Root dir will be "/". Since these aren't absolute paths and all other paths don't start with /, "" would be
        // more natural, but "" is already used for "out-of-screen" targets. root won't show up in any connections 
        // or tooltips anyway, so this is only internal.
        return ancestors.length == 0 ? "/" : ancestors.join("/");
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
        const viewToRenderedRatio = Math.min(this.width, this.height) / (this.s.diagramSize / this.transform.k);
        return viewPortLength * viewToRenderedRatio;
    }

    shouldHideContents(d: d3.HierarchyCircularNode<AnyFile>) {
        return d.data.type == FileType.Directory && this.calcPixelLength(d.r) <= this.s.zoom.hideContentsR;
    }

    shouldHideLabels(d: d3.HierarchyCircularNode<AnyFile>) {
        return this.calcPixelLength(d.r) <= this.s.zoom.hideLabelsR;
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

    emit(event: string, data: any) {
        this.diagram.node()!.dispatchEvent(new CustomEvent(`cbrv:${event}`, {detail: data}))
    }

    contextMenu(d: Node) {
        return [
            {
                title: 'Reveal in Explorer',
                action: (d: Node) => this.emit("reveal-in-explorer", {file: this.filePath(d)})
            },
            d.data.type == FileType.File ? {
                title: 'Open in Editor',
                action: (d: Node) => this.emit("open", {file: this.filePath(d)})
            } : undefined,
            {
                title: 'Copy Path',
                action: (d: Node) => this.emit("copy-path", {file: this.filePath(d)})
            },
            {
                title: 'Copy Relative Path',
                action: (d: Node) => this.emit("copy-relative-path", {file: this.filePath(d)})
            }
        ].filter(item => item)
    }

    setTooltip(id: string, content: string) {
        this.connectionSelection
            ?.filter((connPath) => connPath.id == id)
            .each((d, i, node) => { // there'll only be one
                const tooltip = (node[i] as any)._tippy as Tippy
                node[i].setAttribute("data-tooltip-loaded", "true")
                tooltip.setContent(content || "");
                if (content) {
                    tooltip.show()
                }
            })
    }
}
