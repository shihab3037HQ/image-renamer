# HexaEcom Amazon Bulk Image Renamer

Free tool at **https://images.hexaecom.com**, built by the HexaEcom team.

One photo set per colour (or one folder per product) becomes Amazon file names for every ASIN
(`ASIN.MAIN.jpg`, `ASIN.PT01.jpg`, `ASIN.SWCH.jpg` …), packed into ZIP files for Seller Central's
bulk image upload. Everything runs in the browser: photos are never uploaded.

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
