# MapLeads

Export business leads from Google Maps with one click. Free and open source.

Pulls names, categories, addresses, phones, websites, ratings, hours, and Maps URLs from any Google Maps search and downloads them as CSV or JSON. Everything runs locally in your browser - no accounts, no servers, no tracking.

![MapLeads](store-assets/screenshot-1280x800.png)

## Install

1. Clone or download this repo.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.

## Use

1. Search for businesses on [Google Maps](https://www.google.com/maps) (e.g. "dentists in Austin TX").
2. Click the MapLeads icon.
3. Pick the fields you want and the format (CSV or JSON).
4. Click **Extract Leads** - the file downloads automatically.

Keep "Auto-scroll" on to load all results before exporting.

## Develop

End-to-end test (drives the scraper against a live Maps page via Playwright):

```bash
npm i playwright
node test-extension.js
```

## License

MIT
