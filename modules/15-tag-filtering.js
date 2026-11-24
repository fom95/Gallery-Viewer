/*
 * 15-tag-filtering.js
 *
 * The tag filter bar and the responsive masonry-style gallery grid
 * layout.
 */

/*
 * Tags are stored with underscores (bare_legs), but people read and type
 * spaces. Display spaces, match either form. The raw string is still what
 * selectedTags/excludedTags use, so filtering itself is untouched.
 */
function formatTagLabel(tag) {

    return String(tag).replace(/_/g, " ");

}

function normalizeTagForMatch(tag) {

    return String(tag)
        .trim()
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ");

}


/* ------------------------------------------------------------------ */
/* Tag tooltip                                                         */
/* ------------------------------------------------------------------ */

let tagTooltipElement = null;
let tagTooltipTimer = null;
let tagTooltipTarget = null;

function getTagTooltipElement() {

    if (tagTooltipElement && tagTooltipElement.isConnected)
        return tagTooltipElement;

    const element =
        document.createElement("div");

    element.className = "tag-tooltip";

    document.body.appendChild(element);

    tagTooltipElement =
        element;

    return element;

}

function hideTagTooltip() {

    clearTimeout(tagTooltipTimer);
    tagTooltipTimer = null;
    tagTooltipTarget = null;

    if (tagTooltipElement)
        tagTooltipElement.classList.remove("visible");

}

function showTagTooltip(button) {

    if (!button || !button.isConnected)
        return;

    const name =
        button.querySelector(".tag-name");

    const label =
        formatTagLabel(
            button.dataset.tag ||
            name?.textContent ||
            ""
        );

    if (!label)
        return;

    const tooltip =
        getTagTooltipElement();

    tooltip.textContent =
        label;

    tooltip.classList.add("visible");

    const tagRect =
        button.getBoundingClientRect();

    const tooltipRect =
        tooltip.getBoundingClientRect();

    let left =
        tagRect.right + 8;

    if (left + tooltipRect.width > window.innerWidth - 8) {

        left =
            Math.max(
                8,
                tagRect.left - tooltipRect.width - 8
            );

    }

    let top =
        tagRect.top +
        (tagRect.height - tooltipRect.height) / 2;

    top =
        Math.max(
            8,
            Math.min(
                top,
                window.innerHeight - tooltipRect.height - 8
            )
        );

    tooltip.style.left =
        left + "px";

    tooltip.style.top =
        top + "px";

}

function scheduleTagTooltip(button) {

    clearTimeout(tagTooltipTimer);

    tagTooltipTarget =
        button;

    tagTooltipTimer =
        setTimeout(
            () => showTagTooltip(button),
            500
        );

}

const tagListElement =
    document.getElementById("tagList");

tagListElement.addEventListener(
    "mouseover",
    e => {

        const button =
            e.target.closest?.(".tag");

        if (!button || !tagListElement.contains(button))
            return;

        if (button === tagTooltipTarget)
            return;

        scheduleTagTooltip(button);

    }
);

tagListElement.addEventListener(
    "mouseout",
    e => {

        const button =
            e.target.closest?.(".tag");

        if (!button)
            return;

        const next =
            e.relatedTarget?.closest?.(".tag");

        if (next === button)
            return;

        hideTagTooltip();

    }
);

tagListElement.addEventListener(
    "scroll",
    hideTagTooltip,
    { passive: true }
);

document.addEventListener("mousedown", hideTagTooltip, true);

window.addEventListener(
    "scroll",
    hideTagTooltip,
    { passive: true, capture: true }
);

window.addEventListener("resize", hideTagTooltip);


/*
 * Tags used for filtering and tag-bar counts. When an album has an
 * edit base (local or published), include the tags the image had in
 * that base as well, so a removed tag can still find the image it was
 * removed from and show it as an edit.
 */
function getAlbumFilterBase() {

    const album = currentAlbum;

    return (
        album?._publishedEditBase ||
        album?._localEditBase ||
        album?._savedAlbumEditBase ||
        null
    );

}


let albumFilterBaseCache = {
    base: null,
    map: null
};


function getFilterTagsForImage(image, album = currentAlbum) {

    const tags =
        typeof resolveImageTagStrings === "function"
            ? resolveImageTagStrings(album, image)
            : [];

    const base =
        getAlbumFilterBase();

    if (
        !base ||
        !image ||
        typeof albumEditImageIdentity !== "function"
    ) {
        return tags;
    }

    const signature =
        albumEditImageIdentity(image);

    if (!signature)
        return tags;

    if (
        albumFilterBaseCache.base !== base
    ) {

        const map =
            new Map();

        for (const candidate of Object.values(base.images || {})) {

            const candidateSignature =
                albumEditImageIdentity(candidate);

            if (candidateSignature && !map.has(candidateSignature))
                map.set(candidateSignature, candidate);

        }

        albumFilterBaseCache = {
            base,
            map
        };

    }

    const baseImage =
        albumFilterBaseCache.map.get(signature);

    if (!baseImage)
        return tags;

    const baseTags =
        resolveImageTagStrings(base, baseImage);

    return [
        ...new Set([
            ...tags,
            ...baseTags
        ])
    ];

}


function applyTagFilter() {

    if (!currentAlbum) {

        const albums =
            document.querySelectorAll(".album");

        albums.forEach(element => {

            const tags =
                (element.alt || "")
                .split(",")
                .map(t => t.trim());

            const excluded =
                [...excludedTags].some(
                    tag => tags.includes(tag)
                );

            if (excluded) {

                element.style.display =
                    "none";

                return;

            }

            if (!selectedTags.size) {

                element.style.display =
                    "";

                return;

            }

            let show;

            if (
                filterMode === "all"
            ) {

                show =
                    [...selectedTags].every(
                        tag =>
                            tags.includes(tag)
                    );

            } else {

                show =
                    [...selectedTags].some(
                        tag =>
                            tags.includes(tag)
                    );

            }

            element.style.display =
                show ? "" : "none";

        });

        updateGalleryLayout();

        updateTagVisibleCount();

        return;

    }

    const slots =
        document.querySelectorAll(".thumbnail-slot");

    slots.forEach(slot => {

        const item =
            slot._thumbnailItem;

        const tags =
            getFilterTagsForImage(
                item?.image
            );

        const excluded =
            [...excludedTags].some(
                tag =>
                    tags.includes(tag)
            );

        if (excluded) {

            slot.style.display =
                "none";

            return;

        }

        if (!selectedTags.size) {

            slot.style.display =
                "";

            return;

        }

        let show;

        if (
            filterMode === "all"
        ) {

            show =
                [...selectedTags].every(
                    tag =>
                        tags.includes(tag)
                );

        } else {

            show =
                [...selectedTags].some(
                    tag =>
                        tags.includes(tag)
                );

        }

        slot.style.display =
            show ? "" : "none";

    });

    updateGalleryLayout();

    updateTagVisibleCount();
    updateTagAvailability();

    if (typeof bulkTagFilterChanged === "function")
        bulkTagFilterChanged();

    /*
     * Album edit mode uses cells rather than thumbnail slots; a normal
     * filter has to hide those cells too.
     */
    if (
        document.body.classList.contains("album-editing") &&
        typeof applyAlbumEditTagFilter === "function"
    ) {
        applyAlbumEditTagFilter();
    }

}


function updateGalleryLayout(animate = true) {
    applyGalleryLayout(animate);
}


function getGalleryColumnCount(
    width,
    minColumnsToUse = minColumns,
    maxColumnsToUse = maxColumns,
    minWidthToUse = minThumbWidth) {

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const columns =
        Math.floor(
            (width + gap) /
            (minWidthToUse + gap));

    return Math.max(
        minColumnsToUse,
        Math.min(maxColumnsToUse,
            columns));
}


function calculateGalleryLayout(itemsOverride = null) {

    const gallery =
        document.getElementById("gallery");

    const isHomePage =
        !currentAlbum;

    let sourceItems;

    if (itemsOverride) {

        sourceItems =
            itemsOverride;

    } else if (isHomePage) {

        sourceItems =
            [...gallery.querySelectorAll(".album")];

    } else {

        /*
         * Album pages normally contain only thumbnail slots. The
         * ".gallery-add-tile" selector is kept for compatibility with
         * any legacy markup that still appends one.
         */
        sourceItems =
            [...gallery.querySelectorAll(
                ".thumbnail-slot, .gallery-add-tile"
            )];

    }

    const items =
        sourceItems.filter(
            element =>
                getComputedStyle(element).display !== "none"
        );

    const minColumnsToUse =
        isHomePage
        ? homeMinColumns
        : minColumns;

    const maxColumnsToUse =
        isHomePage
        ? homeMaxColumns
        : maxColumns;

    const albumWidthScale =
        isHomePage
            ? 1
            : Math.min(
                1.5,
                Math.max(
                    0.5,
                    1 + albumImageWidthPercent / 100
                )
            );

    const albumHeightScale =
        isHomePage
            ? 1
            : Math.min(
                1.5,
                Math.max(
                    0.5,
                    1 + albumImageHeightPercent / 100
                )
            );

    const minWidthToUse =
        isHomePage
        ? homeMinThumbWidth
        : minThumbWidth;

    const style =
        getComputedStyle(gallery);

    const paddingLeft =
        parseFloat(style.paddingLeft) || 0;

    const paddingRight =
        parseFloat(style.paddingRight) || 0;

    const paddingTop =
        parseFloat(style.paddingTop) || 0;

    const paddingBottom =
        parseFloat(style.paddingBottom) || 0;

    const galleryRect =
        gallery.getBoundingClientRect();

    const galleryWidth =
        galleryRect.width -
        paddingLeft -
        paddingRight;

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const baseColumns =
        getGalleryColumnCount(
            galleryWidth,
            minColumnsToUse,
            maxColumnsToUse,
            minWidthToUse
        );

    const albumBaseItemWidth =
        (
            galleryWidth -
            gap * (baseColumns - 1)
        ) /
        baseColumns;

    let columns =
        baseColumns;

    let itemWidth =
        albumBaseItemWidth;

    let centerRows =
        false;

    if (!isHomePage) {

        /*
         * Width is a true scale of the default thumbnail width: the
         * column count adapts, but the cards themselves are
         * baseWidth * scale (rather than being stretched back to the
         * full row width).
         */
        const targetWidth =
            Math.min(
                galleryWidth,
                itemWidth * albumWidthScale
            );

        columns =
            Math.max(
                1,
                Math.min(
                    maxColumns,
                    Math.floor(
                        (galleryWidth + gap + 0.0001) /
                        (targetWidth + gap)
                    )
                )
            );

        itemWidth =
            targetWidth;

        centerRows =
            Math.abs(
                albumWidthScale - 1
            ) > 0.001;

    }

    const itemHeight =
        isHomePage
        ? itemWidth *
            homeHeightMultiplier
        : albumBaseItemWidth *
            albumHeightScale;

    const positions =
        [];

    items.forEach(
        (item, index) => {

            const column =
                index %
                columns;

            const row =
                Math.floor(
                    index /
                    columns
                );

            const rowStart =
                row * columns;

            const rowCount =
                Math.min(
                    columns,
                    items.length - rowStart
                );

            const rowWidth =
                rowCount * itemWidth +
                (rowCount - 1) * gap;

            const rowLeft =
                centerRows
                    ? paddingLeft +
                        (
                            galleryWidth -
                            rowWidth
                        ) / 2
                    : paddingLeft;

            const left =
                rowLeft +
                column *
                (
                    itemWidth +
                    gap
                );

            const top =
                paddingTop +
                row *
                (
                    itemHeight +
                    gap
                );

            positions.push({

                element:
                    item,

                left:
                    left,

                top:
                    top,

                width:
                    itemWidth,

                height:
                    itemHeight

            });

        }
    );

    const rows =
        items.length > 0
        ? Math.ceil(
            items.length /
            columns
        )
        : 0;

    const imageAreaHeight =
        rows > 0

        ? (
            rows *
            itemHeight +
            (
                rows - 1
            ) *
            gap
        )

        : 0;

    const requiredHeight =
        paddingTop +
        imageAreaHeight +
        paddingBottom;

    return {

        positions,

        height:
            requiredHeight,

        columns

    };

}


function applyGalleryLayout(animate = true, itemsOverride = null) {

    /*
     * Inline album editing uses a grid of explicit cells (filled and
     * empty) rather than a compact list of image slots. That grid owns
     * its own cell count, so hand layout back to it.
     */
    if (
        !itemsOverride &&
        document.body.classList.contains("album-editing") &&
        typeof layoutAlbumEditGrid === "function"
    ) {

        return layoutAlbumEditGrid(animate);

    }

    const gallery =
        document.getElementById("gallery");

    const layout =
        calculateGalleryLayout(itemsOverride);

    if (!animate)
        gallery.style.transition = "none";

    gallery.style.height =
        layout.height + "px";

    layout.positions.forEach(info => {

        const item =
            info.element;

        if (!animate) {
            item.style.transition = "none";
        }

        item.style.position = "absolute";

        item.style.left =
            info.left + "px";

        item.style.top =
            info.top + "px";

        item.style.width =
            info.width + "px";

        item.style.height =
            info.height + "px";

        if (!animate) {

            item.offsetWidth;

            item.style.transition = "";

        }

    });

    if (!animate) {

        gallery.offsetWidth;

        gallery.style.transition = "";

    }

    return layout;
}


const tagToggle =
    document.getElementById("tagToggle");


const tagBar =
    document.getElementById("tagBar");


tagToggle.addEventListener("click", () => {

    /*
     * The width transition on #tagBar changes the gallery's width every
     * frame; the ResizeObserver below re-lays-out the grid as that
     * happens, so there is no separate requestAnimationFrame loop.
     */
    tagBar.classList.toggle("hidden");
    saveTagBarState();

});


let galleryResizeObserver = null;

let lastGalleryWidth = null;

let galleryResizeCheck = null;

let fallbackLastWidth = null;

let stableChecks = 0;


function startGalleryResizeTracking() {

    const gallery =
        document.getElementById("gallery");

    if (!gallery)
        return;

    if (typeof ResizeObserver === "function") {

        if (galleryResizeObserver)
            return;

        lastGalleryWidth = null;

        galleryResizeObserver =
            new ResizeObserver(entries => {

                const width =
                    entries[0]?.contentRect?.width ??
                    gallery.getBoundingClientRect().width;

                if (lastGalleryWidth === null) {

                    lastGalleryWidth = width;
                    return;

                }

                /*
                 * applyGalleryLayout() changes the gallery's height,
                 * which also notifies this observer. Only react to a
                 * width change.
                 */
                if (Math.abs(width - lastGalleryWidth) < 0.5)
                    return;

                lastGalleryWidth = width;

                updateGalleryLayout();

            });

        galleryResizeObserver.observe(gallery);

        return;

    }

    /* Fallback for browsers without ResizeObserver. */
    clearInterval(galleryResizeCheck);

    stableChecks = 0;
    fallbackLastWidth = null;

    galleryResizeCheck = setInterval(() => {

        const currentGallery =
            document.getElementById("gallery");

        if (!currentGallery) {

            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;
            return;
        }

        const width =
            currentGallery.getBoundingClientRect().width;

        if (
            fallbackLastWidth !== null &&
            Math.abs(width - fallbackLastWidth) < 0.01
        ) {

            stableChecks++;

        } else {

            stableChecks = 0;

        }

        fallbackLastWidth = width;

        updateGalleryLayout();

        if (stableChecks >= 3) {

            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;

        }

    }, 75);
}


window.addEventListener("resize", () => {

    startGalleryResizeTracking();

});


/*
 * Watch the gallery from the start: the tag bar toggle changes the
 * gallery's width, and the grid must follow it every frame. Previously
 * tracking only began after a window resize or a search.
 */
startGalleryResizeTracking();


function updateTagVisibleCount() {
    const element =
        document.getElementById("tagVisibleCount");

    if (!element)
        return;

    if (!currentAlbum) {

        const cards =
            [...document.querySelectorAll("#gallery .album")];

        const visible =
            cards.filter(card => card.style.display !== "none").length;

        element.textContent =
            `${visible}/${cards.length}`;

        return;

    }

    const slots =
        [...document.querySelectorAll("#gallery .thumbnail-slot")];

    const visible =
        slots.filter(slot => slot.style.display !== "none").length;

    element.textContent =
        `${visible}/${slots.length}`;
}


/*
 * Dim tags that can no longer lead anywhere under the current filter.
 * With All, a tag is valid when at least one non-excluded image carries
 * every selected tag plus this one. With Any, adding a tag can only keep
 * or widen the result, so it is valid whenever a non-excluded image has
 * it. Currently selected/excluded tags stay highlighted.
 */
function updateTagAvailability() {

    if (!currentAlbum)
        return;

    const selected =
        [...selectedTags];

    const excluded =
        [...excludedTags];

    const candidateTags =
        new Map(
            thumbnailItems.map(item => [
                item,
                getFilterTagsForImage(item.image)
            ])
        );

    const candidates =
        thumbnailItems.filter(item => {

            const tags =
                candidateTags.get(item) || [];

            return !excluded.some(tag => tags.includes(tag));

        });

    for (const button of document.querySelectorAll("#tagList .tag")) {

        const tag =
            button.dataset.tag;

        if (!tag)
            continue;

        if (selectedTags.has(tag) || excludedTags.has(tag)) {

            button.classList.remove("tag-unavailable");
            button.removeAttribute("aria-disabled");

            continue;

        }

        const valid =
            filterMode === "all"
                ? candidates.some(item => {

                    const tags =
                        candidateTags.get(item) || [];

                    return (
                        tags.includes(tag) &&
                        selected.every(selectedTag =>
                            tags.includes(selectedTag)
                        )
                    );

                })
                : candidates.some(item =>
                    (candidateTags.get(item) || []).includes(tag)
                );

        button.classList.toggle("tag-unavailable", !valid);

        if (valid)
            button.removeAttribute("aria-disabled");
        else
            button.setAttribute("aria-disabled", "true");

    }

}


/*
 * Tags that no image references anymore are hidden from the sidebar
 * while the album has local edits (including the currently edited
 * session). This is visual only: album.tags is left intact so the
 * record data is unchanged until the user publishes it.
 */
function tagListHidesUnusedTags() {

    const album =
        currentAlbum;

    if (!album)
        return false;

    if (
        album.localEdited === true ||
        album.savedEdited === true
    ) {
        return true;
    }

    /*
     * Published/edited records can also retain an album-level tag that
     * no image uses anymore (e.g. a tag was removed and the record was
     * published). Treat that like a local edit for the tag bar: show
     * only tags the current images actually carry.
     */
    if (album.edited === true)
        return true;

    if (
        album.temporary === true &&
        album.edited === true
    ) {
        return true;
    }

    return !!(
        typeof albumEditSession !== "undefined" &&
        albumEditSession &&
        albumEditSession.album === album &&
        typeof albumEditHasChanges === "function" &&
        albumEditHasChanges(albumEditSession)
    );

}


function buildTagList(tags) {
    const tagContainer = document.getElementById("tagList");

    hideTagTooltip();

    tagContainer.innerHTML = "";

    /*
     * How many images in the album carry each tag. Duplicate tags on one
     * image count once. This is static for the album, so it does not
     * change with the current filter.
     */
    const countByTag =
        new Map();

    for (const item of thumbnailItems) {

        const seen =
            new Set();

        for (const raw of getFilterTagsForImage(item.image)) {

            const key =
                String(raw).trim().toLowerCase();

            if (!key || seen.has(key))
                continue;

            seen.add(key);

            countByTag.set(
                key,
                (countByTag.get(key) || 0) + 1
            );

        }

    }

    const hideUnused =
        tagListHidesUnusedTags();

    const visibleTags =
        [...tags].filter(tag => {

            if (!hideUnused)
                return true;

            const key =
                String(tag).trim().toLowerCase();

            return (countByTag.get(key) || 0) > 0;

        });

    /*
     * A hidden tag cannot sensibly remain an active filter; it would
     * leave the gallery empty with no visible button to clear it.
     */
    let filtersChanged =
        false;

    if (hideUnused) {

        const visibleKeys =
            new Set(
                visibleTags.map(tag =>
                    String(tag).trim().toLowerCase()
                )
            );

        for (const tag of [...selectedTags]) {

            if (visibleKeys.has(
                String(tag).trim().toLowerCase()
            )) {
                continue;
            }

            selectedTags.delete(tag);
            filtersChanged = true;

        }

        for (const tag of [...excludedTags]) {

            if (visibleKeys.has(
                String(tag).trim().toLowerCase()
            )) {
                continue;
            }

            excludedTags.delete(tag);
            filtersChanged = true;

        }

    }

    visibleTags
    .sort((a, b) => a.localeCompare(b))
    .forEach(tag => {

        const btn = document.createElement("button");

        btn.className = "tag";
        btn.dataset.tag = tag;

        const name =
            document.createElement("span");

        name.className = "tag-name";
        name.textContent = formatTagLabel(tag);

        const count =
            document.createElement("span");

        count.className = "tag-count";
        count.textContent =
            String(
                countByTag.get(
                    String(tag).trim().toLowerCase()
                ) || 0
            );

        btn.append(name, count);

        if (selectedTags.has(tag))
            btn.classList.add("selected");

        if (excludedTags.has(tag))
            btn.classList.add("excluded");

        btn.onclick = () => {

            if (btn.classList.contains("tag-unavailable"))
                return;

            if (excludedTags.has(tag)) {

                excludedTags.delete(tag);
                btn.classList.remove("excluded");

            }

            if (selectedTags.has(tag)) {

                selectedTags.delete(tag);
                btn.classList.remove("selected");

            } else {

                selectedTags.add(tag);
                btn.classList.add("selected");

            }

            clearButton.style.display =
                (selectedTags.size || excludedTags.size)
             ? ""
             : "none";

            applyTagFilter();

        };

        btn.oncontextmenu = (e) => {

            /* Right-click negates the tag; keep the browser menu away. */
            e.preventDefault();
            e.stopPropagation();

            hideTagTooltip();

            if (btn.classList.contains("tag-unavailable"))
                return;

            if (selectedTags.has(tag)) {

                selectedTags.delete(tag);
                btn.classList.remove("selected");

            }

            if (excludedTags.has(tag)) {

                excludedTags.delete(tag);
                btn.classList.remove("excluded");

            } else {

                excludedTags.add(tag);
                btn.classList.add("excluded");

            }

            clearButton.style.display =
                (selectedTags.size || excludedTags.size)
             ? ""
             : "none";

            applyTagFilter();

        };

        tagContainer.appendChild(btn);

    });

    updateTagVisibleCount();
    updateTagAvailability();

    /*
     * buildTagList() is also called when reloading or leaving edit
     * mode. Keep the bar's selected/excluded styling and the Clear
     * button in sync with the filter sets instead of resetting them.
     */
    const clearFilterButton =
        document.getElementById("clearTags");

    if (clearFilterButton) {

        clearFilterButton.style.display =
            (selectedTags.size || excludedTags.size)
                ? ""
                : "none";

    }

    if (filtersChanged) {

        const clearFilters =
            document.getElementById("clearTags");

        if (clearFilters) {

            clearFilters.style.display =
                (
                    selectedTags.size ||
                    excludedTags.size
                )
                    ? ""
                    : "none";

        }

        applyTagFilter();

    }

}

function updateTelegramImageTagsLive(image) {
    if (!image)
        return;

    const tags =
        Array.isArray(image.tags)
            ? image.tags
            : [];

    /*
     * Update the actual gallery image immediately.
     */
    const item =
        thumbnailItems.find(
            entry =>
                entry &&
                entry.image === image
        );

    if (item) {
        item.tags = tags.slice();

        if (item.img)
            item.img.alt = tags.join(",");

        if (item.mediumImg)
            item.mediumImg.alt = tags.join(",");
    }

    /*
     * Rebuild the album's unique tag list from every image
     * that has been processed so far.
     */
    if (currentAlbum) {
        const unique =
            [];
        const seen =
            new Set();

        for (const albumImage of currentAlbum.images || []) {
            for (const tag of albumImage.tags || []) {
                if (typeof tag !== "string")
                    continue;

                const clean =
                    tag.trim();

                if (!clean)
                    continue;

                const normalized =
                    clean.toLowerCase();

                if (seen.has(normalized))
                    continue;

                seen.add(normalized);
                unique.push(clean);
            }
        }

        currentAlbum.tags = unique;

        buildTagList(unique);
    }
}

const clearButton = document.getElementById("clearTags");


clearButton.onclick = () => {

    selectedTags.clear();
    excludedTags.clear();

    document.querySelectorAll("#tagList .tag")
    .forEach(btn => {
        btn.classList.remove("selected");
        btn.classList.remove("excluded");
    });

    applyTagFilter();

    clearButton.style.display = "none";

};
