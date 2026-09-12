/*
 * 07-thumbnail-loading-pipeline.js
 *
 * The progressive thumbnail loader: queueing, prioritizing visible
 * thumbnails, and the retry/backoff logic for images that fail to load.
 */

let thumbnailItems = [];

let thumbnailQueue = [];

let thumbnailLoading = false;

let thumbnailObserver = null;

let thumbnailScrollTimer = null;

const THUMBNAIL_SETTLE_DELAY = 1000;

const IMAGE_RETRY_DELAY = 3000;

let thumbnailLoadSession = 0;

let thumbnailPriorityMode = false;

let thumbnailPriorityPaused = false;

let imageRetryTimer = null;

let lastImageFailureTime = 0;

let imageRetryPending = false;

let modalRetry = null;


function noteImageFailure() {

    lastImageFailureTime =
        Date.now();

    /*
     * Do not automatically retry Telegram failures.
     *
     * Telegram thumbnail file IDs can contain expired
     * file references. Retrying the same ID cannot fix
     * that condition and can create an endless queue.
     */

    imageRetryPending =
        false;

    if (imageRetryTimer) {

        clearTimeout(
            imageRetryTimer
        );

        imageRetryTimer =
            null;
    }
}


function scheduleImageRetry() {

    if (imageRetryTimer) {

        clearTimeout(
            imageRetryTimer
        );

        imageRetryTimer =
            null;
    }

    imageRetryPending =
        false;
}


function retryFailedImages() {

    /*
     * Automatic retries are intentionally disabled here.
     *
     * A Telegram FILE_REFERENCE_EXPIRED error requires
     * obtaining a fresh Telegram file reference rather
     * than downloading the same file ID again.
     */
    return;
}


function pauseThumbnailLoading() {
    thumbnailPriorityPaused = true;
    clearTimeout(thumbnailScrollTimer);
    thumbnailScrollTimer = null;
}


function resumeThumbnailLoading() {
    thumbnailPriorityPaused = false;
    prioritizeVisibleThumbnails();
    if (!thumbnailLoading)
        processThumbnailQueue(thumbnailLoadSession);
}


function stopThumbnailLoading() {
    thumbnailLoadSession++;
    clearTimeout(thumbnailScrollTimer);
    thumbnailScrollTimer = null;
    if (thumbnailObserver) {
        thumbnailObserver.disconnect();
        thumbnailObserver = null;
    }
    thumbnailPriorityMode = false;
}


function getThumbnailSlots() {
    const gallery = document.getElementById("gallery");
    if (!gallery)
        return [];
    return Array.from(gallery.querySelectorAll(".thumbnail-slot"));
}


function getVisibleThumbnailSlots() {
    return getThumbnailSlots()
        .map((slot, position) => ({slot, position, rect: slot.getBoundingClientRect()}))
        .filter(item =>
            item.rect.bottom > 0 &&
            item.rect.top < window.innerHeight &&
            item.rect.right > 0 &&
            item.rect.left < window.innerWidth
        )
        .sort((a, b) => {
            if (Math.abs(a.rect.top - b.rect.top) > 1)
                return a.rect.top - b.rect.top;
            return a.rect.left - b.rect.left;
        })
        .map(item => item.slot);
}


function getNextAvailableVisibleSlot() {
    for (const slot of getVisibleThumbnailSlots()) {
        if (slot.dataset.loaded !== "true" && slot.dataset.loading !== "true")
            return slot;
    }
    return null;
}


function rebuildThumbnailQueue(
    prioritizeVisible = false,
    restoreFailed = false
) {

    const eligible =
        thumbnailItems.filter(item =>
            item &&
            !item.loaded &&
            !item.loading &&
            !item.thumbnailPermanentlyFailed
        );

    if (!prioritizeVisible) {

        const normal =
            eligible
                .filter(
                    item =>
                        !item.thumbnailFailed
                )
                .sort(
                    (a, b) =>
                        a.index -
                        b.index
                );

        const failed =
            eligible
                .filter(
                    item =>
                        item.thumbnailFailed
                )
                .sort(
                    (a, b) =>
                        a.index -
                        b.index
                );

        /*
         * Failed items remain at the end of the queue.
         * Permanently failed items aren't eligible at all.
         */

        thumbnailQueue =
            normal.concat(
                failed
            );

        return;
    }

    const visible =
        new Set(
            getVisibleThumbnailSlots()
                .map(
                    slot =>
                        Number(
                            slot.dataset.index
                        )
                )
        );

    const ordered =
        eligible.sort(
            (a, b) =>
                a.index -
                b.index
        );

    const visibleItems =
        ordered.filter(
            item =>
                visible.has(
                    item.index
                )
        );

    const remaining =
        ordered.filter(
            item =>
                !visible.has(
                    item.index
                )
        );

    /*
     * DO NOT clear thumbnailFailed here.
     *
     * restoreFailed is retained in the function signature
     * for compatibility with existing callers, but failed
     * Telegram thumbnails must not be resurrected merely
     * because the gallery was reprioritized.
     */

    const normal =
        visibleItems
            .concat(remaining)
            .filter(
                item =>
                    !item.thumbnailFailed
            );

    const failed =
        visibleItems
            .concat(remaining)
            .filter(
                item =>
                    item.thumbnailFailed
            );

    thumbnailQueue =
        normal.concat(
            failed
        );
}

async function forceLoadThumbnail(item) {
    if (!item || item.loaded)
        return item?.src || null;

    const url = await resolveImageAsset(item, "thumb", () => isModalLoadActive(modalLoadID));
    if (!url || !isModalLoadActive(modalLoadID))
        return null;

    const slot = item.slot;
    const img = slot?.querySelector(".thumbnail-image") || item.img;
    if (!img)
        return null;

    img.src = url;
    item.src = url;
    item.loaded = true;
    item.loading = false;
    item.assigned = true;
    item.thumbnailFailed = false;

    if (slot) {
        slot._thumbnailItem = item;
        slot.dataset.index = item.index;
        slot.dataset.src = url;
        slot.dataset.loaded = "true";
        slot.dataset.loading = "false";
        slot.style.visibility = "visible";
        img.style.visibility = "visible";
    }

    thumbnailQueue = thumbnailQueue.filter(queueItem => queueItem !== item);
    return url;
}


function assignThumbnailToSlot(item,
    slot) {

    if (
        !item ||
        !slot
    ) {

        return;

    }

    if (
        slot._thumbnailItem ===
        item
    ) {

        return;

    }

    const thumbnailImg =
        slot.querySelector(
            ".thumbnail-image");

    const mediumImg =
        slot.querySelector(
            ".medium-image");

    if (
        !thumbnailImg ||
        !mediumImg
    ) {

        return;

    }

    slot.style.visibility =
        "hidden";

    slot._thumbnailItem =
        item;

    item.slot = slot;
    item.img = thumbnailImg;
    item.mediumImg = mediumImg;

    slot.dataset.index =
        item.index;

    slot.dataset.src =
        item.src;

    slot.dataset.loaded =
        "false";

    slot.dataset.loading =
        "false";

    mediumImg.style.visibility =
        "hidden";

    mediumImg.style.opacity =
        "0";

    mediumImg.removeAttribute(
        "src");

    slot.alt =
        (item.tags || []).join(",");

    slot.onclick =
        () => {

        if (
            !slot._thumbnailItem
        ) {

            return;

        }

        const current =
            slot._thumbnailItem;

        currentImageIndex =
            current.index;

        openModal(
            current.src,
            current.mediumSrc,
            current.fullSrc,
            slot
        );

    };

    if (
        item.loaded
    ) {

        thumbnailImg.src =
            item.src;

        thumbnailImg.style.visibility =
            "visible";

        slot.dataset.loaded =
            "true";

        slot.dataset.loading =
            "false";

        slot.style.visibility =
            "visible";

    }

    if (
        item.mediumLoaded &&
        item.mediumImage
    ) {

        mediumImg.src =
            item.mediumImage.src;

        mediumImg.style.visibility =
            "visible";

        mediumImg.style.opacity =
            "1";

    }

}


function getNextAvailableVisibleSlot() {

	const visibleSlots =
		getVisibleThumbnailSlots();

	for (
		const slot of visibleSlots
	) {

		if (
			slot.dataset.loaded ===
			"true"
		) {

			continue;

		}

		if (
			slot.dataset.loading ===
			"true"
		) {

			continue;

		}

		return slot;

	}

	return null;

}


function loadThumbnail(item, session) {

    return new Promise(resolve => {

        if (
            !item ||
            item.loaded ||
            item.loading ||
            item.thumbnailPermanentlyFailed ||
            session !== thumbnailLoadSession
        ) {

            resolve();

            return;
        }

        let targetSlot =
            thumbnailPriorityMode
                ? getNextAvailableVisibleSlot()
                : null;

        if (!targetSlot) {

            targetSlot =
                getThumbnailSlots().find(
                    slot =>
                        slot.dataset.loading !== "true" &&
                        slot.dataset.loaded !== "true"
                );

        }

        if (!targetSlot) {

            resolve();

            return;
        }

        const img =
            targetSlot.querySelector(
                ".thumbnail-image"
            );

        if (!img) {

            resolve();

            return;
        }

        item.loading =
            true;

        item.thumbnailFailed =
            false;

        assignThumbnailToSlot(
            item,
            targetSlot
        );

        targetSlot.dataset.loading =
            "true";

        let finished =
            false;

        const finish =
            success => {

                if (finished)
                    return;

                finished =
                    true;

                img.onload =
                    null;

                img.onerror =
                    null;

                item.loading =
                    false;

                targetSlot.dataset.loading =
                    "false";

                if (
                    session !==
                    thumbnailLoadSession
                ) {

                    resolve();

                    return;
                }

                if (success) {

                    item.loaded =
                        true;

                    item.assigned =
                        true;

                    item.thumbnailFailed =
                        false;

                    item.thumbnailPermanentlyFailed =
                        false;

                    targetSlot.dataset.loaded =
                        "true";

                    targetSlot.style.visibility =
                        "visible";

                    img.style.visibility =
                        "visible";

                }
                else {

                    item.loaded =
                        false;

                    item.assigned =
                        false;

                    item.thumbnailFailed =
                        true;

                    /*
                     * HARD STOP.
                     *
                     * This prevents queue rebuilding,
                     * visibility prioritization, or other
                     * loader activity from attempting the
                     * same thumbnail again.
                     */
                    item.thumbnailPermanentlyFailed =
                        true;

                    targetSlot.dataset.loaded =
                        "false";

                    noteImageFailure();

                    console.debug(
                        "[THUMBNAIL] Failed; deferred for retry",
                        {
                            index:
                                item.index,

                            source:
                                item.source,

                            url:
                                item.src ||
                                item.mediumSrc ||
                                item.fullSrc ||
                                null
                        }
                    );

                }

                resolve();
            };

        img.onload =
            () =>
                finish(true);

        img.onerror =
            () =>
                finish(false);

        resolveImageAsset(
            item,
            "thumb",
            () =>
                session ===
                thumbnailLoadSession
        )
            .then(
                url => {

                    if (
                        !url ||
                        session !==
                        thumbnailLoadSession
                    ) {

                        finish(false);

                        return;
                    }

                    item.src =
                        url;

                    targetSlot.dataset.src =
                        url;

                    img.src =
                        url;

                }
            )
            .catch(
                error => {

                    console.debug(
                        "[THUMBNAIL] Asset resolution failed",
                        {
                            index:
                                item.index,

                            source:
                                item.source,

                            errorName:
                                error?.name,

                            errorMessage:
                                error?.message
                        }
                    );

                    finish(false);

                }
            );

    });
}

async function processThumbnailQueue(session) {
    if (thumbnailLoading || thumbnailPriorityPaused || session !== thumbnailLoadSession)
        return;

    thumbnailLoading = true;

    while (thumbnailQueue.length && session === thumbnailLoadSession && !thumbnailPriorityPaused) {
        if (thumbnailPriorityMode) {
            const visibleSlots = getVisibleThumbnailSlots();
            if (!visibleSlots.length)
                break;
            prioritizeVisibleQueue();
        }

        const item = thumbnailQueue.shift();
        if (!item || item.loaded || item.loading)
            continue;

        if (item.thumbnailFailed) {
            thumbnailQueue.push(item);
            if (!thumbnailQueue.some(entry => entry && !entry.loaded && !entry.loading && !entry.thumbnailFailed))
                break;
            continue;
        }

        await loadThumbnail(item, session);
    }

    thumbnailLoading = false;

    if (thumbnailPriorityPaused || thumbnailPriorityMode || session !== thumbnailLoadSession)
        return;

    const remainingNormal = thumbnailItems.some(item =>
        item && !item.loaded && !item.loading && !item.thumbnailFailed
    );

    if (remainingNormal) {
        rebuildThumbnailQueue(false, false);
        processThumbnailQueue(session);
        return;
    }

    const failed = thumbnailItems.some(item => item && !item.loaded && item.thumbnailFailed);
    if (failed) {
        imageRetryPending = true;
        scheduleImageRetry();
    }

    if (!remainingNormal)
        startMediumLoading();
}


function prioritizeVisibleQueue() {
    rebuildThumbnailQueue(true, false);
}

function prioritizeVisibleThumbnails() {

    if (thumbnailPriorityPaused)
        return;

    thumbnailPriorityMode =
        true;

    /*
     * Do NOT restore failed thumbnails here.
     *
     * A failed Telegram thumbnail may have an expired
     * file reference. Re-prioritizing the gallery must
     * not turn that failure back into a new download.
     */
    rebuildThumbnailQueue(
        true,
        false
    );

    processThumbnailQueue(
        thumbnailLoadSession
    );

    const finishPriorityCheck = () => {

        if (!thumbnailPriorityMode)
            return;

        const visibleSlots =
            getVisibleThumbnailSlots();

        const pendingVisible =
            visibleSlots.some(slot => {

                const item =
                    thumbnailItems.find(
                        entry =>
                            entry.index ===
                            Number(
                                slot.dataset.index
                            )
                    );

                /*
                 * Failed items are not pending anymore.
                 * They are deliberately left failed until
                 * their Telegram file reference is refreshed.
                 */
                return (
                    item &&
                    !item.loaded &&
                    !item.thumbnailFailed
                );
            });

        if (pendingVisible) {

            setTimeout(
                finishPriorityCheck,
                50
            );

            return;
        }

        thumbnailPriorityMode =
            false;

        rebuildThumbnailQueue(
            false,
            false
        );

        processThumbnailQueue(
            thumbnailLoadSession
        );

        if (mediumItems.length)
            prioritizeVisibleMediums();
    };

    setTimeout(
        finishPriorityCheck,
        0
    );
}

function scheduleThumbnailVisibilityCheck() {
    if (thumbnailPriorityPaused)
        return;
    clearTimeout(thumbnailScrollTimer);
    thumbnailPriorityMode = true;
    thumbnailScrollTimer = setTimeout(() => {
        thumbnailScrollTimer = null;
        prioritizeVisibleThumbnails();
    }, THUMBNAIL_SETTLE_DELAY);
}


function startThumbnailLoading() {
    stopThumbnailLoading();
    const gallery = document.getElementById("gallery");
    if (!gallery)
        return;

    const session = thumbnailLoadSession;
    const slots = getThumbnailSlots();
    if (!slots.length)
        return;

    rebuildThumbnailQueue(false, true);
    thumbnailPriorityMode = false;
    processThumbnailQueue(session);

    thumbnailObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting))
            scheduleThumbnailVisibilityCheck();
    }, {root: null, rootMargin: "0px", threshold: 0});

    slots.forEach(slot => thumbnailObserver.observe(slot));
    window.addEventListener("scroll", scheduleThumbnailVisibilityCheck, {passive: true});
    window.addEventListener("resize", scheduleThumbnailVisibilityCheck);
}
