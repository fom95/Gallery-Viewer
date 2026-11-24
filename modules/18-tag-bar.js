/*
 * 18-tag-bar.js
 *
 * Persists tag bar UI state and handles the "snap back to center"
 * animation.
 */

/*
 * One object for UI preferences that live in localStorage. The tag bar
 * state and the tagging menu height are the first entries; new
 * interface settings should be added here instead of new keys.
 */
const SITE_UI_SETTINGS_STORAGE_KEY =
    "siteUiSettings";


function readSiteUiSettings() {

    try {

        const parsed =
            JSON.parse(
                localStorage.getItem(
                    SITE_UI_SETTINGS_STORAGE_KEY
                ) || "{}"
            );

        return (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) ? parsed : {};

    } catch {

        return {};

    }

}


function updateSiteUiSettings(patch) {

    const next = {
        ...readSiteUiSettings(),
        ...(patch || {})
    };

    try {

        localStorage.setItem(
            SITE_UI_SETTINGS_STORAGE_KEY,
            JSON.stringify(next)
        );

    } catch {}

    return next;

}


function saveTagBarState() {

    const tagBar =
        document.getElementById("tagBar");
    if (!tagBar.classList.contains("hidden")) {
        tagBar.style.visibility = "visible";
    }

    updateSiteUiSettings({
        tagBarHidden:
            tagBar.classList.contains("hidden")
    });

}


function loadTagBarState() {

    const tagBar =
        document.getElementById("tagBar");

    const settings =
        readSiteUiSettings();

    let stored =
        settings.tagBarHidden;

    /*
     * Migrate the old standalone key once, then keep everything in the
     * shared settings object.
     */
    if (stored === undefined) {

        try {

            const legacy =
                localStorage.getItem("tagBarHidden");

            if (legacy !== null) {

                stored =
                    legacy === "true";

                updateSiteUiSettings({
                    tagBarHidden: stored
                });

                localStorage.removeItem(
                    "tagBarHidden"
                );

            }

        } catch {}

    }

    const hidden =
        stored === undefined
            ? true
            : stored === true;

    tagBar.classList.add("noTransition");

    if (hidden) {
        tagBar.classList.add("hidden");
    } else {
        tagBar.classList.remove("hidden");
        tagBar.style.visibility = "visible";
    }

    tagBar.offsetWidth;

    tagBar.classList.remove("noTransition");

    const storedWidth =
        Number(settings.tagBarWidth);

    applyTagBarWidth(
        Number.isFinite(storedWidth)
            ? storedWidth
            : TAG_BAR_BASE_WIDTH
    );

    applyTagCountsVisible(
        settings.tagCountsVisible !== false
    );
}


const TAG_BAR_BASE_WIDTH = 20;

const TAG_BAR_MIN_WIDTH = 10;

const TAG_BAR_MAX_WIDTH = 30;

let tagBarCurrentWidthPercent =
    TAG_BAR_BASE_WIDTH;


function applyTagBarWidth(percent) {

    const value =
        Math.min(
            TAG_BAR_MAX_WIDTH,
            Math.max(
                TAG_BAR_MIN_WIDTH,
                Number(percent) || TAG_BAR_BASE_WIDTH
            )
        );

    tagBarCurrentWidthPercent =
        value;

    document.documentElement.style.setProperty(
        "--tag-bar-width",
        value + "%"
    );

    return value;

}


function saveTagBarWidth(percent) {

    if (typeof updateSiteUiSettings !== "function")
        return;

    updateSiteUiSettings({
        tagBarWidth:
            Math.round(percent * 10) / 10
    });

}


function initTagBarWidthResize() {

    const handle =
        document.getElementById(
            "tagBarResizeHandle"
        );

    const tagBar =
        document.getElementById("tagBar");

    const content =
        document.getElementById("content");

    if (
        !handle ||
        !tagBar ||
        !content ||
        handle.dataset.resizeBound === "true"
    ) {
        return;
    }

    handle.dataset.resizeBound =
        "true";

    handle.addEventListener(
        "pointerdown",
        event => {

            if (tagBar.classList.contains("hidden"))
                return;

            const contentWidth =
                content.getBoundingClientRect().width;

            if (!contentWidth)
                return;

            event.preventDefault();

            const startX =
                event.clientX;

            const startPercent =
                tagBar.getBoundingClientRect().width /
                contentWidth * 100;

            tagBar.classList.add("noTransition");
            handle.classList.add("dragging");

            try {

                handle.setPointerCapture(
                    event.pointerId
                );

            } catch {}

            const onMove =
                moveEvent => {

                    applyTagBarWidth(
                        startPercent +
                        (
                            moveEvent.clientX -
                            startX
                        ) /
                        contentWidth * 100
                    );

                };

            const onUp =
                () => {

                    tagBar.classList.remove(
                        "noTransition"
                    );

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

                    saveTagBarWidth(
                        tagBarCurrentWidthPercent
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


function cancelCenterReturn() {

    if (centerReturnTimer !== null) {

        clearTimeout(centerReturnTimer);

        centerReturnTimer = null;

    }

    if (centerReturnAnimation !== null) {

        cancelAnimationFrame(centerReturnAnimation);

        centerReturnAnimation = null;

    }

}


function scheduleCenterReturn() {

    if (centerReturnTimer !== null)
        return;

    if (
        Math.abs(imgTransform.x) < 0.01 &&
        Math.abs(imgTransform.y) < 0.01 &&
        Math.abs(imgTransform.scale - minZoom) < 0.001) {

        return;

    }

    centerReturnTimer =
        setTimeout(() => {

            centerReturnTimer = null;

            if (
                imgDragging ||
                interactingWithImage ||
                zooming) {

                return;

            }

            const img =
                displayingFull
                 ? modalImgFull
                 : modalImgMedium;

            if (!img)
                return;

            const startX =
                imgTransform.x;

            const startY =
                imgTransform.y;

            const startScale =
                imgTransform.scale;

            if (
                Math.abs(startX) < 0.01 &&
                Math.abs(startY) < 0.01 &&
                Math.abs(startScale - minZoom) < 0.001) {

                return;

            }

            const startTime =
                performance.now();

            const duration =
                centerAnimationDuration;

            function animateCenter(now) {

                if (
                    imgDragging ||
                    interactingWithImage ||
                    zooming) {

                    centerReturnAnimation =
                        null;

                    return;

                }

                const progress =
                    Math.min(
                        1,
                        (now - startTime) /
                        duration);

                const eased =
                    1 -
                    Math.pow(
                        1 - progress,
                        3);

                imgTransform.x =
                    startX *
                    (1 - eased);

                imgTransform.y =
                    startY *
                    (1 - eased);

                imgTransform.scale =
                    startScale +
                    (
                        minZoom -
                        startScale) *
                    eased;

                applyTransform();

                if (progress < 1) {

                    centerReturnAnimation =
                        requestAnimationFrame(animateCenter);

                } else {

                    imgTransform.x = 0;
                    imgTransform.y = 0;
                    imgTransform.scale = minZoom;

                    applyTransform();

                    centerReturnAnimation =
                        null;

                }

            }

            centerReturnAnimation =
                requestAnimationFrame(animateCenter);

        }, 3000);

}


/*
 * The tag bar sits inside the page flow. Without this, a wheel over a
 * non-scrolling part of it (or at either end of the tag list) chains
 * to the document and scrolls the gallery behind it.
 */
function clampAlbumImageSize(value) {

    return Math.min(
        50,
        Math.max(
            -50,
            Math.round(Number(value) || 0)
        )
    );

}


let albumImageSizeLayoutFrame = null;


function scheduleAlbumImageSizeLayout() {

    if (albumImageSizeLayoutFrame)
        return;

    albumImageSizeLayoutFrame =
        requestAnimationFrame(() => {

            albumImageSizeLayoutFrame =
                null;

            if (typeof applyGalleryLayout === "function")
                applyGalleryLayout(true);

        });

}


function applyAlbumImageSizeSetting(key, value) {

    const size =
        clampAlbumImageSize(value);

    if (key === "albumImageWidth")
        albumImageWidthPercent = size;
    else
        albumImageHeightPercent = size;

    scheduleAlbumImageSizeLayout();

    return size;

}


function bindAlbumImageSizeSlider(input, key) {

    if (
        !input ||
        input.dataset.sliderBound === "true"
    ) {
        return;
    }

    input.dataset.sliderBound =
        "true";

    let lastValue =
        Number(input.value);

    let lastTime =
        performance.now();

    let dragFromOuter =
        false;

    let lastSpeed =
        0;

    const SNAP_RANGE = 4;

    const SNAP_RANGE_OUTER = 6;

    const SNAP_SPEED = 0.05;

    input.addEventListener(
        "pointerdown",
        event => {

            const rect =
                input.getBoundingClientRect();

            const ratio =
                rect.width
                    ? (event.clientX - rect.left) /
                        rect.width
                    : 0.5;

            const pointerValue =
                -50 + ratio * 100;

            /*
             * A drag that starts in the outer quarter is treated as a
             * coarse resize: the centre tick is strongly magnetic.
             * Starting near the middle keeps fine adjustments possible.
             */
            dragFromOuter =
                Math.abs(pointerValue) > 25;

            lastSpeed =
                0;

        }
    );

    input.addEventListener(
        "pointercancel",
        () => {

            dragFromOuter =
                false;

            lastSpeed =
                0;

        }
    );

    input.addEventListener(
        "keydown",
        () => {

            dragFromOuter =
                false;

            lastSpeed =
                0;

        }
    );

    /*
     * Releasing a range input can report the raw pointer position and
     * undo a magnetic snap that was already visible. Apply the same
     * stickiness on commit so the thumb stays on the default value.
     */
    const applyMagneticSnap = value => {

        const range =
            dragFromOuter
                ? SNAP_RANGE_OUTER
                : SNAP_RANGE;

        if (
            Math.abs(value) <= range &&
            (
                dragFromOuter ||
                lastSpeed >= SNAP_SPEED
            )
        ) {

            input.value =
                "0";

            return 0;

        }

        return value;

    };

    input.addEventListener(
        "input",
        () => {

            const now =
                performance.now();

            const value =
                Number(input.value);

            const dt =
                Math.max(1, now - lastTime);

            const speed =
                Math.abs(value - lastValue) /
                dt;

            lastValue =
                value;

            lastTime =
                now;

            lastSpeed =
                speed;

            /*
             * Fast drags snap near the centre; slow, deliberate
             * drags can pass through it without sticking. Drags that
             * began at the outer edge always snap.
             */
            applyMagneticSnap(value);

            if (input.value === "0")
                lastValue = 0;

            applyAlbumImageSizeSetting(
                key,
                Number(input.value)
            );

        }
    );

    input.addEventListener(
        "change",
        () => {

            applyMagneticSnap(
                Number(input.value)
            );

            const size =
                applyAlbumImageSizeSetting(
                    key,
                    Number(input.value)
                );

            updateSiteUiSettings({
                [key]: size
            });

            dragFromOuter =
                false;

            lastSpeed =
                0;

        }
    );

}


function initAlbumImageSizeSliders() {

    const widthInput =
        document.getElementById(
            "albumImageWidth"
        );

    const heightInput =
        document.getElementById(
            "albumImageHeight"
        );

    if (!widthInput || !heightInput)
        return;

    const settings =
        readSiteUiSettings();

    widthInput.value =
        String(
            clampAlbumImageSize(
                settings.albumImageWidth
            )
        );

    heightInput.value =
        String(
            clampAlbumImageSize(
                settings.albumImageHeight
            )
        );

    albumImageWidthPercent =
        Number(widthInput.value);

    albumImageHeightPercent =
        Number(heightInput.value);

    bindAlbumImageSizeSlider(
        widthInput,
        "albumImageWidth"
    );

    bindAlbumImageSizeSlider(
        heightInput,
        "albumImageHeight"
    );

}


function applyTagCountsVisible(visible) {
    const tagBar =
        document.getElementById("tagBar");

    const button =
        document.getElementById("tagCountToggle");

    const show =
        visible !== false;

    if (tagBar) {

        tagBar.classList.toggle(
            "tag-counts-hidden",
            !show
        );

    }

    if (button) {

        button.classList.toggle(
            "active",
            show
        );

        button.setAttribute(
            "aria-pressed",
            show ? "true" : "false"
        );

        button.title =
            show
                ? "Hide tag counts"
                : "Show tag counts";

    }

}


function saveTagCountsVisible(visible) {

    if (typeof updateSiteUiSettings !== "function")
        return;

    updateSiteUiSettings({
        tagCountsVisible:
            visible !== false
    });

}


function installTagBarWheelContainment() {

    const tagBar =
        document.getElementById("tagBar");

    if (
        !tagBar ||
        tagBar.dataset.wheelContain === "true"
    ) {
        return;
    }

    tagBar.dataset.wheelContain =
        "true";

    tagBar.addEventListener(
        "wheel",
        event => {

            /*
             * The suggestion dropdowns have their own scrolling; let
             * them handle the wheel normally.
             */
            if (
                event.target instanceof Element &&
                event.target.closest(
                    "#tagSuggestions, #bulkTagSuggestions"
                )
            ) {
                return;
            }

            const tagList =
                document.getElementById("tagList");

            if (tagList) {

                let delta =
                    event.deltaY;

                if (event.deltaMode === 1)
                    delta *= 16;
                else if (event.deltaMode === 2)
                    delta *= tagList.clientHeight;

                if (delta)
                    tagList.scrollTop += delta;

            }

            /*
             * Swallow the wheel even at the ends of the list, so the
             * page behind never scrolls while the pointer is inside
             * the tag bar.
             */
            event.preventDefault();

        },
        { passive: false }
    );

}


installTagBarWheelContainment();

initTagBarWidthResize();

initAlbumImageSizeSliders();

const tagCountToggleButton =
    document.getElementById("tagCountToggle");

if (tagCountToggleButton) {

    tagCountToggleButton.onclick =
        () => {

            const show =
                !tagCountToggleButton
                    .classList
                    .contains("active");

            applyTagCountsVisible(show);
            saveTagCountsVisible(show);

        };

}

applyTagCountsVisible(
    readSiteUiSettings().tagCountsVisible !== false
);
