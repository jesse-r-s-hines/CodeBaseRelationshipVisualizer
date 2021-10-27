// let uniqIdCount = 0
// function uniqId(prefix = "uniq") {
//     return `${prefix}-${uniqIdCount++}`
// }

// This method is based on https://observablehq.com/@d3/pack
// Copyright 2021 Observable, Inc., Released under the ISC license.
function Pack(data, { // data is either tabular (array of objects) or hierarchy (nested objects)
    children, // if hierarchical data, given a d in data, returns its children
    value, // given a node d, returns a quantitative value (for area encoding; null for count)
    sort = (a, b) => d3.descending(a.value, b.value), // how to sort nodes prior to layout
    label, // given a leaf node d, returns the display name
    title, // given a node d, returns its hover text
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
} = {}) {
    const root = d3.hierarchy(data, children)

    // Compute the values of internal nodes by aggregating from the leaves.
    value == null ? root.count() : root.sum(value);

    // Compute labels and titles.
    const descendants = root.descendants();
    const leaves = descendants.filter(d => !d.children);
    leaves.forEach((d, i) => d.index = i);
    const L = label == null ? null : leaves.map(d => label(d.data, d));
    const T = title == null ? null : descendants.map(d => title(d.data, d));

    // Sort the leaves (typically by descending value for a pleasing layout).
    if (sort != null) root.sort(sort);

    // Compute the layout.
    d3.pack()
        .size([width - marginLeft - marginRight, height - marginTop - marginBottom])
        .padding(padding)
        (root);

    const svg = d3.create("svg")
        .attr("viewBox", [-marginLeft, -marginTop, width, height])
        .attr("width", width)
        .attr("height", height)
        .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
        .attr("font-family", "sans-serif")
        .attr("font-size", 10)
        .attr("text-anchor", "middle");

    const node = svg.selectAll("a")
        .data(descendants)
        .join("a")
        .attr("xlink:href", link == null ? null : (d, i) => link(d.data, d))
        .attr("target", link == null ? null : linkTarget)
        .attr("transform", d => `translate(${d.x},${d.y})`);

    node.append("circle")
        .attr("fill", d => d.children ? "#fff" : fill(d))
        .attr("fill-opacity", d => d.children ? null : fillOpacity)
        .attr("stroke", d => d.children ? stroke : null)
        .attr("stroke-width", d => d.children ? strokeWidth : null)
        .attr("stroke-opacity", d => d.children ? strokeOpacity : null)
        .attr("r", d => d.r);

    if (T) node.append("title").text((d, i) => T[i]);

    if (L) {
        const leaf = node.filter(d => !d.children && L[d.index] != null && d.r > L[d.index].length * 2.5);

        leaf.append("clipPath")
            .attr("id", d => `clip-${d.index}`)
        .append("circle")
            .attr("r", d => d.r);

        leaf.append("text")
            .attr("clip-path", d => `url(#clip-${d.index})`)
            .append("tspan")
                .attrs({x: 0, y: '0.35em'})
                .text(d => L[d.index]);
    }

    return svg.node();
}

function ext(filename) {
    return filename.includes(".") ? filename.split(".").pop() : "" // hidden files?
}

let exts = new Set(d3.hierarchy(window.folder).descendants().map(d => ext(d.data.name)))
color = d3.scaleOrdinal(exts, d3.quantize(d3.interpolateRainbow, exts.size))

diagram = Pack(window.folder, {
    value: d => d.size, // size of each node (file); null for internal nodes (folders)
    label: (d, n) => d.name,
    title: (d, n) => n.ancestors().reverse().map(({data: d}) => d.name).join("/"),
    fill: d => color(ext(d.data.name)),
    width: 1152,
    height: 1152
})

document.getElementById("canvas").append(diagram)
