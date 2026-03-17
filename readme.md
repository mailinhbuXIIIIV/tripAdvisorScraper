# TripAdvisor Scraper — Chrome Extension

## Files
```
tripadvisor-scraper/
├── manifest.json   — Extension manifest (MV3)
├── popup.html      — Popup UI
├── popup.js        — Popup logic
├── background.js   — Service worker (scraping + CSV download)
└── README.md
```

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `tripadvisor-scraper/` folder
5. The extension icon will appear in your toolbar

> **Note:** Icon images (`icon16.png`, `icon48.png`, `icon128.png`) are referenced in
> `manifest.json` but not required. Chrome will just show a default icon without them.
> Add your own if desired.

## Usage

1. Navigate to any TripAdvisor listing/search page in Chrome
2. Click the extension icon
3. The URL field auto-fills with the current tab if it's on tripadvisor.com
   — paste a different URL if needed
4. Click **⚡ Start Getting Data**
5. The extension opens (or reuses) a TripAdvisor tab, injects the scraper,
   and streams progress back to the popup
6. When done, `tripadvisor_data.csv` is automatically downloaded

## CSV Columns

| Column  | Description                            |
|---------|----------------------------------------|
| index   | Sequential rank                        |
| name    | Listing name                           |
| url     | TripAdvisor listing URL                |
| rating  | Aggregate rating value                 |
| reviews | Total number of reviews                |

## How It Works

- **popup.js** validates the URL and sends a `startScraping` message to the
  background service worker.
- **background.js** opens the target URL in a TripAdvisor tab, waits for load,
  then injects `inPageScraper()` into the page using
  `chrome.scripting.executeScript({ world: 'MAIN' })`.
- Running in `MAIN` world means `fetch()` calls use TripAdvisor's origin and
  session cookies — solving the CORS issue.
- The scraper paginates through all results (offset += 30), batching every 5
  requests with a 500 ms pause to avoid rate limiting.
- Results are returned to the service worker, converted to CSV, and downloaded
  via `chrome.downloads.download()`.

## Permissions Used

| Permission         | Why                                             |
|--------------------|-------------------------------------------------|
| `tabs`             | Open / navigate TripAdvisor tab                 |
| `scripting`        | Inject scraper into the page                    |
| `downloads`        | Trigger CSV file download                       |
| `host_permissions` | Required for `scripting` on tripadvisor.com     |