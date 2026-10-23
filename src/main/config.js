'use strict';

/**
 * Where Shark{anty} lives on the web. Releases are hosted on your own site
 * (the GitHub repo, if any, is private and used only to build the installers).
 *
 *  - WEBSITE     the site the "Website" button and the download links point to
 *  - UPDATE_FEED a small JSON file the app polls to offer in-app updates:
 *                  { "version": "1.3.0", "url": "https://sha.best/download", "notes": "..." }
 */
module.exports = {
  WEBSITE: 'https://sha.best',
  UPDATE_FEED: 'https://sha.best/latest.json',
};
