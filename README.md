# Obsidian Native Paginator

协作开发、Agent 提交与合并规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。


MD Reader-style horizontal book pagination embedded inside Obsidian's existing
`MarkdownView`. It keeps the note recognizable as a normal Markdown view so sidebar
tools such as Voice Reader can remain open and resolve the current file/editor. It
also includes an optional Fastread-style visual anchor layer for English words.

## What it does

- Uses a fixed one- or two-page stage with clipped edges.
- Paginates rendered Markdown with CSS columns.
- Turns pages with `translateX(page * stride)`, arrow buttons, mouse wheel,
  keyboard shortcuts, edge clicks, or the draggable progress bar.
- Preserves reading position as a fraction when page geometry changes.
- Preserves per-note reading activation and progress when notes or folders move.
- Applies only to explicitly enabled Markdown notes in Reading View.
- Never collapses sidebars or adds an immersive app-wide state.
- Uses `STSong, 华文宋体, SimSun, serif` and sepia paper by default.
- Adds Fastread emphasis only to the rendered pagination DOM and never writes it
  into the Markdown file.

## Fastread visual anchors

Fastread decoration is enabled by default whenever paginated reading is active. The
default algorithm string is `0 0 0 2 2 0.45`:

- 1–3-letter words are unchanged.
- 4- and 5-letter words emphasize their first 2 letters.
- Words of 6 or more letters emphasize 45%, rounded up.
- Common words are skipped using an editable, case-insensitive list that starts
  with `a, an, the, of, to, in, is, and`.
- The emphasized part uses weight 600; the rest keeps full opacity by default.
- Links, code, math, form controls, metadata/frontmatter, and existing decoration
  spans are excluded.

Use the `Aa` button beside the page counter to open the in-reader plugin panel. The
algorithm, intensity preset (`0`, `0.35`, `0.4`, `0.45`, or `0.5`), common-word list,
rest dimming, emphasis weight, and page-turn switches are all available there without
opening Obsidian settings. On first load or after a layout change, Fastread caches the
word splits and precomputes every page's visual layer in short, non-blocking batches.
Batch scheduling uses message tasks so background-window timer throttling cannot
leave visual anchors waiting indefinitely.
Page turns then swap only the already prepared current-page glyphs, so they do not
rerun the word algorithm or measure text positions and never expose a partly drawn
layer. The full document is never split into thousands of inline DOM nodes. The
feature is scoped to this plugin's paginated Reading View; ordinary Reading View, Live
Preview, and Source mode are not globally decorated.

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

`npm run check` runs the geometry and Fastread algorithm tests, TypeScript checking,
and the production esbuild bundle.

## Credits

The pagination geometry and interaction model were studied from
[mrrepac/obsidian-md-reader](https://github.com/mrrepac/obsidian-md-reader), released
under the MIT License. The Fastread algorithm and rendered-DOM decoration model were
adapted from [SVS696/obsidian-fastread](https://github.com/SVS696/obsidian-fastread),
also released under the MIT License. See `THIRD_PARTY_NOTICES.md`. This plugin is MIT
licensed.
