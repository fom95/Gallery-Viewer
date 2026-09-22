/*
 * 19-album_editing.js
 *
 * Editing and persistence of saved albums.
 *
 * This module is responsible for:
 * - Renaming saved albums
 * - Tracking whether a saved album differs from its source
 * - Persisting album edits
 *
 * Future editing features such as tags, covers, and image changes
 * should use this module rather than modifying savedAlbums directly.
 */


/* ============================================================
 * Source / edit-state helpers
 * ========================================================== */


function getAlbumSourceName(album) {

    if (
        album &&
        typeof album.sourceName === "string"
    ) {
        return album.sourceName;
    }

    return album?.name || "";
}


function updateAlbumEditedState(album) {

    if (!album)
        return false;

    const sourceName =
        getAlbumSourceName(album);

    album.edited =
        album.name !== sourceName;

    return album.edited;
}


/* ============================================================
 * Saved album persistence
 * ========================================================== */


async function saveAlbumEdits(album) {

    if (
        !album ||
        !album.id
    ) {
        return false;
    }

    const saved =
        await getSavedAlbums();

    const index =
        saved.findIndex(
            savedAlbum =>
                savedAlbum.id ===
                album.id
        );

    if (index === -1) {
        return false;
    }

    updateAlbumEditedState(
        album
    );

    saved[index] = {
        ...saved[index],
        ...album
    };

    await setSavedAlbums(saved);

    return true;
}


/* ============================================================
 * Album renaming
 * ========================================================== */


async function renameAlbum(album) {

    if (!album)
        return false;

    const currentName =
        album.name ||
        "";

    const newName =
        prompt(
            "Album name:",
            currentName
        );

    if (
        newName === null
    ) {
        return false;
    }

    const trimmedName =
        newName.trim();

    if (!trimmedName) {
        return false;
    }

    if (
        trimmedName ===
        currentName
    ) {
        return false;
    }

    album.name =
        trimmedName;

    /*
     * Saved albums are persisted immediately.
     */
    if (album.storage) {

        if (
            !(await saveAlbumEdits(
                album
            ))
        ) {
            return false;
        }
    }
    else {

        /*
         * Temporary albums are not part of
         * savedAlbums yet, so only update the
         * in-memory object here.
         */
        if (
            typeof saveTemporaryAlbum ===
            "function"
        ) {
            await saveTemporaryAlbum(
                album
            );
        }
    }

    return true;
}


/* ============================================================
 * Open album editor
 * ========================================================== */


async function editAlbum(album) {

    if (!album)
        return false;

    const changed =
        await renameAlbum(
            album
        );

    if (!changed)
        return false;

    /*
     * If we are currently viewing this album,
     * update the album page directly instead of
     * returning to the album list.
     */
    if (
        currentAlbum &&
        currentAlbum.id === album.id
    ) {

        currentAlbum =
            album;

        document.getElementById(
            "pageName"
        ).textContent =
            album.name;

        document.title =
            album.name;

        /*
         * Re-add the edit button because changing
         * pageName's textContent removes its contents.
         */
        addAlbumPageEditButton(
            album
        );

        return true;
    }

    /*
     * Otherwise we are editing from the album list.
     */
    if (
        typeof showAlbums ===
        "function"
    ) {
        showAlbums();
    }

    return true;
}

function addAlbumPageEditButton(album) {

    const existing =
        document.getElementById(
            "EditNameButton"
        );

    if (existing) {
        existing.remove();
    }

    const saveButton =
        document.getElementById(
            "saveButton"
        );

    if (!saveButton) {
        return;
    }

    const editButton =
        document.createElement("button");

    editButton.id =
        "EditNameButton";

    editButton.className =
        "album-page-edit";

    editButton.textContent =
        "✎";

    editButton.title =
        "Edit album name";

    editButton.onclick =
        (e) => {

            e.stopPropagation();

            editAlbum(
                album
            );

        };

    saveButton.parentNode.insertBefore(
        editButton,
        saveButton
    );
}
