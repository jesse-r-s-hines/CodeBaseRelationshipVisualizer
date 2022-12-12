# CBRV - The CodeBase Relationship Visualizer

Display relationships between files in a codebase, overlayed on a circle packing diagram of the file structure.

Displays nested bubbles, with source code files at the lowest level of the bubbles, visually reminiscent to [Repo Visualizer](https://github.com/githubocto/repo-visualizer) but interactive and zoomable. Also exposes an API that other VSCode extensions can use to build visualizations of different relationships.

# Development
To run the project from source, just open it up in VSCode and press "F5" to run and debug it.

On Windows, you'll want to enable git symlinks before you clone the repo, first enable "Developer Mode" in Windows settings and then run `git config --global core.symlinks true`