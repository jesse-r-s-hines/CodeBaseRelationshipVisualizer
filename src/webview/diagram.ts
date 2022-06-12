import * as d3 from 'd3';
import { ValueFn, BaseType } from 'd3-selection';
import { FileType, AnyFile } from '../util';

// TODO clean up types

type D3Val = null | string | number | boolean | ReadonlyArray<string | number>
type D3Attr<Datum, Rtrn = D3Val> = Rtrn | ValueFn<BaseType, Datum, Rtrn>;
type PackAttr<Rtrn = D3Val> = D3Attr<d3.HierarchyNode<AnyFile>, Rtrn>;


let uniqIdCount = 0;
function uniqId(prefix = "uniq") {
    return `${prefix}-${uniqIdCount++}`;
}

interface PackSettings {
    children?: (d: AnyFile) => Iterable<AnyFile>, // if hierarchical data, given a d in data, returns its children
    value?: (d: AnyFile) => number, // given a node d, returns a quantitative value (for area encoding; null for count)
    sort?: (a: d3.HierarchyNode<AnyFile>, b: d3.HierarchyNode<AnyFile>) => number, // how to sort nodes prior to layout
    label?: (d: d3.HierarchyNode<AnyFile>) => string, // given a leaf node d, returns the display name
    title?: (d: d3.HierarchyNode<AnyFile>) => string, // given a node d, returns its hover text
    link?: (d: d3.HierarchyNode<AnyFile>) => string, // given a node d, its link (if any)
    linkTarget?: PackAttr<string>,
    width?: number, // outer width, in pixels
    height?: number, // outer height, in pixels
    margin?: number, // shorthand for margins
    marginTop?: number, // top margin, in pixels
    marginRight?: number, // right margin, in pixels
    marginBottom?: number, // bottom margin, in pixels
    marginLeft?: number, // left margin, in pixels
    padding?: number, // separation between circles
    fill?: (d: d3.HierarchyNode<AnyFile>) => string, // fill for leaf circles
    fillOpacity?: string, // fill opacity for leaf circles
    stroke?: string, // stroke for internal circles
    strokeWidth?: number, // stroke width for internal circles
    strokeOpacity?: number, // stroke opacity for internal circles
}

// This method is based on https://observablehq.com/@d3/pack
// Copyright 2021 Observable, Inc., Released under the ISC license.
function Pack(data: AnyFile, { // data is either tabular (array of objects) or hierarchy (nested objects)
    children,
    value,
    sort = (a, b) => d3.descending(a.value, b.value),
    label,
    title,
    link, // given a node d, its link (if any)
    linkTarget = "_blank", // the target attribute for links, if any
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    margin = 1, // shorthand for margins
    marginTop = margin, // top margin, in pixels
    marginRight = margin, // right margin, in pixels
    marginBottom = margin, // bottom margin, in pixels
    marginLeft = margin, // left margin, in pixels
    padding = 3, // separation between circles
    fill = d => "#ddd", // fill for leaf circles
    fillOpacity, // fill opacity for leaf circles
    stroke = "#bbb", // stroke for internal circles
    strokeWidth, // stroke width for internal circles
    strokeOpacity, // stroke opacity for internal circles
}: PackSettings) {
    const root = d3.hierarchy(data, children);

    // Compute the values of internal nodes by aggregating from the leaves.
    value == null ? root.count() : root.sum(value);

    // Compute labels and titles.
    const descendants = root.descendants();
    const leaves = descendants.filter(d => !d.children);
    const getIndex = (d: d3.HierarchyNode<AnyFile>) => leaves.findIndex(needle => needle === d);
    const L = label == null ? null : leaves.map(d => label(d));
    const T = title == null ? null : descendants.map(d => title(d));

    // Sort the leaves (typically by descending value for a pleasing layout).
    if (sort != null) root.sort(sort);

    // Compute the layout. // TODO get the return result of this for types
    d3.pack()
        .size([width - marginLeft - marginRight, height - marginTop - marginBottom])
        .padding(padding)(root);

    const svg = d3.create("svg")
        .attr("viewBox", [-marginLeft, -marginTop, width, height])
        .attr("width", width)
        .attr("height", height)
        .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
        .attr("font-family", "sans-serif")
        .attr("font-size", 10)
        .attr("text-anchor", "middle");

    const node = svg.selectAll("g")
        .data(descendants)
        .join("g")
        .attr("xlink:href", link == null ? null : (d, i) => link(d))
        .attr("target", link == null ? null : linkTarget)
        .attr("transform", d => `translate(${(d as any).x},${(d as any).y})`);

    node.append("circle")
        .attr("fill", d => d.children ? "#fff" : fill(d))
        .attr("fill-opacity", d => d.children ? null : (fillOpacity ?? null))
        .attr("stroke", d => d.children ? stroke : null)
        .attr("stroke-width", d => d.children ? (strokeWidth ?? null) : null)
        .attr("stroke: number|string-opacity", d => d.children ? (strokeOpacity ?? null) : null)
        .attr("r", d => (d as any).r);

    if (T) node.append("title").text((d, i) => T[i]);

    if (L) {
        const leaf = node.filter(d => !d.children && L[getIndex(d)] != null && (d as any).r > L[getIndex(d)].length * 2.5);

        leaf.append("clipPath")
            .attr("id", d => `clip-${getIndex(d)}`)
        .append("circle")
            .attr("r", d => (d as any).r);

        leaf.append("text")
            .attr("clip-path", d => `url(#clip-${getIndex(d)})`)
            .append("tspan")
                .attr("x", 0)
                .attr("y", '0.35em')
                .text(d => L[getIndex(d)]);
    }

    return svg.node();
}

function ext(filename: string): string {
    return filename.includes(".") ? filename.split(".").slice(-1)[0] : ""; // hidden files?
}

export function main() {
    let folder;

    addEventListener('message', event => {
        const message = event.data; // The JSON data our extension sent
        if (message.type == "update-folder") {
            folder = message.folder;
            console.log(folder);

            const exts = new Set(d3.hierarchy(folder).descendants().map(d => ext(d.data.name)));
            const color = d3.scaleOrdinal(exts, d3.quantize(d3.interpolateRainbow, exts.size));

            const diagram = Pack(folder, {
                value: d => d.type == FileType.File ? d.size : 0, // size of each node (file); 0 for internal nodes (folders)
                label: (d) => d.data.name,
                title: (d) => d.ancestors().reverse().map((d) => d.data.name).join("/"),
                fill: d => color(ext(d.data.name)),
                width: 1152,
                height: 1152
            })!;

            document.getElementById("canvas")!.append(diagram);
        }
    });
}



