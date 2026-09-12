/*
 * 08-medium-loading-pipeline.js
 *
 * Same idea one resolution up: loads medium-quality images once their
 * thumbnail is already in place.
 */

let mediumItems = [];

let mediumQueue = [];

let mediumLoading = false;

let mediumLoadSession = 0;

let mediumCompletionPromise = null;
let mediumCompletionResolve = null;


function stopMediumLoading() {
    mediumLoadSession++;
    mediumQueue = [];
    mediumLoading = false;

    /*
     * The previous completion promise belongs to the
     * previous medium-loading session. It must not be
     * reused by the next album.
     */
    mediumCompletionPromise = null;
    mediumCompletionResolve = null;
}


function rebuildMediumQueue(prioritizeVisible = false, includeFailed = true) {
    const eligible = mediumItems.filter(item => {
        if (!item || item.mediumLoaded || item.mediumLoading)
            return false;
        const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
        if (!thumbnail || !thumbnail.loaded)
            return false;
        return !!item.src || item.source === "telegram";
    });

    const failed = eligible.filter(item => item.mediumFailed);
    const normal = eligible.filter(item => !item.mediumFailed);

    if (!prioritizeVisible) {
        mediumQueue = normal.sort((a, b) => a.index - b.index);
        if (includeFailed)
            mediumQueue.push(...failed.sort((a, b) => a.index - b.index));
        return;
    }

    const visible = new Set(getVisibleThumbnailSlots()
        .map(slot => Number(slot.dataset.index)));
    const visibleItems = normal.filter(item => visible.has(item.index));
    const remaining = normal.filter(item => !visible.has(item.index));
    mediumQueue = visibleItems.sort((a, b) => a.index - b.index)
        .concat(remaining.sort((a, b) => a.index - b.index));
    if (includeFailed)
        mediumQueue.push(...failed.sort((a, b) => a.index - b.index));
}


function loadMedium(item, session) {
    return new Promise(resolve => {
        if (!item || item.mediumLoaded || item.mediumLoading || session !== mediumLoadSession) {
            resolve();
            return;
        }

        const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
        if (!thumbnail || !thumbnail.loaded) {
            resolve();
            return;
        }

        const img = item.mediumImage;
        if (!img) {
            resolve();
            return;
        }

        item.mediumLoading = true;
        item.mediumFailed = false;

        const finish = success => {
            img.onload = null;
            img.onerror = null;
            item.mediumLoading = false;
            if (session !== mediumLoadSession) {
                resolve();
                return;
            }

            if (success) {
                item.mediumLoaded = true;
                item.mediumFailed = false;
                img.style.visibility = "visible";
                img.style.opacity = "1";

                thumbnail.mediumSrc = item.src;
                thumbnail.fullSrc = getImageURLs(item.image).full;
                thumbnail.mediumLoaded = true;
                thumbnail.mediumImage = img;
                thumbnail.mediumBlobURL = item.mediumBlobURL || item.src;

                if (thumbnail.slot) {
                    const thumbImg = thumbnail.img;
                    if (thumbImg && img.src) {
                        thumbImg.style.visibility = "hidden";
                        thumbImg.style.opacity = "0";
                    }
                }
            } else {
                item.mediumLoaded = false;
                item.mediumFailed = true;
                img.removeAttribute("src");
                noteImageFailure();
                console.debug("[MEDIUM] Failed; deferred for retry", {
                    index: item.index,
                    source: item.source,
                    url: item.src || null
                });
            }
            resolve();
        };

        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        resolveImageAsset(item, "medium", () => session === mediumLoadSession)
            .then(url => {
                if (!url || session !== mediumLoadSession) {
                    finish(false);
                    return;
                }
                item.src = url;
                item.mediumBlobURL = url;
                img.src = url;
            })
            .catch(error => {
                console.debug("[MEDIUM] Asset resolution failed", {
                    index: item.index,
                    source: item.source,
                    errorName: error?.name,
                    errorMessage: error?.message
                });
                finish(false);
            });
    });
}


async function processMediumQueue(session) {

    if (
        mediumLoading ||
        thumbnailPriorityPaused ||
        session !== mediumLoadSession
    ) {

        return;

    }

    mediumLoading = true;

    while (
        mediumQueue.length &&
        session === mediumLoadSession &&
        !thumbnailPriorityPaused
    ) {

        const item =
            mediumQueue.shift();

        if (
            !item ||
            item.mediumLoaded ||
            item.mediumLoading
        ) {

            continue;

        }

        const thumbnail =
            thumbnailItems.find(
                entry =>
                    entry.index ===
                    item.index
            );

        if (
            !thumbnail ||
            !thumbnail.loaded
        ) {

            continue;

        }

        if (item.mediumFailed) {

            mediumQueue.push(
                item
            );

            if (
                !mediumQueue.some(
                    entry =>
                        entry &&
                        !entry.mediumLoaded &&
                        !entry.mediumLoading &&
                        !entry.mediumFailed
                )
            ) {

                break;

            }

            continue;

        }

        await loadMedium(
            item,
            session
        );

    }

    mediumLoading =
        false;

    if (
        thumbnailPriorityPaused ||
        session !== mediumLoadSession
    ) {

        return;

    }

    const remainingNormal =
        mediumItems.some(item => {

            const thumbnail =
                item &&
                thumbnailItems.find(
                    entry =>
                        entry.index ===
                        item.index
                );

            return (
                item &&
                thumbnail?.loaded &&
                !item.mediumLoaded &&
                !item.mediumLoading &&
                !item.mediumFailed
            );

        });

    if (remainingNormal) {

        rebuildMediumQueue(
            false,
            true
        );

        processMediumQueue(
            session
        );

        return;

    }

    const failed =
        mediumItems.some(
            item =>
                item &&
                !item.mediumLoaded &&
                item.mediumFailed
        );

    if (failed) {

        imageRetryPending =
            true;

        scheduleImageRetry();

        /*
         * Do not resolve the completion promise.
         *
         * A temporary Telegram album is not considered
         * complete until every image has successfully
         * loaded and had its XMP processed.
         */

        return;

    }

    /*
     * There are no remaining normal items and no failures.
     *
     * Every medium item has successfully completed.
     */
    if (
        mediumCompletionResolve
    ) {

        const resolve =
            mediumCompletionResolve;

        mediumCompletionResolve =
            null;

        resolve();

    }
}

function prioritizeVisibleMediums() {
    if (thumbnailPriorityPaused)
        return;
    mediumItems.forEach(item => {
        if (item && item.mediumFailed)
            item.mediumFailed = false;
    });
    rebuildMediumQueue(true, true);
    processMediumQueue(mediumLoadSession);
}


function startMediumLoading() {

    if (mediumLoading)
        return;

    stopMediumLoading();

    const session =
        mediumLoadSession;

    if (!mediumItems.length) {

        if (mediumCompletionResolve) {

            mediumCompletionResolve();

            mediumCompletionResolve =
                null;

        }

        return;

    }

    mediumCompletionPromise =
        new Promise(resolve => {

            mediumCompletionResolve =
                resolve;

        });

    rebuildMediumQueue(
        false,
        true
    );

    processMediumQueue(
        session
    );
}

function waitForMediumLoading() {

    if (
        !mediumItems.length
    ) {

        return Promise.resolve();

    }

    if (
        mediumCompletionPromise
    ) {

        return mediumCompletionPromise;

    }

    /*
     * If the pipeline has already finished before this
     * function was called, verify that every item succeeded.
     */
    const incomplete =
        mediumItems.some(
            item =>
                item &&
                !item.mediumLoaded
        );

    if (!incomplete) {

        return Promise.resolve();

    }

    /*
     * The pipeline hasn't created its completion promise yet.
     * Wait until startMediumLoading() does so.
     */
    return new Promise(resolve => {

        const check =
            () => {

                if (
                    mediumCompletionPromise
                ) {

                    mediumCompletionPromise.then(
                        resolve
                    );

                    return;

                }

                const finished =
                    mediumItems.length > 0 &&
                    mediumItems.every(
                        item =>
                            item &&
                            item.mediumLoaded
                    );

                if (finished) {

                    resolve();

                    return;

                }

                setTimeout(
                    check,
                    25
                );

            };

        check();

    });

}

function findMediumItem(src) {
    if (!src)
        return null;
    return mediumItems.find(item => item && (item.mediumSrc === src || item.src === src)) || null;
}


function markMediumItemLoaded(url, image, blobURL = null) {
    if (!url)
        return null;
    const item = findMediumItem(url);
    if (!item)
        return null;

    item.mediumLoaded = true;
    item.mediumFailed = false;
    item.mediumLoading = false;
    item.mediumImage = image || item.mediumImage;
    item.mediumBlobURL = blobURL || item.mediumBlobURL;

    const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
    if (thumbnail) {
        thumbnail.mediumLoaded = true;
        thumbnail.mediumImage = item.mediumImage;
        thumbnail.mediumBlobURL = item.mediumBlobURL;
        const resolvedSrc = blobURL || url;
        thumbnail.mediumSrc = resolvedSrc;

        // This can be called from the modal's own loader (opening an
        // image before its medium/full version has loaded), which
        // decodes the image into a detached, off-grid <img> rather than
        // the grid's own ".medium-image" element. Previously this just
        // hid the grid thumbnail without ever painting anything into
        // that detached element's place, leaving the grid cell blank
        // until closing/reopening the album. Paint the grid's actual
        // medium image first, and only hide the thumbnail underneath it
        // once that swap has actually happened on screen.
        if (thumbnail.slot && thumbnail.mediumImg) {
            const gridMediumImg = thumbnail.mediumImg;
            const revealMedium = () => {
                gridMediumImg.style.visibility = "visible";
                gridMediumImg.style.opacity = "1";
                if (thumbnail.img) {
                    thumbnail.img.style.visibility = "hidden";
                    thumbnail.img.style.opacity = "0";
                }
            };
            if (gridMediumImg.src === resolvedSrc && gridMediumImg.complete) {
                revealMedium();
            } else {
                gridMediumImg.onload = revealMedium;
                gridMediumImg.onerror = null;
                gridMediumImg.src = resolvedSrc;
            }
        } else if (thumbnail.slot && thumbnail.img) {
            // No medium <img> element to swap to (shouldn't normally
            // happen) -- keep the thumbnail visible rather than hiding
            // it into a blank cell.
        }
    }

    mediumQueue = mediumQueue.filter(queueItem => queueItem !== item);
    return item;
}
