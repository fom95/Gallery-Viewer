/*
 * 18-reload-albums-and-persistence.js
 *
 * Loads albums from siteConfig.album (a .txt of newline-separated
 * compressed album blobs -- see 00b-config-and-providers.js) plus
 * anything saved locally, and saves edits back to storage. Every
 * album read from either source is decompressed on the way in; every
 * album written back out is compressed on the way out.
 */

const SAVED_ALBUMS_STORAGE_KEY =
    "savedAlbums";


/*
 * Reads the raw, still-compressed saved-album strings straight out of
 * localStorage, with no decompression -- used when only the count or
 * an unresolved copy is needed.
 */
function getSavedAlbumsRaw() {

    try {

        const parsed =
            JSON.parse(
                localStorage.getItem(SAVED_ALBUMS_STORAGE_KEY) || "[]"
            );

        return Array.isArray(parsed) ? parsed : [];

    } catch {

        return [];

    }

}


/*
 * Decompresses every saved album. Anything that fails to decompress
 * (corrupted entry, format change, etc) is skipped rather than
 * breaking the whole list.
 */
async function getSavedAlbums() {

    const raw =
        getSavedAlbumsRaw();

    const albums =
        [];

    for (const entry of raw) {

        try {

            albums.push(
                await decompressAlbum(entry)
            );

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress a saved album",
                {
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    return albums;

}


/*
 * Compresses and writes back the full saved-albums list in one go.
 */
async function setSavedAlbums(albumObjects) {

    const compressed =
        [];

    for (const album of albumObjects) {

        compressed.push(
            await compressAlbum(album)
        );

    }

    localStorage.setItem(
        SAVED_ALBUMS_STORAGE_KEY,
        JSON.stringify(compressed)
    );

}


/*
 * Parses a .txt response body as newline-separated compressed album
 * blobs (blank lines ignored) and decompresses each one.
 */
async function parseAlbumsText(text) {

    const lines =
        text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);

    const parsed =
        [];

    for (const line of lines) {

        try {

            parsed.push(
                await decompressAlbum(line)
            );

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress an album from the album list",
                {
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    return parsed;

}


async function reloadAlbums() {

    albums.length = 0;

    let remoteAlbums =
        [];

    if (siteConfig?.album) {

        try {

            const response =
                await fetch(siteConfig.album);

            if (!response.ok) {

                throw new Error(`HTTP ${response.status}`);

            }

            const text =
                await response.text();

            remoteAlbums =
                await parseAlbumsText(text);

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to load siteConfig.album",
                {
                    url: siteConfig.album,
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    /*
     * MANUAL_ALBUMS, if a developer still defines it directly in a
     * loaded script, is treated as already-decompressed album objects
     * in the current data shape -- a manual escape hatch, not the
     * normal path.
     */
    if (typeof MANUAL_ALBUMS !== "undefined") {

        remoteAlbums =
            remoteAlbums.concat(MANUAL_ALBUMS);

    }

    remoteAlbums.forEach(album => {

        if (!album)
            return;
		
        albums.push(album);

    });

    const saved =
        await getSavedAlbums();

    saved.forEach(
        album => {

            albums.push({

                ...album,

                tags:
                    album.tags ||
                    [],

                storage:
                    true

            });

        }
    );

}


function showAlbumButtons(show) {

    document.getElementById("backButton").style.display =
        show ? "" : "none";

    document.getElementById("saveButton").style.display =
        (
            show &&
            (
                isQueryAlbum ||
                currentTemporaryAlbumID !== null
            )
        )
            ? "flex"
            : "none";

    document.getElementById("regenerateAlbum").style.display =
        show ? "" : "none";

    document.getElementById("tagToggle").style.display =
        show ? "" : "none";
}

function setTelegramImportSavingState(importing) {
    const button = document.getElementById("saveButton");

    if (!button)
        return;

    button.disabled = importing;
    button.style.opacity = importing ? "0.5" : "";
    button.style.cursor = importing ? "default" : "";
}

async function saveCurrentAlbum() {

    if (!currentAlbum)
        return;

    const name =
		currentAlbum.name ||
		"Untitled Album";

    const isTelegram =
        typeof currentAlbum.url === "string" &&
        currentAlbum.url.startsWith(
            "tg://chat/"
        );

    /*
     * Preserve the Telegram album URL, but remove any
     * existing cover selection.
     *
     * Without "cover=", loadTelegramAlbumCover()
     * will choose a random image.
     */
    let savedURL =
        currentAlbum.url ||
        "";

    if (isTelegram) {

        const match =
            savedURL.match(
                /^tg:\/\/chat\/(-?\d+)(?:\?(.+))?$/
            );

        if (match) {

            const chatId =
                match[1];

            const optionString =
                match[2] ||
                "";

            const options =
                new URLSearchParams(
                    optionString
                );

            options.delete(
                "cover"
            );

            const query =
                options.toString();

            savedURL =
                "tg://chat/" +
                chatId +
                (
                    query
                        ? "?" + query
                        : ""
                );
        }
    }

    const savedAlbum = {

		id:
			crypto.randomUUID(),

		name:
			name,

		sourceName:
			name,

		edited:
			false,

		sources:
			currentAlbum.sources || [],

		images:
			currentAlbum.images,

		tags:
			currentAlbum.tags || [],

		url:
			savedURL

	};

    const saved =
        await getSavedAlbums();

	saved.push(
        savedAlbum
    );

    await setSavedAlbums(saved);

    /*
     * Telegram records are still copied to the clipboard for
     * convenience, now as a compressed, ready-to-paste-into-album.txt
     * line rather than a raw JS object literal.
     */
    if (isTelegram) {

        try {

            const record =
                await compressAlbum(savedAlbum);

            if (
                navigator.clipboard &&
                navigator.clipboard.writeText
            ) {

                navigator.clipboard
                    .writeText(record)
                    .catch(
                        () => {}
                    );
            }

        } catch {}

    }

    if (currentTemporaryAlbumID) {

        deleteTemporaryAlbum(
            currentTemporaryAlbumID
        );

        currentTemporaryAlbumID =
            null;
    }

    alert(
        "Album saved as " +
        name
    );
}
