# HexaEcom Amazon Bulk Image Renamer

Free tool at **https://images.hexaecom.com**, built by the HexaEcom team.

One photo set per colour (or one folder per product) becomes Amazon file names for every ASIN
(`ASIN.MAIN.jpg`, `ASIN.PT01.jpg`, `ASIN.SWCH.jpg` …), packed into ZIP files for Seller Central's
bulk image upload. Everything runs in the browser: photos are never uploaded.

## Styles (parents)

A list can hold many styles: **Style, Colour, Size, ASIN** (a column named Parent works too, and Style
can be left out). Each style keeps its colour folders inside a folder with its name, for example
`Style 1/Black` and `Style 2/Black`, so two styles with the same colour never share photos. One folder for
both, like `Style 1 Black`, is found too. The check groups the new names by style, and warns when two
styles use the same photo folder.

After the check the user picks the download, and can use more than one without checking again:

- **One ZIP for Amazon:** every photo loose in one ZIP.
- **One ZIP for each style:** the same loose files, one ZIP per style.
- **In folders, to check first:** `Style/Colour/Size/ASIN/` folders to look through. Changed by hand,
  they can be dropped back in with "Folders named with ASINs".

## Files

- `index.html`: the page, the tool and the guide (SEO text, FAQ, structured data).
- `assets/js/renamer.js`: the tool (list parsing, folder matching, checks, conversion, downloads).
- `assets/js/zip.js`: a small ZIP writer that streams the original files (no compression).
- `assets/js/feedback.js`: the HexaEcom Feedback button. Same file as on hexaecom.com
  (source: hexaecom-wordpress `site/tools/feedback.js`); copy it here when it changes.
- `assets/js/analytics.js`: Google Analytics 4 (page views and button names only).
- `assets/css/base.css`: HexaEcom brand tokens, header and footer (shared with the Pallet Planner).
- `assets/css/site.css`: this page's styles.
- `example/`: the example list.
- `CNAME`: the custom domain for GitHub Pages.

No build step: GitHub Pages publishes the `main` branch as it is.

## When you change the page

- **Examples use made-up names only** (Style 1, Style 2, White, B0EXAMP001). Never put a real style code,
  product name or ASIN from the owner or a client on the page, in the example files or in a commit message.
- **Bump `?v=` on the CSS and script links in `index.html`** whenever a CSS or JS file changes. Browsers keep
  those files for a while, and an old script with a new page hides the new parts.
