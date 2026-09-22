/*
 * 01-album-routing-and-parsing.js
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
 * initSiteConfig() in 00b-config-and-providers.js) into the same
 * window.telegramAppId/telegramAppHash globals the rest of the
 * Telegram code already expects, and connects if not already
 * connected. Telegram is only ever contacted directly now to browse
 * chats for building a temp album -- actual image bytes come from
 * whatever provider(s) the album/image declares.
 */
async function initTelegramFromConfig() {

    const credentials =
        siteConfig?.credentials?.telegram;

    if (!credentials?.app_id || !credentials?.app_hash)
        return;

    const appID =
        Number(credentials.app_id);

    if (!Number.isInteger(appID) || appID <= 0)
        return;

    window.telegramAppId =
        appID;

    window.telegramAppHash =
        credentials.app_hash;

    if (window.telegramClient)
        return;

    try {

        await initializeTelegramClient();

    } catch (error) {

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

    await initTelegramFromConfig();

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
     * 00b-config-and-providers.js), directly as the query string.
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
