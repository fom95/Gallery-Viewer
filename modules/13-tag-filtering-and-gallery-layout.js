/*
 * 13-tag-filtering-and-gallery-layout.js
 *
 * The tag filter bar and the responsive masonry-style gallery grid
 * layout.
 */

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

        return;

    }

    const slots =
        document.querySelectorAll(".thumbnail-slot");

    slots.forEach(slot => {

        const item =
            slot._thumbnailItem;

        const tags =
            item && item.tags
                ? item.tags
                : [];

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


function calculateGalleryLayout() {

    const gallery =
        document.getElementById("gallery");

    const isHomePage =
        !currentAlbum;

    const items =
        isHomePage

        ? [
            ...gallery.querySelectorAll(".album")
        ].filter(
            element =>
                getComputedStyle(element).display !== "none"
        )

        : [
            ...gallery.querySelectorAll(".thumbnail-slot")
        ].filter(
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

    const columns =
        getGalleryColumnCount(galleryWidth,
            minColumnsToUse,
            maxColumnsToUse,
            minWidthToUse);

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const itemWidth =
        (
            galleryWidth -
            gap * (columns - 1)
        ) /
        columns;

    const itemHeight =
        isHomePage
        ? itemWidth *
            homeHeightMultiplier
        : itemWidth;

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

            const left =
                paddingLeft +
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


function applyGalleryLayout(animate = true) {

    const gallery =
        document.getElementById("gallery");

    const layout =
        calculateGalleryLayout();

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

    return layout;
}


const tagToggle =
    document.getElementById("tagToggle");


const tagBar =
    document.getElementById("tagBar");


tagToggle.addEventListener("click", () => {

    tagBar.classList.toggle("hidden");
    saveTagBarState();

    const startTime =
        performance.now();

    function animateTagGallery(time) {

        const elapsed =
            time - startTime;

        applyGalleryLayout(true);

        if (elapsed < 500) {

            requestAnimationFrame(animateTagGallery);

        }
    }

    requestAnimationFrame(animateTagGallery);

});


let galleryResizeCheck = null;

let lastMeasuredGalleryWidth = null;

let stableChecks = 0;


function startGalleryResizeTracking() {

    clearInterval(galleryResizeCheck);

    stableChecks = 0;
    lastMeasuredGalleryWidth = null;

    galleryResizeCheck = setInterval(() => {

        const gallery =
            document.getElementById("gallery");

        if (!gallery) {
            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;
            return;
        }

        const width =
            gallery.getBoundingClientRect().width;

        if (
            lastMeasuredGalleryWidth !== null &&
            Math.abs(
                width -
                lastMeasuredGalleryWidth) < 0.01) {

            stableChecks++;

        } else {

            stableChecks = 0;

        }

        lastMeasuredGalleryWidth = width;

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


function buildTagList(tags) {
    const tagContainer = document.getElementById("tagList");

    tagContainer.innerHTML = "";

    tags
    .sort((a, b) => a.localeCompare(b))
    .forEach(tag => {

        const btn = document.createElement("button");

        btn.className = "tag";
        btn.textContent = tag;

        btn.onclick = () => {

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
