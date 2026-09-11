/**
 * Thumbnail Loading Module
 * Handles thumbnail image loading, queuing, and visibility-based prioritization
 */

const ThumbnailLoader = (() => {
    let thumbnailItems = [];
    let thumbnailQueue = [];
    let thumbnailLoading = false;
    let thumbnailObserver = null;
    let thumbnailScrollTimer = null;
    let thumbnailLoadSession = 0;
    let thumbnailPriorityMode = false;
    let thumbnailPriorityPaused = false;

    const THUMBNAIL_SETTLE_DELAY = 1000;

    /**
     * Stop all thumbnail loading
     */
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

    /**
     * Pause thumbnail loading (e.g., when opening modal)
     */
    function pauseThumbnailLoading() {
        thumbnailPriorityPaused = true;
        clearTimeout(thumbnailScrollTimer);
        thumbnailScrollTimer = null;
    }

    /**
     * Resume thumbnail loading
     */
    function resumeThumbnailLoading() {
        thumbnailPriorityPaused = false;
        prioritizeVisibleThumbnails();
        if (!thumbnailLoading)
            processThumbnailQueue(thumbnailLoadSession);
    }

    /**
     * Get all thumbnail slots from gallery
     */
    function getThumbnailSlots() {
        const gallery = document.getElementById("gallery");
        if (!gallery) return [];
        return Array.from(gallery.querySelectorAll(".thumbnail-slot"));
    }

    /**
     * Get visible thumbnail slots in viewport
     */
    function getVisibleThumbnailSlots() {
        return getThumbnailSlots()
            .map((slot, position) => ({
                slot,
                position,
                rect: slot.getBoundingClientRect()
            }))
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

    /**
     * Get next available visible slot that needs loading
     */
    function getNextAvailableVisibleSlot() {
        const visibleSlots = getVisibleThumbnailSlots();

        for (const slot of visibleSlots) {
            if (slot.dataset.loaded === "true") {
                continue;
            }
            if (slot.dataset.loading === "true") {
                continue;
            }
            return slot;
        }

        return null;
    }

    /**
     * Rebuild thumbnail queue with optional prioritization
     */
    function rebuildThumbnailQueue(prioritizeVisible = false, restoreFailed = false) {
        const eligible = thumbnailItems.filter(item =>
            item &&
            !item.loaded &&
            !item.loading
        );

        if (!prioritizeVisible) {
            const normal = eligible
                .filter(item => !item.thumbnailFailed)
                .sort((a, b) => a.index - b.index);
            const failed = eligible
                .filter(item => item.thumbnailFailed)
                .sort((a, b) => a.index - b.index);
            thumbnailQueue = normal.concat(failed);
            return;
        }

        const visible = new Set(getVisibleThumbnailSlots()
            .map(slot => Number(slot.dataset.index)));

        const ordered = eligible.sort((a, b) => a.index - b.index);
        const visibleItems = ordered.filter(item => visible.has(item.index));
        const remaining = ordered.filter(item => !visible.has(item.index));

        if (restoreFailed) {
            eligible.forEach(item => {
                if (item.thumbnailFailed)
                    item.thumbnailFailed = false;
            });
            thumbnailQueue = visibleItems.concat(remaining);
        } else {
            const normal = visibleItems.concat(remaining)
                .filter(item => !item.thumbnailFailed);
            const failed = visibleItems.concat(remaining)
                .filter(item => item.thumbnailFailed);
            thumbnailQueue = normal.concat(failed);
        }
    }

    /**
     * Assign thumbnail to slot
     */
    function assignThumbnailToSlot(item, slot) {
        if (!item || !slot) return;
        if (slot._thumbnailItem === item) return;

        const thumbnailImg = slot.querySelector(".thumbnail-image");
        const mediumImg = slot.querySelector(".medium-image");

        if (!thumbnailImg || !mediumImg) return;

        slot.style.visibility = "hidden";
        slot._thumbnailItem = item;
        item.slot = slot;
        item.img = thumbnailImg;
        item.mediumImg = mediumImg;

        slot.dataset.index = item.index;
        slot.dataset.src = item.src;
        slot.dataset.loaded = "false";
        slot.dataset.loading = "false";

        mediumImg.style.visibility = "hidden";
        mediumImg.style.opacity = "0";
        mediumImg.removeAttribute("src");

        slot.alt = (item.tags || []).join(",");

        slot.onclick = () => {
            if (!slot._thumbnailItem) return;
            const current = slot._thumbnailItem;
            // Note: currentImageIndex and openModal should be injected or callback-based
            if (window.currentImageIndex !== undefined) {
                window.currentImageIndex = current.index;
            }
            if (typeof window.openModal === 'function') {
                window.openModal(
                    current.src,
                    current.mediumSrc,
                    current.fullSrc,
                    slot
                );
            }
        };

        if (item.loaded) {
            thumbnailImg.src = item.src;
            thumbnailImg.style.visibility = "visible";
            slot.dataset.loaded = "true";
            slot.dataset.loading = "false";
            slot.style.visibility = "visible";
        }

        if (item.mediumLoaded && item.mediumImage) {
            mediumImg.src = item.mediumImage.src;
            mediumImg.style.visibility = "visible";
            mediumImg.style.opacity = "1";
        }
    }

    /**
     * Force load a thumbnail immediately
     */
    async function forceLoadThumbnail(item, isActive) {
        if (!item || item.loaded)
            return item?.src || null;

        const ImageCache = window.ImageCache || {};
        const url = await ImageCache.resolveImageAsset?.(item, "thumb", isActive);
        if (!url || !isActive?.())
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

    /**
     * Load a single thumbnail
     */
    function loadThumbnail(item, session) {
        return new Promise(resolve => {
            if (!item || item.loaded || item.loading || session !== thumbnailLoadSession) {
                resolve();
                return;
            }

            let targetSlot = thumbnailPriorityMode ? getNextAvailableVisibleSlot() : null;
            if (!targetSlot)
                targetSlot = getThumbnailSlots().find(slot =>
                    slot.dataset.loading !== "true" && slot.dataset.loaded !== "true"
                );
            if (!targetSlot) {
                resolve();
                return;
            }

            const img = targetSlot.querySelector(".thumbnail-image");
            if (!img) {
                resolve();
                return;
            }

            item.loading = true;
            item.thumbnailFailed = false;
            assignThumbnailToSlot(item, targetSlot);
            targetSlot.dataset.loading = "true";

            const finish = success => {
                img.onload = null;
                img.onerror = null;
                item.loading = false;
                targetSlot.dataset.loading = "false";

                if (session !== thumbnailLoadSession) {
                    resolve();
                    return;
                }

                if (success) {
                    item.loaded = true;
                    item.assigned = true;
                    item.thumbnailFailed = false;
                    targetSlot.dataset.loaded = "true";
                    targetSlot.style.visibility = "visible";
                    img.style.visibility = "visible";
                } else {
                    item.loaded = false;
                    item.assigned = false;
                    item.thumbnailFailed = true;
                    targetSlot.dataset.loaded = "false";

                    if (typeof window.noteImageFailure === 'function') {
                        window.noteImageFailure();
                    }

                    console.debug("[THUMBNAIL] Failed; deferred for retry", {
                        index: item.index,
                        source: item.source,
                        url: item.src || item.mediumSrc || item.fullSrc || null
                    });
                }
                resolve();
            };

            img.onload = () => finish(true);
            img.onerror = () => finish(false);

            const ImageCache = window.ImageCache || {};
            ImageCache.resolveImageAsset?.(item, "thumb", () => session === thumbnailLoadSession)
                .then(url => {
                    if (!url || session !== thumbnailLoadSession) {
                        finish(false);
                        return;
                    }
                    item.src = url;
                    targetSlot.dataset.src = url;
                    img.src = url;
                })
                .catch(error => {
                    console.debug("[THUMBNAIL] Asset resolution failed", {
                        index: item.index,
                        source: item.source,
                        errorName: error?.name,
                        errorMessage: error?.message
                    });
                    finish(false);
                });
        });
    }

    /**
     * Prioritize visible queue
     */
    function prioritizeVisibleQueue() {
        rebuildThumbnailQueue(true, true);
    }

    /**
     * Prioritize visible thumbnails
     */
    function prioritizeVisibleThumbnails() {
        if (thumbnailPriorityPaused)
            return;

        thumbnailPriorityMode = true;
        rebuildThumbnailQueue(true, true);
        processThumbnailQueue(thumbnailLoadSession);

        const finishPriorityCheck = () => {
            if (!thumbnailPriorityMode)
                return;

            const visibleSlots = getVisibleThumbnailSlots();
            const pendingVisible = visibleSlots.some(slot => {
                const item = thumbnailItems.find(entry => entry.index === Number(slot.dataset.index));
                return item && !item.loaded;
            });

            if (pendingVisible) {
                setTimeout(finishPriorityCheck, 50);
                return;
            }

            thumbnailPriorityMode = false;
            rebuildThumbnailQueue(false, true);
            processThumbnailQueue(thumbnailLoadSession);

            // Start medium loading if available
            if (typeof window.startMediumLoading === 'function') {
                window.startMediumLoading();
            }
        };

        setTimeout(finishPriorityCheck, 0);
    }

    /**
     * Schedule visibility check with debouncing
     */
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

    /**
     * Process thumbnail queue
     */
    async function processThumbnailQueue(session) {
        if (thumbnailLoading || thumbnailPriorityPaused || session !== thumbnailLoadSession)
            return;

        thumbnailLoading = true;

        while (
            thumbnailQueue.length &&
            session === thumbnailLoadSession &&
            !thumbnailPriorityPaused
        ) {
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
            rebuildThumbnailQueue(false, true);
            processThumbnailQueue(session);
            return;
        }

        const failed = thumbnailItems.some(item => item && !item.loaded && item.thumbnailFailed);
        if (failed) {
            if (typeof window.imageRetryPending !== 'undefined') {
                window.imageRetryPending = true;
            }
            if (typeof window.scheduleImageRetry === 'function') {
                window.scheduleImageRetry();
            }
        }

        if (!remainingNormal && typeof window.startMediumLoading === 'function') {
            window.startMediumLoading();
        }
    }

    /**
     * Start thumbnail loading with intersection observer
     */
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
        }, { root: null, rootMargin: "0px", threshold: 0 });

        slots.forEach(slot => thumbnailObserver.observe(slot));
        window.addEventListener("scroll", scheduleThumbnailVisibilityCheck, { passive: true });
        window.addEventListener("resize", scheduleThumbnailVisibilityCheck);
    }

    /**
     * Initialize thumbnail items array
     */
    function initThumbnailItems(items = []) {
        thumbnailItems = items;
        thumbnailQueue = [];
    }

    /**
     * Clear thumbnail state
     */
    function clearThumbnailState() {
        thumbnailItems = [];
        thumbnailQueue = [];
        thumbnailLoading = false;
    }

    // Public API
    return {
        // State management
        initThumbnailItems,
        clearThumbnailState,
        getThumbnailItems: () => thumbnailItems,
        getThumbnailQueue: () => thumbnailQueue,

        // Loading control
        startThumbnailLoading,
        stopThumbnailLoading,
        pauseThumbnailLoading,
        resumeThumbnailLoading,
        processThumbnailQueue,

        // Slot management
        getThumbnailSlots,
        getVisibleThumbnailSlots,
        getNextAvailableVisibleSlot,
        assignThumbnailToSlot,

        // Queue management
        rebuildThumbnailQueue,
        prioritizeVisibleQueue,
        prioritizeVisibleThumbnails,
        scheduleThumbnailVisibilityCheck,

        // Individual thumbnail operations
        loadThumbnail,
        forceLoadThumbnail,

        // Constants
        THUMBNAIL_SETTLE_DELAY
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThumbnailLoader;
}
