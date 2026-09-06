// ==UserScript==
// @name        next.backpack.tf Recent Sales Finder
// @namespace   http://steamcommunity.com/id/JayTuut
// @version     1.0.0
// @description Adds coloring to next.backpack.tf almanac search results indicating recent sales
// @author      JayTuut
// @run-at      document-start
// @grant       unsafeWindow
// @include     /^https?:\/\/(.*\.)?next\.backpack\.tf(:\d+)?\/almanac\/search.*/
// ==/UserScript==

(function() {
    'use strict';

    const WINDOW = unsafeWindow;

    // add styles for highlighted rows
    // deferred because document.head may not exist yet at document-start
    function addStyles() {
        const style = document.createElement('style');

        style.textContent = `
            tr.sale-success td {
                background-color: #dff0d8 !important;
            }
            tr.sale-warning td {
                background-color: #faf2cc !important;
            }
            tr.sale-danger td {
                background-color: #f2dede !important;
            }
        `;

        document.head.appendChild(style);
    }

    if (document.head) {
        addStyles();
    } else {
        document.addEventListener('DOMContentLoaded', addStyles);
    }

    (function highlightRecentSales() {
        // maps a row's "Current ID" badge text -> unix timestamp of previous owner's last sighting
        const saleTimestamps = new Map();

        /**
         * Process search results from the API response.
         * @param {Array} results - Array of result objects from the search response.
         * @returns {undefined}
         */
        function processResults(results) {
            if (!Array.isArray(results)) {
                return;
            }

            results.forEach((result) => {
                const entries = result && result.history && result.history.entries;

                if (!entries || entries.length === 0) {
                    return;
                }

                const current = entries[0];
                // "Current ID" badge in the row matches this entry's id
                const currentId = String(current.id);
                const currentSteamId = current.steamid;

                // entries are sorted newest-first. Consecutive entries with the
                // same steamid are just repeat inventory scans of the same
                // owner, NOT separate sales. The actual "last sale" boundary
                // is the first entry (walking backwards) whose steamid
                // differs from the current owner's - i.e. the last time the
                // item was seen with whoever had it before.
                const previousEntry = entries.slice(1).find((entry) => {
                    return entry.steamid !== currentSteamId;
                });

                if (!previousEntry) {
                    // no record of a previous owner - nothing to color
                    return;
                }

                saleTimestamps.set(currentId, previousEntry.timestamp);
            });

            highlightRows();
        }

        /**
         * Apply highlighting classes to all currently-rendered rows.
         * @returns {undefined}
         */
        function highlightRows() {
            const now = Date.now() / 1000;
            const rows = document.querySelectorAll('tr[role="row"]');

            rows.forEach((row) => {
                const idBadge = row.querySelector('[content="Current ID"]');

                // always clear first - if this DOM row has been recycled by
                // Vue for a different item (virtualization / re-render), we
                // don't want to leave a stale color from whatever used to be
                // rendered here
                row.classList.remove('sale-success', 'sale-warning', 'sale-danger');

                if (!idBadge) {
                    return;
                }

                const currentId = idBadge.textContent.trim();
                const timestamp = saleTimestamps.get(currentId);

                if (timestamp === undefined) {
                    // no known previous owner for this item - leave uncolored
                    return;
                }

                const days = Math.round((now - timestamp) / 86400);

                // add coloring depending on how long ago the item was last sold
                if (days <= 60) {
                    row.classList.add('sale-success');
                } else if (days <= 90) {
                    row.classList.add('sale-warning');
                } else if (days <= 120) {
                    row.classList.add('sale-danger');
                }
            });
        }

        // debounce re-highlighting so rapid DOM mutations (e.g. scroll virtualization)
        // don't trigger excessive recalculation
        let highlightTimeout = null;
        function scheduleHighlight() {
            clearTimeout(highlightTimeout);
            highlightTimeout = setTimeout(highlightRows, 50);
        }

        // re-apply highlighting whenever rows are added/replaced
        // (covers PrimeVue virtual scrolling and re-renders on new searches)
        // deferred because document.body may not exist yet at document-start
        function startObserving() {
            const observer = new MutationObserver(scheduleHighlight);
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        if (document.body) {
            startObserving();
        } else {
            document.addEventListener('DOMContentLoaded', startObserving);
        }

        // intercept the page's own fetch calls to read the search response
        // this MUST happen at document-start, before the app's own bundle
        // grabs a reference to the original fetch
        const origFetch = WINDOW.fetch;
        WINDOW.fetch = function (...args) {
            return origFetch.apply(this, args).then((response) => {
                const request = args[0];
                const url = (request instanceof Request) ? request.url : request;

                if (typeof url === 'string' && url.includes('/cors/_item/search')) {
                    response.clone().json().then((data) => {
                        processResults(data && data.results);
                    }).catch(() => {});
                }

                return response;
            });
        };

        // also intercept XMLHttpRequest, in case the app uses XHR/axios
        // instead of fetch for the search request
        const OrigXHR = WINDOW.XMLHttpRequest;
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url, ...rest) {
            this._salesFinderUrl = url;
            return origOpen.call(this, method, url, ...rest);
        };

        OrigXHR.prototype.send = function (...args) {
            if (typeof this._salesFinderUrl === 'string' && this._salesFinderUrl.includes('/cors/_item/search')) {
                this.addEventListener('load', function () {
                    try {
                        const data = JSON.parse(this.responseText);
                        processResults(data && data.results);
                    } catch (err) {
                        // ignore malformed responses
                    }
                });
            }

            return origSend.apply(this, args);
        };
    }());
}());