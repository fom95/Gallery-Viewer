/*
 * 31-wake-smoothing.js
 *
 * Firefox frees decoded image bitmaps for a background tab after roughly
 * 10-20 seconds, then re-decodes them when the tab is shown again, which
 * makes a gallery pop in image by image. A page cannot opt out of that,
 * but it can stop the first restored frame from showing half-decoded
 * images and turn the return into one short fade:
 *
 *  - while the tab is hidden the gallery is masked, so no half-decoded
 *    frame is ever painted when it comes back;
 *  - after a long absence the visible images are decoded first (capped
 *    at a few hundred milliseconds) and then the mask is faded out;
 *  - after a quick tab switch the mask is removed immediately.
 *
 * There is no polling, interval or animation frame loop here: the only
 * listener is visibilitychange, and the only timer is the short cap on
 * a single wake (so a broken image can never leave the grid hidden).
 */

const WAKE_MIN_HIDDEN_MS = 30000;

const WAKE_DECODE_CAP_MS = 450;


let wakeHiddenAt = 0;

let wakeRevealToken = 0;


function getWakeGallery() {

    return document.getElementById(
        "gallery"
    );

}


function maskGalleryForWake() {

    const gallery =
        getWakeGallery();

    if (!gallery)
        return;

    gallery.classList.add(
        "wake-masked"
    );

}


async function decodeVisibleGalleryImages(gallery) {

    const viewportWidth =
        window.innerWidth;

    const viewportHeight =
        window.innerHeight;

    const images =
        [...gallery.querySelectorAll("img")];

    const visible =
        images.filter(img => {

            if (!img.currentSrc)
                return false;

            if (
                typeof img.checkVisibility === "function" &&
                !img.checkVisibility()
            ) {
                return false;
            }

            const rect =
                img.getBoundingClientRect();

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.top < viewportHeight &&
                rect.right > 0 &&
                rect.left < viewportWidth
            );

        });

    if (!visible.length)
        return;

    /*
     * decode() re-decodes discarded bitmaps off the main thread and
     * resolves once they are paint-ready. allSettled keeps one broken
     * image from blocking the rest, and the cap guarantees the fade
     * never waits longer than a moment.
     */
    await Promise.race([
        Promise.allSettled(
            visible.map(img =>
                typeof img.decode === "function"
                    ? img.decode()
                    : Promise.resolve()
            )
        ),
        new Promise(resolve =>
            setTimeout(
                resolve,
                WAKE_DECODE_CAP_MS
            )
        )
    ]);

}


async function revealGalleryAfterWake() {

    const gallery =
        getWakeGallery();

    const hiddenFor =
        wakeHiddenAt
            ? Date.now() - wakeHiddenAt
            : 0;

    wakeHiddenAt =
        0;

    if (
        !gallery ||
        !gallery.classList.contains(
            "wake-masked"
        )
    ) {
        return;
    }

    /*
     * A quick switch (or a first load) should feel instant: drop the
     * mask with no fade at all.
     */
    if (hiddenFor < WAKE_MIN_HIDDEN_MS) {

        gallery.classList.add(
            "wake-instant"
        );

        gallery.classList.remove(
            "wake-masked"
        );

        /* Flush the snap before restoring the normal transition. */
        void gallery.offsetWidth;

        gallery.classList.remove(
            "wake-instant"
        );

        return;

    }

    const token =
        ++wakeRevealToken;

    try {
        await decodeVisibleGalleryImages(gallery);
    } catch {}

    if (token !== wakeRevealToken)
        return;

    /*
     * Removing the class restores the gallery's opacity transition, so
     * the already-decoded grid fades in over the normal 220ms instead
     * of flashing.
     */
    gallery.classList.remove(
        "wake-masked"
    );

}


function installWakeSmoothing() {

    document.addEventListener(
        "visibilitychange",
        () => {

            if (document.hidden) {

                wakeHiddenAt =
                    Date.now();

                maskGalleryForWake();

                return;

            }

            revealGalleryAfterWake();

        }
    );

    /*
     * A page opened in a background tab never sees the hidden event
     * above, so start masked in that case too.
     */
    if (document.hidden) {

        wakeHiddenAt =
            Date.now();

        maskGalleryForWake();

    }

}


installWakeSmoothing();
