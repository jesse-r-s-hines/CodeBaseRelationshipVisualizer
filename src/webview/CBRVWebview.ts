import * as d3 from 'd3';
import _ from "lodash";

// d3-context-menu lacks types, so just manually requiring. This is working, but should consider better options:
// - VSCode built-in menu configuration
//     - Webview context menu support is new and zero documentation on how to get it working. See
//         - https://code.visualstudio.com/api/references/contribution-points#contributes.views
//         - https://github.com/microsoft/vscode/pull/154524
//         - https://github.com/microsoft/vscode/issues/156224
//         - https://github.com/gitkraken/vscode-gitlens/blob/main/package.json
// - Or 'vanilla-context-menu' has types
const d3ContextMenu = require("d3-context-menu"); // eslint-disable-line
import "d3-context-menu/css/d3-context-menu.css"; // manually require the CSS

import tippy, {followCursor, Instance as Tippy} from 'tippy.js';
import 'tippy.js/dist/tippy.css'; // optional for styling
import { DeepPartial } from 'ts-essentials';

import { AnyFile, FileType, Directory, SymbolicLink, WebviewVisualizationSettings, CBRVWebviewMessage,
         WebviewMergedConnection, WebviewConnection, WebviewEndpoint } from '../types';
import { getExtension, filterFileTree, loopIndex, OptionalKeys } from '../util/util';
import * as geo from '../util/geometry';
import { Point, Box } from '../util/geometry';
import { ellipsisText, getRect } from './rendering';
import { RuleMerger } from '../util/ruleMerger';

type Node = d3.HierarchyCircularNode<AnyFile>;
type ConnPath = {id: string, conn: WebviewMergedConnection, path: string}
type ConnEnd = { // TODO maybe split this type out into FileConnEnd and OutOfScreenConnEnd
    conn: WebviewMergedConnection, end: "from"|"to",
    target: Point, // center of node or position on border of screen this connection logically connects to
    r?: number, // radius of the node (for file connections)
    hasArrow: boolean, // whether this end of the connection has an arrow marker
    anchorAngle?: number // The angle on the file circle to connect to (for file connections)
    anchorId: string, // a uniq id for the anchor we connected to
    theta: number, // Angle from from.target to to.target
}
type IncompleteConnEnd = OptionalKeys<ConnEnd, "anchorId"|"anchorAngle">
// Shortcut for d3.Selection
type Selection<GElement extends d3.BaseType = HTMLElement, Datum = unknown> =
    d3.Selection<GElement, Datum, d3.BaseType, undefined>
/**
 * This is the class that renders the actual diagram.
 */
export default class CBRVWebview {
    settings: WebviewVisualizationSettings
    codebase: Directory
    connections: WebviewConnection[]

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
            /** Width and height of arrow markers */
            arrowSize: 5,
        },
        zoom: {
            /** Radius when a directory's contents will be hidden (in px) */
            hideContentsR: 16,
            /** Radius when a directory's or file's labels will be hidden (in px) */
            hideLabelsR: 20,
            /** Amount pressing an arrow key will pan in viewbox units */
            panKeyAmount: 50, 
            /** Amount pressing Ctrl-+/- will scale*/
            zoomKeyAmount: 1.5, 
        },
    }
   
    // Parts of the d3 diagram
    diagram: Selection<Element>
    defs: Selection<SVGDefsElement>
    zoomWindow: Selection<SVGGElement>
    fileLayer: Selection<SVGGElement>
    connectionLayer: Selection<SVGGElement>
    allFilesSelection?: Selection<SVGGElement, Node>
    connectionSelection?: Selection<SVGPathElement, ConnPath>

    includeInput: Selection<HTMLInputElement>
    excludeInput: Selection<HTMLInputElement>
    hideUnconnectedInput: Selection<HTMLInputElement>
    showOnHoverSelect: Selection<HTMLSelectElement>
    showSelfLoopsInput: Selection<HTMLInputElement>

    zoom: d3.ZoomBehavior<Element, unknown>

    // Some d3 generation objects
    // See https://observablehq.com/@d3/spline-editor to compare curves
    curve = d3.line().curve(d3.curveBasis);

    // Some rendering variables

    /** Actual current pixel width and height of the svg diagram */
    width = 0; height = 0
    transform: d3.ZoomTransform = new d3.ZoomTransform(1, 0, 0);
    /** Maps file paths to their rendered circle (or first visible circle if they are hidden) */
    pathMap: Map<string, Node> = new Map()
    /** A set of the filenames of nodes have not moved in the last update */
    unchangedFiles: Set<string> = new Set()
    mergedConnectionsCache: WebviewMergedConnection[] = [];

    hoverTimerId?: number

    /** Pass the selector for the canvas svg */
    constructor(settings: WebviewVisualizationSettings, codebase: Directory, connections: WebviewConnection[]) {
        this.codebase = codebase;
        this.settings = settings;
        this.connections = connections;

        // Create the SVG
        this.diagram = d3.select<Element, unknown>('#diagram')
            .attr("viewBox", this.getViewbox());
        this.defs = this.diagram.append("defs");
        this.zoomWindow = this.diagram.append("g")
            .classed("zoom-window", true);
        this.fileLayer = this.zoomWindow.append("g")
            .classed("file-layer", true);
        this.connectionLayer = this.zoomWindow.append("g")
            .classed("connection-layer", true);

        // SVG taken from Font Awesome 6.2.1 (https://fontawesome.com) "fa-share" icon, with some positioning tweaks
        this.defs.html(`
            <svg id="symlink-icon" viewBox="0 -480 512 448">
                <path d="
                    M 307 -34.8 c -11.5 -5.1 -19 -16.6 -19 -29.2 v -64 H 176 C 78.8 -128 0 -206.8 0 -304 C 0 -417.3 81.5
                    -467.9 100.2 -478.1 c 2.5 -1.4 5.3 -1.9 8.1 -1.9 c 10.9 0 19.7 8.9 19.7 19.7 c 0 7.5 -4.3 14.4 -9.8
                    19.5 C 108.8 -431.9 96 -414.4 96 -384 c 0 53 43 96 96 96 h 96 v -64 c 0 -12.6 7.4 -24.1 19 -29.2 s
                    25 -3 34.4 5.4 l 160 144 c 6.7 6.1 10.6 14.7 10.6 23.8 s -3.8 17.7 -10.6 23.8 l -160 144 c -9.4 8.5
                    -22.9 10.6 -34.4 5.4 z
                "/>
            </svg>
        `);

        // Add event listeners
        this.throttledUpdate = _.throttle(() => this.update(), 150, {trailing: true});

        const [x, y, width, height] = this.getViewbox();
        const extent: [Point, Point] = [[x, y], [x + width, y + height]];
        this.zoom = d3.zoom()
            .on('zoom', (e) => this.onZoom(e))
            .extent(extent)
            .scaleExtent([1, Infinity])
            .translateExtent(extent);

        this.diagram
            .call(this.zoom as any)
            .on("dblclick.zoom", null) // double-click zoom interferes with clicking on files and folders
            .attr("tabindex", 0) // make svg focusable so it can receive keydown events
            .on("keydown", event => {
                const key = event.key;
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
                    const dx = key == "ArrowLeft" ? -1 : (key == "ArrowRight" ? +1 : 0);
                    const dy = key == "ArrowUp" ? -1 : (key == "ArrowDown" ? +1 : 0);
                    const amount = this.s.zoom.panKeyAmount / this.transform.k;
                    this.zoom.translateBy(this.diagram, dx * amount, dy * amount);
                } else if (event.ctrlKey && ['-', '='].includes(key)) {
                    const amount = this.s.zoom.zoomKeyAmount;
                    this.zoom.scaleBy(this.diagram, key == '=' ? amount : 1/amount);
                    event.stopPropagation(); // prevent VSCode from zooming the interface
                }
            });

        d3.select(window).on('resize', (e) => this.onResize(e));

        [this.width, this.height] = getRect(this.diagram.node()!);

        tippy.setDefaultProps({
            plugins: [followCursor],
        });

        this.includeInput = d3.select<HTMLInputElement, unknown>("#include");
        this.excludeInput = d3.select<HTMLInputElement, unknown>("#exclude");
        this.hideUnconnectedInput = d3.select<HTMLInputElement, unknown>("#hide-unconnected");
        this.showOnHoverSelect = d3.select<HTMLSelectElement, unknown>("#show-on-hover");
        this.showSelfLoopsInput = d3.select<HTMLInputElement, unknown>("#show-self-loops");

        const updateFilters = () => {
            this.emitUpdateSettings({
                filters: {
                    include: this.includeInput.property('value').trim(),
                    exclude: this.excludeInput.property('value').trim(),
                },
            });
        };
        this.includeInput.on('change', updateFilters);
        this.excludeInput.on('change', updateFilters);
        this.hideUnconnectedInput.on('change', () => {
            this.emitUpdateSettings({
                filters: {
                    hideUnconnected: !!this.hideUnconnectedInput.property('checked'),
                },
            });
        });
        this.showOnHoverSelect.on('change', () => {
            const value = this.showOnHoverSelect.property('value');
            this.emitUpdateSettings({
                showOnHover: value == "off" ? false : value,
            });
        });
        this.showSelfLoopsInput.on('change', () => {
            this.emitUpdateSettings({
                filters: {
                    showSelfLoops: !!this.showSelfLoopsInput.property('checked'),
                },
            });
        });

        this.update(this.settings, this.codebase, this.connections);
    }

    getViewbox(): Box {
        const { top, right, bottom, left } = this.s.margin;
        // use negatives to add margin since pack() starts at 0 0. Viewbox is [minX, minY, width, height]
        return [ -left, -top, left + this.s.diagramSize + right, top + this.s.diagramSize + bottom];
    }

    throttledUpdate: () => void

    update(settings?: WebviewVisualizationSettings, codebase?: Directory, connections?: WebviewConnection[]) {
        this.settings = settings ?? this.settings;
        this.codebase = codebase ?? this.codebase;
        this.connections = connections ?? this.connections;

        this.updateCodebase(!!(settings || codebase));
        this.updateConnections(!!(settings || codebase || connections));

        // this is cheap and influenced by multiple things so always update it.
        // And update it last so it can use connectionSelection
        this.updateMisc();
    }

    /** Update the layout/inputs/etc. */
    updateMisc() {
        // add some settings as data attributes for CSS access
        this.diagram
            .attr("data-show-on-hover", !!this.settings.showOnHover);

        // Hide hidUnconnectedInput if no connections. Use the selection rather than the connection list so the input
        // will be hidden if all connections are to missing/excluded files.
        const hasConnections = !!this.connectionSelection?.size();
        const inputDiv = d3.select(this.hideUnconnectedInput.node()!.parentElement);
        inputDiv.style("display", hasConnections ? 'inherit' : 'none');


        this.includeInput.property('value', this.settings.filters.include);
        this.excludeInput.property('value', this.settings.filters.exclude);
        this.hideUnconnectedInput.property('checked', this.settings.filters.hideUnconnected);
        this.showOnHoverSelect.property('value', this.settings.showOnHover || "off");
        this.showSelfLoopsInput.property('checked', this.settings.filters.showSelfLoops);
    }

    updateCodebase(fullRerender = true) { // rename to filesChanged
        const filteredCodebase = this.filteredCodebase();

        const root = d3.hierarchy<AnyFile>(filteredCodebase,
            f => f.type == FileType.Directory ? f.children : undefined
        );

        root.sum(d => { // Compute size of files and folders.
            if (d.type == FileType.File) {
                return _.clamp(d.size, this.s.file.minSize, this.s.file.maxSize);
            } else if (d.type == FileType.Directory) {    // only give empty folders a size. Empty folders are normally
                return d.children.length == 0 ? 1 : 0 ;   // filtered, but root can be empty.
            } else if (d.type == FileType.SymbolicLink) {
                return this.s.file.minSize; // render all symbolic links as the minimum size.
            } else {
                throw new Error(`Unknown type`); // shouldn't be possible, other types won't be sent.
            }
        });

        // Sort by descending size for layout purposes
        root.sort((a, b) => d3.descending(a.value, b.value));

        // Use d3 to calculate the circle packing layout
        const packLayout = d3.pack<AnyFile>() // pack is slow, maybe cache it? It only needs to change if files actually change. Also would let me move pathMap. Though profiling seems its only a problem first time so maybe not
            .size([this.s.diagramSize, this.s.diagramSize])
            .padding(this.s.file.padding)(root);

        const colorScale = this.getColorScale(packLayout);
        // Calculate unique key for each data. Use `type:path/to/file` so that types is treated as creating a new node
        // rather than update the existing one, which simplifies the logic.
        const keyFunc = (d: Node) => `${d.data.type}:${this.filePath(d)}`;

        const data = packLayout.descendants().filter(d => !d.parent || !this.shouldHideContents(d.parent));

        const all = this.fileLayer.selectAll(".file, .directory")
            .data(data, keyFunc as any) // the typings here seem to be incorrect
            .join(
                enter => {
                    const all = enter.append('g')
                        .attr('data-file', d => this.filePath(d))
                        .classed("file", d => this.resolvedType(d) == FileType.File)
                        .classed("directory", d => this.resolvedType(d) == FileType.Directory)
                        .classed("symlink", d => d.data.type == FileType.SymbolicLink)
                        .classed("new", true); // We'll use this to reselect newly added nodes later.

                    // Draw the circles for each file and directory. Use path instead of circle so we can use textPath
                    // on it for the folder name
                    all.append("path")
                        .classed("circle", true)
                        .attr("id", d => `file-${this.filePath(d)}`);

                    const files = all.filter(d => this.resolvedType(d) == FileType.File);
                    const directories = all.filter(d => this.resolvedType(d) == FileType.Directory);
                    const symlinks = all.filter(d => d.data.type == FileType.SymbolicLink); // overlaps files/directories

                    // Add labels
                    files.filter(d => d.data.type != FileType.SymbolicLink)
                        .append("text")
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
                            .attr("href", d => `#file-${encodeURIComponent(this.filePath(d))}`)
                            .attr("startOffset", "50%")
                            .attr("font-size", d => Math.max(this.s.label.fontMax - d.depth, this.s.label.fontMin));
  
                    directories.append("text")
                        .append("tspan")
                            .classed("contents-hidden-label", true)
                            .attr("x", 0)
                            .attr("y", 0)
                            .attr("font-size", d => this.calcPixelLength(d.r)) // wait... scaling is after this...
                            .text("...");

                    const iconSize = this.s.file.minSize * 1.5;
                    symlinks.append("use")
                            .classed("symlink-icon", true)
                            .attr("href", "#symlink-icon")
                            .attr("x", -iconSize/2) // offset to be centered
                            .attr("y", -iconSize/2)
                            .attr("width", iconSize) // minSize is radius
                            .attr("height", iconSize)
                            .style("fill", d => {
                                const isDir = this.resolvedType(d) == FileType.Directory;
                                return `var(--vscode-editor-${isDir ? 'foreground' : 'background'})`;
                            });

                    const showConnectedConns = (node: Node, toggle: boolean) => {
                        const {showOnHover, directed} = this.settings;
                        if (showOnHover) {
                            // if not directed, show all connections regardless of direction specified.
                            const showAll = (showOnHover == "both" || (showOnHover && !directed));
                            const showIn = (showOnHover == "in" || showAll);
                            const showOut = (showOnHover == "out" || showAll);
                            const file = this.filePath(node);

                            // Show/hide connections
                            const selection = this.connectionSelection!
                                .filter(({conn}) => {
                                    const [fromFile, toFile] = [conn.from, conn.to].map(e => e?.file == file);
                                    return (showOut && (fromFile || (conn.bidirectional && toFile))) ||
                                           (showIn && (toFile || (conn.bidirectional && fromFile)));
                                });

                            this.connShowTransition(selection, toggle);
                        }
                    };
                    
                    // Add event listeners.
                    all
                        .on("mouseover", (event, d) => showConnectedConns(d, true))
                        .on("mouseout", (event, d) => showConnectedConns(d, false))
                        .on("dblclick", (event, d) => {
                            if (d.data.type == FileType.Directory) {
                                this.emit({type: "reveal", file: this.filePath(d)});
                            } else if (d.data.type == FileType.File) {
                                this.emit({type: "open", file: this.filePath(d)});
                            } else if (d.data.type == FileType.SymbolicLink) {
                                const jumpTo = this.pathMap.get(d.data.resolved);
                                if (jumpTo) {
                                    this.emphasizeFile(jumpTo);
                                }
                            }
                        })
                        .on("contextmenu", d3ContextMenu((d: Node) => this.contextMenu(d)));

                    all
                        .filter(d => d.depth > 0) // don't tooltip to root folder
                        .each((d, i, nodes) => tippy(nodes[i], {
                            content: this.filePath(d),
                            delay: [1000, 0], // [show, hide]
                            followCursor: true,
                        }));

                    return all;
                },
                update => { // TODO transitions
                    return update.classed("new", false);
                },
                exit => exit
                    .each((d, i, nodes) => (nodes[i] as any)._tippy?.destroy()) // destroy any tippy instances
                    .remove()
            );

        all
            .classed("contents-hidden", d => this.shouldHideContents(d))
            .classed("labels-hidden", d => this.shouldHideLabels(d));

        // we only need to recalculate these for new elements unless the file structure changed (not just zoom)
        const changed = fullRerender ? all : all.filter(".new");
        
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

        this.allFilesSelection = all as Selection<SVGGElement, Node>;

        // Store a map of paths to nodes for future use in connections
        const newPathMap = new Map<string, Node>();
        packLayout.each((d) => {
            // get d or the first ancestor that is visible
            const firstVisible = d.ancestors().find(p => !p.parent || !this.shouldHideContents(p.parent))!;
            newPathMap.set(this.filePath(d), firstVisible);
        });
        this.unchangedFiles = new Set();
        if (!fullRerender) { // full rerender nothing is unchanged
            for (const [filePath, newNode] of newPathMap) {
                const oldNode = this.pathMap.get(filePath);
                if (oldNode && this.filePath(oldNode) == this.filePath(newNode)) {
                    this.unchangedFiles.add(filePath);
                }
            }
        }
        this.pathMap = newPathMap;
    }

    filteredCodebase() {
        let connected: Set<string> = new Set();
        if (this.settings.filters.hideUnconnected) {
            connected = new Set(_(this.connections)
                .flatMap(conn => [conn.from?.file, conn.to?.file].filter(e => e) as string[])
                .uniq().value()
            );
        }

        return filterFileTree(this.codebase, (f, path) =>
            !(this.settings.filters.hideUnconnected && f.type != FileType.Directory && !connected.has(path)) &&
            !(f.type == FileType.Directory && f.children.length == 0) // filter empty dirs
        );
    }

    updateConnections(fullRerender = true) {
        let merged: WebviewMergedConnection[];
        let paths: ConnPath[];

        if (fullRerender || this.mergedConnectionsCache.length == 0) {
            merged = this.mergeConnections(this.connections);
            paths = this.calculatePaths(merged);
        } else {
            const changed = this.connections
                .filter(conn => [conn.from, conn.to].some(e => e && !this.unchangedFiles.has(e.file)));
            if (changed.length == 0) {
                return; // nothing to do, we don't need to rerender anything.
            }

            const unchanged = this.mergedConnectionsCache
                .filter(mergedConn =>
                    mergedConn.connections.every(conn =>
                        [conn.from, conn.to].every(e => !e || this.unchangedFiles.has(e.file))
                    )
                );
            merged = [...unchanged, ...this.mergeConnections(changed)];
            paths = this.calculatePaths(merged);
        }

        this.mergedConnectionsCache = merged;

        // If directed == false, we don't need any markers
        const markers = this.settings.directed ? _(merged).map(c => c.color).uniq().value() : [];

        this.defs.selectAll("marker.arrow")
            .data(markers, color => color as string)
            .join(
                enter => enter.append('marker')
                    .classed("arrow", true)
                    .attr("id", color => `arrow-head-${color}`)
                    .attr("viewBox", "0 0 8 6")
                    .attr("refX", 4)
                    .attr("refY", 3)
                    .attr("markerWidth", this.s.conn.arrowSize)
                    .attr("markerHeight", this.s.conn.arrowSize)
                    .attr("orient", "auto-start-reverse")
                    .append("path")
                        .attr("d", "M 0 0 L 8 3 L 0 6 z")
                        .attr("fill", color => color),
            );

        this.connectionSelection = this.connectionLayer.selectAll<SVGPathElement, unknown>(".connection")
            .data(paths, ({id}: any) => id)
            .join(
                enter => enter.append("path")
                    .classed("connection", true)
                    .attr("data-from", ({conn}) => conn.from?.file ?? "")
                    .attr("data-to", ({conn}) => conn.to?.file ?? "")
                    // To avoid creating many tippy instances, create them dynamically on hover over a connection
                    .on("mouseover", (event, {id, conn}) => {
                        const elem = event.currentTarget as HTMLElement;
                        clearTimeout(this.hoverTimerId);
                        if (!elem.hasAttribute("data-tippy-content")) {
                            const mergedConnSet = new Set(conn.connections);
                            const connIndices = _(this.connections)
                                .entries()
                                .filter(([i, origConn]) => mergedConnSet.has(origConn))
                                .map(([i, origConn]) => +i)
                                .value();

                            this.hoverTimerId = _.delay(() => {
                                this.emit({
                                    type: "tooltip-request",
                                    id,
                                    conn: {...conn, connections: connIndices },
                                }); // will create and trigger the tooltip
                            }, 250);
                        }
                        this.connShowTransition(d3.select(event.currentTarget), true);
                    })
                    .on("mouseout", (event, {id, conn}) => {
                        clearTimeout(this.hoverTimerId);
                        this.connShowTransition(d3.select(event.currentTarget), false);
                    }),
                update => update,
                exit => exit
                    .each((d, i, nodes) => (nodes[i] as any)._tippy?.destroy()) // destroy any tippy instances
                    .remove()
            )
                .attr("data-bidirectional", ({conn}) => conn.bidirectional)
                .attr("stroke-width", ({conn}) => conn.width)
                .attr("stroke", ({conn}) => conn.color)
                .attr("marker-end", ({conn}) =>
                    this.settings.directed ? `url("#arrow-head-${encodeURIComponent(conn.color)}")` : null
                )
                .attr("marker-start", ({conn}) => this.settings.directed && conn.bidirectional ?
                    `url("#arrow-head-${encodeURIComponent(conn.color)}")` : null
                )
                .attr("d", ({path}) => path)
                .attr("data-tippy-content", null) // set this on tooltip creation
                .interrupt() // clear transitions
                .style("display", null) // unset these to clear any showOnHover transitions
                .style("opacity", null);
    }

    /**
     * Merge all the connections to combine connections going between the same files after being raised to the first
     * visible file/folder, using mergeRules.
     */
    mergeConnections(connections: WebviewConnection[]): WebviewMergedConnection[] {
        // Each keyFunc will split up connections in to smaller groups
        let raised = _(connections)
            // filter connections to missing files
            .filter(conn => [conn.from, conn.to].every(e => !e || !!this.pathMap.get(e.file)))
            .map(conn => { // raise to first visible file
                const [from, to] = [conn.from, conn.to].map(
                    e => e ? {file: this.filePath(this.pathMap.get(e.file)!)} : undefined
                );
                const raised: WebviewConnection = {from, to};
                return {conn, raised};
            });
        if (!this.settings.filters.showSelfLoops) {
            raised = raised.filter(({raised}) => raised.from?.file != raised.to?.file);
        }

        if (this.settings.mergeRules) {
            const merger = new RuleMerger(
                {
                    ...this.settings.mergeRules,
                    from: "group", to: "first", connections: "group",
                },
                {},
                { // virtual properties that can be used in the rules
                    // o.connections will be the single connection for the object (since we haven't grouped it yet)
                    file: (o: any) => this.connKey(o.connections, false, false),
                    line: (o: any) => this.connKey(o.connections, true, false),
                    direction: (o: any) => (o.from?.file ?? '') <= (o.to?.file ?? ''),
                }
            );

            return raised
                // top level is from/to after being raised to the first visible files/folders, regardless of merging
                .groupBy(({raised}) => this.connKey(raised, false, false))
                .flatMap((pairs) => {
                    const obj = pairs.map(({conn, raised}) => ({
                        ...this.settings.connectionDefaults,
                        ...conn,
                        // We'll group these into arrays for use later
                        from: raised.from, to: raised.to, // override conn.from/to with raised
                        connections: conn,
                    }));

                    return merger.merge(obj);
                })
                .map<WebviewMergedConnection>(obj => {
                    const from = obj.from[0];
                    const to = obj.to;
                    const isSelfLoop = (from?.file === to?.file);

                    return {
                        ...obj,
                        from, to,
                        bidirectional: !isSelfLoop && (obj.from.some((e: WebviewEndpoint) => e?.file === to?.file)),
                    } as WebviewMergedConnection;
                })
                .value();
        } else { // no merging
            return raised
                .map(({conn, raised}) => ({
                    ...this.settings.connectionDefaults,
                    ...conn,
                    ...raised,
                    bidirectional: false,
                    connections: [conn],
                }))
                .value();
        }
    }

    /** Calculate the paths for each connection. */
    calculatePaths(connections: WebviewMergedConnection[]): ConnPath[] {
        const viewbox = this.getViewbox();
        const directed = this.settings.directed;

        // split out each "end" of the connections and calculate angles and target coords
        const ends = _(connections)
            .flatMap<IncompleteConnEnd>((conn) => {
                const [from, to] = [conn.from, conn.to]
                    .map(e => e ? this.pathMap.get(e.file)! : undefined)
                    .map((node, i, arr) => {
                        if (node) {
                            return { target: [node.x, node.y] as Point, r: node.r };
                        } else {
                            const other = arr[+!i]!; // hack to get other node in the array
                            return { target: geo.closestPointOnBorder([other.x, other.y], viewbox) };
                        }
                    });
                
                let fromTheta = 0;
                let toTheta = 0;
                if (conn.from?.file != conn.to?.file) { // theta is meaningless for self loops
                    fromTheta = Math.atan2(to.target[1] - from.target[1], to.target[0] - from.target[0]);
                    // The other angle is just 180 deg around (saves us calculating atan2 again)
                    toTheta = geo.normalizeAngle(fromTheta + Math.PI);
                }

                return [
                    {conn, end: "from", ...from, theta: fromTheta, hasArrow: directed && conn.bidirectional},
                    {conn, end: "to", ...to, theta: toTheta, hasArrow: directed},
                ];
            })
            .value();

        _(ends)
            // group all ends that connect to each file
            .groupBy(({conn, end}) => conn[end]?.file ?? '')
            .forEach(ends => this.anchorEnds(ends)); // anchor ends to actual coords

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
            .value();
    }

    /**
     * Pass list of incomplete conn ends that go to the same file, and it will anchor them all.
     * NOTE: It mutates the ends in ends.
     */
    anchorEnds(ends: IncompleteConnEnd[]): void {
        const {r: targetR, conn, end} = ends[0];
        const file = conn[end]?.file ?? '';

        if (targetR) { // This is an end to a normal file
            // Calculate number of anchor points by using the padding.connAnchorPoints arc length, but snapping
            // to a number that is divisible by 4 so we get nice angles.
            const numAnchors = Math.max(geo.snap((2*Math.PI*targetR) / this.s.conn.anchorSpacing, 4), 4);
            const deltaTheta = (2*Math.PI) / numAnchors;
            const anchorPoints: IncompleteConnEnd[][] = _.times(numAnchors, i => []);

            // assign to an anchor point and update the actual rendered point. Makes sure that connections going
            // opposite directions don't go to the same anchor point.
            const anchorConn = (connEnd: IncompleteConnEnd) => {
                const rawTheta = connEnd.theta!; // we know these aren't self loops

                // Snap to angle, round to index to account for any floating point error
                const theta1 = geo.snapAngle(rawTheta, deltaTheta);
                const index1 = Math.round(theta1 / deltaTheta);
                const hasArrow1 = anchorPoints[index1].length ? anchorPoints[index1][0].hasArrow : undefined;

                // no conflict on first choice
                if (hasArrow1 == undefined || hasArrow1 == connEnd.hasArrow) {
                    anchorPoints[index1].push(connEnd);
                } else {
                    // fallback index if conflict. Assign in to even, and out to odd anchors.
                    let index2: number;
                    if ((index1 % 2 == 0) == connEnd.hasArrow) {
                        index2 = index1; // keep choice
                    } else {
                        // find a nearby anchor point that matches our arrow. from and to will look in opposite
                        // directions around the circle so that the adjustments are more likely to line up nicely.
                        index2 = loopIndex(index1 + (connEnd.end == "to" ? -1 : +1), numAnchors);
                    }
                    const connEnds2 = anchorPoints[index2];
                    const hasArrow2 = connEnds2.length ? connEnds2[0].hasArrow : undefined;

                    // no conflict on second choice
                    if (hasArrow2 == undefined || hasArrow2 == connEnd.hasArrow) {
                        anchorPoints[index2].push(connEnd);
                    } else { // conflict on second choice
                        anchorPoints[index2] = [connEnd];

                        for (const connEnd of connEnds2) {
                            anchorConn(connEnd); // may need to resolve conflicts recursively
                        }
                    }
                }
            };

            // should be called after all regular files are placed
            const anchorSelfLoop = (from: IncompleteConnEnd, to: IncompleteConnEnd) => {
                const len = anchorPoints.length;
                    
                // try to find two consecutive empty slots
                let toAnchor = anchorPoints.findIndex(
                    (a, i, arr) => arr[loopIndex(i - 1, len)].length == 0 && a.length == 0
                );
                
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
                        )!;
                    toAnchor = anchorPoints.findIndex(v => v == min);
                }

                const fromAnchor = loopIndex(toAnchor - 1, len);

                anchorPoints[fromAnchor].push(from);
                anchorPoints[toAnchor].push(to);
            };

            const [selfLoops, regular] = _(ends)
                .partition(({conn}) => conn.from?.file == conn.to?.file)
                .value();

            regular.forEach(connEnd => anchorConn(connEnd));

            // group and partition keep order, so we can just chunk to combine ends back together
            _(selfLoops).chunk(2).forEach(([from, to]) => anchorSelfLoop(from, to));

            // assign actual targets
            anchorPoints.forEach((ends, anchorI) => {
                ends.forEach(end => {
                    // NOTE: Mutating end
                    end.anchorId = `r:${file}:${anchorI}`;
                    end.anchorAngle = deltaTheta * anchorI;
                });
            });
        } else { // out-of-screen connection
            ends.forEach(end => {
                // NOTE: Mutating end
                // use the file of the end that is connected to a real file as the anchorId
                const connectedFile = end.conn[end.end == "from" ? "to" : "from"]!.file;
                end.anchorId = `oos:${connectedFile}`;
            });
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
        const arrowSize = this.s.conn.arrowSize * conn.width / 2;
        const [fromAnchor, toAnchor] = [from, to].map(e => {
            if (e.anchorAngle !== undefined) {
                // calc point on circle, but offset by arrow size so arrow tip just touches circle
                return geo.polarToRect(e.anchorAngle, e.r! + (e.hasArrow ? arrowSize: 0), e.target);
            } else { // out of border
                if (e.hasArrow) {
                    // recalculate the closestPointOnBorder, but shift border in by arrowSize so arrow fits.
                    const [bx, by, bw, bh] = this.getViewbox();
                    const border: Box = [bx + arrowSize, by + arrowSize, bw - 2 * arrowSize, bh - 2 * arrowSize];
                    const other = e.end == "from" ? to : from;
                    return geo.closestPointOnBorder(other.target, border);
                } else {
                    return e.target;
                }
            }
        });

        const dist = geo.distance(fromAnchor, toAnchor);
        const even = (numDups % 2 == 0);

        const controls: Point[] = [];

        if (conn.from && conn.to) { // connection from file to file
            // calculate control points such that the bezier curve will be perpendicular to the
            // circle by extending the line from the center of the circle to the anchor point.
            const offset = dist * this.s.conn.controlOffset;
            const control1 = geo.extendLine([from.target, fromAnchor], offset);
            const control2 = geo.extendLine([to.target, toAnchor], offset);
            controls.push(control1, control2);
        } else {
            // For out-of-screen conns add controls on a straight line. We could leave these out but
            // but this makes the arrows line up if we have an offset for duplicate conns
            const offset = dist * this.s.conn.outOfScreenControlOffset;
            const control1 = geo.extendLine([fromAnchor, toAnchor], -(dist - offset));
            const control2 = geo.extendLine([fromAnchor, toAnchor], -offset);
            controls.push(control1, control2);
        }

        // Set a dupOffset. We'll use this to make sure connections between the same files don't overlap completely,
        // dupOffset will be symmetrically distributed around 0 so control points are symmetrical, e.g.
        // 3 conns -> -1, 0, 1
        // 4 conns -> -2, -1, 1, 2 (skipping 0 to make it symmetrical)
        let dupOffset = -Math.floor(numDups / 2) + index;
        if (even && dupOffset >= 0) {
            dupOffset += 1;
        }

        if (dupOffset != 0) {
            // If we have multiple connections between the same two files, calculate another control
            // point based on the index so that the connections don't overlap completely. The
            // control point will be a distance from the line between from and to at the midpoint.
            const midpoint: Point = geo.midpoint(fromAnchor, toAnchor);

            // Vector in direction of line between from and to
            const vec = [toAnchor[0] - fromAnchor[0], toAnchor[1] - fromAnchor[1]];
            // calculate the perpendicular unit vector (perp vectors have dot product of 0)
            const perpVec = geo.unitVector((vec[1] != 0) ? [1, -vec[0] / vec[1]] : [0, 1]);

            const dist = this.s.conn.dupConnPadding * dupOffset;
            const control: Point = [
                midpoint[0] + perpVec[0] * dist,
                midpoint[1] + perpVec[1] * dist
            ];

            controls.splice(1, 0, control); // insert in middle.
        }

        return this.curve([fromAnchor, ...controls, toAnchor])!.toString();
    }

    calculateSelfLoopPath(from: ConnEnd, to: ConnEnd, numDups: number, index: number): string {
        const [fromAnchor, toAnchor] = [from, to].map(e => geo.polarToRect(e.anchorAngle!, e.r!, e.target));

        const dist = geo.distance(fromAnchor, toAnchor);
        // The arc will start at fromAnchor, pass through the point between fromAnchor and toAnchor and selfLoopDistance
        // from the edge of the file circle, and then end at toAnchor

        // Calculate the angle between from/toAnchor and the center of the file circle. This is different than
        // from.theta, which is between two targets (and isn't applicable to self loops anyways).
        const fileCenter = from.target; // from/to are are both the same
        const [[fromX, fromY], [toX, toY]] = [fromAnchor, toAnchor];

        const fromTheta = Math.atan2(fromY - fileCenter[1], fromX - fileCenter[0]);
        const toTheta = Math.atan2(toY - fileCenter[1], toX - fileCenter[0]);
        // Calculate the angle between from and to
        let middleTheta = (fromTheta + toTheta) / 2;
        if (Math.abs(fromTheta - toTheta) > Math.PI) { // bisect gets the "larger" angle
            middleTheta = middleTheta + Math.PI; // need to rotate around 180
        }

        // Calculate the third point on the arc, that will be selfLoopDistance past the edge of the file circle on the
        // middle angle.
        const scaledDupOffset = index * this.s.conn.dupConnPadding;
        const distFromFileCenter = from.r! + this.s.conn.selfLoopSize + scaledDupOffset;
        const farPoint = geo.polarToRect(middleTheta, distFromFileCenter, fileCenter);

        // The center of the arc lies on the line between file center and farPoint and the perpendicular bisector of the
        // cord between from.target and farPoint
        // NOTE: neither slope can be vertical since numAnchors is divisible by 4, so top/bottom/left/right are anchors,
        // and the self loop will always connect to two adjacent anchors meaning it can't cross over the vertical to
        // make m1 vertical, or cross over the horizontal to make m2 vertical
        const m1 = geo.slope(fileCenter, farPoint);
        const m2 = -1 / geo.slope(fromAnchor, farPoint); // perpendicular slope
        const [midX, midY] = geo.midpoint(fromAnchor, farPoint);
        const [cx, cy] = fileCenter;

        const arcCenter: Point = [ // solve the two equations for their intersection
            (m1 * cx - m2 * midX + midY - cy) / (m1 - m2),
            (m1 * midY - m2 * cy - m1 * m2 * (midX - cx)) / (m1 - m2),
        ];

        const arcR = geo.distance(arcCenter, farPoint);

        // whether the arc is greater than 180 or not. This will be large-arc-flag
        const large = dist < 2 * arcR ? 1 : 0;
        // sweep-flag will always be 1 (positive angle or clockwise) to go outside of the file

        // Move the end of the path back so that the arrow head just touches the file circle
        let arcEnd: Point;
        let redirection: string;
        if (to.hasArrow) {
            const arrowSize = this.s.conn.arrowSize * to.conn.width / 2;

            // get angle between arcCenter and the to point
            const baseTheta = Math.atan2(toY - arcCenter[1], toX - arcCenter[0]);
            // I want the point where the cord between it and the anchor equals the arrow sizes
            const shiftBackTheta = Math.acos((2 * arcR ** 2 - arrowSize ** 2) / (2 * arcR ** 2)); // use law of cosigns
            const theta = geo.normalizeAngle(baseTheta - shiftBackTheta);

            arcEnd = geo.polarToRect(theta, arcR, arcCenter);
            // Add a tiny line at the end so the arrow goes towards the anchor point.
            const redirectionPoint = geo.extendLine([arcEnd, toAnchor], -geo.distance(arcEnd, toAnchor) + 0.1);
            redirection = `L ${redirectionPoint[0]},${redirectionPoint[1]}`;
        } else {
            arcEnd = toAnchor;
            redirection = "";
        }

        // d3 paths take angles, so its actually easier to just make an svg path string directly
        // Arc path args: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
        return `M ${fromX} ${fromY} A ${arcR},${arcR} 0 ${large} 1 ${arcEnd[0]},${arcEnd[1]} ${redirection}`;
    }

    /** Returns a function used to compute color from file extension */
    getColorScale(nodes: Node): (d: AnyFile) => string | null {
        const domain = _(nodes.descendants()) // lodash is lazy
            .filter(n => n.data.type != FileType.Directory)
            .map(n => getExtension((n.data.type == FileType.SymbolicLink) ? n.data.resolved : n.data.name))
            .uniq()
            .value();
        // interpolateRainbow loops around so the first and last entries are the same, so +1 and slice off end to make
        // all colors unique. Also, quantize requires n > 1, so the +1 also fixes that.
        const range = d3.quantize(d3.interpolateRainbow, domain.length + 1).slice(0, -1);
        const colorScale = d3.scaleOrdinal(domain, range);

        return (d: AnyFile) => {
            if (d.type == FileType.Directory) {
                return null;
            } else if (d.type == FileType.SymbolicLink) {
                return colorScale(getExtension(d.resolved));
            } else {
                return colorScale(getExtension(d.name));
            }
        };
    }

    filePath(d: Node): string {
        const ancestors = d.ancestors().reverse().slice(1).map(d => d.data.name);
        // Root dir will be "/". Since these aren't absolute paths and all other paths don't start with /, "" would be
        // more natural, but "" is already used for "out-of-screen" targets. root won't show up in any connections 
        // or tooltips anyway, so this is only internal.
        return ancestors.length == 0 ? "/" : ancestors.join("/");
    }

    /** Returns the type of the file if its a regular file, or its linked file type if its a symlink. */
    resolvedType(d: Node): FileType.File|FileType.Directory {
        return (d.data.type == FileType.SymbolicLink) ? d.data.linkedType : d.data.type;
    }

    connKey(conn: WebviewConnection, lines = true, ordered = true): string {
        let from = conn.from ? `${conn.from.file}:${lines && conn.from.line ? conn.from.line : ''}` : '';
        let to = conn.to ? `${conn.to.file}:${lines && conn.to.line ? conn.to.line : ''}` : '';
        if (!ordered && from > to) {
            [to, from] = [from, to];
        }
        return JSON.stringify(from) + "," + JSON.stringify(to);
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

    onZoom(e: d3.D3ZoomEvent<SVGSVGElement, WebviewConnection>) {
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

    emit(message: CBRVWebviewMessage) {
        this.diagram.node()!.dispatchEvent(new CustomEvent(`cbrv:send`, {detail: message}));
    }

    emitUpdateSettings(settingsUpdate: DeepPartial<WebviewVisualizationSettings>, rerender = true) {
        const newSettings = _.merge({}, this.settings, settingsUpdate);
        if (rerender) {
            this.update(newSettings);
        } else {
            this.settings = newSettings;
        }
        this.emit({type: "update-settings", settings: settingsUpdate});
    }

    contextMenu(d: Node) {
        const fileType = (this.resolvedType(d) == FileType.Directory) ? 'directory' : 'file';
        return this.settings.contextMenu[fileType].map((item, i) => ({
            title: item.title,
            action: (d: Node) => this.emit({
                type: "context-menu",
                action: `${fileType}-${i}`,
                file: this.filePath(d),
            })
        }));
    }

    setTooltip(id: string, content: string) {
        this.connectionSelection
            ?.filter((connPath) => connPath.id == id)
            .each((d, i, node) => { // there'll only be one
                const elem = node[i];
                let tooltip = (elem as any)._tippy as Tippy|undefined;

                if (content) {
                    elem.setAttribute("data-tippy-content", content);
                    tooltip = tooltip ?? tippy(elem, {
                        allowHTML: true,
                        delay: [250, 0], // [show, hide]
                        followCursor: true,
                    });
                    tooltip.show();
                } else {
                    tooltip?.hide();
                    tooltip?.destroy();
                }
            });
    }

    connShowTransition(selection: Selection<SVGPathElement, ConnPath>, toggle: boolean) {
        if (this.settings.showOnHover) {
            selection.classed("hover-show", toggle);
            if (toggle) {
                selection
                    .style("display", "inline")
                    .transition("conn-fade").duration(50)
                    .style("opacity", 1);
            } else {
                selection
                    .transition("conn-fade").duration(500)
                    .style("opacity", 0)
                    .transition().duration(0)
                    .style("display", "none");
            }
        }
    }

    /** Jump the view to a file, and make it flash */
    emphasizeFile(node: Node) {
        // Zoom triggers update which clears transition, so add one-time handler to start animation after zoom jumps
        this.zoom.on('zoom.emphasize', e => {
            this.allFilesSelection!
                .filter(d => d == node)
                .select(".circle") // flash the file or folder
                    .style("stroke", "cyan")
                    .style("stroke-width", d => d.data.type == FileType.Directory ? 1 : 0)
                    .transition().duration(1000)
                        .style("stroke-width", 5)
                    .transition().duration(1000)
                        .style("stroke-width", d => d.data.type == FileType.Directory ? 1 : 0)
                    .transition().duration(0)
                        .style("stroke", null)
                        .style("stroke-width", null);
            this.zoom.on('zoom.emphasize', null); // remove handler
        });
        
        // Zoom to center and fit
        this.zoom.translateTo(this.diagram, node.x, node.y);
        if (2*node.r * this.transform.k > this.s.diagramSize) {
            this.zoom.scaleTo(this.diagram, this.s.diagramSize / (2*node.r));
        }
    }
}
