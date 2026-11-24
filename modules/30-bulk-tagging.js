/*
 * 30-bulk-tagging.js
 *
 * Bulk tag mode for the inline album editor.
 *
 * While active:
 * - image tiles are selected by clicking instead of opening the image
 *   editor or being dragged;
 * - the normal tag sidebar is shown, split into selected-image tags
 *   (top) and the normal tag filter list (bottom);
 * - the top search slot becomes an "add tags…" field;
 * - changes can be closed, cancelled, or saved from the bottom bar.
 *
 * Tags are still applied to the underlying album edit session. Saving
 * bulk mode only leaves bulk mode; the album itself is still saved or
 * cancelled with the normal album-edit controls.
 */

let bulkTagSession = null;


function bulkTagIsActive() {

    return !!bulkTagSession;

}


function bulkTagNormalize(value) {

    return typeof normalizeTagForMatch === "function"
        ? normalizeTagForMatch(value)
        : String(value || "")
            .trim()
            .toLowerCase()
            .replace(/_/g, " ")
            .replace(/\s+/g, " ");

}


function bulkTagLabel(value) {

    return typeof formatTagLabel === "function"
        ? formatTagLabel(value)
        : String(value || "");

}


function bulkTagAllImages(session) {

    const images =
        new Set();

    if (session?.album?.images) {

        for (const image of Object.values(session.album.images)) {

            if (image)
                images.add(image);

        }

    }

    if (session?.pendingImages) {

        for (const image of session.pendingImages.values()) {

            if (image)
                images.add(image);

        }

    }

    return [...images];

}


function bulkTagImageAt(session, index) {

    if (!session)
        return null;

    const key =
        session.cells?.[index];

    if (key == null || key === "")
        return null;

    return albumEditImageForKey(session, key);

}


function bulkTagSelectedImages(session) {

    if (!session || !bulkTagSession)
        return [];

    const images =
        [];

    for (
        const index of
        [...bulkTagSession.selectedIndices].sort(
            (a, b) => a - b
        )
    ) {

        const image =
            bulkTagImageAt(session, index);

        if (image)
            images.push(image);

    }

    return images;

}


function bulkTagVocabulary(album) {

    const values =
        new Set();

    if (typeof getAllSearchTags === "function") {

        for (const tag of getAllSearchTags())
            values.add(tag);

    }

    if (Array.isArray(album?.tags)) {

        for (const tag of album.tags)
            values.add(tag);

    }

    return [...values];

}


function bulkTagCanonical(album, raw) {

    const normalized =
        bulkTagNormalize(raw);

    if (!normalized)
        return "";

    const canonical =
        bulkTagVocabulary(album).find(
            tag =>
                bulkTagNormalize(tag) ===
                normalized
        );

    return canonical || raw.trim().replace(/\s+/g, "_");

}


function bulkTagTagsOnAllSelected(session) {

    const images =
        bulkTagSelectedImages(session);

    if (!images.length)
        return [];

    const album =
        session.album;

    const first =
        resolveImageTagStrings(album, images[0]);

    return first.filter(tag => {

        const normalized =
            bulkTagNormalize(tag);

        return images.every(image =>
            resolveImageTagStrings(album, image)
                .some(candidate =>
                    bulkTagNormalize(candidate) ===
                    normalized
                )
        );

    });

}


/*
 * The pristine tag list for an image. For normal albums this comes from
 * the album edit base; for temporary albums (no base) the state at the
 * start of bulk mode is the best available baseline.
 */
function bulkTagBaselineTags(session, image) {

    if (!session || !image)
        return [];

    if (
        session.baseAlbum &&
        typeof albumEditBaseImage === "function"
    ) {

        const baseImage =
            albumEditBaseImage(session, image);

        if (!baseImage)
            return [];

        return resolveImageTagStrings(
            session.baseAlbum,
            baseImage
        );

    }

    const snapshotTags =
        bulkTagSession?.snapshot?.imageTags?.get(image);

    if (!Array.isArray(snapshotTags))
        return [];

    return snapshotTags
        .map(index => session.album.tags?.[index])
        .filter(tag => typeof tag === "string" && tag);

}


function bulkTagSelectedStates(session, images) {

    return images.map(image => {

        const active =
            resolveImageTagStrings(
                session.album,
                image
            );

        const baseline =
            bulkTagBaselineTags(
                session,
                image
            );

        return {

            image,
            active,
            baseline,

            activeKeys:
                new Set(active.map(bulkTagNormalize)),

            baselineKeys:
                new Set(baseline.map(bulkTagNormalize))

        };

    });

}


/*
 * Removed-tag tracking is per image. A tag is only shown as removed for
 * the images that were selected when it was removed (or that already
 * had it removed relative to the last save). Tracking it globally made
 * the removed state leak onto images that never had the tag at all,
 * especially after filtering.
 */
function bulkTagDisabledImages(normalized) {

    return (
        bulkTagSession
            ?.disabledTagImages
            ?.get(normalized)
            ?.images ||
        null
    );

}


function bulkTagIsDisabledForImage(normalized, image) {

    const images =
        bulkTagDisabledImages(normalized);

    return !!(
        images &&
        image &&
        images.has(image)
    );

}


function bulkTagMarkDisabled(normalized, tag, images) {

    if (
        !bulkTagSession ||
        !normalized ||
        !images?.length
    ) {
        return;
    }

    let entry =
        bulkTagSession.disabledTagImages.get(
            normalized
        );

    if (!entry) {

        entry = {
            tag: tag || normalized,
            images: new Set()
        };

        bulkTagSession.disabledTagImages.set(
            normalized,
            entry
        );

    } else if (!entry.tag && tag) {

        entry.tag =
            tag;

    }

    for (const image of images) {

        if (image)
            entry.images.add(image);

    }

}


function bulkTagRestoreDisabled(normalized, images) {

    if (!bulkTagSession || !normalized)
        return;

    const entry =
        bulkTagSession.disabledTagImages.get(
            normalized
        );

    if (!entry)
        return;

    for (const image of images || []) {

        if (image)
            entry.images.delete(image);

    }

    if (!entry.images.size) {

        bulkTagSession.disabledTagImages.delete(
            normalized
        );

    }

}


function bulkTagCandidateTags(states) {

    const tags =
        new Map();

    for (const state of states) {

        for (const tag of state.active) {

            tags.set(
                bulkTagNormalize(tag),
                tag
            );

        }

        for (const tag of state.baseline) {

            const normalized =
                bulkTagNormalize(tag);

            if (!tags.has(normalized))
                tags.set(normalized, tag);

        }

    }

    const selectedImages =
        new Set(states.map(state => state.image));

    for (
        const [normalized, entry] of
        bulkTagSession.disabledTagImages
    ) {

        const relevant =
            [...entry.images].some(image =>
                selectedImages.has(image)
            );

        if (relevant && !tags.has(normalized))
            tags.set(normalized, entry.tag);

    }

    return tags;

}


function bulkTagTagInfo(states, normalized) {

    const disabledImages =
        bulkTagDisabledImages(normalized);

    const disabled = !!(
        disabledImages &&
        disabledImages.size
    );

    let activeCount = 0;
    let removedCount = 0;
    let editedCount = 0;

    for (const state of states) {

        const active =
            state.activeKeys.has(normalized);

        const baseline =
            state.baselineKeys.has(normalized);

        if (active) {

            activeCount++;

            if (!baseline)
                editedCount++;

        } else if (
            baseline ||
            (
                disabledImages &&
                disabledImages.has(state.image)
            )
        ) {

            removedCount++;

        }

    }

    return {
        activeCount,
        removedCount,
        editedCount,
        disabled
    };

}


function bulkTagDefaultClass(info, total) {

    if (!total)
        return "";

    if (
        info.activeCount === total &&
        info.editedCount === total
    ) {
        return "new";
    }

    /*
     * If no selected image has the tag, images that never had it are
     * equivalent to images where it was removed for this state. Show
     * the whole selection as removed instead of falling back to blue.
     */
    if (
        info.activeCount === 0 &&
        info.removedCount > 0
    ) {
        return "removed";
    }

    return "";

}


function bulkTagImageHoverClass(
    state,
    normalized,
    anySelectedActive = true,
    inSelection = true
) {

    if (state.activeKeys.has(normalized)) {

        return state.baselineKeys.has(normalized)
            ? "bulk-tag-hover-blue"
            : "bulk-tag-hover-new";

    }

    if (
        state.baselineKeys.has(normalized) ||
        bulkTagIsDisabledForImage(
            normalized,
            state.image
        ) ||
        (inSelection && !anySelectedActive)
    ) {
        return "bulk-tag-hover-removed";
    }

    return "bulk-tag-dimmed";

}


/*
 * Remove tags that were added in this edit session and are no longer
 * used by any image. This keeps an add-then-remove from leaving an
 * unused tag in album.tags and making the album look edited.
 * Tags already present at the last save (session.originalAlbumTags)
 * are kept even if currently unused.
 */
function bulkTagPruneUnusedSessionTags(session) {

    const album =
        session?.album;

    if (!album || !Array.isArray(album.tags))
        return false;

    const baseline =
        new Set(
            (session.snapshot?.albumTags ||
                session.originalAlbumTags ||
                [])
                .map(bulkTagNormalize)
                .filter(Boolean)
        );

    const images =
        bulkTagAllImages(session);

    const used =
        new Set();

    for (const image of images) {

        for (const index of image.tags || []) {

            if (Number.isInteger(index))
                used.add(index);

        }

    }

    const nextTags =
        [];

    const indexMap =
        new Map();

    album.tags.forEach((tag, index) => {

        if (
            used.has(index) ||
            baseline.has(bulkTagNormalize(tag))
        ) {

            indexMap.set(
                index,
                nextTags.length
            );

            nextTags.push(tag);

        }

    });

    if (nextTags.length === album.tags.length)
        return false;

    for (const image of images) {

        image.tags =
            (image.tags || [])
                .map(index => indexMap.get(index))
                .filter(index => index !== undefined);

    }

    album.tags =
        nextTags;

    return true;

}


/* ---------------------------------------------------------------- */
/* Snapshot / restore                                                */
/* ---------------------------------------------------------------- */

function bulkTagSnapshot(session) {

    const imageTags =
        new Map();

    const imageTagKeys =
        new Map();

    const albumTags =
        Array.isArray(session.album.tags)
            ? session.album.tags.slice()
            : [];

    for (const image of bulkTagAllImages(session)) {

        const indices =
            Array.isArray(image.tags)
                ? image.tags.slice()
                : [];

        imageTags.set(
            image,
            indices
        );

        imageTagKeys.set(
            image,
            indices
                .map(index =>
                    bulkTagNormalize(
                        albumTags[index]
                    )
                )
                .filter(Boolean)
        );

    }

    return {

        albumTags,

        imageTags,

        imageTagKeys,

        originalImageTags:
            new Map(session.originalImageTags || []),

        layoutDirty:
            session.layoutDirty === true

    };

}


function bulkTagRestoreSnapshot(snapshot) {

    if (!snapshot || !bulkTagSession)
        return;

    const session =
        bulkTagSession.albumSession;

    const album =
        session.album;

    album.tags =
        snapshot.albumTags.slice();

    for (const [image, tags] of snapshot.imageTags) {

        image.tags =
            tags.slice();

    }

    session.originalImageTags.clear();

    for (const [image, tags] of snapshot.originalImageTags) {

        session.originalImageTags.set(
            image,
            tags
        );

    }

    session.layoutDirty =
        snapshot.layoutDirty;

}


function bulkTagRecomputeDirty() {

    const session =
        bulkTagSession;

    if (!session)
        return false;

    const albumSession =
        session.albumSession;

    const album =
        albumSession.album;

    let dirty =
        false;

    for (const [image, indices] of session.snapshot.imageTags) {

        const current =
            resolveImageTagStrings(
                album,
                image
            )
                .map(bulkTagNormalize)
                .filter(Boolean)
                .sort()
                .join("\u0000");

        const savedKeys =
            session.snapshot.imageTagKeys?.get(
                image
            );

        const saved =
            (
                savedKeys ||
                (indices || [])
                    .map(index => album.tags?.[index])
            )
                .filter(tag => typeof tag === "string" && tag)
                .map(bulkTagNormalize)
                .filter(Boolean)
                .sort()
                .join("\u0000");

        if (current !== saved) {

            dirty = true;
            break;

        }

    }

    session.dirty =
        dirty;

    return dirty;

}


/*
 * Removed tags that were added during this edit session and never saved
 * are visual-only. On Save they disappear instead of becoming a real
 * removal, and they do not count toward dirty state.
 */
function bulkTagPruneEphemeralDisabled() {

    const session =
        bulkTagSession;

    if (!session)
        return;

    const albumSession =
        session.albumSession;

    for (
        const [normalized, entry] of
        [...session.disabledTagImages]
    ) {

        for (const image of [...entry.images]) {

            const wasOriginal =
                bulkTagBaselineTags(
                    albumSession,
                    image
                ).some(tag =>
                    bulkTagNormalize(tag) ===
                    normalized
                );

            const wasSaved =
                (
                    session.snapshot.imageTagKeys
                        ?.get(image) ||
                    []
                ).includes(normalized);

            /*
             * Only a tag that existed in the last saved state is a
             * real removal. A tag added and removed in this session is
             * purely visual and disappears on Save.
             */
            if (!wasOriginal && !wasSaved)
                entry.images.delete(image);

        }

        if (!entry.images.size) {

            session.disabledTagImages.delete(
                normalized
            );

        }

    }

}


function bulkTagSaveChanges() {

    const session =
        bulkTagSession;

    if (!session)
        return;

    bulkTagPruneEphemeralDisabled();
    bulkTagPruneUnusedSessionTags(
        session.albumSession
    );

    session.snapshot =
        bulkTagSnapshot(session.albumSession);

    session.dirty =
        false;

    bulkTagClearHover();

    bulkTagSyncThumbnailItems(
        session.albumSession
    );

    if (typeof buildTagList === "function")
        buildTagList(
            session.albumSession.album.tags || []
        );

    bulkTagReapplyFilterClasses();
    bulkTagApplyCellFilter();
    bulkTagRenderSummary();
    bulkTagRenderActions();

}


function bulkTagCancelChanges() {

    const session =
        bulkTagSession;

    if (!session)
        return;

    bulkTagRestoreSnapshot(
        session.snapshot
    );

    session.disabledTagImages.clear();
    session.dirty =
        false;

    bulkTagClearHover();

    bulkTagSyncThumbnailItems(
        session.albumSession
    );

    if (typeof buildTagList === "function")
        buildTagList(session.albumSession.album.tags || []);

    bulkTagReapplyFilterClasses();
    bulkTagApplyCellFilter();
    bulkTagRenderSummary();
    bulkTagRenderActions();

    if (typeof updateAlbumEditIndicators === "function")
        updateAlbumEditIndicators(
            session.albumSession
        );

}


function bulkTagSyncThumbnailItems(session) {

    const album =
        session.album;

    for (const item of thumbnailItems) {

        if (!item?.image)
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

}


/* ---------------------------------------------------------------- */
/* Selected-image tag chips                                          */
/* ---------------------------------------------------------------- */

function bulkTagRenderSummary() {

    const session =
        bulkTagSession?.albumSession;

    const chips =
        document.getElementById("bulkTagChips");

    const count =
        document.getElementById("bulkTagSelectedCount");

    if (!session || !chips)
        return;

    const images =
        bulkTagSelectedImages(session);

    if (count) {

        count.textContent =
            images.length + " selected";

    }

    const clearSelection =
        document.getElementById("bulkTagClearSelection");

    if (clearSelection) {

        clearSelection.textContent =
            images.length
                ? "Clear"
                : "All";

        clearSelection.title =
            images.length
                ? "Clear selection"
                : "Select all images";

        clearSelection.style.display = "";

    }

    chips.innerHTML = "";
    bulkTagSession.chipByTag =
        new Map();

    if (!images.length) {

        const empty =
            document.createElement("div");

        empty.className =
            "bulk-tag-empty";

        empty.textContent =
            "Select images to see their tags.";

        chips.appendChild(empty);

        return;

    }

    const states =
        bulkTagSelectedStates(
            session,
            images
        );

    const candidates =
        bulkTagCandidateTags(states);

    if (!candidates.size) {

        const empty =
            document.createElement("div");

        empty.className =
            "bulk-tag-empty";

        empty.textContent =
            "No tags on the selected images.";

        chips.appendChild(empty);

        return;

    }

    const entries =
        [...candidates.entries()]
            .map(([normalized, tag]) => {

                const info =
                    bulkTagTagInfo(
                        states,
                        normalized
                    );

                return {
                    normalized,
                    tag,
                    info,
                    defaultClass:
                        bulkTagDefaultClass(
                            info,
                            images.length
                        )
                };

            })
            .sort((a, b) => {

                const aRemoved =
                    a.defaultClass === "removed"
                        ? 1
                        : 0;

                const bRemoved =
                    b.defaultClass === "removed"
                        ? 1
                        : 0;

                if (aRemoved !== bRemoved)
                    return aRemoved - bRemoved;

                return bulkTagLabel(a.tag).localeCompare(
                    bulkTagLabel(b.tag)
                );

            });

    entries.forEach(
        ({ normalized, tag, info, defaultClass }) => {

            const chip =
                document.createElement("span");

            chip.className =
                "search-tag bulk-tag-chip" +
                (
                    defaultClass
                        ? " " + defaultClass
                        : ""
                );

            chip.dataset.tag =
                tag;

            chip.title =
                info.activeCount +
                " of " +
                images.length +
                " selected image" +
                (images.length === 1 ? "" : "s") +
                " · click to toggle for all selected";

            chip.setAttribute(
                "role",
                "button"
            );

            chip.tabIndex =
                0;

            const label =
                document.createElement("span");

            label.className =
                "search-tag-label";

            label.textContent =
                bulkTagLabel(tag);

            chip.appendChild(label);

            chip.onclick =
                () => bulkTagToggleTag(tag);

            chip.onkeydown =
                event => {

                    if (
                        event.key === "Enter" ||
                        event.key === " "
                    ) {

                        event.preventDefault();
                        bulkTagToggleTag(tag);

                    }

                };

            chips.appendChild(chip);

            bulkTagSession.chipByTag.set(
                normalized,
                chip
            );

        });

    if (bulkTagSession.hoveredImage) {

        bulkTagApplyImageHoverToChips(
            bulkTagSession.hoveredImage
        );

    }

}


/* ---------------------------------------------------------------- */
/* Hover highlighting                                                */
/* ---------------------------------------------------------------- */

function bulkTagClearChipHoverClasses(chips = null) {

    const nodes =
        chips ||
        document.querySelectorAll(".bulk-tag-chip");

    for (const chip of nodes) {

        chip.classList.remove(
            "bulk-tag-hover-new",
            "bulk-tag-hover-removed",
            "bulk-tag-hover-blue",
            "bulk-tag-dimmed"
        );

    }

}


function bulkTagClearCellDimming() {

    document
        .querySelectorAll(
            ".album-grid-cell.bulk-tag-image-dimmed"
        )
        .forEach(cell =>
            cell.classList.remove(
                "bulk-tag-image-dimmed"
            )
        );

}


function bulkTagClearHover() {

    if (bulkTagSession) {

        bulkTagSession.hoveredImage =
            null;

        bulkTagSession.hoveredTag =
            null;

    }

    bulkTagClearChipHoverClasses();
    bulkTagClearCellDimming();

}


function bulkTagApplyImageHoverToChips(image) {

    const session =
        bulkTagSession?.albumSession;

    if (!session || !image)
        return;

    const state =
        bulkTagSelectedStates(
            session,
            [image]
        )[0];

    const selectedStates =
        bulkTagSelectedStates(
            session,
            bulkTagSelectedImages(session)
        );

    if (!state || !bulkTagSession.chipByTag)
        return;

    const inSelection =
        selectedStates.some(
            selectedState =>
                selectedState.image === image
        );

    bulkTagClearChipHoverClasses();

    for (const [normalized, chip] of bulkTagSession.chipByTag) {

        const anySelectedActive =
            selectedStates.some(
                selectedState =>
                    selectedState.activeKeys.has(
                        normalized
                    )
            );

        const hoverClass =
            bulkTagImageHoverClass(
                state,
                normalized,
                anySelectedActive,
                inSelection
            );

        if (hoverClass)
            chip.classList.add(hoverClass);

    }

}


function bulkTagHighlightImage(image) {

    const session =
        bulkTagSession?.albumSession;

    if (!session || !image)
        return;

    bulkTagClearHover();

    bulkTagSession.hoveredImage =
        image;

    bulkTagApplyImageHoverToChips(image);

}


function bulkTagHighlightTag(rawTag) {

    const session =
        bulkTagSession?.albumSession;

    if (!session || !rawTag)
        return;

    bulkTagSession.hoveredImage =
        null;

    bulkTagSession.hoveredTag =
        rawTag;

    bulkTagClearChipHoverClasses();
    bulkTagClearCellDimming();

    const normalized =
        bulkTagNormalize(rawTag);

    session.cellElements?.forEach((cell, index) => {

        if (!cell)
            return;

        const key =
            session.cells[index];

        if (key == null || key === "")
            return;

        const image =
            albumEditImageForKey(session, key);

        if (!image)
            return;

        const hasTag =
            resolveImageTagStrings(
                session.album,
                image
            ).some(tag =>
                bulkTagNormalize(tag) ===
                normalized
            );

        cell.classList.toggle(
            "bulk-tag-image-dimmed",
            !hasTag
        );

    });

}


/* ---------------------------------------------------------------- */
/* Tag filter list and cell filtering                                */
/* ---------------------------------------------------------------- */

function bulkTagReapplyFilterClasses() {

    const clearButton =
        document.getElementById("clearTags");

    document
        .querySelectorAll("#tagList .tag")
        .forEach(button => {

            const tag =
                button.dataset.tag;

            if (!tag)
                return;

            button.classList.toggle(
                "selected",
                selectedTags.has(tag)
            );

            button.classList.toggle(
                "excluded",
                excludedTags.has(tag)
            );

        });

    if (clearButton) {

        clearButton.style.display =
            (selectedTags.size || excludedTags.size)
                ? ""
                : "none";

    }

    if (typeof updateTagAvailability === "function")
        updateTagAvailability();

}


function bulkTagSelectAllImages() {

    const session =
        bulkTagSession?.albumSession;

    if (!session)
        return;

    session.cells?.forEach((key, index) => {

        if (key == null || key === "")
            return;

        const image =
            bulkTagImageAt(session, index);

        if (!image)
            return;

        bulkTagSession.selectedIndices.add(index);

        session.cellElements?.[index]
            ?.classList.add("bulk-tag-selected");

    });

    bulkTagClearHover();
    bulkTagRenderSummary();

}


function bulkTagClearSelectedImages() {

    if (!bulkTagSession)
        return;

    for (const index of bulkTagSession.selectedIndices) {

        bulkTagSession.albumSession
            .cellElements?.[index]
            ?.classList.remove("bulk-tag-selected");

    }

    bulkTagSession.selectedIndices.clear();

    bulkTagClearHover();
    bulkTagRenderSummary();

}


function bulkTagApplyCellFilter() {

    const session =
        bulkTagSession?.albumSession;

    if (!session)
        return;

    const active =
        selectedTags.size > 0 ||
        excludedTags.size > 0;

    const selected =
        [...selectedTags];

    const excluded =
        [...excludedTags];

    let total = 0;
    let visible = 0;
    let selectionChanged = false;

    session.cellElements?.forEach((cell, index) => {

        if (!cell)
            return;

        const key =
            session.cells[index];

        if (key == null || key === "") {

            cell.style.display =
                active
                    ? "none"
                    : "";

            return;

        }

        total++;

        const image =
            albumEditImageForKey(session, key);

        if (!image) {

            cell.style.display =
                active
                    ? "none"
                    : "";

            if (
                bulkTagSession.selectedIndices.has(index)
            ) {

                bulkTagSession.selectedIndices.delete(index);
                cell.classList.remove("bulk-tag-selected");
                selectionChanged = true;

            }

            return;

        }

        const tags =
            resolveImageTagStrings(
                session.album,
                image
            );

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
            show
                ? ""
                : "none";

        if (show)
            visible++;

        /*
         * A tag filter must not leave hidden images selected.
         */
        if (
            !show &&
            bulkTagSession.selectedIndices.has(index)
        ) {

            bulkTagSession.selectedIndices.delete(index);
            cell.classList.remove("bulk-tag-selected");
            selectionChanged = true;

        }

    });

    if (selectionChanged) {

        bulkTagClearHover();
        bulkTagRenderSummary();

    }

    if (typeof layoutAlbumEditGrid === "function")
        layoutAlbumEditGrid(false);

    const count =
        document.getElementById("tagVisibleCount");

    if (count) {

        count.textContent =
            visible +
            " / " +
            total;

    }

}


/*
 * Called by applyTagFilter() in 15-tag-filtering.js.
 */
function bulkTagFilterChanged() {

    if (bulkTagSession)
        bulkTagApplyCellFilter();

}


/* ---------------------------------------------------------------- */
/* Adding tags                                                       */
/* ---------------------------------------------------------------- */

function bulkTagAddTag(rawText) {

    const session =
        bulkTagSession?.albumSession;

    if (!session)
        return false;

    const images =
        bulkTagSelectedImages(session);

    if (!images.length)
        return false;

    const pieces =
        String(rawText || "")
            .split(",")
            .map(piece => piece.trim())
            .filter(Boolean);

    if (!pieces.length)
        return false;

    const album =
        session.album;

    let changed =
        false;

    for (const piece of pieces) {

        const normalized =
            bulkTagNormalize(piece);

        if (!normalized)
            continue;

        const tag =
            bulkTagCanonical(album, piece);

        for (const image of images) {

            const current =
                resolveImageTagStrings(
                    album,
                    image
                );

            if (
                current.some(candidate =>
                    bulkTagNormalize(candidate) ===
                    normalized
                )
            ) {
                continue;
            }

            if (
                typeof applyAlbumEditImageTags ===
                    "function" &&
                applyAlbumEditImageTags(
                    session,
                    image,
                    current.concat(tag)
                )
            ) {
                changed = true;
            }

        }

        bulkTagRestoreDisabled(
            normalized,
            images
        );

    }

    if (!changed)
        return false;

    bulkTagPruneUnusedSessionTags(session);
    bulkTagSyncThumbnailItems(session);

    if (typeof buildTagList === "function")
        buildTagList(album.tags || []);

    bulkTagReapplyFilterClasses();
    bulkTagApplyCellFilter();
    bulkTagRenderSummary();
    bulkTagRecomputeDirty();
    bulkTagRenderActions();

    if (typeof updateAlbumEditIndicators === "function")
        updateAlbumEditIndicators(session);

    return true;

}


/*
 * Clicking a tag chip mirrors the individual image editor's tag
 * toggle, but for the whole selection:
 *
 * - If any selected image has the tag, remove it from those images and
 *   mark it removed for the selection. A mixed selection therefore
 *   equalizes to "removed".
 * - If no selected image has it, add it to the whole selection.
 */
function bulkTagToggleTag(rawTag) {

    const session =
        bulkTagSession?.albumSession;

    if (!session || !rawTag)
        return false;

    const images =
        bulkTagSelectedImages(session);

    if (!images.length)
        return false;

    const normalized =
        bulkTagNormalize(rawTag);

    if (!normalized)
        return false;

    const album =
        session.album;

    const states =
        bulkTagSelectedStates(
            session,
            images
        );

    const anyActive =
        states.some(state =>
            state.activeKeys.has(normalized)
        );

    let changed =
        false;

    if (anyActive) {

        for (const state of states) {

            if (!state.activeKeys.has(normalized))
                continue;

            const current =
                resolveImageTagStrings(
                    album,
                    state.image
                );

            const next =
                current.filter(tag =>
                    bulkTagNormalize(tag) !==
                    normalized
                );

            if (
                typeof applyAlbumEditImageTags ===
                    "function" &&
                applyAlbumEditImageTags(
                    session,
                    state.image,
                    next
                )
            ) {
                changed = true;
            }

        }

        /*
         * Remember exactly which images were selected when the tag was
         * removed. Only those images should display it as removed;
         * images that never had the tag and were not part of this
         * selection stay neutral.
         */
        bulkTagMarkDisabled(
            normalized,
            rawTag,
            images
        );

    } else {

        for (const state of states) {

            if (state.activeKeys.has(normalized))
                continue;

            const current =
                resolveImageTagStrings(
                    album,
                    state.image
                );

            if (
                typeof applyAlbumEditImageTags ===
                    "function" &&
                applyAlbumEditImageTags(
                    session,
                    state.image,
                    current.concat(rawTag)
                )
            ) {
                changed = true;
            }

        }

        bulkTagRestoreDisabled(
            normalized,
            images
        );

    }

    if (!changed)
        return false;

    bulkTagClearHover();
    bulkTagPruneUnusedSessionTags(session);
    bulkTagSyncThumbnailItems(session);

    if (typeof buildTagList === "function")
        buildTagList(album.tags || []);

    bulkTagReapplyFilterClasses();
    bulkTagApplyCellFilter();
    bulkTagRenderSummary();
    bulkTagRecomputeDirty();
    bulkTagRenderActions();

    if (typeof updateAlbumEditIndicators === "function")
        updateAlbumEditIndicators(session);

    return true;

}


/* ---------------------------------------------------------------- */
/* Add-tag suggestions                                               */
/* ---------------------------------------------------------------- */

function bulkTagHideSuggestions() {

    const box =
        document.getElementById("bulkTagSuggestions");

    if (!box)
        return;

    box.innerHTML = "";
    box.style.display = "none";

    if (bulkTagSession)
        bulkTagSession.suggestions = [];

    if (bulkTagSession)
        bulkTagSession.selectedSuggestion = -1;

}


function bulkTagRenderSuggestions(text) {

    const session =
        bulkTagSession?.albumSession;

    const box =
        document.getElementById("bulkTagSuggestions");

    const input =
        document.getElementById("bulkTagSearch");

    if (!session || !box || !input)
        return;

    if (!bulkTagSession.searchBox.contains(document.activeElement)) {

        bulkTagHideSuggestions();
        return;

    }

    const normalized =
        bulkTagNormalize(text);

    if (!normalized) {

        bulkTagHideSuggestions();
        return;

    }

    const excluded =
        bulkTagTagsOnAllSelected(session);

    let matches;

    if (typeof getSortedMatches === "function") {

        matches =
            getSortedMatches(
                normalized,
                excluded
            ).slice(0, 80);

    } else {

        const excludedKeys =
            new Set(excluded.map(bulkTagNormalize));

        matches =
            bulkTagVocabulary(session.album)
                .filter(tag =>
                    bulkTagNormalize(tag).includes(
                        normalized
                    ) &&
                    !excludedKeys.has(
                        bulkTagNormalize(tag)
                    )
                )
                .slice(0, 80);

    }

    box.innerHTML = "";
    bulkTagSession.suggestions = [];
    bulkTagSession.selectedSuggestion = -1;

    for (const tag of matches) {

        const suggestion =
            document.createElement("div");

        suggestion.className =
            "suggestion";

        suggestion.dataset.tag =
            tag;

        suggestion.textContent =
            bulkTagLabel(tag);

        suggestion.onmousedown =
            event => event.preventDefault();

        suggestion.onclick =
            () => {

                bulkTagAddTag(tag);
                input.value = "";
                bulkTagHideSuggestions();
                input.focus();

            };

        box.appendChild(suggestion);
        bulkTagSession.suggestions.push(suggestion);

    }

    box.style.display =
        matches.length
            ? ""
            : "none";

}


function bulkTagUpdateSelectedSuggestion() {

    const session =
        bulkTagSession;

    if (!session)
        return;

    session.suggestions.forEach(
        (suggestion, index) => {

            suggestion.classList.toggle(
                "selected",
                index ===
                session.selectedSuggestion
            );

        }
    );

    const selected =
        session.suggestions[
            session.selectedSuggestion
        ];

    if (selected)
        selected.scrollIntoView({ block: "nearest" });

}


function bulkTagHandleKeyDown(event) {

    const session =
        bulkTagSession;

    const input =
        document.getElementById("bulkTagSearch");

    if (!session || !input)
        return;

    if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp"
    ) {

        if (!session.suggestions.length)
            bulkTagRenderSuggestions(input.value);

        if (!session.suggestions.length) {

            event.preventDefault();
            event.stopPropagation();

            return;

        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (event.key === "ArrowDown") {

            session.selectedSuggestion =
                (session.selectedSuggestion + 1) %
                session.suggestions.length;

        } else {

            session.selectedSuggestion =
                session.selectedSuggestion <= 0
                    ? session.suggestions.length - 1
                    : session.selectedSuggestion - 1;

        }

        bulkTagUpdateSelectedSuggestion();
        return;

    }

    if (event.key === "Enter") {

        event.preventDefault();
        event.stopImmediatePropagation();

        const typed =
            input.value.trim();

        if (typed)
            bulkTagAddTag(typed);

        input.value = "";
        bulkTagHideSuggestions();

        return;

    }

    if (
        event.key === "Tab" &&
        !event.shiftKey
    ) {

        event.preventDefault();
        event.stopImmediatePropagation();

        const typed =
            input.value.trim();

        if (
            typed &&
            bulkTagVocabulary(session.albumSession.album)
                .some(tag =>
                    bulkTagNormalize(tag) ===
                    bulkTagNormalize(typed)
                )
        ) {

            bulkTagAddTag(typed);
            input.value = "";
            bulkTagHideSuggestions();

            return;

        }

        let tag =
            null;

        if (
            session.selectedSuggestion >= 0 &&
            session.suggestions[session.selectedSuggestion]
        ) {

            tag =
                session.suggestions[
                    session.selectedSuggestion
                ].dataset.tag || null;

        } else if (typed) {

            const matches =
                typeof getSortedMatches === "function"
                    ? getSortedMatches(
                        bulkTagNormalize(typed),
                        bulkTagTagsOnAllSelected(
                            session.albumSession
                        )
                    )
                    : bulkTagVocabulary(
                        session.albumSession.album
                    ).filter(candidate =>
                        bulkTagNormalize(candidate).includes(
                            bulkTagNormalize(typed)
                        )
                    );

            if (matches.length)
                tag = matches[0];

        }

        if (tag) {

            input.value =
                bulkTagLabel(tag);

            const position =
                input.value.length;

            input.setSelectionRange(
                position,
                position
            );

            bulkTagRenderSuggestions(
                input.value
            );

        }

        return;

    }

    if (event.key === ",") {

        event.preventDefault();
        event.stopImmediatePropagation();

        if (input.value.trim())
            bulkTagAddTag(input.value);

        input.value = "";
        bulkTagHideSuggestions();

        return;

    }

    if (event.key === "Escape") {

        event.preventDefault();
        event.stopPropagation();

        if (input.value) {

            input.value = "";
            bulkTagHideSuggestions();

        } else {

            bulkTagHideSuggestions();

        }

    }

}


/* ---------------------------------------------------------------- */
/* Selection                                                         */
/* ---------------------------------------------------------------- */

function bulkTagHandleCellClick(cell, index) {

    const session =
        bulkTagSession?.albumSession;

    if (
        !session ||
        session !== albumEditSession ||
        !cell ||
        !Number.isFinite(index)
    ) {
        return;
    }

    if (cell.classList.contains("album-grid-empty"))
        return;

    const image =
        bulkTagImageAt(session, index);

    if (!image)
        return;

    if (bulkTagSession.selectedIndices.has(index)) {

        bulkTagSession.selectedIndices.delete(index);
        cell.classList.remove("bulk-tag-selected");

    } else {

        bulkTagSession.selectedIndices.add(index);
        cell.classList.add("bulk-tag-selected");

    }

    bulkTagRenderSummary();
    bulkTagClearHover();

}


/* ---------------------------------------------------------------- */
/* Nav actions                                                       */
/* ---------------------------------------------------------------- */

function bulkTagRenderActions() {

    /*
     * The tagging actions live in the top-right nav now, alongside the
     * album edit X. updateAlbumEditButtons() reads the bulk session
     * first, so it owns the Cancel/Save visibility and handlers.
     */
    if (
        typeof updateAlbumEditButtons === "function" &&
        bulkTagSession?.albumSession
    ) {
        updateAlbumEditButtons(
            bulkTagSession.albumSession
        );
    }

}


/* ---------------------------------------------------------------- */
/* Enter / exit                                                      */
/* ---------------------------------------------------------------- */

function bulkTagBindEvents(session) {

    const input =
        document.getElementById("bulkTagSearch");

    const chips =
        document.getElementById("bulkTagChips");

    const gallery =
        document.getElementById("gallery");

    if (input) {

        session.onInput =
            () => bulkTagRenderSuggestions(input.value);

        session.onFocus =
            () => bulkTagRenderSuggestions(input.value);

        session.onBlur =
            () => setTimeout(() => {

                if (
                    session.searchBox.contains(
                        document.activeElement
                    )
                ) {
                    return;
                }

                bulkTagHideSuggestions();

            }, 0);

        session.onKeyDown =
            event => bulkTagHandleKeyDown(event);

        input.addEventListener("input", session.onInput);
        input.addEventListener("focus", session.onFocus);
        input.addEventListener("blur", session.onBlur);
        input.addEventListener(
            "keydown",
            session.onKeyDown,
            true
        );

    }

    if (chips) {

        session.onChipsOver =
            event => {

                const chip =
                    event.target.closest?.(".bulk-tag-chip");

                if (!chip)
                    return;

                bulkTagClearHover();
                bulkTagHighlightTag(chip.dataset.tag);

            };

        session.onChipsOut =
            event => {

                const chip =
                    event.target.closest?.(".bulk-tag-chip");

                if (!chip)
                    return;

                const next =
                    event.relatedTarget?.closest?.(
                        ".bulk-tag-chip"
                    );

                if (next === chip)
                    return;

                bulkTagClearHover();

            };

        chips.addEventListener("mouseover", session.onChipsOver);
        chips.addEventListener("mouseout", session.onChipsOut);

    }

    if (gallery) {

        session.onGalleryOver =
            event => {

                const cell =
                    event.target.closest?.(".album-grid-cell");

                if (!cell)
                    return;

                const image =
                    bulkTagImageAt(
                        session.albumSession,
                        Number(cell.dataset.cellIndex)
                    );

                if (!image)
                    return;

                bulkTagClearHover();
                bulkTagHighlightImage(image);

            };

        session.onGalleryOut =
            event => {

                const cell =
                    event.target.closest?.(".album-grid-cell");

                if (!cell)
                    return;

                const next =
                    event.relatedTarget?.closest?.(
                        ".album-grid-cell"
                    );

                if (next === cell)
                    return;

                bulkTagClearHover();

            };

        gallery.addEventListener(
            "mouseover",
            session.onGalleryOver
        );

        gallery.addEventListener(
            "mouseout",
            session.onGalleryOut
        );

    }

}


function bulkTagUnbindEvents(session) {

    const input =
        document.getElementById("bulkTagSearch");

    const chips =
        document.getElementById("bulkTagChips");

    const gallery =
        document.getElementById("gallery");

    if (input && session.onInput)
        input.removeEventListener("input", session.onInput);

    if (input && session.onFocus)
        input.removeEventListener("focus", session.onFocus);

    if (input && session.onBlur)
        input.removeEventListener("blur", session.onBlur);

    if (input && session.onKeyDown)
        input.removeEventListener(
            "keydown",
            session.onKeyDown,
            true
        );

    if (chips && session.onChipsOver)
        chips.removeEventListener(
            "mouseover",
            session.onChipsOver
        );

    if (chips && session.onChipsOut)
        chips.removeEventListener(
            "mouseout",
            session.onChipsOut
        );

    if (gallery && session.onGalleryOver)
        gallery.removeEventListener(
            "mouseover",
            session.onGalleryOver
        );

    if (gallery && session.onGalleryOut)
        gallery.removeEventListener(
            "mouseout",
            session.onGalleryOut
        );

}


/* ---------------------------------------------------------------- */
/* Menu height                                                       */
/* ---------------------------------------------------------------- */

function bulkTagMenuBaseHeight() {

    /*
     * Fixed base, not viewport-scaled: at the 50% minimum this still
     * leaves exactly one tag row visible with even padding.
     */
    return 260;

}


function bulkTagMenuHeightLimits() {

    const base =
        bulkTagMenuBaseHeight();

    return {
        min: Math.max(70, base * 0.5),
        max: base * 1.5
    };

}


function getBulkTagMenuHeight() {

    const limits =
        bulkTagMenuHeightLimits();

    const stored =
        typeof readSiteUiSettings === "function"
            ? Number(
                readSiteUiSettings().tagMenuHeight
            )
            : 0;

    const value =
        Number.isFinite(stored) && stored > 0
            ? stored
            : bulkTagMenuBaseHeight();

    return Math.min(
        limits.max,
        Math.max(limits.min, value)
    );

}


function applyBulkTagMenuHeight(value) {

    const limits =
        bulkTagMenuHeightLimits();

    const height =
        Math.min(
            limits.max,
            Math.max(limits.min, Number(value))
        );

    document.documentElement.style.setProperty(
        "--bulk-tag-menu-height",
        height + "px"
    );

    return height;

}


function saveBulkTagMenuHeight(value) {

    if (typeof updateSiteUiSettings !== "function")
        return;

    updateSiteUiSettings({
        tagMenuHeight:
            Math.round(value)
    });

}


function initBulkTagMenuResize() {

    const handle =
        document.getElementById(
            "bulkTagResizeHandle"
        );

    if (
        !handle ||
        handle.dataset.resizeBound === "true"
    ) {
        return;
    }

    handle.dataset.resizeBound =
        "true";

    handle.addEventListener(
        "pointerdown",
        event => {

            if (!bulkTagSession)
                return;

            const sheet =
                document.getElementById(
                    "bulkTagSheet"
                );

            if (!sheet)
                return;

            event.preventDefault();

            const startY =
                event.clientY;

            const startHeight =
                sheet.getBoundingClientRect().height;

            handle.classList.add("dragging");

            try {

                handle.setPointerCapture(
                    event.pointerId
                );

            } catch {}

            const onMove =
                moveEvent => {

                    const limits =
                        bulkTagMenuHeightLimits();

                    const height =
                        Math.min(
                            limits.max,
                            Math.max(
                                limits.min,
                                startHeight +
                                startY -
                                moveEvent.clientY
                            )
                        );

                    document.documentElement.style.setProperty(
                        "--bulk-tag-menu-height",
                        height + "px"
                    );

                };

            const onUp =
                () => {

                    handle.classList.remove(
                        "dragging"
                    );

                    try {

                        handle.releasePointerCapture(
                            event.pointerId
                        );

                    } catch {}

                    handle.removeEventListener(
                        "pointermove",
                        onMove
                    );

                    handle.removeEventListener(
                        "pointerup",
                        onUp
                    );

                    handle.removeEventListener(
                        "pointercancel",
                        onUp
                    );

                    saveBulkTagMenuHeight(
                        parseFloat(
                            getComputedStyle(
                                sheet
                            ).height
                        ) || getBulkTagMenuHeight()
                    );

                };

            handle.addEventListener(
                "pointermove",
                onMove
            );

            handle.addEventListener(
                "pointerup",
                onUp
            );

            handle.addEventListener(
                "pointercancel",
                onUp
            );

        }
    );

}


function enterBulkTagMode() {

    const albumSession =
        albumEditSession;

    if (
        !albumSession ||
        bulkTagSession ||
        document.getElementById("addImageEditor")
    ) {
        return;
    }

    const searchBox =
        document.getElementById("bulkTagSearchBox");

    const input =
        document.getElementById("bulkTagSearch");

    if (!searchBox || !input)
        return;

    bulkTagSession = {

        albumSession,

        selectedIndices:
            new Set(),

        dirty:
            false,

        disabledTagImages:
            new Map(),

        snapshot:
            bulkTagSnapshot(albumSession),

        searchBox,

        chipByTag:
            new Map(),

        hoveredImage:
            null,

        hoveredTag:
            null,

        modeLabel:
            null,

        suggestions:
            [],

        selectedSuggestion:
            -1,

        onInput: null,
        onFocus: null,
        onBlur: null,
        onKeyDown: null,
        onChipsOver: null,
        onChipsOut: null,
        onGalleryOver: null,
        onGalleryOut: null

    };

    albumSession.bulkTagging =
        true;

    albumSession.bulkTagClick =
        (cell, index) => bulkTagHandleCellClick(cell, index);

    albumSession.bulkTagCleanup =
        keepChanges => exitBulkTagMode({
            restore: !keepChanges,
            fromAlbumExit: true
        });

    if (albumSession.titleInput)
        albumSession.titleInput.disabled = true;

    applyBulkTagMenuHeight(
        getBulkTagMenuHeight()
    );

    document.body.classList.add("bulk-tagging");

    bulkTagSession.modeLabel =
        document.getElementById("bulkTagModeLabel");

    input.value = "";
    bulkTagHideSuggestions();

    bulkTagBindEvents(bulkTagSession);

    if (typeof refreshAlbumEditCells === "function")
        refreshAlbumEditCells(albumSession);

    bulkTagSyncThumbnailItems(albumSession);

    if (typeof buildTagList === "function")
        buildTagList(albumSession.album.tags || []);

    bulkTagReapplyFilterClasses();

    bulkTagRenderSummary();
    bulkTagRenderActions();
    bulkTagApplyCellFilter();

    input.focus({ preventScroll: true });

}


function exitBulkTagMode({ restore = false, fromAlbumExit = false } = {}) {

    const session =
        bulkTagSession;

    if (!session)
        return;

    const albumSession =
        session.albumSession;

    bulkTagUnbindEvents(session);

    /*
     * A clean Close also restores the last saved bulk snapshot. That is
     * a no-op for image tags, but it removes tracking left behind by
     * ephemeral add-then-remove operations so the album does not look
     * edited.
     */
    if (restore || !session.dirty)
        bulkTagRestoreSnapshot(session.snapshot);

    bulkTagSession =
        null;

    albumSession.bulkTagging =
        false;

    albumSession.bulkTagClick =
        null;

    albumSession.bulkTagCleanup =
        null;

    if (albumSession.titleInput)
        albumSession.titleInput.disabled = false;

    document.body.classList.remove("bulk-tagging");

    document
        .querySelectorAll(".album-grid-cell.bulk-tag-selected")
        .forEach(cell =>
            cell.classList.remove("bulk-tag-selected")
        );

    bulkTagClearHover();

    const chips =
        document.getElementById("bulkTagChips");

    if (chips)
        chips.innerHTML = "";

    const count =
        document.getElementById("bulkTagSelectedCount");

    if (count)
        count.textContent = "0 selected";

    const clearSelection =
        document.getElementById("bulkTagClearSelection");

    if (clearSelection) {

        clearSelection.textContent = "All";
        clearSelection.title = "Select all images";

    }

    session.modeLabel?.classList.remove("active");

    bulkTagHideSuggestions();

    const input =
        document.getElementById("bulkTagSearch");

    if (input)
        input.value = "";

    if (fromAlbumExit)
        return;

    bulkTagSyncThumbnailItems(albumSession);

    if (typeof buildTagList === "function")
        buildTagList(albumSession.album.tags || []);

    bulkTagReapplyFilterClasses();

    if (typeof applyTagFilter === "function")
        applyTagFilter();

    albumSession.cellElements?.forEach(cell => {

        if (cell)
            cell.style.display = "";

    });

    if (typeof refreshAlbumEditCells === "function")
        refreshAlbumEditCells(albumSession);

    if (typeof layoutAlbumEditGrid === "function")
        layoutAlbumEditGrid(false);

    if (typeof updateAlbumEditIndicators === "function")
        updateAlbumEditIndicators(albumSession);

    if (typeof updateAlbumEditButtons === "function")
        updateAlbumEditButtons(albumSession);

}


/* ---------------------------------------------------------------- */
/* Entry point                                                       */
/* ---------------------------------------------------------------- */

const bulkTagEditButton =
    document.getElementById("editTagsButton");

if (bulkTagEditButton) {

    bulkTagEditButton.onclick =
        () => {

            /*
             * This is the entry point only. Leaving tagging mode goes
             * through the X, which is locked until Cancel or Save.
             */
            if (bulkTagSession)
                return;

            enterBulkTagMode();

        };

}

initBulkTagMenuResize();

const bulkTagClearSelectionButton =
    document.getElementById("bulkTagClearSelection");

if (bulkTagClearSelectionButton) {

    bulkTagClearSelectionButton.onclick =
        () => {

            if (!bulkTagSession)
                return;

            if (bulkTagSession.selectedIndices.size)
                bulkTagClearSelectedImages();
            else
                bulkTagSelectAllImages();

        };

}
