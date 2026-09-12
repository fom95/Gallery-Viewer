/*
 * 03-temporary-albums-and-import-dialog.js
 *
 * Temporary (unsaved) album storage, and the "add album from a URL"
 * dialog.
 */

const TEMP_ALBUM_STORAGE_KEY =
    "temporaryAlbums";


function getTemporaryAlbums() {

    return JSON.parse(
        localStorage.getItem(TEMP_ALBUM_STORAGE_KEY) || "{}"
    );

}


function saveTemporaryAlbum(album) {

    const temporaryAlbums =
        getTemporaryAlbums();

    temporaryAlbums[album.id] =
        album;

    localStorage.setItem(
        TEMP_ALBUM_STORAGE_KEY,
        JSON.stringify(temporaryAlbums)
    );

}


function getTemporaryAlbum(id) {

    const temporaryAlbums =
        getTemporaryAlbums();

    return temporaryAlbums[id] ||
        null;

}


function deleteTemporaryAlbum(id) {

    if (!id)
        return;

    const temporaryAlbums =
        getTemporaryAlbums();

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


function openAlbumInput() {

    let overlay =
        document.getElementById("albumInputOverlay");

    if (overlay) {

        overlay.style.display =
            "flex";

        return;

    }

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

    const openButton =
        document.getElementById("albumInputOpen");

    const cancelButton =
        document.getElementById("albumInputCancel");

    populateTelegramAlbumChats(telegramSelect);

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

            openTemporaryAlbumFromURL(value);

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
