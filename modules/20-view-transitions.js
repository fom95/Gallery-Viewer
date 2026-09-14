/*
 * 20-view-transitions.js
 *
 * The blur/fade transition between the albums home page and an album's
 * gallery, plus the "flying cover" shared-element animation that carries
 * the clicked album's cover image into its real position in the gallery
 * grid -- and reverses the whole thing when going back to the home page.
 *
 * This hides the load delay (most noticeable with Telegram albums)
 * behind the fade instead of leaving stale home-page content on screen.
 */

const VIEW_TRANSITION_MS = 820;

const COVER_FLIGHT_MS = 920;


function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    );

}


function clampNumber(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function fadeOutCurrentView() {

    const content =
        document.getElementById("content");

    const pageName =
        document.getElementById("pageName");

    content.classList.add("view-fade");
    pageName.classList.add("view-fade");

    return sleep(VIEW_TRANSITION_MS);

}


function fadeInCurrentView() {

    const content =
        document.getElementById("content");

    const pageName =
        document.getElementById("pageName");

    content.classList.remove("view-fade");
    pageName.classList.remove("view-fade");

}


/*
 * The very first paint (a fresh load or refresh) is hidden entirely via
 * html.pageLoading (see index.html/styles.css), rather than a
 * fade/blur, since there's nothing to blur yet. This swaps that instant
 * pop-in for the same fade used everywhere else: the faded state is
 * applied while the page is still hidden, then revealed already-faded,
 * then eased in a frame later.
 *
 * showAlbums()/loadAlbum() both call this at the point where they used
 * to just remove "pageLoading" outright. It's a no-op once the page has
 * already been revealed once, so it never interferes with the explicit
 * fade choreography in openAlbumWithTransition()/
 * goBackToAlbumsWithTransition() on later navigations.
 */
function revealPageIfNeeded() {

    if (!document.documentElement.classList.contains("pageLoading"))
        return;

    const content =
        document.getElementById("content");

    const pageName =
        document.getElementById("pageName");

    /*
     * #content already has a real, previously-painted opacity of 1 (it
     * was just never visible, since <body> itself was hidden). Simply
     * adding "view-fade" here would kick off the always-on opacity/
     * filter transition immediately -- and then removing "pageLoading"
     * in the same tick reveals the page before that transition has
     * gone anywhere, so there's nothing left to fade FROM a moment
     * later. "view-fade-instant" disables the transition just long
     * enough to force the faded state to apply immediately (not
     * animated), so it's fully committed before the page is revealed --
     * the same trick loadTagBarState() uses for its own instant state
     * changes.
     */
    content.classList.add("view-fade-instant");
    pageName.classList.add("view-fade-instant");

    content.classList.add("view-fade");
    pageName.classList.add("view-fade");

    // Force layout so the instant, faded state is actually committed.
    void content.offsetWidth;

    document.documentElement.classList.remove("pageLoading");

    // Force layout again now that the page is visible, so this faded
    // frame genuinely gets painted before anything else changes.
    void content.offsetWidth;

    content.classList.remove("view-fade-instant");
    pageName.classList.remove("view-fade-instant");

    requestAnimationFrame(() => {

        requestAnimationFrame(() => {

            fadeInCurrentView();

        });

    });

}


function waitForAlbumLayout() {

    return new Promise(resolve => {

        document.addEventListener(
            "albumLayoutReady",
            function handler(e) {

                document.removeEventListener(
                    "albumLayoutReady",
                    handler
                );

                resolve(e.detail.album);

            }
        );

    });

}


/*
 * Creates a fixed-position clone of an <img>, pinned exactly over its
 * current on-screen position. It lives outside #content, so the
 * blur/fade applied to the rest of the page doesn't touch it -- the
 * cover stays sharp the whole time it's "in flight", and (see
 * flyCoverIntoRect / the callers below) is kept around until the real
 * content underneath has finished fading in, so the cover itself never
 * appears to fade or blur.
 */
function createCoverFlight(sourceImg) {

    if (!sourceImg)
        return null;

    const src =
        sourceImg.currentSrc ||
        sourceImg.src;

    if (!src)
        return null;

    if (getComputedStyle(sourceImg).visibility === "hidden")
        return null;

    const rect =
        sourceImg.getBoundingClientRect();

    if (!rect.width || !rect.height)
        return null;

    const clone =
        document.createElement("img");

    clone.src = src;
    clone.className = "cover-flight";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";

    document.body.appendChild(clone);

    return clone;
}


/*
 * Reveals the destination slot/card with the flying cover's own image
 * immediately, so that once the clone is eventually removed, there is
 * no flash -- the destination was already showing the same picture
 * underneath the whole time.
 */
function settleCoverIntoThumbnailSlot(slot, src) {

    if (!slot || !src)
        return;

    slot.style.visibility = "visible";

    const thumbImg =
        slot.querySelector(".thumbnail-image");

    if (thumbImg && !thumbImg.getAttribute("src")) {

        thumbImg.src = src;
        thumbImg.style.visibility = "visible";

    }

    const item =
        slot._thumbnailItem;

    if (item && !item.loaded && !item.loading) {

        item.loaded = true;
        item.assigned = true;
        item.thumbnailFailed = false;
        item.src = src;

        slot.dataset.loaded = "true";

        thumbnailQueue =
            thumbnailQueue.filter(
                entry => entry !== item
            );

    }

}


function settleCoverIntoHomeCard(cardImg, src) {

    if (!cardImg || !src)
        return;

    if (!cardImg.src)
        cardImg.src = src;

    cardImg.style.visibility = "visible";

}


function getSlotDisplayImage(slot) {

    if (!slot)
        return null;

    const medium =
        slot.querySelector(".medium-image");

    if (
        medium &&
        medium.src &&
        getComputedStyle(medium).visibility !== "hidden"
    ) {

        return medium;

    }

    const thumb =
        slot.querySelector(".thumbnail-image");

    if (thumb && thumb.src)
        return thumb;

    return null;
}


/*
 * Works out where an element sits in the document (not just the
 * viewport), and how far the page needs to scroll so that element ends
 * up vertically centered -- clamped so we never scroll past the top
 * (an element near the top of the grid just leaves the grid flush
 * against the nav bar, exactly like a normal album load) or past the
 * bottom of the document.
 *
 * Returns both the scroll position to animate to, and the viewport
 * rect the element will occupy once that scroll finishes, so a flying
 * clone can be sent straight to its true final position instead of
 * chasing a moving target.
 */
function computeCenteredScrollTarget(el) {

    const rect =
        el.getBoundingClientRect();

    const docTop =
        rect.top + window.scrollY;

    const maxScrollY =
        Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight
        );

    const desiredScrollY =
        clampNumber(
            docTop + rect.height / 2 - window.innerHeight / 2,
            0,
            maxScrollY
        );

    return {

        scrollY: desiredScrollY,

        rect: {
            left: rect.left,
            top: docTop - desiredScrollY,
            width: rect.width,
            height: rect.height
        }

    };

}


/*
 * Smoothly animates the window's scroll position over `duration` ms,
 * using the same ease-out curve as the cover flight so the two read as
 * one motion.
 */
function animateScrollTo(targetY, duration) {

    return new Promise(resolve => {

        const startY =
            window.scrollY;

        const delta =
            targetY - startY;

        if (Math.abs(delta) < 1) {

            resolve();

            return;
        }

        const startTime =
            performance.now();

        function step(now) {

            const progress =
                Math.min(1, (now - startTime) / duration);

            const eased =
                1 - Math.pow(1 - progress, 3);

            window.scrollTo(
                window.scrollX,
                startY + delta * eased
            );

            if (progress < 1) {

                requestAnimationFrame(step);

            } else {

                resolve();

            }

        }

        requestAnimationFrame(step);

    });

}


/*
 * Animates a flying clone to sit exactly over `rect` (a viewport rect,
 * as produced by getBoundingClientRect() or computeCenteredScrollTarget).
 * Calls `settle` first so the real destination underneath is already
 * correct. Returns true if the clone actually flew somewhere and is
 * still in the DOM (the caller is responsible for removing it once the
 * surrounding fade-in has finished); returns false if there was
 * nothing to animate, in which case the clone has already been removed.
 */
async function flyCoverIntoRect(clone, rect, settle) {

    if (!clone)
        return false;

    if (!rect) {

        clone.remove();

        return false;
    }

    if (settle)
        settle();

    requestAnimationFrame(() => {

        clone.style.left = rect.left + "px";
        clone.style.top = rect.top + "px";
        clone.style.width = rect.width + "px";
        clone.style.height = rect.height + "px";

    });

    await sleep(COVER_FLIGHT_MS);

    return true;
}


function flyCoverTo(clone, targetEl, settle) {

    if (!clone) {

        return Promise.resolve(false);

    }

    if (!targetEl) {

        clone.remove();

        return Promise.resolve(false);
    }

    return flyCoverIntoRect(
        clone,
        targetEl.getBoundingClientRect(),
        settle
    );

}


/*
 * Home page -> album.
 */
async function openAlbumWithTransition(album, coverImgEl) {

    const isTelegram =
        typeof album.url === "string" &&
        album.url.startsWith("tg://chat/");

    const clone =
        createCoverFlight(coverImgEl);

    let coverMessageID = null;
    let coverImageObject = null;

    if (isTelegram) {

        const cached =
            homeCoverCache.get(album.id);

        if (cached) {

            try {

                const result =
                    await Promise.race([
                        cached,
                        sleep(600).then(() => null)
                    ]);

                if (result && result.messageID != null)
                    coverMessageID = result.messageID;

            } catch {}

        }

    }
    else {

        coverImageObject =
            homeCoverCache.get(album.id) || null;

    }

    await fadeOutCurrentView();

    const layoutReady =
        waitForAlbumLayout();

    loadAlbum(album);

    const loadedAlbum =
        await layoutReady;

    let targetIndex = null;

    if (isTelegram && coverMessageID != null) {

        targetIndex =
            (loadedAlbum.images || []).findIndex(
                image => image.messageID === coverMessageID
            );

    }
    else if (coverImageObject) {

        targetIndex =
            (loadedAlbum.images || []).indexOf(coverImageObject);

    }

    if (targetIndex === -1)
        targetIndex = null;

    /*
     * Remembered so the reverse (album -> home) transition knows which
     * thumbnail to fly back to the home card.
     */
    loadedAlbum._coverThumbIndex =
        targetIndex;

    const slot =
        targetIndex != null
            ? document.querySelector(
                `.thumbnail-slot[data-index="${targetIndex}"]`
            )
            : null;

    let flew = false;

    if (slot) {

        const scrollTarget =
            computeCenteredScrollTarget(slot);

        /*
         * Scroll and fly at the same time, over the same duration, so
         * the grid glides into place under the cover as it lands.
         */
        animateScrollTo(scrollTarget.scrollY, COVER_FLIGHT_MS);

        flew =
            clone
                ? await flyCoverIntoRect(
                    clone,
                    scrollTarget.rect,
                    () => settleCoverIntoThumbnailSlot(slot, clone.src)
                )
                : false;

    }
    else {

        /*
         * No known destination -- fall back to the same top-of-grid
         * position a normal album load ends up at.
         */
        window.scrollTo(0, 0);

        if (clone)
            clone.remove();

    }

    fadeInCurrentView();

    /*
     * Keep the crisp flying cover in place, masking the real thumbnail
     * underneath, until the fade-in has fully finished -- otherwise the
     * cover would visibly fade/blur in along with the rest of the page.
     */
    if (flew) {

        await sleep(VIEW_TRANSITION_MS);

        clone.remove();

    }

}


/*
 * Album -> home page.
 */
async function goBackToAlbumsWithTransition() {

    const album =
        currentAlbum;

    let clone = null;

    const coverIndex =
        album && typeof album._coverThumbIndex === "number"
            ? album._coverThumbIndex
            : null;

    if (album && coverIndex != null) {

        const slot =
            document.querySelector(
                `.thumbnail-slot[data-index="${coverIndex}"]`
            );

        const img =
            getSlotDisplayImage(slot);

        if (img)
            clone = createCoverFlight(img);

    }

    if (currentTemporaryAlbumID) {

        deleteTemporaryAlbum(currentTemporaryAlbumID);

        currentTemporaryAlbumID = null;

    }

    await fadeOutCurrentView();

    await showAlbums();

    let flew = false;

    if (clone && album) {

        const card =
            document.querySelector(
                `.album[data-album-id="${CSS.escape(String(album.id))}"]`
            );

        const cardImg =
            card && card.querySelector("img");

        flew =
            await flyCoverTo(
                clone,
                cardImg,
                cardImg
                    ? () => settleCoverIntoHomeCard(cardImg, clone.src)
                    : null
            );

    }

    fadeInCurrentView();

    if (flew) {

        await sleep(VIEW_TRANSITION_MS);

        clone.remove();

    }

}
