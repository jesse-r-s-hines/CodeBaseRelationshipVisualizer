Manual acceptance tests for the graphical aspects of CBRV which can't easily be tested automatically.

# Sample codebases
Several sample codebases are in the [sample-codebases](./sample-codebases) directory. They are used in both the unit
tests as well for manual acceptance testing.

## [minimal](./sample-codebases/minimal)
A codebase that's just a set of files and directories. Contains some long names to show name cropping. Used to test the
minimal codebase visualization.

## [python](./sample-codebases/python)
A simple python codebase containing a stack trace 8 levels deep and recursion cycles whithin a single file and between
two files. Used to test the stack trace and dependency visualizations.

## [simple-hyperlink-graph](./sample-codebases/simple-hyperlink-graph)
A simple markdown codebase to test the hyperlink visualization and basic connections and iterations.

## [symlinks](./sample-codebases/symlinks)
A codebase that contains internal and external symlinks to test symlink rendering and handling.

## [symlink-root](./sample-codebases/symlink-root)
A codebase where the root folder is a symlink to `simple-hyperlink-graph`.

## [vscode-docs](./sample-codebases/vscode-docs)
This sample codebase is taken from https://github.com/microsoft/vscode-docs. It used to test the hyperlink visualization
and how CBRV scales to a large and interconnected codebase.

## [empty](./sample-codebases/empty)
A codebase that is just an empty folder. Since git can't commit empty directories you may have to create this codebase
manually, though the unit tests will create it automically when run as well.

# Manual Tests

## Basic diagram
- Open the `minimal` codebase in VSCode
- Run the "Visualize your codebase" command
  - (View > Command Palette or Ctrl + Shift + P) and type and select "Visualize your codebase"
- A circle packing diagram containing 7 leaf files should be shown
- File names should show on files and folders
- `deoxyribonucleicAcid` folder and `Supercalifragilisticexpialidocious` file should have their names cropped
  - May depend on your screen and font size settings
- `E.txt` should be the largest circle, `deoxyribonucleicAcid/I` should be the smallest
- Files should be color coded by extension (should be 4 different colors shown)

## Basic interaction
- Open the `minimal` codebase in VSCode
- Run the "Visualize your codebase" command
- Zoom and pan should work use mouse wheel and click and drag
- Use keyboard shortcuts `ctrl +`, `ctrl -` to zoom and pan
    - May need to click on the svg to make sure its focused first
- Hover over the smallest file
    - It should show `deoxyribonucleicAcid/I` in a tooltip
- Double click `A/F.md`
    - The file should open in a VSCode editor panel
- Double click `A`
    - The folder should be selected in the explorer panel
- Right click on `A/E.txt`
    - A context menu should show containing:
        - Reveal in Explorer
        - Open in editor
        - Copy Path
        - Copy Relative Path
- Use the context menu on `A/E.txt` to "Reveal in Explorer"
    - Should select `A/E.txt` in vscode explorer
- Use the context menu on `A/E.txt` to "Open"
    - Should open `A/E.txt` in the editor
- Use the context menu on `A/E.txt` to "Copy Path"
    - Should copy full path `.../sample-codebases/minimal/A/E.txt` to clipboard
- Use the context menu on `A/E.txt` to "Copy Relative Path"
    - Should copy `A/E.txt` to clipboard
- Right click on `A`
    - A context menu should show containing:
        - Reveal in Explorer
        - Copy Path
        - Copy Relative Path
- Use the context menu on `A` to "Reveal in Explorer"
    - Should select `A` in vscode explorer
- Use the context menu on `A` to "Copy Path"
    - Should copy full path `.../sample-codebases/minimal/A` to clipboard
- Use the context menu on `A` to "Copy Relative Path"
    - Should copy `A` to clipboard

## Filtering
- Open the `minimal` codebase in VSCode
- Run the "Visualize your codebase" command
- Type `A/**` in "Files to Include" input, press Enter
    - Diagram should change to only include `E.txt`, `F.txt`, `G.txt`
- Type `**/*.txt` in "Files to Exclude"
    - Diagram should change to only include `G.md`
- Clear both inputs
    - View should go back to what it was before showing everything
- Type `**/*.txt,**/*.md` into "Files to Include"
  - Diagram should change to include only `C.txt`, `D.txt`, `E.txt`, `F.txt`, `G.txt`
- Clear both inputs
- Type `A/**` in "Files to Exclude"
    - Folder `A` and all contents should be hidden

## Hyperlink Visualization and Connections
- Open the `simple-hyperlink-graph` codebase in VSCode
- Run the "Visualize a hyperlink graph" command
    - Should show the codebase diagram, but no connections at first
- Hover over `O.md`
    - Connections for `Q.md` and `P.md` should show
- Hover over `P.md`
    - Connection from `P.md` -> `O.md` should show
- Change the "Show on hover" dropdown to "in only"
- Hover over `P.md` again
    - No connection should show
- Hover over `O.md`
    - Connections for `Q.md` and `P.md` should show.
- Change the "Show on hover" dropdown to "out only"
- Hover over `P.md`
    - Connection from `P.md` -> `O.md` should show
- Hover over `O.md`
    - No connections should show
- Change the "Show on hover" dropdown to "off"
    - Connections accross the diagram should appear.
- One double headed arrow should show between `M.md` and `R.md`
- A single self loop connection should show on `N.md`
- Uncheck the "Show self loops" checkbox
    - The loop on `N.md` should disappear
- Check the "Show self loops" checkbox
    - The loop on `N.md` should come back
- Check "Hide unconnected"
    - View should change to only include files with connections
- Uncheck show self loops
    - `N.md` should disappear
- Check show shelf loops
    - `N.md` should reappear
- Uncheck "Hide unconnected"
    - All files should show again
- Hover over the connection between `M.md` and `R.md`
    - Tooltip should show containing
        - "A/D/M.md" -> "A/D/R.md"
        - "A/D/R.md" -> "A/D/M.md" x2

## Real-time updates
- Open the `simple-hyperlink-graph` codebase in VSCode
- Run the "Visualize a hyperlink graph" command
- Open `A/F/Q.md` and delete the first line.
    - Link between `Q.md` and `O.md` should disappear.
- Undo the line change
    - Link between `Q.md` and `O.md` should come back.
- Delete or move folder `A` out of the codebase
    - Visualization should immediately update to remove the `A` folder
- Put `A` back
    - `git reset --hard HEAD` or copy `A` back into codebase
    - Visualization should immediately update to show `A` again

## Symlinks
- Open the `symlinks` codebase in VSCode
- Run the "Visualize a hyperlink graph" command
- Symlinks files should show as colored circles with an arrow icon inside
- `link` folder should show as a circle outline with an arrow icon inside
- `externalLink.md` and `E.txt` should show as different colors
    - The color is based on the resolved filepath's extension
- Zoom in until you can only see `link.md` in the screen
- Double-click `link.md`
    - View should jump to center on and fit `B.md`
    - `B.md` should flash
- Zoom out all the way and double-click on `link` folder
    - `A` should flash
    - View shouldn't change
- Double-click on `external.md`
    - Nothing should happen
- Hover over `B.md`
    - Connections should show to `C.md` and `link.md`
- Open `symlink-root` codebase in VSCode
- Run the "Visualize a hyperlink graph" command
    - Should show a codebase containing several files
- Hovering over `P.md`
    - Should show connection to `O.md`

## Large Codebase
- Open the `vscode-docs` codebase in VSCode
- Run the "Visualize a hyperlink graph" command
- Deep folders should have their contents hidden and replaced with ellipses
    - Exact results will depend on your screen size
- Zoom in on one of the folders with hidden content
    - Contents should show up as you zoom.
- Hover over hidden folders and regular files
    - Connections show on hover, and connect to the first visible parent folder of their target

## Stack Trace Visualization
- Open the `python` codebase in VSCode
- Install the "Python" extension from the VSCode marketplace for python debugging if you don't already have it
- Run the "Visualize the stack trace during a debugger session" command
    - Notification saying "No active debug session" should show
- Type `**/*.py` in "Files to Include"
    - `.pyc` files should be hidden
- Add breakpoints (Click in gutter) at
    - `b/fact.py:3`
    - `b/e.py:3`
    - `b/j.py:3`
    - `a.py:26`
- Open `a.py` in a split panel so you can see both the visualization and the editor
- Open "Run and Debug" panel in VSCode's side panel
- Focus `a.py` editor view
- Click "Run and Debug" in the side panel and select "Python File"
    - Debugger should stop at `b/fact.py:3`
    - Connections: out of screen -> `a.py` -> `fact.py` -> `fact.py` (self loop)
- Click continue
    - Debugger should stop at `b/e.py:3`
    - Connections: out of screen -> `a.py` -> `c.py` -> `d.py` -> `e.py`
- Type `b/d.py` in "Files to Exclude"
    - Connections: out of screen -> `a.py` -> `c.py` -> `e.py`
- Clear "Files to Exclude"
    - Connections: out of screen -> `a.py` -> `c.py` -> `d.py` -> `e.py`
- Click continue
  - Debugger should stop at `b/j.py:3`
  - Connections: out of screen -> `a.py` -> `c.py` -> `d.py` -> `e.py` -> `f.py` -> `g.py` -> `h.py` -> `i.py` -> `j.py`
- Remove breakpoint at `b/j.py:3` (click the red dot in the gutter)
- Click continue
    - Debugger should stop at `a.py:26`
    - Connections: out of screen -> `a.py`
- Click continue.
    - Should stop at either `thread1` `b/fact.py:3` or `thread2` `b/j.py:3`
- In the debugger side panel select the other thread
    - If you are stopped on `b/fact.py` select the thread that starts at `thread2` in the stack trace,
    - If stopped on `b/e.py` select the thread that starts on `thread1`
- Click continue again
    - Should stop at the other thread.
    - You should now see two lines in the stack trace of different colors
        - Out of screen -> `a.py` -> `c.py` -> `d.py` -> `e.py`
        - Out of screen -> `a.py` -> `fact.py` -> `fact.py` (self loop)
- Click stop
    - Debugging session will end to end the debugging session,
    - Connections should clear

## Dependency Visualization
- Open the `python` codebase in VSCode
- Run the "Visualize the dependencies between python files" command
    - If this is your first time running the command, it should show an "Installing pydeps..." progress notification
    - Wait for any progress notifications to complete
- Hover over `a.py`
    - Connections should show to `b/c.py`, `b/__init__.py` and `b/fact.py`
- Hover over `b/h.py`
    - Connections should show to `b/i.py`, `b/__init__.py`, `__init__.py`
    - Connections should show from `b/g.py`

## Empty Codebases
- Open the `empty` codebase (may need to create an empty folder)
- Run the "Visualize your codebase" command
    - Should just show an empty circle
- Run the "Visualize a hyperlink graph" command
    - Should just show an empty circle
- Run the "Visualize the stack trace during a debugger session" command
    - Should just show an empty circle
- Run the "Visualize the dependencies between python files" command
    - Should just show an empty circle
