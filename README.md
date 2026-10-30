# Highlight & Print

A Chrome extension that prints only the content you highlight, keeping it looking the way it does on the page.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.

## Use

Highlight something on a page, then do one of these:

- Right-click and choose **Print selection**.
- Click the toolbar button.
- Press **Alt+Shift+P** (you can change this at `chrome://extensions/shortcuts`).

A print tab opens with a preview of your selection. Before you print, you can:

- **Change the print size** with the **Size** slider, the **−**/**+** buttons, or by typing a percentage (25–200%). Text re-wraps at the new size, so the preview shows how lines and pages will break. **Ctrl+=**, **Ctrl+-** and **Ctrl+0** also work.
- Click **Fit width** to shrink wide content (big tables, wide images) so nothing gets cut off at the sides. **Reset** goes back to 100%.
- Click into the page to edit or delete anything.

Then click **Print** (or press **Ctrl+P**) to open the system print dialog. The size you choose is remembered for next time.

## What gets kept

- **Only the text you highlighted.** Partly selected paragraphs are trimmed to the selection.
- **Formatting.** Fonts (including the page's web fonts), colors, sizes, headings, borders, backgrounds, callout boxes, links, code blocks and `::before`/`::after` icons are copied as styles on each element.
- **Images inside the highlighted area, even if you didn't select them.** This includes images, SVG icons, canvases, the current frame of a video, and CSS background images. Floated images next to the text count. Images in sidebars, headers and other columns outside the selection don't.
- **Structure.** Ordered lists keep their original numbers. When only some cells in a table row are selected, the other cells are kept empty so the columns line up.
- **Hidden content is left out.** That includes screen-reader-only text, scripts and `display:none` elements.

## Limitations

- Chrome blocks extensions on `chrome://` pages, the Chrome Web Store and the built-in PDF viewer.
- Content inside cross-origin iframes (some embedded widgets) can't be read.
- Page layout wrappers (sidebar offsets, fixed widths) are dropped on purpose, so the content flows to the paper width.
- Images that only load with your login cookies are embedded when they come from the same site as the page. If such an image comes from a different site, it may not appear.

## License

Public domain, under [The Unlicense](LICENSE). Use, copy, modify or redistribute it however you like. No credit is needed.
