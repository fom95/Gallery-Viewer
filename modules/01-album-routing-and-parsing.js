/*
 * 01-album-routing-and-parsing.js
 *
 * Album ID generation, URL query-string parsing (the ad-hoc "?query="
 * albums, plus the ?gh=, ?tg=, @paste, $album and =temp routes), and
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


async function initAlbums() {

    const query =
        location.search.substring(1);

    if (
        !window.telegramAppId ||
        !window.telegramAppHash
    ) {

        const savedTelegramAppID =
            localStorage.getItem("telegram_app_id");

        const savedTelegramAppHash =
            localStorage.getItem("telegram_app_hash");

        if (
            savedTelegramAppID &&
            savedTelegramAppHash
        ) {

            const appID =
                Number(savedTelegramAppID);

            if (
                Number.isInteger(appID) &&
                appID > 0
            ) {

                window.telegramAppId =
                    appID;

                window.telegramAppHash =
                    savedTelegramAppHash;

            }

        }

    }

    if (
        window.telegramAppId &&
        window.telegramAppHash &&
        !window.telegramClient
    ) {

        try {

            await initializeTelegramClient();

        }
        catch (error) {

            alert(
                "Telegram initialization failed:\n\n" +
                (
                    error &&
                    error.message
                        ? error.message
                        : String(error)
                )
            );

        }

    }

    if (!query) {

        await reloadAlbums();

        await showAlbums();

        return;

    }

    if (
        query.includes("gh=") ||
        query.includes("tg=")
    ) {

        const params =
            new URLSearchParams(query);

        const githubEncoded =
            params.get("gh");

        if (githubEncoded) {

            const githubURL =
                decodeBase64URL(githubEncoded);

            if (githubURL) {

                currentGithubID =
                    githubURL;

            }
            else {

            }

        }

        const telegramEncoded =
            params.get("tg");

        if (telegramEncoded) {

            try {

                const telegramJSON =
                    decodeBase64URL(telegramEncoded);

                if (!telegramJSON) {

                    throw new Error("Invalid Base64 Telegram data.");

                }

                const telegramInfo =
                    JSON.parse(telegramJSON);

                if (
                    telegramInfo.app_id === undefined ||
                    telegramInfo.app_hash === undefined
                ) {

                    throw new Error("Telegram data must contain app_id and app_hash.");

                }

                const appID =
                    Number(telegramInfo.app_id);

                if (
                    !Number.isInteger(appID) ||
                    appID <= 0
                ) {

                    throw new Error("Invalid Telegram app_id.");

                }

                if (
                    typeof telegramInfo.app_hash !==
                    "string" ||
                    !telegramInfo.app_hash
                ) {

                    throw new Error("Invalid Telegram app_hash.");

                }

                localStorage.setItem(
                    "telegram_app_id",
                    String(appID)
                );

                localStorage.setItem(
                    "telegram_app_hash",
                    telegramInfo.app_hash
                );

                window.telegramAppId =
                    appID;

                window.telegramAppHash =
                    telegramInfo.app_hash;

                if (
                    window.telegramAppId &&
                    window.telegramAppHash &&
                    !window.telegramClient
                ) {

                    await initializeTelegramClient();

                }

            }
            catch (error) {

                alert(
                    "Telegram initialization failed:\n\n" +
                    (
                        error &&
                        error.message
                            ? error.message
                            : String(error)
                    )
                );

            }

        }

        params.delete("gh");
        params.delete("tg");

        const remainingQuery =
            params.toString();

        const cleanURL =
            location.pathname +
            (
                remainingQuery
                    ? "?" + remainingQuery
                    : ""
            ) +
            location.hash;

        history.replaceState(
            null,
            "",
            cleanURL
        );

        if (currentGithubID) {

            await reloadAlbums();

            await showAlbums(false);

            return;

        }

        await reloadAlbums();

        await showAlbums();

        return;

    }

    if (
        query.startsWith("@")
    ) {

        const pasteID =
            decodeBase64URL(
                query.substring(1)
            );

        if (!pasteID) {

            await showAlbums();

            return;

        }

        currentGithubID =
            pasteID;

        await reloadAlbums();

        await showAlbums(false);

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
            getTemporaryAlbum(albumID);

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

    const albumQuery =
        createQueryAlbum(query);

    currentAlbum =
        albumQuery;

    isQueryAlbum =
        true;

    loadAlbum(albumQuery, false);

    showAlbumButtons(true);

}


function createQueryAlbum(query) {

    return {
        name: "Shared Album",
        images: parseQuery(query),
        tags: []
    };

}


function parseQuery(query) {

    return query.split("|").map(entry => {

        try {

            const data =
                JSON.parse(
                    decodeURIComponent(entry)
                );

            if (
                data.source ===
                "telegram"
            ) {

                return {

                    source:
                        "telegram",

                    messageID:
                        data.messageID ||
                        data.messageId ||
                        null,

                    telegramFileID:
                        data.telegramFileID ||
                        data.fileID ||
                        data.fileId ||
                        null,

                    telegramThumbnailFileID:
                        data.telegramThumbnailFileID ||
                        data.thumbnailFileID ||
                        data.thumbnailFileId ||
                        null,

                    mimeType:
                        data.mimeType ||
                        "",

                    fileName:
                        data.n ||
                        data.fileName ||
                        "",

                    width:
                        data.width,

                    height:
                        data.height,

                    tags:
                        (data.d?.tags || data.tags || [])
                        .map(
                            tag =>
                                decodeURIComponent(tag)
                        )

                };

            }

            const fileName =
                data.n || "";

            const thumbURL =
                data.t
                    ? `https://i.ibb.co/${data.t}/${fileName}`
                    : null;

            const mediumURL =
                data.m
                    ? `https://i.ibb.co/${data.m}/${fileName}`
                    : null;

            const fullURL =
                data.f
                    ? `https://i.ibb.co/${data.f}/${fileName}`
                    : null;

            return {

                thumb:
                    thumbURL
                        ? {
                            url:
                                thumbURL
                        }
                        : null,

                medium:
                    mediumURL
                        ? {
                            url:
                                mediumURL
                        }
                        : null,

                image:
                    fullURL
                        ? {
                            url:
                                fullURL
                        }
                        : null,

                tags:
                    (data.d?.tags || [])
                    .map(
                        tag =>
                            decodeURIComponent(tag)
                    )

            };

        }

        catch (e) {

            const [
                thumbId,
                mediumId,
                imageId,
                fileName
            ] =
                entry.split(",");

            return {

                thumb:
                    thumbId
                        ? {
                            url:
                                `https://i.ibb.co/${thumbId}/${fileName}`
                        }
                        : null,

                medium:
                    mediumId
                        ? {
                            url:
                                `https://i.ibb.co/${mediumId}/${fileName}`
                        }
                        : null,

                image:
                    imageId
                        ? {
                            url:
                                `https://i.ibb.co/${imageId}/${fileName}`
                        }
                        : null,

                tags:
                    []

            };

        }

    });

}


function createAlbumQuery(album) {

    function getId(url) {
        if (!url)
            return "";

        const match = url.match(/\/([A-Za-z0-9]+)\//);
        return match ? match[1] : "";
    }

    function getFile(url) {
        if (!url)
            return "";

        return url.split("/").pop();
    }

    return album.images.map(img => {

        const file =
            getFile(
                img.image?.url ||
                img.thumb?.url);

        return encodeURIComponent(JSON.stringify({
                t: getId(img.thumb?.url),
                m: getId(img.medium?.url),
                f: getId(img.image?.url),
                n: file,
                d: {
                    tags: img.tags || []
                }
            }));

    }).join("|");
}
