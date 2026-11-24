/*
 * 03-routing.js
 *
 * Album ID generation, URL query-string routing (?@config, ?$album,
 * ?=temp, and a bare "?<compressed>" for ad-hoc shared albums), and
 * initAlbums() -- the app's URL router, run once at startup.
 */

function generateAlbumID(name, currentID) {

    const usedIDs = new Set();

    albums.forEach(album => {

        if (album.id && album.id !== currentID) {
            usedIDs.add(album.id);
        }

    });

    if (typeof MANUAL_ALBUMS !== "undefined") {

        MANUAL_ALBUMS.forEach(album => {

            if (album.id && album.id !== currentID) {
                usedIDs.add(album.id);
            }

        });

    }

    const base = name
        .trim()
        .replace(/[^\w -]/g, "")
        .replace(/\s+/g, "_");

    if (!usedIDs.has(base)) {
        return base;
    }

    let number = 1;
    while (usedIDs.has(base + number)) {
        number++;
    }

    return base + number;
}


function getAlbumQuery(url) {

    if (!url)
        return "";

    if (url.includes("?$")) {

        return url.split("?$")[1];

    }

    if (url.includes("?")) {

        return url.split("?")[1];

    }

    return url;

}


/*
 * Pulls Telegram credentials out of the site config (see
 * initSiteConfig() in 00-config-and-state.js) into the same
 * window.telegramAppId/telegramAppHash globals the rest of the
 * Telegram code already expects, and connects if not already
 * connected. Telegram is only ever contacted directly now to browse
 * chats for building a temp album -- actual image bytes come from
 * whatever provider(s) the album/image declares.
 */
/*
 * Copies the Telegram app_id/app_hash out of siteConfig into the same
 * window globals the Telegram code already expects -- WITHOUT contacting
 * Telegram.
 *
 * Startup calls this so the album list and home page render immediately.
 * Connecting (and, if there is no saved session, the login prompt) is
 * deferred until something actually needs Telegram: opening a Telegram
 * album, the Add New dialog, the uploader, or Save & Apply.
 */
function configureTelegramFromConfig() {

    const credentials =
        siteConfig?.credentials?.telegram;

    if (!credentials?.app_id || !credentials?.app_hash)
        return false;

    const appID =
        Number(credentials.app_id);

    if (!Number.isInteger(appID) || appID <= 0)
        return false;

    window.telegramAppId =
        appID;

    window.telegramAppHash =
        credentials.app_hash;

    return true;

}


async function initTelegramFromConfig({ silent = false, allowLogin = true } = {}) {

    if (!configureTelegramFromConfig())
        return;

    if (window.telegramClient)
        return;

    try {

        await initializeTelegramClient({ allowLogin });

    } catch (error) {

        /*
         * Callers that will surface their own error (or that are only
         * trying to restore a session in the background) pass silent,
         * so a cancelled login does not pop an extra alert.
         */
        if (silent) {

            console.debug(
                "[TELEGRAM] Not connected:",
                error?.message || String(error)
            );

            return;

        }

        alert(
            "Telegram initialization failed:\n\n" +
            (
                error && error.message
                    ? error.message
                    : String(error)
            )
        );

    }

}


async function initAlbums() {

    await initSiteConfig();

    await initProviderAuth();

    /*
     * Only read the credentials here -- do NOT connect. Connecting can
     * take seconds and, with no saved session, opens a login prompt;
     * both would hold the home page hostage. Telegram is connected on
     * demand by loadTelegramAlbum() and the Add New dialog.
     */
    configureTelegramFromConfig();

    const query =
        location.search.substring(1);

    if (!query) {

        await reloadAlbums();

        await showAlbums();

        return;

    }

    if (
        query.startsWith("$")
    ) {

        const albumID =
            decodeURIComponent(
                query.substring(1)
            );

        await reloadAlbums();

        const album =
            albums.find(
                a =>
                    a.id === albumID
            );

        if (album) {

            currentAlbum =
                album;

            isQueryAlbum =
                false;

            loadAlbum(album, false);

            showAlbumButtons(true);

            return;

        }

        await showAlbums();

        return;

    }

    if (
        query.startsWith("=")
    ) {

        const albumID =
            decodeURIComponent(
                query.substring(1)
            );

        const album =
            await getTemporaryAlbum(albumID);

        if (
            album
        ) {

            currentTemporaryAlbumID =
                albumID;

            currentAlbum =
                album;

            isQueryAlbum =
                false;

            loadAlbum(album, false);

            showAlbumButtons(true);

            return;

        }

        await showAlbums();

        return;

    }

    /*
     * A bare query is an ad-hoc shared-album link: the whole album
     * object, compressed (see compressAlbum()/decompressAlbum() in
     * 00-config-and-state.js), directly as the query string.
     */
    let albumQuery = null;

    try {

        albumQuery =
            await decompressAlbum(query);

    } catch (error) {

        alert(
            "This album link couldn't be read:\n\n" +
            (
                error && error.message
                    ? error.message
                    : String(error)
            )
        );

        await showAlbums();

        return;

    }

    currentAlbum =
        albumQuery;

    isQueryAlbum =
        true;

    loadAlbum(albumQuery, false);

    showAlbumButtons(true);

}
