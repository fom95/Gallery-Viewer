/*
 * 22-album-editing.js
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

    const hasAddedImages =
        Object.values(album.images || {})
            .some(image => image?.added);

    album.edited =
        album.edited === true ||
        album.name !== sourceName ||
        hasAddedImages;

    return album.edited;
}


/* ============================================================
 * Saved album persistence
 * ========================================================== */


async function saveAlbumEdits(
    album,
    { trackBase = false } = {}
) {

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

    /*
     * Keep the record as it was before the first local edit so the
     * home-screen "Remove local edits" action can restore it without
     * deleting the saved album.
     */
    if (
        trackBase &&
        typeof saveSavedAlbumEditBase === "function"
    ) {

        await saveSavedAlbumEditBase(
            album.id,
            saved[index]
        );

    }

    updateAlbumEditedState(
        album
    );

    const merged = {
        ...saved[index],
        ...album
    };

    /*
     * "storage" is a runtime-only flag (added when an album is
     * loaded FROM localStorage) and must never be written back
     * into the persisted record. Local-edit markers and cached
     * runtime fields are stripped for the same reason.
     */
    delete merged.storage;
    delete merged.localEdited;
    delete merged.savedEdited;

    for (const key of Object.keys(merged)) {

        if (key.startsWith("_"))
            delete merged[key];

    }

    saved[index] =
        merged;

    await setSavedAlbums(saved);

    if (
        typeof hasSavedAlbumEditBase === "function" &&
        hasSavedAlbumEditBase(album.id)
    ) {
        album.savedEdited = true;
    }

    return true;
}


/*
 * Restores a saved album to the record it had before its first local
 * edit. The saved album itself stays; only the edits are removed.
 */
async function revertSavedAlbumEdits(id) {

    if (!id)
        return false;

    const saved =
        await getSavedAlbums();

    const index =
        saved.findIndex(
            album =>
                album.id === id
        );

    if (index === -1)
        return false;

    const base =
        typeof getSavedAlbumEditBase === "function"
            ? await getSavedAlbumEditBase(id)
            : null;

    if (!base)
        return false;

    saved[index] = {
        ...base
    };

    await setSavedAlbums(saved);

    if (typeof deleteSavedAlbumEditBase === "function")
        deleteSavedAlbumEditBase(id);

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
        await showInWindowPrompt({
            title: "Rename Album",
            message: "Album name:",
            value: currentName,
            okLabel: "Rename"
        });

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
                album,
                { trackBase: true }
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
        "album-page-edit nav-icon";

    editButton.textContent =
        "✎";

    const hasLocalEdits =
        album?.localEdited === true ||
        album?.savedEdited === true;

    editButton.title =
        hasLocalEdits
            ? "Edit album (has local edits)"
            : "Edit album";

    if (hasLocalEdits) {

        editButton.classList.add(
            "album-page-edit-local"
        );

    }

    editButton.onclick =
        (e) => {

            e.stopPropagation();

            enterAlbumEditMode(
                album
            );

        };

    saveButton.parentNode.insertBefore(
        editButton,
        saveButton
    );
}


/*
 * Keep the amber "has local edits" marker on the album's edit button
 * in sync without waiting for a full page reload.
 */
function syncAlbumPageEditButton(album = currentAlbum) {

    const editButton =
        document.getElementById("EditNameButton");

    if (!editButton || !album)
        return;

    const hasLocalEdits =
        album.localEdited === true ||
        album.savedEdited === true;

    editButton.classList.toggle(
        "album-page-edit-local",
        hasLocalEdits
    );

    if (!albumEditSession) {

        editButton.title =
            hasLocalEdits
                ? "Edit album (has local edits)"
                : "Edit album";

    }

}


/*
 * currentAlbum can be a runtime copy while the home view renders the
 * entry from `albums`. Mirror the edit flags so the yellow home-card
 * marker appears on the first render, not only after a refresh.
 */
function syncAlbumListEditFlags(album) {

    if (
        !album ||
        typeof albums === "undefined"
    ) {
        return;
    }

    const entry =
        albums.find(
            item =>
                item &&
                String(item.id) ===
                    String(album.id)
        );

    if (!entry || entry === album)
        return;

    if (album.localEdited === true)
        entry.localEdited = true;

    if (album.savedEdited === true)
        entry.savedEdited = true;

    if (album.edited === true)
        entry.edited = true;

}

/*
 * Inline album edit mode.
 *
 * The album page itself becomes the editor: the title turns into an
 * input, a source select appears beside it, the gallery tiles become
 * draggable, and the bottom bar shows the manifest/record actions.
 * Search and the tag sidebar are hidden while editing.
 *
 * Nothing is written to the album until the check mark (save) or the
 * record generation button. The X asks before discarding.
 */

let albumEditSession = null;


function albumEditSourceNames(album) {

    const names =
        new Set(
            Object.keys(siteConfig?.providers || {})
        );

    names.add("direct");

    if (Array.isArray(album?.sources) && album.sources[0])
        names.add(album.sources[0]);

    return [...names].sort();

}


function albumEditImageForKey(session, key) {

    if (key == null || key === "")
        return null;

    const normalized =
        String(key);

    return (
        session.pendingImages?.get(normalized) ||
        session.album.images?.[normalized] ||
        null
    );

}


/*
 * Current order of real images in the edit grid, ignoring empty slots
 * and duplicate keys.
 */
function albumEditCurrentOrder(session) {

    const order =
        [];

    for (const key of session.cells || []) {

        if (key == null || key === "")
            continue;

        const image =
            albumEditImageForKey(session, key);

        if (image && !order.includes(image))
            order.push(image);

    }

    return order;

}


function albumEditSavedOrder(state) {

    const images =
        state?.images || {};

    return Object.keys(images)
        .sort(
            (a, b) =>
                Number(a) - Number(b)
        )
        .map(key => images[key]);

}


/*
 * A stable identity for an image across reloads. Image map keys are
 * renumbered on save, so compare the stored source records instead.
 */
const albumEditImageIdentityCache =
    new WeakMap();

function albumEditImageIdentity(image) {

    if (!image || typeof image !== "object")
        return "";

    const cached =
        albumEditImageIdentityCache.get(image);

    if (cached !== undefined)
        return cached;

    const parts =
        [];

    for (const key of Object.keys(image).sort()) {

        if (
            key === "tags" ||
            key === "urlOverrides" ||
            key === "added" ||
            key === "_imageNumber" ||
            key.startsWith("_")
        ) {
            continue;
        }

        parts.push(
            key + "=" + JSON.stringify(image[key])
        );

    }

    const identity =
        parts.join("|");

    albumEditImageIdentityCache.set(
        image,
        identity
    );

    return identity;

}


/*
 * Image tags as comparable strings. Tag indices point into a different
 * album.tags list for the base record, so compare the resolved names
 * rather than raw indices.
 */
function albumEditTagSignature(album, image) {

    const tags =
        typeof resolveImageTagStrings === "function"
            ? resolveImageTagStrings(album, image)
            : [];

    return tags
        .map(tag => String(tag).trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join("\u0000");

}


/*
 * The pristine image matching a live one, if this album has a base
 * record. Used by the image editor to keep showing which URLs and tags
 * were locally changed after a save and reload.
 */
function albumEditBaseImage(session, image) {

    const base =
        session?.baseAlbum;

    if (!base || !image)
        return null;

    const signature =
        albumEditImageIdentity(image);

    if (!signature)
        return null;

    for (const key of Object.keys(base.images || {})) {

        if (
            albumEditImageIdentity(
                base.images[key]
            ) === signature
        ) {
            return base.images[key];
        }

    }

    return null;

}


/*
 * Amber "local edit" marks inside album edit mode. When a pristine
 * base record is available, everything is compared against it, so the
 * marks persist across saves and reloads. Without a base (saved and
 * temporary albums), only changes made in the current session are
 * shown. Cancel removes the live marks by restoring the snapshot.
 */
function updateAlbumEditIndicators(session) {

    if (
        !session ||
        albumEditSession !== session
    ) {
        return;
    }

    const base =
        session.baseAlbum || null;

    const titleReference =
        base
            ? (base.name || "")
            : (session.originalTitle || "");

    const sourceReference =
        base
            ? ((base.sources || [])[0] || "")
            : (session.originalSource || "");

    if (session.titleInput) {

        session.titleInput.classList.toggle(
            "album-edit-changed",
            session.titleInput.value.trim() !==
                titleReference
        );

    }

    if (session.sourceSelect) {

        session.sourceSelect.classList.toggle(
            "album-edit-changed",
            session.sourceSelect.value !==
                sourceReference
        );

    }

    const currentOrder =
        albumEditCurrentOrder(session);

    const currentIndexByImage =
        new Map(
            currentOrder.map(
                (image, index) => [image, index]
            )
        );

    let baseBySignature =
        null;

    if (base) {

        if (session.baseIndexBySignature) {

            baseBySignature =
                session.baseIndexBySignature;

        } else {

            baseBySignature =
                new Map();

            Object.keys(base.images || {})
                .sort(
                    (a, b) =>
                        Number(a) - Number(b)
                )
                .forEach(
                    (key, index) => {

                        const baseImage =
                            base.images[key];

                        const signature =
                            albumEditImageIdentity(
                                baseImage
                            );

                        if (
                            signature &&
                            !baseBySignature.has(signature)
                        ) {

                            baseBySignature.set(
                                signature,
                                {
                                    image: baseImage,
                                    index
                                }
                            );

                        }

                    }
                );

            session.baseIndexBySignature =
                baseBySignature;

        }

    }

    const originalIndexByImage =
        base
            ? null
            : new Map(
                (session.originalOrder || []).map(
                    (image, index) => [image, index]
                )
            );

    session.cellElements?.forEach(
        (cell, index) => {

            if (!cell)
                return;

            const key =
                session.cells[index];

            const image =
                albumEditImageForKey(session, key);

            if (!image) {

                cell.classList.remove(
                    "album-grid-changed"
                );

                return;

            }

            let changed =
                false;

            if (base) {

                const signature =
                    albumEditImageIdentity(image);

                const baseEntry =
                    signature
                        ? baseBySignature.get(signature)
                        : null;

                if (!baseEntry) {

                    /* Newly added image. */
                    changed =
                        true;

                } else {

                    const after =
                        currentIndexByImage.get(image);

                    const moved =
                        after !== undefined &&
                        after !== baseEntry.index;

                    const urlChanged =
                        typeof getImageURLs ===
                            "function"
                            ? JSON.stringify(
                                getImageURLs(
                                    image,
                                    session.album
                                )
                            ) !==
                            JSON.stringify(
                                getImageURLs(
                                    baseEntry.image,
                                    base
                                )
                            )
                            : JSON.stringify(
                                image.urlOverrides || null
                            ) !==
                            JSON.stringify(
                                baseEntry.image.urlOverrides ||
                                null
                            );

                    const tagsChanged =
                        albumEditTagSignature(
                            session.album,
                            image
                        ) !==
                        albumEditTagSignature(
                            base,
                            baseEntry.image
                        );

                    changed =
                        moved ||
                        urlChanged ||
                        tagsChanged;

                }

            } else {

                const pending =
                    session.pendingImages?.get(
                        String(key)
                    ) === image;

                /*
                 * Compare against the last saved state instead of the
                 * sticky original* maps, so toggling a change back
                 * also clears its amber outline.
                 */
                const savedState =
                    session.savedState;

                let contentChanged;

                if (savedState) {

                    const savedTags =
                        savedState.imageTagSignatures?.get(
                            image
                        );

                    const tagsChanged =
                        savedTags !== undefined &&
                        albumEditTagSignature(
                            session.album,
                            image
                        ) !== savedTags;

                    const savedOverrides =
                        savedState.imageOverrides?.get(
                            image
                        );

                    const urlChanged =
                        JSON.stringify(
                            image.urlOverrides || null
                        ) !==
                        JSON.stringify(
                            savedOverrides || null
                        );

                    contentChanged =
                        tagsChanged ||
                        urlChanged;

                } else {

                    contentChanged =
                        session.originalImageOverrides?.has(
                            image
                        ) === true ||
                        session.originalImageTags?.has(
                            image
                        ) === true;

                }

                const before =
                    originalIndexByImage.get(image);

                const after =
                    currentIndexByImage.get(image);

                const moved =
                    before !== undefined &&
                    after !== undefined &&
                    before !== after;

                changed =
                    pending ||
                    contentChanged ||
                    moved;

            }

            cell.classList.toggle(
                "album-grid-changed",
                changed
            );

        }
    );

    updateAlbumEditButtons(session);

}


function buildEditedAlbumView(session) {

    const album =
        session.album;

    const name =
        session.titleInput.value.trim() ||
        album.name;

    const sources =
        Array.isArray(album.sources)
            ? album.sources.slice()
            : [];

    const source =
        session.sourceSelect.value;

    if (source) {

        if (sources.length)
            sources[0] = source;
        else
            sources.push(source);

    }

    const images =
        {};

    const used =
        new Set();

    let next = 0;

    /*
     * Reading order is left-to-right, top-to-bottom. Empty grid cells
     * are skipped, which is what compacts the album on save.
     */
    for (const key of session.cells || []) {

        const image =
            albumEditImageForKey(session, key);

        if (!image || used.has(image))
            continue;

        images[++next] =
            image;

        used.add(image);

    }

    const remainingKeys =
        Object.keys(album.images || {})
            .sort((a, b) => Number(a) - Number(b));

    for (const key of remainingKeys) {

        const image =
            album.images[key];

        if (!image || used.has(image))
            continue;

        images[++next] =
            image;

        used.add(image);

    }

    return {
        ...album,
        name,
        sources,
        images,
        _imagesArray: undefined,
        _localEditBase: undefined,
        localEdited: undefined
    };

}


function applyInlineAlbumEdit(session) {

    const album =
        session.album;

    const name =
        session.titleInput.value.trim();

    if (!name) {

        session.titleInput.focus();
        session.titleInput.reportValidity?.();

        return false;

    }

    const view =
        buildEditedAlbumView(session);

    /*
     * Mark the album as edited only when the session actually differs
     * from its last saved state. Sticky layout flags would otherwise
     * keep an album edited after a reorder was undone.
     */
    const hasActualEdits =
        albumEditHasChanges(session);

    album.edited =
        album.edited === true ||
        hasActualEdits;

    album.name =
        name;

    album.sources =
        view.sources;

    album.images =
        view.images;

    return true;

}


async function persistAlbumEdit(album) {

    if (
        album.storage &&
        typeof saveAlbumEdits === "function"
    ) {
        await saveAlbumEdits(
            album,
            { trackBase: true }
        );
    } else if (
        album.temporary &&
        typeof saveTemporaryAlbum === "function"
    ) {
        await saveTemporaryAlbum(album);
    } else if (
        typeof saveAlbumLocalEdit === "function"
    ) {
        /*
         * Remote albums have no storage record. Keep their edits in
         * localStorage so reloadAlbums() can lay them over the
         * original metadata on the next load.
         */
        await saveAlbumLocalEdit(album);
    }

    syncAlbumListEditFlags(album);

}


function confirmCancelAlbumEdit() {

    return new Promise(resolve => {

        const {
            overlay,
            box
        } = createInWindowDialog("Stop editing?");

        addInWindowDialogMessage(
            box,
            "Your changes will not be saved."
        );

        const buttons =
            createInWindowDialogButtons(box);

        let finished =
            false;

        const finish = value => {

            if (finished)
                return;

            finished =
                true;

            document.removeEventListener(
                "keydown",
                onKeydown,
                true
            );

            overlay.remove();

            resolve(value);

        };

        const onKeydown = event => {

            if (event.key === "Escape") {

                event.preventDefault();
                event.stopPropagation();

                finish(false);

            }

        };

        const keep =
            createInWindowDialogButton(
                buttons,
                "Keep editing",
                false
            );

        keep.onclick =
            () => finish(false);

        const discard =
            createInWindowDialogButton(
                buttons,
                "Discard changes",
                true
            );

        discard.classList.remove(
            "app-button-primary"
        );

        discard.classList.add(
            "app-button-danger"
        );

        discard.onclick =
            () => finish(true);

        document.addEventListener(
            "keydown",
            onKeydown,
            true
        );

        overlay.onclick =
            event => {

                if (event.target === overlay)
                    finish(false);

            };

    });

}


function albumEditColumnCount() {

    const gallery =
        document.getElementById("gallery");

    if (!gallery)
        return 1;

    const style =
        getComputedStyle(gallery);

    const width =
        gallery.getBoundingClientRect().width -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);

    return Math.max(
        1,
        getGalleryColumnCount(
            width,
            minColumns,
            maxColumns,
            minThumbWidth
        )
    );

}


function albumEditLastOccupiedIndex(session) {

    for (
        let index = (session.cells?.length || 0) - 1;
        index >= 0;
        index--
    ) {

        if (session.cells[index] != null)
            return index;

    }

    return -1;

}


function padAlbumEditCells(session, columns) {

    columns =
        Math.max(1, columns || 1);

    const last =
        albumEditLastOccupiedIndex(session);

    /*
     * One empty row below the lowest image. Dropping an image into that
     * row creates a new empty row, so the user can keep growing the
     * work area downwards.
     */
    const rows =
        last < 0
            ? 1
            : Math.floor(last / columns) + 2;

    const desired =
        rows * columns;

    if (desired < session.cells.length)
        session.cells.length = desired;

    while (session.cells.length < desired)
        session.cells.push(null);

}


function createAlbumEditCell() {

    const cell =
        document.createElement("div");

    cell.className =
        "album-grid-cell album-grid-empty";

    return cell;

}


function syncAlbumEditCellElements(session) {

    const gallery =
        document.getElementById("gallery");

    if (!gallery) {

        session.cellElements =
            [];

        return;

    }

    session.cellElements =
        [...gallery.querySelectorAll(".album-grid-cell")];

    while (
        session.cellElements.length <
        session.cells.length
    ) {

        const cell =
            createAlbumEditCell();

        gallery.appendChild(cell);

        session.cellElements.push(cell);

    }

    while (
        session.cellElements.length >
        session.cells.length
    ) {

        const cell =
            session.cellElements.pop();

        cell
            .querySelectorAll(".thumbnail-slot")
            .forEach(slot => slot.remove());

        cell.remove();

    }

    /* Keep DOM order and cell indices in sync without moving every
     * cell on each resize/layout pass. */
    const inOrder =
        gallery
            .querySelectorAll(".album-grid-cell")
            .length === session.cellElements.length &&
        [...gallery.querySelectorAll(".album-grid-cell")]
            .every(
                (cell, index) =>
                    cell === session.cellElements[index]
            );

    if (!inOrder) {

        session.cellElements.forEach(
            cell => gallery.appendChild(cell)
        );

    }

}


function refreshAlbumEditCells(session) {

    session.cellElements.forEach(
        (cell, index) => {

            const key =
                session.cells[index];

            cell.dataset.cellIndex =
                String(index);

            if (key != null && key !== "") {

                const normalized =
                    String(key);

                const slot =
                    session.slotByKey.get(normalized);

                cell.classList.add(
                    "album-grid-filled"
                );

                cell.classList.remove(
                    "album-grid-empty",
                    "album-dragging",
                    "album-drop-target"
                );

                cell.dataset.imageKey =
                    normalized;

                cell.draggable =
                    session.bulkTagging !== true &&
                    !albumEditFilterActive();

                cell
                    .querySelector(".album-grid-add")
                    ?.remove();

                if (slot) {

                    slot.style.display =
                        "";

                    slot
                        .querySelectorAll("img")
                        .forEach(img => {

                            img.draggable =
                                false;

                        });

                    if (slot.parentNode !== cell)
                        cell.appendChild(slot);

                }

            } else {

                cell.classList.remove(
                    "album-grid-filled",
                    "album-dragging",
                    "album-drop-target"
                );

                cell.classList.add(
                    "album-grid-empty"
                );

                delete cell.dataset.imageKey;

                cell.draggable =
                    false;

                cell
                    .querySelector(".thumbnail-slot")
                    ?.remove();

                if (!cell.querySelector(".album-grid-add")) {

                    const add =
                        document.createElement("button");

                    add.type =
                        "button";

                    add.className =
                        "album-grid-add";

                    add.textContent =
                        "+";

                    add.title =
                        "Add image here";

                    add.setAttribute(
                        "aria-label",
                        "Add image in this grid slot"
                    );

                    cell.appendChild(add);

                }

            }

        }
    );

    updateAlbumEditIndicators(session);

}


function syncAlbumEditGrid(session) {

    const columns =
        albumEditColumnCount();

    session.columns =
        columns;

    padAlbumEditCells(
        session,
        columns
    );

    syncAlbumEditCellElements(session);

    refreshAlbumEditCells(session);

}


function layoutAlbumEditGrid(animate = true) {

    const session =
        albumEditSession;

    if (!session)
        return;

    syncAlbumEditGrid(session);

    return applyGalleryLayout(
        animate,
        session.cellElements
    );

}


function clearAlbumEditDropTarget() {

    document
        .querySelectorAll(
            ".album-grid-cell.album-drop-target"
        )
        .forEach(cell =>
            cell.classList.remove("album-drop-target")
        );

}


function removeAlbumEditDragGhost(session) {

    if (session?.dragGhost) {

        session.dragGhost.remove();

        session.dragGhost =
            null;

    }

    document
        .querySelectorAll(".album-drag-ghost")
        .forEach(ghost => ghost.remove());

}


/*
 * Remove only the gallery listeners owned by this session. Binding is
 * repeated whenever the edit grid is rebuilt (for example after Cancel
 * or Save), so stale handler references used to pile up: an old handler
 * from a finished session could open the single-image editor in tagging
 * mode, and duplicate current handlers could toggle a selection twice.
 */
function unbindAlbumEditGridEvents(session) {

    const gallery =
        document.getElementById("gallery");

    if (!gallery || !session)
        return;

    if (session.onDragStart)
        gallery.removeEventListener(
            "dragstart",
            session.onDragStart
        );

    if (session.onDragOver)
        gallery.removeEventListener(
            "dragover",
            session.onDragOver
        );

    if (session.onDrop)
        gallery.removeEventListener(
            "drop",
            session.onDrop
        );

    if (session.onDragEnd)
        gallery.removeEventListener(
            "dragend",
            session.onDragEnd
        );

    if (session.onClickCapture)
        gallery.removeEventListener(
            "click",
            session.onClickCapture,
            true
        );

}


function bindAlbumEditGrid(session) {

    if (
        !session ||
        albumEditSession !== session
    ) {
        return;
    }

    const gallery =
        document.getElementById("gallery");

    if (!gallery)
        return;

    /*
     * Never leave a previous set of handlers attached when the grid is
     * rebuilt for the same session.
     */
    unbindAlbumEditGridEvents(session);

    gallery.classList.add(
        "album-edit-gallery"
    );

    session.draggedIndex =
        null;

    session.onDragStart =
        event => {

            if (
                albumEditSession !== session ||
                session.bulkTagging ||
                albumEditFilterActive()
            ) {
                event.preventDefault();
                return;
            }

            const cell =
                event.target.closest(".album-grid-cell");

            if (
                !cell ||
                cell.classList.contains("album-grid-empty")
            ) {
                return;
            }

            session.draggedIndex =
                Number(cell.dataset.cellIndex);

            removeAlbumEditDragGhost(session);

            const previewSource =
                cell.querySelector(".thumbnail-slot") ||
                cell;

            const previewRect =
                previewSource.getBoundingClientRect();

            const offsetX =
                event.clientX
                    ? event.clientX - previewRect.left
                    : previewRect.width / 2;

            const offsetY =
                event.clientY
                    ? event.clientY - previewRect.top
                    : previewRect.height / 2;

            /*
             * Firefox needs the drag image's pixels to be ready at
             * dragstart. A freshly-cloned <img> has not loaded yet, so
             * the first drag of a tile renders black. Draw the already
             * loaded thumbnail into a canvas synchronously instead.
             */
            const sourceImage =
                previewSource.querySelector(
                    ".thumbnail-image"
                ) ||
                previewSource.querySelector("img");

            const canvas =
                document.createElement("canvas");

            canvas.className =
                "album-drag-ghost";

            canvas.setAttribute(
                "aria-hidden",
                "true"
            );

            const pixelWidth =
                Math.max(
                    1,
                    Math.round(previewRect.width)
                );

            const pixelHeight =
                Math.max(
                    1,
                    Math.round(previewRect.height)
                );

            canvas.width =
                pixelWidth;

            canvas.height =
                pixelHeight;

            canvas.style.setProperty(
                "position",
                "fixed",
                "important"
            );

            canvas.style.setProperty(
                "left",
                Math.round(previewRect.left) + "px",
                "important"
            );

            canvas.style.setProperty(
                "top",
                Math.round(previewRect.top) + "px",
                "important"
            );

            canvas.style.setProperty(
                "width",
                Math.max(1, Math.round(previewRect.width)) + "px",
                "important"
            );

            canvas.style.setProperty(
                "height",
                Math.max(1, Math.round(previewRect.height)) + "px",
                "important"
            );

            canvas.style.setProperty(
                "margin",
                "0",
                "important"
            );

            canvas.style.setProperty(
                "z-index",
                "1",
                "important"
            );

            canvas.style.setProperty(
                "pointer-events",
                "none",
                "important"
            );

            canvas.style.setProperty(
                "opacity",
                "1",
                "important"
            );

            canvas.style.setProperty(
                "visibility",
                "visible",
                "important"
            );

            const context =
                canvas.getContext("2d");

            if (
                context &&
                sourceImage?.complete &&
                sourceImage.naturalWidth &&
                sourceImage.naturalHeight
            ) {

                if (typeof context.roundRect === "function") {

                    context.beginPath();
                    context.roundRect(
                        0,
                        0,
                        canvas.width,
                        canvas.height,
                        8
                    );
                    context.clip();

                }

                /*
                 * Match object-fit: cover, the same crop the tile shows.
                 */
                const scale =
                    Math.max(
                        canvas.width / sourceImage.naturalWidth,
                        canvas.height / sourceImage.naturalHeight
                    );

                const drawWidth =
                    sourceImage.naturalWidth * scale;

                const drawHeight =
                    sourceImage.naturalHeight * scale;

                context.drawImage(
                    sourceImage,
                    (canvas.width - drawWidth) / 2,
                    (canvas.height - drawHeight) / 2,
                    drawWidth,
                    drawHeight
                );

            }

            document.body.appendChild(canvas);

            canvas.getBoundingClientRect();

            session.dragGhost =
                canvas;

            try {

                event.dataTransfer.setDragImage(
                    canvas,
                    Math.max(
                        1,
                        Math.min(
                            previewRect.width - 1,
                            Math.round(offsetX)
                        )
                    ),
                    Math.max(
                        1,
                        Math.min(
                            previewRect.height - 1,
                            Math.round(offsetY)
                        )
                    )
                );

            } catch {}

            cell.classList.add(
                "album-dragging"
            );

            try {

                event.dataTransfer.effectAllowed =
                    "move";

                event.dataTransfer.setData(
                    "text/plain",
                    cell.dataset.imageKey || ""
                );

            } catch {}

        };

    session.onDragOver =
        event => {

            if (
                albumEditSession !== session ||
                session.draggedIndex == null ||
                albumEditFilterActive()
            ) {
                return;
            }

            const cell =
                event.target.closest(".album-grid-cell");

            event.preventDefault();

            try {
                event.dataTransfer.dropEffect = "move";
            } catch {}

            clearAlbumEditDropTarget();

            if (
                cell &&
                Number(cell.dataset.cellIndex) !==
                session.draggedIndex
            ) {
                cell.classList.add(
                    "album-drop-target"
                );
            }

        };

    session.onDrop =
        event => {

            if (
                albumEditSession !== session ||
                albumEditFilterActive()
            ) {
                return;
            }

            const cell =
                event.target.closest(".album-grid-cell");

            clearAlbumEditDropTarget();
            removeAlbumEditDragGhost(session);

            if (
                !cell ||
                session.draggedIndex == null
            ) {
                return;
            }

            event.preventDefault();

            const targetIndex =
                Number(cell.dataset.cellIndex);

            const sourceIndex =
                session.draggedIndex;

            if (
                !Number.isFinite(targetIndex) ||
                !Number.isFinite(sourceIndex) ||
                targetIndex === sourceIndex
            ) {
                return;
            }

            /*
             * Swap contents. Dropping onto an occupied cell exchanges
             * the two images; dropping onto an empty cell leaves the
             * old cell empty.
             */
            const sourceKey =
                session.cells[sourceIndex] ?? null;

            session.cells[sourceIndex] =
                session.cells[targetIndex] ?? null;

            session.cells[targetIndex] =
                sourceKey;

            session.layoutDirty =
                true;

            layoutAlbumEditGrid(true);

        };

    session.onDragEnd =
        () => {

            if (albumEditSession !== session)
                return;

            document
                .querySelectorAll(
                    ".album-grid-cell.album-dragging"
                )
                .forEach(cell =>
                    cell.classList.remove("album-dragging")
                );

            session.draggedIndex =
                null;

            clearAlbumEditDropTarget();
            removeAlbumEditDragGhost(session);

        };

    /*
     * A click is either "open the add-image editor" (empty slot) or
     * the tail end of a drag (filled slot). Neither should open the
     * image viewer while the album is being organized.
     */
    session.onClickCapture =
        event => {

            if (albumEditSession !== session)
                return;

            const cell =
                event.target.closest(".album-grid-cell");

            if (!cell)
                return;

            if (session.bulkTagging) {

                event.preventDefault();
                event.stopPropagation();

                if (
                    typeof session.bulkTagClick ===
                    "function"
                ) {
                    session.bulkTagClick(
                        cell,
                        Number(cell.dataset.cellIndex)
                    );
                }

                return;

            }

            event.preventDefault();
            event.stopPropagation();

            const index =
                Number(cell.dataset.cellIndex);

            if (cell.classList.contains("album-grid-empty"))
                openAlbumEditAddImage(index);
            else
                openAlbumEditImageEditor(session, index);

        };

    gallery.addEventListener(
        "dragstart",
        session.onDragStart
    );

    gallery.addEventListener(
        "dragover",
        session.onDragOver
    );

    gallery.addEventListener(
        "drop",
        session.onDrop
    );

    gallery.addEventListener(
        "dragend",
        session.onDragEnd
    );

    gallery.addEventListener(
        "click",
        session.onClickCapture,
        true
    );

}


function unbindAlbumEditGrid(session) {

    const gallery =
        document.getElementById("gallery");

    unbindAlbumEditGridEvents(session);

    if (gallery) {

        gallery.classList.remove(
            "album-edit-gallery"
        );

        gallery
            .querySelectorAll(".album-grid-cell")
            .forEach(cell => {

                cell.draggable =
                    false;

                cell.classList.remove(
                    "album-dragging",
                    "album-drop-target"
                );

            });

    }

    session.draggedIndex =
        null;

    removeAlbumEditDragGhost(session);

}


function buildAlbumEditGrid(session) {

    if (
        !session ||
        albumEditSession !== session
    ) {
        return;
    }

    const gallery =
        document.getElementById("gallery");

    if (!gallery)
        return;

    const album =
        session.album;

    const imageKeys =
        Object.keys(album.images || {})
            .sort((a, b) => Number(a) - Number(b));

    const slots =
        [...gallery.querySelectorAll(".thumbnail-slot")];

    slots.forEach(slot => {

        slot.style.display =
            "";

    });

    const slotByKey =
        new Map();

    slots.forEach((slot, index) => {

        const number =
            slot._thumbnailItem?.image?._imageNumber;

        const key =
            number != null
                ? String(number)
                : imageKeys[index];

        if (key != null)
            slotByKey.set(String(key), slot);

    });

    gallery
        .querySelectorAll(
            ".gallery-add-tile, .album-grid-cell"
        )
        .forEach(element => element.remove());

    slots.forEach(slot => slot.remove());

    session.slotByKey =
        slotByKey;

    session.pendingImages =
        new Map();

    session.cells =
        imageKeys.filter(
            key => slotByKey.has(String(key))
        );

    session.nextImageKey =
        (
            Object.keys(album.images || {})
                .map(Number)
                .filter(Number.isFinite)
                .reduce((max, n) => Math.max(max, n), 0)
        ) + 1;

    session.layoutDirty =
        false;

    session.columns =
        albumEditColumnCount();

    padAlbumEditCells(
        session,
        session.columns
    );

    syncAlbumEditCellElements(session);

    refreshAlbumEditCells(session);

    bindAlbumEditGrid(session);

    layoutAlbumEditGrid(false);

}


function refreshAlbumEditImageSlot(session, image) {

    if (!session || !image)
        return;

    let slot =
        null;

    for (const [key, candidate] of session.slotByKey) {

        if (albumEditImageForKey(session, key) === image) {

            slot =
                candidate;

            break;

        }

    }

    if (!slot)
        return;

    const urls =
        getImageURLs(image, session.album);

    if (slot._thumbnailItem) {

        slot._thumbnailItem.src =
            urls.thumb;

        slot._thumbnailItem.mediumSrc =
            urls.medium;

        slot._thumbnailItem.fullSrc =
            urls.full;

    }

    slot.dataset.src =
        urls.thumb;

    slot.dataset.loaded =
        "true";

    slot.dataset.loading =
        "false";

    slot.style.visibility =
        "visible";

    const thumb =
        slot.querySelector(".thumbnail-image");

    if (thumb) {

        thumb.src =
            urls.thumb;

        thumb.style.visibility =
            "visible";

        if (typeof setMediaLoadingPlaceholder === "function")
            setMediaLoadingPlaceholder(slot, false);

    }

    const medium =
        slot.querySelector(".medium-image");

    if (medium) {

        medium.style.visibility =
            "hidden";

        medium.style.opacity =
            "0";

    }

}


function applyAlbumEditImageTags(session, image, tags) {

    if (
        !session ||
        !image ||
        !Array.isArray(tags)
    ) {
        return false;
    }

    const normalize =
        value =>
            typeof normalizeTagForMatch ===
                "function"
                ? normalizeTagForMatch(value)
                : String(value || "")
                    .trim()
                    .toLowerCase();

    const current =
        typeof resolveImageTagStrings ===
            "function"
            ? resolveImageTagStrings(
                session.album,
                image
            )
            : [];

    if (
        current.length === tags.length &&
        current.every(
            (tag, index) =>
                normalize(tag) ===
                normalize(tags[index])
        )
    ) {
        return false;
    }

    if (!session.originalImageTags.has(image)) {

        session.originalImageTags.set(
            image,
            Array.isArray(image.tags)
                ? image.tags.slice()
                : []
        );

    }

    if (!Array.isArray(session.album.tags))
        session.album.tags = [];

    const indices =
        [];

    for (const tag of tags) {

        const normalized =
            normalize(tag);

        let index =
            session.album.tags.findIndex(
                existing =>
                    normalize(existing) ===
                    normalized
            );

        if (index < 0) {

            session.album.tags.push(tag);

            index =
                session.album.tags.length - 1;

        }

        if (!indices.includes(index))
            indices.push(index);

    }

    indices.sort(
        (a, b) =>
            String(
                session.album.tags[a] || ""
            ).localeCompare(
                String(
                    session.album.tags[b] || ""
                )
            )
    );

    image.tags =
        indices;

    session.layoutDirty =
        true;

    return true;

}


function applyAlbumEditImageURLs(session, image, initial, values) {

    if (!session || !image)
        return;

    const tagsChanged =
        applyAlbumEditImageTags(
            session,
            image,
            values.tags
        );

    const sizeForField = {
        thumb: "thumb",
        medium: "medium",
        image: "full"
    };

    const overrides = {
        ...(image.urlOverrides || {})
    };

    let changed =
        false;

    for (const [field, sizeKey] of Object.entries(sizeForField)) {

        const next =
            values[field];

        if (next === initial[field])
            continue;

        overrides[sizeKey] =
            next;

        changed =
            true;

    }

    if (!changed) {

        if (tagsChanged) {

            session.layoutDirty =
                true;

            updateAlbumEditIndicators(
                session
            );

        }

        return;

    }

    if (!session.originalImageOverrides.has(image)) {

        session.originalImageOverrides.set(
            image,
            image.urlOverrides
                ? { ...image.urlOverrides }
                : undefined
        );

    }

    if (Object.keys(overrides).length)
        image.urlOverrides = overrides;
    else
        delete image.urlOverrides;

    session.layoutDirty =
        true;

    if (typeof forgetResolvedImageAsset === "function")
        forgetResolvedImageAsset(image);

    refreshAlbumEditImageSlot(
        session,
        image
    );

    updateAlbumEditIndicators(
        session
    );

}


/*
 * Reordering while a tag filter hides cells would shuffle invisible
 * neighbours, so drag-and-drop is disabled until the filter is clear.
 */
function albumEditFilterActive() {

    return (
        (typeof selectedTags !== "undefined" &&
            selectedTags.size > 0) ||
        (typeof excludedTags !== "undefined" &&
            excludedTags.size > 0)
    );

}


/*
 * Plain album-edit mode has its own cell grid, so the normal tag bar's
 * filter has to hide cells rather than thumbnail slots. During tagging
 * mode the bulk session owns this, so skip there.
 */
function applyAlbumEditTagFilter() {

    const session =
        albumEditSession;

    if (
        !session ||
        typeof bulkTagSession !== "undefined" &&
        bulkTagSession
    ) {
        return;
    }

    const selected =
        [...selectedTags];

    const excluded =
        [...excludedTags];

    const active =
        selected.length > 0 ||
        excluded.length > 0;

    session.cellElements?.forEach((cell, index) => {

        if (!cell)
            return;

        cell.draggable =
            !active &&
            cell.classList.contains("album-grid-filled") &&
            session.bulkTagging !== true;

        const key =
            session.cells[index];

        if (key == null || key === "") {

            cell.style.display =
                active ? "none" : "";

            return;

        }

        const image =
            albumEditImageForKey(session, key);

        if (!image) {

            cell.style.display =
                active ? "none" : "";

            return;

        }

        const currentTags =
            resolveImageTagStrings(
                session.album,
                image
            );

        const baseImage =
            typeof albumEditBaseImage === "function"
                ? albumEditBaseImage(
                    session,
                    image
                )
                : null;

        const baseTags =
            baseImage
                ? resolveImageTagStrings(
                    session.baseAlbum,
                    baseImage
                )
                : [];

        const tags =
            baseTags.length
                ? [
                    ...new Set([
                        ...currentTags,
                        ...baseTags
                    ])
                ]
                : currentTags;

        const isExcluded =
            excluded.some(tag =>
                tags.includes(tag)
            );

        let show =
            !isExcluded;

        if (show && selected.length) {

            show =
                filterMode === "all"
                    ? selected.every(tag =>
                        tags.includes(tag)
                    )
                    : selected.some(tag =>
                        tags.includes(tag)
                    );

        }

        cell.style.display =
            show ? "" : "none";

    });

    if (typeof layoutAlbumEditGrid === "function")
        layoutAlbumEditGrid(false);

}


function scrollAlbumEditImageIntoView(session, index) {

    if (!session)
        return;

    const key =
        session.cells[index];

    if (key == null)
        return;

    const slot =
        session.slotByKey.get(String(key));

    if (!slot)
        return;

    const dataIndex =
        Number(slot.dataset.index);

    if (
        Number.isFinite(dataIndex) &&
        typeof scrollToCurrentThumbnail === "function"
    ) {

        scrollToCurrentThumbnail(
            dataIndex
        );

        return;

    }

    const rect =
        slot.getBoundingClientRect();

    const top =
        window.scrollY +
        rect.top -
        (window.innerHeight / 2) +
        (rect.height / 2);

    if (typeof scrollPageKeepingOverlayLock === "function") {

        scrollPageKeepingOverlayLock(top);

    } else {

        window.scrollTo({
            top,
            behavior: "smooth"
        });

    }

}


function openAlbumEditImageEditor(session, index) {

    if (!session)
        return;

    const key =
        session.cells[index];

    if (key == null) {

        openAlbumEditAddImage(index);

        return;

    }

    const image =
        albumEditImageForKey(session, key);

    if (!image)
        return;

    const album =
        session.album;

    scrollAlbumEditImageIntoView(
        session,
        index
    );

    const initial = {

        thumb:
            getBestGuessImageURL(
                album,
                image,
                "thumb"
            ) || "",

        medium:
            getBestGuessImageURL(
                album,
                image,
                "medium"
            ) || "",

        image:
            getBestGuessImageURL(
                album,
                image,
                "full"
            ) || ""

    };

    /*
     * Compare the editor against the pristine remote image too, when
     * one exists, so previously saved local changes stay marked.
     */
    const baseImage =
        albumEditBaseImage(session, image);

    const baselineUrls =
        baseImage
            ? {

                thumb:
                    getBestGuessImageURL(
                        session.baseAlbum,
                        baseImage,
                        "thumb"
                    ) || "",

                medium:
                    getBestGuessImageURL(
                        session.baseAlbum,
                        baseImage,
                        "medium"
                    ) || "",

                image:
                    getBestGuessImageURL(
                        session.baseAlbum,
                        baseImage,
                        "full"
                    ) || ""

            }
            : null;

    const baselineTags =
        baseImage &&
        typeof resolveImageTagStrings === "function"
            ? resolveImageTagStrings(
                session.baseAlbum,
                baseImage
            )
            : null;

    /*
     * Reuse the exact assets the gallery/viewer already resolved for
     * this image (including blob URLs) so the editor preview does not
     * restart a download for a size that is already available.
     */
    const previewSources =
        typeof getResolvedImageAssetURL === "function"
            ? {

                thumb:
                    getResolvedImageAssetURL(
                        image,
                        "thumb"
                    ) || "",

                medium:
                    getResolvedImageAssetURL(
                        image,
                        "medium"
                    ) || "",

                image:
                    getResolvedImageAssetURL(
                        image,
                        "full"
                    ) || ""

            }
            : null;

    openAddImageEditor({
        album,
        title:
            "Image #" + (index + 1),
        submitLabel:
            "Save",
        initial,
        previewSources,
        baselineUrls,
        baselineTags,
        initialTags:
            typeof resolveImageTagStrings ===
                "function"
                ? resolveImageTagStrings(
                    album,
                    image
                )
                : [],
        onSave:
            values => applyAlbumEditImageURLs(
                session,
                image,
                initial,
                values
            ),
        onNavigate:
            direction => {

                const indices =
                    [];

                session.cells.forEach(
                    (cellKey, cellIndex) => {

                        if (cellKey != null)
                            indices.push(cellIndex);

                    }
                );

                if (indices.length < 2)
                    return;

                const position =
                    indices.indexOf(index);

                if (position < 0)
                    return;

                const nextIndex =
                    indices[
                        (
                            position +
                            direction +
                            indices.length
                        ) % indices.length
                    ];

                if (nextIndex === index)
                    return;

                document
                    .getElementById("addImageEditor")
                    ?.remove();

                openAlbumEditImageEditor(
                    session,
                    nextIndex
                );

            }
    });

}


function openAlbumEditAddImage(index) {

    const session =
        albumEditSession;

    if (
        !session ||
        !Number.isFinite(index) ||
        index < 0 ||
        index >= session.cells.length
    ) {
        return;
    }

    openAddImageEditor({
        album:
            session.album,

        onAdd:
            image => addAlbumEditPendingImage(
                session,
                index,
                image
            )
    });

}


function addAlbumEditPendingImage(session, index, image) {

    const album =
        session.album;

    if (session.cells[index] != null)
        return;

    let key =
        session.nextImageKey;

    while (
        album.images?.[key] ||
        session.pendingImages.has(String(key))
    ) {
        key++;
    }

    session.nextImageKey =
        key + 1;

    const normalized =
        String(key);

    session.pendingImages.set(
        normalized,
        image
    );

    session.cells[index] =
        normalized;

    session.layoutDirty =
        true;

    const gallery =
        document.getElementById("gallery");

    const imageIndex =
        Object.keys(album.images || {}).length +
        session.pendingImages.size -
        1;

    const slot =
        createAlbumImageItems(
            album,
            image,
            imageIndex,
            gallery
        );

    if (slot) {

        slot
            .querySelectorAll("img")
            .forEach(img => {

                img.draggable =
                    false;

            });

        session.slotByKey.set(
            normalized,
            slot
        );

    }

    layoutAlbumEditGrid(true);

    if (typeof startThumbnailLoading === "function")
        startThumbnailLoading();

}


function enterAlbumEditMode(album) {

    if (albumEditSession || !album)
        return;

    if (typeof setSearchActive === "function")
        setSearchActive(false);

    const pageName =
        document.getElementById("pageName");

    if (!pageName)
        return;

    const titleInput =
        document.createElement("input");

    titleInput.type =
        "text";

    titleInput.className =
        "album-edit-title-input";

    titleInput.value =
        album.name || "";

    titleInput.required =
        true;

    titleInput.setAttribute(
        "aria-label",
        "Album name"
    );

    const sourceSelect =
        document.createElement("select");

    sourceSelect.className =
        "album-edit-source";

    sourceSelect.title =
        "Primary source";

    sourceSelect.setAttribute(
        "aria-label",
        "Primary source"
    );

    for (const name of albumEditSourceNames(album))
        sourceSelect.appendChild(new Option(name, name));

    sourceSelect.value =
        album.sources?.[0] ||
        "direct";

    const editButton =
        document.getElementById("EditNameButton");

    const backButton =
        document.getElementById("backButton");

    const manifestButton =
        document.getElementById("generateManifest");

    const recordButton =
        document.getElementById("regenerateAlbum");

    /*
     * Remote albums and saved local albums both keep a pristine base
     * record so edit-mode marks can survive save + reload. Temporary
     * albums are their own source of truth and only show live session
     * changes.
     */
    let baseAlbum =
        album._publishedEditBase ||
        album._localEditBase ||
        album._savedAlbumEditBase ||
        null;

    if (
        !baseAlbum &&
        !album.temporary &&
        typeof cloneAlbumRecord === "function"
    ) {

        baseAlbum =
            cloneAlbumRecord(album);

        /*
         * Keep the base in the matching runtime slot so the image
         * editor's baseline tags/URLs work on the very first edit of
         * a saved local album too, not only after the album has been
         * saved once.
         */
        if (album.storage)
            album._savedAlbumEditBase = baseAlbum;
        else
            album._localEditBase = baseAlbum;

    }

    const session = {
        album,
        baseAlbum,
        savedState:
            null,
        tagBarWasHidden:
            false,
        pageName,
        pageNameDisplay: pageName.style.display,
        titleInput,
        sourceSelect,
        bulkTagging:
            false,
        bulkTagClick:
            null,
        bulkTagCleanup:
            null,
        originalSources:
            Array.isArray(album.sources)
                ? album.sources.slice()
                : null,
        originalSource:
            album.sources?.[0] ||
            "direct",
        originalTitle:
            album.name ||
            "",
        originalOrder:
            Object.keys(album.images || {})
                .sort(
                    (a, b) =>
                        Number(a) - Number(b)
                )
                .map(
                    key => album.images[key]
                ),
        originalEdited:
            album.edited === true,
        committed:
            false,
        pendingImages:
            new Map(),
        originalImageOverrides:
            new Map(),
        originalImageTags:
            new Map(),
        originalAlbumTags:
            Array.isArray(album.tags)
                ? album.tags.slice()
                : null,
        cells:
            [],
        cellElements:
            [],
        slotByKey:
            new Map(),
        nextImageKey:
            1,
        layoutDirty:
            false,
        editButton,
        editText: editButton?.textContent || "✎",
        editTitle: editButton?.title || "Edit album",
        editOnclick: editButton?.onclick || null,
        backButton,
        backText: backButton?.textContent || "←",
        backTitle: backButton?.title || "Back to albums",
        backOnclick: backButton?.onclick || null,
        manifestButton,
        manifestOnclick: manifestButton?.onclick || null,
        recordButton,
        recordTitle: recordButton?.title || "Generate album record",
        recordOnclick: recordButton?.onclick || null
    };

    albumEditSession =
        session;

    pageName.style.display =
        "none";

    pageName.parentNode.insertBefore(
        titleInput,
        pageName.nextSibling
    );

    pageName.parentNode.insertBefore(
        sourceSelect,
        titleInput.nextSibling
    );

    if (editButton) {

        editButton.textContent =
            "×";

        editButton.title =
            "Close edit mode";

        editButton.onclick =
            event => {

                event.stopPropagation();

                if (albumEditHasChanges(session))
                    return;

                closeAlbumEditModeAnimated();

            };

    }

    if (backButton) {

        backButton.style.display =
            "none";

    }

    if (manifestButton) {

        manifestButton.onclick =
            () => {

                if (typeof openAlbumManifestDialog === "function") {

                    openAlbumManifestDialog(
                        buildEditedAlbumView(session)
                    );

                }

            };

    }

    if (recordButton) {

        recordButton.title =
            "Publish album record (writes the current edits to the library)";

        recordButton.onclick =
            async () => {

                if (typeof generateAlbumRecord !== "function")
                    return;

                /*
                 * Generate from the live edit view so the record uses
                 * the current title, source, order, and any pending
                 * added images, without leaving edit mode. The action
                 * dialog is the confirmation; there is no extra prompt.
                 */
                await generateAlbumRecord(
                    buildEditedAlbumView(session)
                );

            };

    }

    titleInput.addEventListener(
        "keydown",
        event => {

            if (event.key === "Enter") {

                event.preventDefault();

                albumEditPrimaryAction();

            } else if (event.key === "Escape") {

                event.preventDefault();

                albumEditSecondaryAction();

            }

        }
    );

    titleInput.addEventListener(
        "input",
        () => updateAlbumEditIndicators(session)
    );

    sourceSelect.addEventListener(
        "change",
        () => updateAlbumEditIndicators(session)
    );

    const gallery =
        document.getElementById("gallery");

    const beforeRects =
        new Map();

    const galleryRectBefore =
        gallery?.getBoundingClientRect();

    gallery
        ?.querySelectorAll(".thumbnail-slot")
        .forEach(slot => {

            const image =
                slot._thumbnailItem?.image;

            if (image) {

                beforeRects.set(
                    image,
                    slot.getBoundingClientRect()
                );

            }

        });

    document.body.classList.add(
        "album-editing"
    );

    buildAlbumEditGrid(session);

    albumEditMarkSaved(session);
    updateAlbumEditButtons(session);

    /*
     * FLIP the new edit cells from their old thumbnail positions into
     * the grid. The tag sidebar and search field animate out over the
     * same interval.
     */
    const galleryRectNow =
        gallery?.getBoundingClientRect();

    let hasFlip =
        false;

    session.cellElements?.forEach((cell, index) => {

        const key =
            session.cells[index];

        const image =
            key != null
                ? albumEditImageForKey(session, key)
                : null;

        const oldRect =
            image && beforeRects.get(image);

        if (
            oldRect &&
            galleryRectBefore &&
            galleryRectNow
        ) {

            cell.style.transition =
                "none";

            cell.style.left =
                (oldRect.left - galleryRectNow.left) + "px";

            cell.style.top =
                (oldRect.top - galleryRectNow.top) + "px";

            cell.style.width =
                oldRect.width + "px";

            cell.style.height =
                oldRect.height + "px";

            hasFlip =
                true;

        } else if (!image) {

            cell.style.opacity =
                "0";

        }

    });

    if (hasFlip && gallery)
        void gallery.offsetWidth;

    requestAnimationFrame(() => {

        session.cellElements?.forEach(cell => {

            if (!cell)
                return;

            cell.style.transition = "";
            cell.style.opacity = "";

        });

        if (typeof layoutAlbumEditGrid === "function")
            layoutAlbumEditGrid(hasFlip);

        if (typeof applyAlbumEditTagFilter === "function")
            applyAlbumEditTagFilter();

    });

}


function albumEditCaptureState(session) {

    const album =
        session.album;

    const images =
        { ...(album.images || {}) };

    const imageTags =
        new Map();

    const imageTagSignatures =
        new Map();

    const imageOverrides =
        new Map();

    for (const image of Object.values(images)) {

        imageTags.set(
            image,
            Array.isArray(image.tags)
                ? image.tags.slice()
                : []
        );

        imageTagSignatures.set(
            image,
            albumEditTagSignature(
                album,
                image
            )
        );

        imageOverrides.set(
            image,
            image.urlOverrides
                ? { ...image.urlOverrides }
                : undefined
        );

    }

    return {

        name:
            album.name || "",

        sources:
            Array.isArray(album.sources)
                ? album.sources.slice()
                : null,

        images,

        albumTags:
            Array.isArray(album.tags)
                ? album.tags.slice()
                : [],

        imageTags,
        imageTagSignatures,
        imageOverrides,

        pendingImages:
            new Map(session.pendingImages || []),

        nextImageKey:
            session.nextImageKey,

        edited:
            album.edited === true

    };

}


function albumEditRestoreState(
    session,
    state,
    { rebuild = true } = {}
) {

    if (!session || !state)
        return;

    const album =
        session.album;

    album.name =
        state.name;

    if (Array.isArray(state.sources))
        album.sources =
            state.sources.slice();
    else
        delete album.sources;

    album.tags =
        state.albumTags.slice();

    album.images =
        { ...state.images };

    album.edited =
        state.edited;

    for (const [image, tags] of state.imageTags) {

        if (!image)
            continue;

        image.tags =
            tags.slice();

    }

    for (const [image, overrides] of state.imageOverrides) {

        if (!image)
            continue;

        if (overrides)
            image.urlOverrides =
                { ...overrides };
        else
            delete image.urlOverrides;

    }

    session.pendingImages =
        new Map(state.pendingImages || []);

    session.nextImageKey =
        state.nextImageKey;

    session.titleInput.value =
        state.name;

    session.sourceSelect.value =
        state.sources?.[0] ||
        "direct";

    if (!rebuild)
        return;

    const wanted =
        new Set(
            Object.values(state.images)
        );

    const gallery =
        document.getElementById("gallery");

    gallery
        ?.querySelectorAll(".thumbnail-slot")
        .forEach(slot => {

            const image =
                slot._thumbnailItem?.image;

            if (image && !wanted.has(image))
                slot.remove();

        });

    const filterStale = list => {

        if (!Array.isArray(list))
            return;

        for (
            let index = list.length - 1;
            index >= 0;
            index--
        ) {

            const image =
                list[index]?.image;

            if (image && !wanted.has(image))
                list.splice(index, 1);

        }

    };

    if (typeof thumbnailItems !== "undefined")
        filterStale(thumbnailItems);

    if (typeof mediumItems !== "undefined")
        filterStale(mediumItems);

    if (typeof stopThumbnailLoading === "function")
        stopThumbnailLoading();

    if (typeof stopMediumLoading === "function")
        stopMediumLoading();

    if (typeof buildImagesArray === "function")
        buildImagesArray(album);

    buildAlbumEditGrid(session);

}


function albumEditMarkSaved(session) {

    const album =
        session.album;

    session.originalSources =
        Array.isArray(album.sources)
            ? album.sources.slice()
            : null;

    session.originalSource =
        album.sources?.[0] ||
        "direct";

    session.originalTitle =
        album.name ||
        "";

    session.originalEdited =
        album.edited === true;

    session.originalOrder =
        Object.keys(album.images || {})
            .sort(
                (a, b) =>
                    Number(a) - Number(b)
            )
            .map(key => album.images[key]);

    session.originalImageOverrides.clear();
    session.originalImageTags.clear();

    session.originalAlbumTags =
        Array.isArray(album.tags)
            ? album.tags.slice()
            : [];

    session.layoutDirty =
        false;

    session.pendingImages.clear();

    session.nextImageKey =
        (
            Object.keys(album.images || {})
                .map(Number)
                .filter(Number.isFinite)
                .reduce(
                    (max, number) =>
                        Math.max(max, number),
                    0
                )
        ) + 1;

    session.savedState =
        albumEditCaptureState(session);

    session.committed =
        true;

    return session.savedState;

}


function updateAlbumEditButtons(session) {

    if (
        !session ||
        albumEditSession !== session
    ) {
        return;
    }

    const editButton =
        session.editButton;

    const backButton =
        session.backButton;

    if (!editButton)
        return;

    const bulkSession =
        typeof bulkTagSession !== "undefined"
            ? bulkTagSession
            : null;

    const dirty =
        bulkSession
            ? bulkSession.dirty === true
            : albumEditHasChanges(session);

    session.committed =
        !albumEditHasChanges(session);

    /*
     * Normal edit mode keeps a compact X at the far right. Tagging
     * mode turns that button into a wide Close spanning both rightmost
     * slots; when changes exist it is replaced by Cancel + Save.
     */
    editButton.textContent =
        bulkSession ? "Close" : "×";

    editButton.title =
        bulkSession
            ? (
                dirty
                    ? "Save or cancel changes first"
                    : "Close tagging mode"
            )
            : (
                dirty
                    ? "Save or cancel changes first"
                    : "Close edit mode"
            );

    editButton.classList.toggle(
        "bulk-close-wide",
        !!bulkSession
    );

    editButton.classList.toggle(
        "album-edit-close",
        !dirty
    );

    editButton.style.display =
        dirty
            ? "none"
            : "";

    /*
     * Match the two-slot span to the actual rendered round buttons in
     * this browser rather than relying on a height-based calculation.
     */
    if (bulkSession) {

        const sample =
            document.getElementById("tagToggle");

        const nav =
            document.getElementById("navCont");

        const sampleWidth =
            sample
                ? sample.getBoundingClientRect().width
                : 0;

        const gap =
            nav
                ? (
                    parseFloat(
                        getComputedStyle(nav).columnGap
                    ) || 6
                )
                : 6;

        editButton.style.width =
            !dirty && sampleWidth > 0
                ? (sampleWidth * 2 + gap) + "px"
                : "";

    } else {

        editButton.style.width =
            "";

    }

    editButton.onclick =
        event => {

            event.stopPropagation();

            if (
                typeof bulkTagSession !== "undefined" &&
                bulkTagSession
            ) {

                if (bulkTagSession.dirty)
                    return;

                exitBulkTagMode({
                    restore: false
                });

                return;

            }

            if (albumEditHasChanges(session))
                return;

            closeAlbumEditModeAnimated();

        };

    const cancelButton =
        document.getElementById("editCancelButton");

    const saveButton =
        document.getElementById("editSaveButton");

    const showActions =
        dirty &&
        (
            bulkSession ||
            albumEditSession === session
        );

    if (cancelButton) {

        cancelButton.style.display =
            showActions ? "" : "none";

        cancelButton.onclick =
            event => {

                event.stopPropagation();

                if (
                    typeof bulkTagSession !== "undefined" &&
                    bulkTagSession
                ) {

                    bulkTagCancelChanges();

                } else {

                    albumEditSecondaryAction();

                }

            };

    }

    if (saveButton) {

        saveButton.style.display =
            showActions ? "" : "none";

        saveButton.onclick =
            event => {

                event.stopPropagation();

                if (
                    typeof bulkTagSession !== "undefined" &&
                    bulkTagSession
                ) {

                    bulkTagSaveChanges();

                } else {

                    albumEditPrimaryAction();

                }

            };

    }

    if (backButton) {

        backButton.style.display =
            "none";

    }

}


function albumEditPrimaryAction() {

    const session =
        albumEditSession;

    if (!session)
        return;

    if (albumEditHasChanges(session))
        albumEditSaveAndStay();
    else
        closeAlbumEditModeAnimated();

}


function albumEditSecondaryAction() {

    const session =
        albumEditSession;

    if (!session)
        return;

    if (albumEditHasChanges(session))
        albumEditCancelAndStay();
    else
        closeAlbumEditModeAnimated();

}


async function albumEditSaveAndStay() {

    const session =
        albumEditSession;

    if (!session || session.saving)
        return false;

    session.saving =
        true;

    try {

        const changed =
            albumEditHasChanges(session);

        if (!applyInlineAlbumEdit(session))
            return false;

        if (changed)
            await persistAlbumEdit(session.album);

        /*
         * The user may have navigated away while the save was
         * persisting. Don't rebuild or rebind the grid for a session
         * that is no longer active.
         */
        if (albumEditSession !== session)
            return false;

        if (typeof buildImagesArray === "function")
            buildImagesArray(session.album);

        buildAlbumEditGrid(session);

        albumEditMarkSaved(session);
        updateAlbumEditIndicators(session);
        updateAlbumEditButtons(session);

        return true;

    } finally {

        session.saving =
            false;

    }

}


function albumEditCancelAndStay() {

    const session =
        albumEditSession;

    if (
        !session ||
        !session.savedState ||
        !albumEditHasChanges(session)
    ) {
        return false;
    }

    albumEditRestoreState(
        session,
        session.savedState
    );

    albumEditMarkSaved(session);
    updateAlbumEditIndicators(session);
    updateAlbumEditButtons(session);

    return true;

}


function restoreAlbumEditSnapshot(session) {

    if (!session)
        return;

    if (Array.isArray(session.originalSources))
        session.album.sources =
            session.originalSources.slice();
    else
        delete session.album.sources;

    for (
        const [image, original] of
        session.originalImageOverrides || []
    ) {

        if (original === undefined)
            delete image.urlOverrides;
        else
            image.urlOverrides = original;

    }

    for (
        const [image, original] of
        session.originalImageTags || []
    ) {

        image.tags =
            Array.isArray(original)
                ? original.slice()
                : [];

    }

    if (Array.isArray(session.originalAlbumTags))
        session.album.tags =
            session.originalAlbumTags.slice();
    else
        delete session.album.tags;

    session.album.edited =
        session.originalEdited === true;

}


function closeAlbumEditModeAnimated() {

    const session =
        albumEditSession;

    if (!session)
        return;

    if (!session.committed) {

        return exitAlbumEditMode({
            reload: true
        });

    }

    if (typeof session.bulkTagCleanup === "function")
        session.bulkTagCleanup(true);

    const album =
        session.album;

    const gallery =
        document.getElementById("gallery");

    if (!gallery) {

        return exitAlbumEditMode({
            reload: true
        });

    }

    const galleryRect =
        gallery.getBoundingClientRect();

    const rects =
        new Map();

    session.cellElements?.forEach((cell, index) => {

        const key =
            session.cells[index];

        const image =
            key != null
                ? albumEditImageForKey(session, key)
                : null;

        if (image && cell) {

            rects.set(
                image,
                cell.getBoundingClientRect()
            );

        }

    });

    unbindAlbumEditGrid(session);

    if (typeof stopThumbnailLoading === "function")
        stopThumbnailLoading();

    if (typeof stopMediumLoading === "function")
        stopMediumLoading();

    albumEditSession =
        null;

    const slots =
        [];

    session.cells?.forEach((key, index) => {

        const cell =
            session.cellElements?.[index];

        if (!cell)
            return;

        const slot =
            cell.querySelector(".thumbnail-slot");

        if (!slot)
            return;

        const image =
            slot._thumbnailItem?.image;

        const rect =
            image
                ? rects.get(image)
                : null;

        if (rect) {

            slot.style.transition =
                "none";

            slot.style.left =
                (rect.left - galleryRect.left) + "px";

            slot.style.top =
                (rect.top - galleryRect.top) + "px";

            slot.style.width =
                rect.width + "px";

            slot.style.height =
                rect.height + "px";

        }

        slot.style.visibility =
            "visible";

        gallery.appendChild(slot);
        slots.push(slot);

    });

    session.cellElements?.forEach(cell => {

        if (cell)
            cell.remove();

    });

    gallery
        .querySelectorAll(".album-grid-cell")
        .forEach(cell => cell.remove());

    document.body.classList.remove(
        "album-editing"
    );

    session.titleInput.remove();
    session.sourceSelect.remove();

    session.pageName.style.display =
        session.pageNameDisplay;

    session.pageName.textContent =
        album.name || "";

    document.title =
        album.name || document.title;

    if (session.editButton?.isConnected) {

        session.editButton.textContent =
            session.editText;

        session.editButton.title =
            session.editTitle;

        session.editButton.onclick =
            session.editOnclick;

        session.editButton.classList.remove(
            "album-edit-close"
        );

    }

    syncAlbumPageEditButton(session.album);

    if (session.backButton) {

        session.backButton.textContent =
            session.backText;

        session.backButton.title =
            session.backTitle;

        session.backButton.onclick =
            session.backOnclick;

        session.backButton.style.display =
            "";

    }

    const editCancelButton =
        document.getElementById("editCancelButton");

    const editSaveButton =
        document.getElementById("editSaveButton");

    if (editCancelButton)
        editCancelButton.style.display = "none";

    if (editSaveButton)
        editSaveButton.style.display = "none";

    if (
        session.manifestButton &&
        session.manifestOnclick
    ) {
        session.manifestButton.onclick =
            session.manifestOnclick;
    }

    if (
        session.recordButton &&
        session.recordOnclick
    ) {
        session.recordButton.title =
            session.recordTitle;

        session.recordButton.onclick =
            session.recordOnclick;
    }

    showAlbumButtons(true);

    document.getElementById("settingsButton").style.display =
        "";

    if (typeof buildImagesArray === "function")
        buildImagesArray(album);

    const orderedItems =
        [];

    gallery
        .querySelectorAll(".thumbnail-slot")
        .forEach((slot, index) => {

            const item =
                slot._thumbnailItem;

            if (!item)
                return;

            item.index =
                index;

            item.slotIndex =
                index;

            slot.dataset.index =
                String(index);

            slot.dataset.thumbnailIndex =
                String(index);

            orderedItems.push(item);

        });

    if (typeof thumbnailItems !== "undefined") {

        thumbnailItems.length =
            0;

        thumbnailItems.push(
            ...orderedItems
        );

    }

    if (typeof mediumItems !== "undefined") {

        mediumItems.forEach(item => {

            const thumbnail =
                orderedItems.find(
                    entry =>
                        entry.image === item.image
                );

            if (thumbnail)
                item.index = thumbnail.index;

        });

    }

    for (const item of orderedItems) {

        if (!item.image)
            continue;

        const tags =
            resolveImageTagStrings(
                album,
                item.image
            );

        item.tags =
            tags;

        if (item.img)
            item.img.alt = tags.join(",");

        if (item.mediumImg)
            item.mediumImg.alt = tags.join(",");

    }

    /*
     * Rebuild the tag list so tags changed during the edit are
     * reflected, but keep the current filter selection intact.
     */
    if (typeof buildTagList === "function")
        buildTagList(album.tags || []);

    void gallery.offsetWidth;

    requestAnimationFrame(() => {

        slots.forEach(slot => {

            slot.style.transition = "";

        });

        if (typeof applyTagFilter === "function")
            applyTagFilter();
        else if (typeof applyGalleryLayout === "function")
            applyGalleryLayout(true);

    });

}


function exitAlbumEditMode({ reload = true } = {}) {

    const session =
        albumEditSession;

    if (!session)
        return;

    if (typeof session.bulkTagCleanup === "function")
        session.bulkTagCleanup(session.committed === true);

    albumEditSession =
        null;

    if (!session.committed) {

        if (session.savedState)
            albumEditRestoreState(
                session,
                session.savedState,
                { rebuild: false }
            );
        else
            restoreAlbumEditSnapshot(session);

    }

    unbindAlbumEditGrid(session);

    document.body.classList.remove(
        "album-editing"
    );

    session.titleInput.remove();
    session.sourceSelect.remove();

    session.pageName.style.display =
        session.pageNameDisplay;

    if (session.editButton?.isConnected) {

        session.editButton.textContent =
            session.editText;

        session.editButton.title =
            session.editTitle;

        session.editButton.onclick =
            session.editOnclick;

        session.editButton.classList.remove(
            "album-edit-close"
        );

    }

    syncAlbumPageEditButton(session.album);

    if (session.backButton) {

        session.backButton.textContent =
            session.backText;

        session.backButton.title =
            session.backTitle;

        session.backButton.onclick =
            session.backOnclick;

        session.backButton.style.display =
            "";

    }

    const editCancelButton =
        document.getElementById("editCancelButton");

    const editSaveButton =
        document.getElementById("editSaveButton");

    if (editCancelButton)
        editCancelButton.style.display = "none";

    if (editSaveButton)
        editSaveButton.style.display = "none";

    if (
        session.manifestButton &&
        session.manifestOnclick
    ) {
        session.manifestButton.onclick =
            session.manifestOnclick;
    }

    if (
        session.recordButton &&
        session.recordOnclick
    ) {
        session.recordButton.title =
            session.recordTitle;

        session.recordButton.onclick =
            session.recordOnclick;
    }

    if (reload) {

        if (typeof loadAlbum === "function")
            return loadAlbum(session.album, false);

    } else if (
        !document.querySelector("#gallery .album-grid-cell") &&
        typeof applyGalleryLayout === "function"
    ) {

        applyGalleryLayout(false);

    }

    if (
        !reload &&
        typeof applyTagFilter === "function"
    ) {
        applyTagFilter();
    }

}


async function saveInlineAlbumEdit() {

    const session =
        albumEditSession;

    if (!session)
        return false;

    /*
     * Measure changes before applying them: applyInlineAlbumEdit()
     * writes the title/source back into the album, which would make a
     * no-op save look indistinguishable from a real one.
     */
    const changed =
        albumEditHasChanges(session);

    if (!applyInlineAlbumEdit(session))
        return false;

    if (changed)
        await persistAlbumEdit(session.album);

    session.committed =
        true;

    await exitAlbumEditMode({
        reload: true
    });

    return true;

}


function albumEditHasChanges(session) {

    if (!session)
        return false;

    const saved =
        session.savedState;

    if (!saved)
        return false;

    const album =
        session.album;

    if (
        session.titleInput.value.trim() !==
        (saved.name || "")
    ) {
        return true;
    }

    const currentSources =
        Array.isArray(album.sources)
            ? album.sources
            : [];

    const savedSources =
        Array.isArray(saved.sources)
            ? saved.sources
            : [];

    /*
     * The source dropdown is live state; album.sources only updates on
     * apply, so compare the control itself as well.
     */
    if (
        session.sourceSelect.value !==
        (savedSources[0] || "direct")
    ) {
        return true;
    }

    if (
        JSON.stringify(currentSources) !==
        JSON.stringify(savedSources)
    ) {
        return true;
    }

    /*
     * Compare the actual on-screen order against the last saved order.
     * A flip flag like layoutDirty stays true even after the user
     * swaps two images back, which wrongly kept Save/Cancel visible.
     */
    const currentOrder =
        albumEditCurrentOrder(session);

    const savedOrder =
        albumEditSavedOrder(saved);

    if (
        currentOrder.length !== savedOrder.length ||
        currentOrder.some(
            (image, index) =>
                image !== savedOrder[index]
        )
    ) {
        return true;
    }

    for (const image of currentOrder) {

        const savedTags =
            saved.imageTagSignatures?.get(
                image
            );

        if (
            savedTags !== undefined &&
            albumEditTagSignature(
                album,
                image
            ) !== savedTags
        ) {
            return true;
        }

        const savedOverrides =
            saved.imageOverrides?.get(
                image
            );

        if (
            JSON.stringify(
                image.urlOverrides || null
            ) !==
            JSON.stringify(
                savedOverrides || null
            )
        ) {
            return true;
        }

    }

    if (session.pendingImages?.size)
        return true;

    return false;

}


async function cancelAlbumEdit() {

    const session =
        albumEditSession;

    if (!session)
        return;

    if (albumEditHasChanges(session)) {

        const discard =
            await confirmCancelAlbumEdit();

        if (!discard)
            return;

    }

    await exitAlbumEditMode({
        reload: true
    });

}


/*
 * Bulk tag editing is wired in 30-bulk-tagging.js. Keep that module
 * separate so the album editor stays focused on ordering and metadata.
 */

