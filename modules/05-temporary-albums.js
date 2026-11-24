/*
 * 05-temporary-albums.js
 *
 * Temporary (unsaved) album storage, and the "add album from a URL"
 * dialog.
 */

const TEMP_ALBUM_STORAGE_KEY =
    "temporaryAlbums";


function getTemporaryAlbumsRaw() {

    try {

        return JSON.parse(
            localStorage.getItem(TEMP_ALBUM_STORAGE_KEY) || "{}"
        );

    } catch {

        return {};

    }

}


async function saveTemporaryAlbum(album) {

    const temporaryAlbums =
        getTemporaryAlbumsRaw();

    temporaryAlbums[album.id] =
        await compressAlbum(album);

    localStorage.setItem(
        TEMP_ALBUM_STORAGE_KEY,
        JSON.stringify(temporaryAlbums)
    );

}


async function getTemporaryAlbum(id) {

    const temporaryAlbums =
        getTemporaryAlbumsRaw();

    const compressed =
        temporaryAlbums[id];

    if (!compressed)
        return null;

    try {

        return await decompressAlbum(compressed);

    } catch (error) {

        console.debug(
            "[ALBUMS] Failed to decompress a temporary album",
            {
                id,
                errorName: error?.name,
                errorMessage: error?.message
            }
        );

        return null;

    }

}


function deleteTemporaryAlbum(id) {

    if (!id)
        return;

    const temporaryAlbums =
        getTemporaryAlbumsRaw();

    if (
        !temporaryAlbums[id]
    ) {

        return;

    }

    delete temporaryAlbums[id];

    localStorage.setItem(
        TEMP_ALBUM_STORAGE_KEY,
        JSON.stringify(temporaryAlbums)
    );

}


/*
 * A pasted album URL's query string is a compressed album blob
 * directly (same format as the ad-hoc share links initAlbums() reads
 * -- see 03-routing.js), so opening one just means
 * decompressing it and treating it as a temporary album.
 */
async function openTemporaryAlbumFromURL(url) {

    if (!url)
        return;

    const query =
        getAlbumQuery(url.trim());

    if (!query) {

        alert("No album data was found in that URL.");

        return;

    }

    let album =
        null;

    try {

        album =
            await decompressAlbum(query);

    } catch (error) {

        alert(
            "That album link couldn't be read:\n\n" +
            (
                error && error.message
                    ? error.message
                    : String(error)
            )
        );

        return;

    }

    const id =
        generateAlbumID(album.name || "Shared Album");

    album.id =
        id;

    album.temporary =
        true;

    currentTemporaryAlbumID =
        id;

    await saveTemporaryAlbum(album);

    history.pushState(
        null,
        "",
        "?=" +
        encodeURIComponent(id)
    );

    loadAlbum(album, false);

    showAlbumButtons(true);

}


async function openAlbumInput() {

    let overlay =
        document.getElementById("albumInputOverlay");

    if (overlay) {

        overlay.style.display =
            "flex";

        return;

    }

    /*
     * Build the dialog first so the URL field is usable immediately;
     * the Telegram chat list fills in once (and if) a session connects.
     * A cancelled login must not stop the dialog from working.
     */
    overlay =
        document.createElement("div");

    overlay.id =
        "albumInputOverlay";

    overlay.innerHTML = `
        <div class="album-input-box">

            <div class="album-input-title">
                Open Album
            </div>

            <input
                id="albumInput"
                type="text"
                placeholder="Paste album URL"
                autocomplete="off"
            >

            <div
                id="telegramAlbumSection"
                style="display: none;"
            >

                <div
                    style="
                        margin: 12px 0;
                        text-align: center;
                        opacity: 0.7;
                    "
                >
                    OR
                </div>

                <select
                    id="telegramAlbumChat"
                    style="width: 100%;"
                >
                    <option value="">
                        Select Telegram chat
                    </option>
                </select>

            </div>

            <button
                id="albumInputEmpty"
                type="button"
                class="album-input-empty"
            >
                Create empty album
            </button>

            <div class="album-input-buttons">

                <button id="albumInputCancel">
                    Cancel
                </button>

                <button id="albumInputOpen">
                    Open
                </button>

            </div>

        </div>
    `;

    document.body.appendChild(overlay);

    const input =
        document.getElementById("albumInput");

    const telegramSelect =
        document.getElementById("telegramAlbumChat");

    const telegramSection =
        document.getElementById("telegramAlbumSection");

    const openButton =
        document.getElementById("albumInputOpen");

    const cancelButton =
        document.getElementById("albumInputCancel");

    const emptyButton =
        document.getElementById("albumInputEmpty");

    emptyButton.onclick =
        async () => {

            const name =
                await showInWindowPrompt({
                    title: "New Album",
                    message: "Album name:",
                    value: "Untitled Album",
                    okLabel: "Create"
                });

            if (name === null)
                return;

            const trimmed =
                name.trim();

            if (!trimmed)
                return;

            const album = {
                id: generateAlbumID(trimmed),
                name: trimmed,
                sourceName: trimmed,
                edited: false,
                sources: [],
                images: {},
                tags: [],
                url: ""
            };

            const saved =
                await getSavedAlbums();

            saved.push(album);

            await setSavedAlbums(saved);

            overlay.remove();

            await reloadAlbums();

            const created =
                albums.find(item => item.id === album.id);

            if (created) {

                await loadAlbum(created, true);
                showAlbumButtons(true);

            }

        };

    /*
     * The Telegram option only exists when a valid session is connected.
     * Opening the dialog stays instant; a saved session is restored in
     * the background and only then is the chat picker revealed.
     */
    const revealTelegramSection =
        async () => {

            try {

                if (!window.telegramClient) {
                    await initTelegramFromConfig({ silent: true });
                }

                if (
                    window.telegramClient &&
                    telegramSelect.isConnected
                ) {

                    telegramSection.style.display = "";

                    await populateTelegramAlbumChats(telegramSelect);

                }

            } catch {}

        };

    revealTelegramSection();

    openButton.onclick =
        async () => {

            const telegramChatID =
                telegramSelect.value;

            const value =
                input.value.trim();

            if (
                telegramChatID
            ) {

                overlay.remove();

                await openTemporaryTelegramAlbum(
                    Number(telegramChatID)
                );

                return;

            }

            if (!value)
                return;

            overlay.remove();

            await openTemporaryAlbumFromURL(value);

        };

    cancelButton.onclick =
        () => {

            overlay.remove();

        };

    overlay.onclick =
        (e) => {

            if (
                e.target === overlay
            ) {

                overlay.remove();

            }

        };

    input.addEventListener(
        "keydown",
        e => {

            if (
                e.key === "Enter"
            ) {

                openButton.click();

            }

            if (
                e.key === "Escape"
            ) {

                cancelButton.click();

            }

        }
    );

    input.focus();

}
