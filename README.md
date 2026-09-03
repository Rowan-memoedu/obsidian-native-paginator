# Obsidian Native Paginator

MD Reader-style horizontal book pagination embedded inside Obsidian's existing
`MarkdownView`. It keeps the note recognizable as a normal Markdown view so sidebar
tools such as Voice Reader can remain open and resolve the current file/editor.

## What it does

- Uses a fixed one- or two-page stage with clipped edges.
- Paginates rendered Markdown with CSS columns.
- Turns pages with `translateX(page * stride)`, arrow buttons, mouse wheel,
  keyboard shortcuts, edge clicks, or the draggable progress bar.
- Preserves reading position as a fraction when page geometry changes.
- Applies only to explicitly enabled Markdown notes in Reading View.
- Never collapses sidebars or adds an immersive app-wide state.
- Uses `STSong, 华文宋体, SimSun, serif` and sepia paper by default.

## Use

Run **Native Markdown Paginator: Toggle current note's native paginated reading**
from the command palette, or click the book icon in the ribbon. The command switches
the current note to Reading View when needed. Run it again while pagination is active
to return to the ordinary Obsidian Reading View.

## Design

The page geometry follows the implementation model used by MD Reader 1.9.0:

1. Choose one or two visible pages from the available viewport width.
2. Lock stage width, individual column width, gap, and page stride together.
3. Clip overflow at the book stage rather than at the whole Obsidian window.
4. Calculate total spreads from rendered width and move by an exact transform stride.

Unlike MD Reader, this plugin does not register a separate `ItemView`. It renders the
book stage inside a standard Markdown Reading View, leaving the native `MarkdownView`
and its editor/file context available to other plugins.

## Development

```powershell
npm install
npm run check
```

`npm run check` runs the geometry tests, TypeScript checking, and the production
esbuild bundle.

## Credits

The pagination geometry and interaction model were studied from
[mrrepac/obsidian-md-reader](https://github.com/mrrepac/obsidian-md-reader), released
under the MIT License. This plugin is also MIT licensed.
