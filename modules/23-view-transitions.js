/*
 * 23-view-transitions.js
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
 * albumLayoutReady fires as soon as the first layout pass runs. A tall
 * album can then make the vertical scrollbar appear, which narrows the
 * gallery and triggers an animated re-layout a frame or two later.
 * Measuring the cover's destination before that settles left the flight
 * target hundreds of pixels off, so the cover visibly slid into place
 * at the end. Wait for the gallery width to stop changing, then snap any
 * queued animation so the measured rect is the final one.
 */
async function stabilizeAlbumLayout() {

    const gallery =
        document.getElementById("gallery");

    if (!gallery)
        return;

    let previousWidth =
        null;

    for (let i = 0; i < 12; i++) {

        await new Promise(requestAnimationFrame);

        const width =
            gallery.getBoundingClientRect().width;

        if (
            previousWidth !== null &&
            Math.abs(width - previousWidth) < 0.5
        ) {
            break;
        }

        previousWidth =
            width;

    }

    if (typeof applyGalleryLayout === "function")
        applyGalleryLayout(false);

    await new Promise(requestAnimationFrame);

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

    /*
     * Always point the card at the image the flight is carrying. The
     * render may have chosen a different cached cover, which used to
     * make the card swap images the moment the clone was removed.
     */
    if (cardImg.src !== src)
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


/*
 * The predicted flight rectangle and the real destination can drift
 * apart while the page scrolls, a scrollbar appears/disappears, or
 * thumbnails settle. The clone is removed at the end of the fade, so
 * any leftover offset shows up as the cover "jumping" into place.
 *
 * Re-measure the destination and glide the clone onto it over a short
 * distance. Called while the page is still faded (invisible) and again
 * just before removal to catch late layout shifts.
 */
function alignCoverClone(clone, targetEl, duration = 140) {

    return new Promise(resolve => {

        if (
            !clone ||
            !targetEl ||
            !targetEl.isConnected
        ) {

            resolve();

            return;

        }

        const target =
            targetEl.getBoundingClientRect();

        const current =
            clone.getBoundingClientRect();

        const dx =
            target.left - current.left;

        const dy =
            target.top - current.top;

        const dw =
            target.width - current.width;

        const dh =
            target.height - current.height;

        if (
            Math.abs(dx) < 0.5 &&
            Math.abs(dy) < 0.5 &&
            Math.abs(dw) < 0.5 &&
            Math.abs(dh) < 0.5
        ) {

            resolve();

            return;

        }

        clone.style.transition = [
            `left ${duration}ms cubic-bezier(.33, 1, .68, 1)`,
            `top ${duration}ms cubic-bezier(.33, 1, .68, 1)`,
            `width ${duration}ms cubic-bezier(.33, 1, .68, 1)`,
            `height ${duration}ms cubic-bezier(.33, 1, .68, 1)`
        ].join(", ");

        void clone.offsetWidth;

        clone.style.left =
            target.left + "px";

        clone.style.top =
            target.top + "px";

        clone.style.width =
            target.width + "px";

        clone.style.height =
            target.height + "px";

        setTimeout(resolve, duration + 20);

    });

}


/*
 * Follows the destination rect for the duration of the fade-in. Late
 * layout changes (scrollbar, lazy thumbnails, resized grid) move the
 * clone with the real element instead of leaving a final correction
 * that reads as a jump when the clone is removed.
 */
function trackCoverClone(clone, targetEl, duration) {

    return new Promise(resolve => {

        if (!clone) {

            resolve();

            return;

        }

        const startTime =
            performance.now();

        clone.style.transition =
            "none";

        const step =
            now => {

                if (!clone.isConnected) {

                    resolve();

                    return;

                }

                if (
                    targetEl &&
                    targetEl.isConnected
                ) {

                    const rect =
                        targetEl.getBoundingClientRect();

                    clone.style.left =
                        rect.left + "px";

                    clone.style.top =
                        rect.top + "px";

                    clone.style.width =
                        rect.width + "px";

                    clone.style.height =
                        rect.height + "px";

                }

                if (now - startTime < duration) {

                    requestAnimationFrame(step);

                } else {

                    resolve();

                }

            };

        requestAnimationFrame(step);

    });

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
/*
 * Most Telegram album URLs already carry an explicit "cover=<id>"
 * parameter (see openTemporaryTelegramAlbum()) -- when it's there, this
 * is a synchronous, always-correct way to know the cover's messageID
 * without waiting on anything at all. The only albums without one are
 * ones saved via the save button, which deliberately strips it so a
 * fresh random cover gets picked each session (see saveCurrentAlbum()
 * in 20-albums-persistence.js) -- those still fall back to
 * awaiting homeCoverCache's promise.
 */
function parseTelegramCoverMessageID(url) {

    if (typeof url !== "string")
        return null;

    const match =
        /[?&]cover=([^&]+)/.exec(url);

    if (!match)
        return null;

    let raw =
        match[1];

    try {

        raw =
            decodeURIComponent(raw);

    } catch {}

    const parsed =
        Number(raw);

    return Number.isFinite(parsed)
        ? parsed
        : null;

}


function findLoadedImageIndex(images, image) {

    if (
        !Array.isArray(images) ||
        !images.length ||
        !image ||
        image instanceof Promise
    ) {
        return -1;
    }

    const direct =
        images.indexOf(image);

    if (direct !== -1)
        return direct;

    if (image._manifestId != null) {

        const byManifest =
            images.findIndex(
                candidate =>
                    candidate &&
                    String(candidate._manifestId) ===
                        String(image._manifestId)
            );

        if (byManifest !== -1)
            return byManifest;

    }

    if (image._imageNumber != null) {

        const byNumber =
            images.findIndex(
                candidate =>
                    candidate &&
                    String(candidate._imageNumber) ===
                        String(image._imageNumber)
            );

        if (byNumber !== -1)
            return byNumber;

    }

    return -1;

}


async function openAlbumWithTransition(album, coverImgEl) {

    const isTelegram =
        usesLiveTelegram(album);

    const clone =
        createCoverFlight(coverImgEl);

    let coverMessageID =
        isTelegram
            ? parseTelegramCoverMessageID(album.url)
            : null;

    let coverImageObject = null;

    /*
     * Figuring out which image in the album corresponds to the home
     * page's cover can mean waiting on a real Telegram network call
     * (resolving homeCoverCache's promise) -- so this runs
     * concurrently with the fade-out below instead of blocking it.
     * Blocking it meant the user saw nothing happen at all until this
     * settled, and a hard 600ms cutoff meant any real network delay
     * silently dropped the flying-cover animation entirely, which is
     * exactly why it never seemed to work for Telegram albums. The
     * timeout here is just a safety net against a call that never
     * resolves at all, not the normal path.
     *
     * This whole lookup is skipped when parseTelegramCoverMessageID()
     * above already found an explicit cover in the URL -- no need to
     * touch the network at all in that (common) case.
     */
    const coverIDPromise =
        (async () => {

            if (!isTelegram) {

                const cached =
                    homeCoverCache.get(album.id);

                coverImageObject =
                    cached && !(cached instanceof Promise)
                        ? cached
                        : null;

                return;

            }

            if (coverMessageID != null)
                return;

            const cached =
                homeCoverCache.get(album.id);

            if (!cached)
                return;

            try {

                const result =
                    await Promise.race([
                        cached,
                        sleep(10000).then(() => null)
                    ]);

                if (result && result.messageID != null)
                    coverMessageID = result.messageID;

            } catch {}

        })();

    await Promise.all([
        fadeOutCurrentView(),
        coverIDPromise
    ]);

    const layoutReady =
        waitForAlbumLayout();

    loadAlbum(album, true, { transition: true });

    const loadedAlbum =
        await layoutReady;

    await stabilizeAlbumLayout();

    const loadedImages =
        loadedAlbum._imagesArray || buildImagesArray(loadedAlbum);

    let targetIndex = null;

    if (isTelegram && coverMessageID != null) {

        targetIndex =
            loadedImages.findIndex(
                image => {

                    const telegramSource =
                        image?.[0];

                    if (!telegramSource)
                        return false;

                    /*
                     * The home cover can be the quick copy (medium)
                     * or the original document (full/thumb) depending
                     * on which message ID was picked, so compare
                     * against every size's message ID. Multipart videos
                     * can also be represented by a later part.
                     */
                    return [
                        telegramSource.full?.key2,
                        telegramSource.medium?.key2,
                        telegramSource.thumb?.key2,
                        ...(Array.isArray(image.parts) ? image.parts : [])
                    ].some(
                        id =>
                            id != null &&
                            String(id) === String(coverMessageID)
                    );

                }
            );

    }
    else if (coverImageObject) {

        targetIndex =
            findLoadedImageIndex(
                loadedImages,
                coverImageObject
            );

        /*
         * The home card may hold an object from before the album list
         * refreshed. Fall back to the index the home render recorded,
         * which stays valid because album images keep their order.
         */
        if (
            targetIndex === -1 &&
            Number.isInteger(album._homeCoverIndex) &&
            album._homeCoverIndex >= 0 &&
            album._homeCoverIndex < loadedImages.length
        ) {
            targetIndex =
                album._homeCoverIndex;
        }

    }

    if (targetIndex === -1)
        targetIndex = null;

    /*
     * Only fly when we know which grid image the cover belongs to.
     * Falling back to the first grid slot used to park the album's
     * cover over the first tile and then remove it, revealing a
     * different picture underneath -- a visible "wrong image lands,
     * then swaps" glitch. Without a match, just fade into the album.
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

    if (slot && targetIndex != null) {

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

    /*
     * The page is still faded out here, so any correction to the
     * clone's final position is invisible. Do it before the fade-in so
     * the real slot is already perfectly covered when it appears.
     */
    if (flew)
        await alignCoverClone(clone, slot);

    fadeInCurrentView();

    /*
     * Keep the crisp flying cover in place, masking the real thumbnail
     * underneath, until the fade-in has fully finished -- otherwise the
     * cover would visibly fade/blur in along with the rest of the page.
     */
    if (flew) {

        await trackCoverClone(
            clone,
            slot,
            VIEW_TRANSITION_MS
        );

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

        /*
         * Keep the home render on the same image the cover flight is
         * carrying. Without this, a re-rendered card could pick a
         * different cached cover and swap as the clone lands.
         */
        const flightItem =
            slot?._thumbnailItem;

        if (
            flightItem?.image &&
            !usesLiveTelegram(album)
        ) {
            homeCoverCache.set(
                album.id,
                flightItem.image
            );
            album._homeCoverIndex =
                coverIndex;
        }

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

    let destinationImg = null;

    if (clone && album) {

        const card =
            document.querySelector(
                `.album[data-album-id="${CSS.escape(String(album.id))}"]`
            );

        const cardImg =
            card && card.querySelector("img");

        destinationImg =
            cardImg || null;

        flew =
            await flyCoverTo(
                clone,
                cardImg,
                cardImg
                    ? () => settleCoverIntoHomeCard(cardImg, clone.src)
                    : null
            );

    }

    if (flew)
        await alignCoverClone(clone, destinationImg);

    fadeInCurrentView();

    if (flew) {

        await trackCoverClone(
            clone,
            destinationImg,
            VIEW_TRANSITION_MS
        );

        clone.remove();

    }

}
