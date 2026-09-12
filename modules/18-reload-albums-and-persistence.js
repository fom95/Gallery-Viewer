/*
 * 18-reload-albums-and-persistence.js
 *
 * Loads albums from every configured source (manual list, GitHub-hosted
 * list, localStorage) and saves edits back to storage.
 */

async function reloadAlbums() {

    albums.length = 0;

    const GITHUB_STORAGE_KEY =
        "githubID";

    const query =
        window.location.search.substring(1);

    let pasteID =
        null;

    if (
        query.startsWith("@")
    ) {

        pasteID =
            decodeBase64URL(
                query.substring(1)
            );

        if (
            !pasteID
        ) {

            pasteID =
                null;

        }
        else {

            localStorage.setItem(GITHUB_STORAGE_KEY,
                pasteID);

        }

    }

    else {

        pasteID =
            localStorage.getItem(GITHUB_STORAGE_KEY);

    }

    let manualAlbums = [];

    if (pasteID) {

        try {

            const response =
                await fetch(pasteID);

            if (!response.ok) {

                throw new Error(`HTTP ${response.status}`);

            }

            const text =
                await response.text();

            const start =
                text.indexOf("MANUAL_ALBUMS");

            if (
                start === -1
            ) {

                throw new Error("MANUAL_ALBUMS was not found in GitHub file.");

            }

            const arrayStart =
                text.indexOf(
                    "[",
                    start
                );

            if (
                arrayStart === -1
            ) {

                throw new Error("MANUAL_ALBUMS array start was not found.");

            }

            let depth =
                0;

            let arrayEnd =
                -1;

            let inString =
                false;

            let stringChar =
                null;

            let escaped =
                false;

            for (
                let i = arrayStart;
                i < text.length;
                i++
            ) {

                const char =
                    text[i];

                if (escaped) {

                    escaped =
                        false;

                    continue;

                }

                if (inString) {

                    if (
                        char === "\\"
                    ) {

                        escaped =
                            true;

                    }
                    else if (
                        char === stringChar
                    ) {

                        inString =
                            false;

                        stringChar =
                            null;

                    }

                    continue;

                }

                if (
                    char === '"' ||
                    char === "'" ||
                    char === "`"
                ) {

                    inString =
                        true;

                    stringChar =
                        char;

                    continue;

                }

                if (
                    char === "["
                ) {

                    depth++;

                }
                else if (
                    char === "]"
                ) {

                    depth--;

                    if (
                        depth === 0
                    ) {

                        arrayEnd =
                            i;

                        break;

                    }

                }

            }

            if (
                arrayEnd === -1
            ) {

                throw new Error("Could not find end of MANUAL_ALBUMS.");

            }

            const arrayText =
                text.substring(
                    arrayStart,
                    arrayEnd + 1
                );

            manualAlbums =
                Function(
                    `"use strict"; return (${arrayText});`
                )();

            if (
                !Array.isArray(manualAlbums)
            ) {

                throw new Error("Extracted MANUAL_ALBUMS is not an array.");

            }

        }
        catch (error) {

            manualAlbums =
                [];

        }

    }

    else if (
        typeof MANUAL_ALBUMS !==
        "undefined"
    ) {

        manualAlbums =
            MANUAL_ALBUMS;

    }

    manualAlbums.forEach(
		album => {

			const isTelegram =
				typeof album.url === "string" &&
				album.url.startsWith("tg://chat/");

			albums.push({

				id:
					album.id,

				name:
					album.name,

				images:
					isTelegram
						? []
						: parseQuery(
							getAlbumQuery(album.url)
						),

				url:
					album.url,

				tags:
					album.tags ||
					[]

			});

		}
	);

    const saved =
        JSON.parse(
            localStorage.getItem("savedAlbums") || "[]"
        );

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

function saveCurrentAlbum() {

    if (!currentAlbum)
        return;

    const saved =
        JSON.parse(
            localStorage.getItem(
                "savedAlbums"
            ) || "[]"
        );

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

		images:
			currentAlbum.images,

		tags:
			currentAlbum.tags || [],

		url:
			savedURL

	};

	saved.push(
        savedAlbum
    );

    localStorage.setItem(
        "savedAlbums",
        JSON.stringify(saved)
    );

    /*
     * Telegram records are still copied to the clipboard
     * for now, but no debug output is produced.
     */
    if (isTelegram) {

        const record =
            JSON.stringify({
                id:
                    savedAlbum.id,

                name:
                    name,

                url:
                    savedAlbum.url,

                tags:
                    currentAlbum.tags || []
            });

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