/*
 * 08-image-sources.js
 *
 * Resolves an image + size ("thumb"/"medium"/"full") to an actual
 * displayable URL, by trying each of that image's declared source
 * candidates in order (see getImageProviderCandidates() in
 * 00-config-and-state.js) until one actually loads.
 *
 * Every provider -- imgbb, Telegram (served through the Cloudflare
 * Worker as plain HTTP), or anything else declared in the user's
 * config -- is just a URL from here on. Every candidate is a normal,
 * cacheable HTTP(S) URL, so the browser's native HTTP cache gives
 * repeat visits instant loads for every source uniformly.
 *
 * LOAD QUEUE
 * ----------
 * All probes go through a small client-side queue. The Worker sits in
 * front of ONE Telegram connection, so firing dozens of image requests
 * at once just makes every one of them slow (and then time out). The
 * queue:
 *   - limits how many images load at the same time,
 *   - lets the image the user actually asked for (full > medium > thumb)
 *     jump ahead of background thumbnails,
 *   - lets background loads (gallery thumbnails/mediums) re-rank
 *     themselves by distance from the viewport every time a slot frees
 *     up, so whatever is on screen NOW loads first -- even after a
 *     scroll -- instead of strictly in album order,
 *   - drops queued work whose gallery/modal is no longer active, so
 *     scrolling away or closing the modal doesn't leave stale requests,
 *   - starts each image's timeout only when it gets a slot, so time
 *     spent waiting in line is not counted against it.
 *
 * PRIORITY SCALE (lower loads first)
 *   0        full image the user opened
 *   0.5      thumbnail the user just clicked (modal open)
 *   1        medium image the user opened
 *   2 .. 2.9 background gallery thumbnails (2 = on screen)
 *   3 .. 3.9 background gallery mediums     (3 = on screen)
 */

/* How many images may be loading at once. 4 keeps the Worker busy
 * without piling a burst onto the single Telegram connection. Raise
 * toward 6-8 if loading feels slow and the Worker is coping fine. */
const IMAGE_MAX_CONCURRENT =
    4;

/* Default priority per size when the caller doesn't supply one. */
const IMAGE_PRIORITY = {
    full: 0,
    medium: 1,
    thumb: 2
};

const RESOLVED_URL_ATTEMPTS_PER_CANDIDATE =
    2;

/*
 * Per-size timeouts, counted from when the image gets a slot.
 * Full-size images can be 10-20 MB and have to arrive completely before
 * a probe succeeds, so they need far longer than a thumbnail. Too-short
 * timeouts are actively harmful: each retry restarts the download.
 */
const RESOLVED_URL_TIMEOUT_MS = {
    thumb: 20000,
    medium: 40000,
    full: 120000
};

/* Pause before a retry, so a slow Worker gets time to finish (and cache)
 * the first attempt instead of being hit again immediately. */
const RESOLVED_URL_RETRY_DELAY_MS =
    1500;

const resolvedAssetCache =
    new WeakMap();


function forgetResolvedImageAsset(image) {

    if (image)
        resolvedAssetCache.delete(image);

}


/*
 * The URL that resolveImageAsset() already settled on for this image
 * and size, if any. It can be a direct HTTP URL or a cached blob URL.
 * Used by the single-image editor preview to show the same asset the
 * gallery or viewer already loaded.
 */
function getResolvedImageAssetURL(image, resolution) {

    const url =
        resolvedAssetCache.get(image)?.[resolution] ||
        null;

    return isLiveImageBlobURL(url)
        ? url
        : null;

}


/* ------------------------------------------------------------------ */
/* Priority helpers                                                    */
/* ------------------------------------------------------------------ */

/*
 * Priority for a background load tied to an on-screen element (a
 * gallery slot). Returns `base` while the element is within the
 * viewport, rising toward base + 0.9 the further off-screen it is, and
 * base + 0.95 if the element isn't laid out at all (display:none from a
 * tag filter, etc). Pass this as a function -- the queue re-evaluates it
 * each time a slot frees up, so scrolling re-ranks the waiting images.
 */
function distanceFromViewportPriority(base, element) {

    if (!element)
        return base + 0.9;

    const rect =
        element.getBoundingClientRect();

    if (!rect.width && !rect.height)
        return base + 0.95;

    const viewportHeight =
        window.innerHeight;

    const distance =
        rect.bottom < 0
            ? -rect.bottom
            : rect.top > viewportHeight
                ? rect.top - viewportHeight
                : 0;

    return base +
        0.9 * distance / (distance + viewportHeight);

}


/* ------------------------------------------------------------------ */
/* Load queue                                                          */
/* ------------------------------------------------------------------ */

const imageLoadQueue =
    [];

let imageLoadsActive =
    0;

let imageLoadSequence =
    0;

let imageLoadQueuePeak =
    0;

/*
 * Queue diagnostics. Run getImageQueueStats() in the console after a
 * page load: a "peak" in the hundreds just means the gallery queued all
 * its thumbnails up front (fine -- the queue meters them out, nearest
 * the viewport first). It's "active" that must stay <= max.
 */
function getImageQueueStats() {

    return {
        queued: imageLoadQueue.length,
        active: imageLoadsActive,
        peakQueued: imageLoadQueuePeak,
        max: IMAGE_MAX_CONCURRENT
    };

}

window.getImageQueueStats =
    getImageQueueStats;


function resolveJobPriority(job) {

    if (typeof job.priority !== "function")
        return job.priority;

    try {

        const value =
            job.priority();

        return Number.isFinite(value)
            ? value
            : IMAGE_PRIORITY.thumb;

    } catch {

        return IMAGE_PRIORITY.thumb;

    }

}


function pumpImageLoadQueue() {

    // Nothing to do (and, importantly, no sorting/measuring work) while
    // every slot is busy -- this keeps queueing hundreds of images cheap.
    if (
        !imageLoadQueue.length ||
        imageLoadsActive >= IMAGE_MAX_CONCURRENT
    ) {

        return;

    }

    // Drop work whose gallery/modal was closed or replaced while waiting.
    const live =
        [];

    for (const job of imageLoadQueue) {

        if (job.isActive && !job.isActive())
            job.reject(new Error("Load was cancelled."));
        else
            live.push(job);

    }

    // Evaluate each job's (possibly dynamic) priority once, then sort.
    const keyed =
        live.map(job => ({
            job,
            key: resolveJobPriority(job)
        }));

    keyed.sort(
        (a, b) =>
            a.key - b.key ||
            a.job.sequence - b.job.sequence
    );

    imageLoadQueue.length =
        0;

    for (const entry of keyed)
        imageLoadQueue.push(entry.job);

    while (
        imageLoadsActive < IMAGE_MAX_CONCURRENT &&
        imageLoadQueue.length
    ) {

        const job =
            imageLoadQueue.shift();

        imageLoadsActive++;

        let released =
            false;

        job.resolve(() => {

            if (released)
                return;

            released = true;

            imageLoadsActive--;

            pumpImageLoadQueue();

        });

    }

}

/*
 * Resolves with a release() function once a slot is free.
 * `priority` is a number, or a function returning one (re-evaluated
 * every time the queue picks its next job).
 */
function acquireImageLoadSlot(priority, isActive) {

    return new Promise((resolve, reject) => {

        imageLoadQueue.push({
            priority,
            sequence: imageLoadSequence++,
            isActive,
            resolve,
            reject
        });

        if (imageLoadQueue.length > imageLoadQueuePeak)
            imageLoadQueuePeak = imageLoadQueue.length;

        pumpImageLoadQueue();

    });

}

function delay(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}


/* ------------------------------------------------------------------ */
/* Probing                                                             */
/* ------------------------------------------------------------------ */

/*
 * Waits for a queue slot, then tries to load exactly one candidate URL
 * via a throwaway <img>. Resolves with the URL itself on success (the
 * browser now has it in its own HTTP cache, so handing this same URL to
 * the real <img> a moment later is effectively instant) or rejects on
 * error/timeout. The timeout starts AFTER the slot is acquired.
 */
async function probeImageURL(url, timeoutMs, isActive, priority) {

    const release =
        await acquireImageLoadSlot(
            priority,
            isActive
        );

    try {

        return await new Promise((resolve, reject) => {

            if (isActive && !isActive()) {

                reject(new Error("Load was cancelled."));

                return;

            }

            const probe =
                new Image();

            let settled =
                false;

            function finish(callback) {

                if (settled)
                    return;

                settled = true;

                clearTimeout(timer);

                probe.onload = null;
                probe.onerror = null;

                callback();

            }

            const timer =
                setTimeout(() => {

                    finish(() => {

                        // Stop the download so it frees the connection.
                        probe.src = "";

                        reject(new Error("Timed out."));

                    });

                }, timeoutMs);

            probe.onload = () =>
                finish(() => resolve(url));

            probe.onerror = () =>
                finish(() => reject(new Error("Failed to load.")));

            probe.decoding =
                "async";

            probe.src =
                url;

        });

    } finally {

        release();

    }

}


/*
 * Download-to-blob support for sources whose delivery mode is
 * "download". The site never assumes a particular endpoint; it just
 * fetches the URL the map produced. Blobs are cached in memory with a
 * hard byte cap so a large gallery cannot grow the tab without bound.
 */
const DOWNLOADED_BLOB_LIMIT = 48;
const DOWNLOADED_BLOB_BYTES = 128 * 1024 * 1024;

const downloadedBlobs = new Map();
let downloadedBlobBytes = 0;

/*
 * Blob object URLs that are still valid. Resolved-URL caches can be
 * much longer-lived than the byte cache, so a blob may have been
 * evicted (and revoked) before an image is reopened. Callers use this
 * to ignore stale blob URLs instead of handing a dead src to an <img>.
 */
const liveImageBlobURLs = new Set();


function forgetDownloadedBlob(url) {

    const entry =
        downloadedBlobs.get(url);

    if (!entry)
        return;

    downloadedBlobs.delete(url);
    downloadedBlobBytes -= entry.bytes;

    liveImageBlobURLs.delete(entry.blobURL);

    URL.revokeObjectURL(entry.blobURL);

}


function isLiveImageBlobURL(url) {

    return (
        typeof url !== "string" ||
        !url.startsWith("blob:") ||
        liveImageBlobURLs.has(url)
    );

}


/*
 * Bounded in-memory store for aborted full-size downloads. When the
 * modal closes or navigates away mid-download, the bytes already read
 * are kept so the next open can request the remainder with a Range
 * request instead of starting over.
 *
 * Only useful partials are kept (at least 10% of the file or 256 KB),
 * and both the entry count and total byte size are capped.
 */
const partialImageDownloads = new Map();

const PARTIAL_IMAGE_LIMIT = 6;
const PARTIAL_IMAGE_MAX_BYTES = 96 * 1024 * 1024;
const PARTIAL_IMAGE_MIN_BYTES = 256 * 1024;
const PARTIAL_IMAGE_MIN_FRACTION = 0.10;

let partialImageBytes = 0;


function getPartialImageDownload(url) {

    if (!url)
        return null;

    const entry =
        partialImageDownloads.get(url);

    if (!entry)
        return null;

    /* Refresh LRU position. */
    partialImageDownloads.delete(url);
    partialImageDownloads.set(url, entry);

    return entry;

}


function forgetPartialImageDownload(url) {

    const entry =
        partialImageDownloads.get(url);

    if (!entry)
        return;

    partialImageDownloads.delete(url);
    partialImageBytes -= entry.bytes;

}


function trimPartialImageDownloads() {

    while (
        partialImageDownloads.size >
            PARTIAL_IMAGE_LIMIT ||
        partialImageBytes >
            PARTIAL_IMAGE_MAX_BYTES
    ) {

        const oldest =
            partialImageDownloads.keys().next().value;

        if (oldest === undefined)
            break;

        forgetPartialImageDownload(oldest);

    }

}


function savePartialImageDownload(url, state) {

    if (
        !url ||
        !state ||
        !state.bytes
    ) {
        return;
    }

    const total =
        Number(state.total) || 0;

    const minimum =
        total > 0
            ? Math.max(
                PARTIAL_IMAGE_MIN_BYTES,
                total * PARTIAL_IMAGE_MIN_FRACTION
            )
            : PARTIAL_IMAGE_MIN_BYTES * 8;

    if (state.bytes < minimum)
        return;

    /* A complete download is not a partial. */
    if (total > 0 && state.bytes >= total)
        return;

    forgetPartialImageDownload(url);

    const entry = {

        chunks:
            state.chunks || [],

        bytes:
            state.bytes,

        total,

        contentType:
            state.contentType ||
            "image/jpeg",

        etag:
            state.etag || "",

        lastModified:
            state.lastModified || "",

        updated:
            Date.now()

    };

    partialImageDownloads.set(url, entry);
    partialImageBytes += entry.bytes;

    trimPartialImageDownloads();

}

function getCachedImageBlobURL(url) {

    if (!url)
        return null;

    const entry =
        downloadedBlobs.get(url);

    if (!entry)
        return null;

    /* Refresh LRU position. */
    downloadedBlobs.delete(url);
    downloadedBlobs.set(url, entry);

    return entry.blobURL;

}


function rememberImageBlob(url, blob) {

    if (!url || !blob || !blob.size)
        return null;

    const existing =
        getCachedImageBlobURL(url);

    if (existing)
        return existing;

    const blobURL =
        URL.createObjectURL(blob);

    rememberDownloadedBlob(
        url,
        blobURL,
        blob.size
    );

    /*
     * rememberDownloadedBlob() may evict this entry immediately if a
     * single image is larger than the whole cache budget.
     */
    return downloadedBlobs.get(url)?.blobURL === blobURL
        ? blobURL
        : null;

}


/*
 * Reads an already-displayed image into the shared blob cache in the
 * background. The <img> that triggered this has just loaded the same
 * URL, so the fetch normally comes straight from the HTTP cache; the
 * point is to keep a reusable blob for the modal/viewer afterwards.
 */
const imageBlobPrefetches =
    new Map();


function prefetchImageBlob(url) {

    if (!url || url.startsWith("blob:"))
        return Promise.resolve(null);

    const cached =
        getCachedImageBlobURL(url);

    if (cached)
        return Promise.resolve(cached);

    const pending =
        imageBlobPrefetches.get(url);

    if (pending)
        return pending;

    const task =
        (async () => {

            try {

                const response =
                    await fetch(url);

                if (!response.ok)
                    return null;

                const blob =
                    await response.blob();

                return rememberImageBlob(
                    url,
                    blob
                );

            } catch {

                return null;

            } finally {

                imageBlobPrefetches.delete(url);

            }

        })();

    imageBlobPrefetches.set(url, task);

    return task;

}


function rememberDownloadedBlob(url, blobURL, bytes) {

    downloadedBlobs.set(url, { blobURL, bytes });
    downloadedBlobBytes += bytes;

    liveImageBlobURLs.add(blobURL);

    while (
        downloadedBlobs.size > DOWNLOADED_BLOB_LIMIT ||
        downloadedBlobBytes > DOWNLOADED_BLOB_BYTES
    ) {

        const oldest =
            downloadedBlobs.keys().next().value;

        if (oldest === undefined)
            break;

        forgetDownloadedBlob(oldest);

    }

}


async function downloadImageURL(
    url,
    maxBytes,
    timeoutMs,
    isActive,
    priority
) {

    if (url.startsWith("blob:"))
        return url;

    const cached =
        downloadedBlobs.get(url);

    if (cached) {

        /* Refresh LRU position. */
        downloadedBlobs.delete(url);
        downloadedBlobs.set(url, cached);

        return cached.blobURL;

    }

    const release =
        await acquireImageLoadSlot(
            priority,
            isActive
        );

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            timeoutMs
        );

    try {

        if (isActive && !isActive())
            return null;

        const response =
            await fetch(url, {
                signal: controller.signal
            });

        if (!response.ok)
            return null;

        const declared =
            Number(response.headers.get("content-length")) || 0;

        if (maxBytes > 0 && declared > maxBytes)
            return null;

        const reader =
            response.body?.getReader();

        if (!reader)
            return null;

        const chunks = [];
        let total = 0;

        for (;;) {

            const { done, value } =
                await reader.read();

            if (done)
                break;

            total += value.length;

            if (maxBytes > 0 && total > maxBytes) {

                controller.abort();
                return null;

            }

            chunks.push(value);

        }

        if (!total)
            return null;

        const type =
            response.headers.get("content-type") || "";

        const blob =
            new Blob(chunks, type ? { type } : undefined);

        const blobURL =
            URL.createObjectURL(blob);

        rememberDownloadedBlob(url, blobURL, total);

        return blobURL;

    } catch {

        return null;

    } finally {

        clearTimeout(timer);
        release();

    }

}


/*
 * Works through an ordered list of {url, providerName} candidates,
 * retrying each one a limited number of times (with a pause between
 * attempts) before moving on to the next. Returns the first URL that
 * actually loads, or null if every candidate is exhausted.
 */
async function resolveFirstWorkingCandidate(candidates, isActive, resolution, priority) {

    const timeoutMs =
        RESOLVED_URL_TIMEOUT_MS[resolution] ??
        RESOLVED_URL_TIMEOUT_MS.thumb;

    for (const candidate of candidates) {

        if (isActive && !isActive())
            return null;

        /*
         * A blob for this exact URL is already in the shared cache
         * (downloaded by the modal or an editor preview), so this is
         * ready to display without probing or queueing again.
         */
        const cachedBlob =
            getCachedImageBlobURL(candidate.url);

        if (cachedBlob)
            return cachedBlob;

        /*
         * Delivery "download": fetch the bytes once and hand back a
         * blob URL. This is for endpoints that need it (header auth,
         * no usable direct URL, transforms); direct stays the default.
         */
        if (candidate.delivery === "download") {

            const cap =
                getProviderDelivery(
                    candidate.providerName
                ).maxDownloadMB * 1024 * 1024;

            const blobURL =
                await downloadImageURL(
                    candidate.url,
                    cap,
                    timeoutMs,
                    isActive,
                    priority
                );

            if (blobURL)
                return blobURL;

            console.debug(
                "[IMAGE] Download candidate failed",
                {
                    provider: candidate.providerName,
                    url: candidate.url
                }
            );

            continue;

        }

        for (
            let attempt = 1;
            attempt <= RESOLVED_URL_ATTEMPTS_PER_CANDIDATE;
            attempt++
        ) {

            if (isActive && !isActive())
                return null;

            try {

                return await probeImageURL(
                    candidate.url,
                    timeoutMs,
                    isActive,
                    priority
                );

            } catch (error) {

                if (error?.message === "Load was cancelled.")
                    return null;

                console.debug(
                    "[IMAGE] Candidate failed",
                    {
                        provider: candidate.providerName,
                        url: candidate.url,
                        attempt,
                        errorMessage: error?.message
                    }
                );

                if (attempt < RESOLVED_URL_ATTEMPTS_PER_CANDIDATE) {

                    await delay(
                        RESOLVED_URL_RETRY_DELAY_MS * attempt
                    );

                }

            }

        }

    }

    return null;

}


/*
 * item.image is the raw album.images[n] entry (see
 * 00-config-and-state.js); item._album is the album it came from
 * (needed to look up album.sources). Both are set when the item is
 * created -- see createAlbumImageItems() in
 * 07-album-loading.js.
 *
 * options.priority (optional): a number, or a function returning one,
 * overriding the default for this size. See the priority scale at the
 * top of this file.
 */
/*
 * Modal-friendly variant of resolveImageAsset(): fetches the first
 * working candidate as a blob while reporting byte progress. This is
 * used only for the user-opened medium, so the centered loading bar can
 * show real progress instead of an indeterminate sweep. Falls back to
 * null if the fetch route fails (for example a non-CORS provider), in
 * which case the caller can still use the normal <img> probe path.
 */
async function resolveImageAssetBlobWithProgress(
    item,
    resolution,
    onProgress,
    isActive
) {

    if (!item?.image)
        return null;

    const album =
        item._album || currentAlbum;

    const candidates =
        getImageProviderCandidates(
            album,
            item.image,
            resolution
        );

    for (const candidate of candidates) {

        if (isActive && !isActive())
            return null;

        const cached =
            getCachedImageBlobURL(candidate.url);

        if (cached) {

            onProgress?.(1, 1);

            return cached;

        }

        const controller =
            new AbortController();

        if (typeof activeImageLoaders !== "undefined")
            activeImageLoaders.push(controller);

        const timeout =
            setTimeout(
                () => controller.abort(),
                120000
            );

        try {

            const response =
                await fetch(
                    candidate.url, {
                        signal:
                            controller.signal
                    }
                );

            if (!response.ok)
                continue;

            const total =
                Number(
                    response.headers.get(
                        "Content-Length"
                    )
                ) || 0;

            const reader =
                response.body?.getReader();

            if (!reader)
                continue;

            const chunks =
                [];

            let received =
                0;

            onProgress?.(0, total);

            for (;;) {

                const {
                    done,
                    value
                } = await reader.read();

                if (done)
                    break;

                chunks.push(value);
                received += value.length;

                if (isActive && !isActive()) {

                    controller.abort();

                    return null;

                }

                onProgress?.(received, total);

            }

            if (!received)
                continue;

            const blob =
                new Blob(
                    chunks,
                    {
                        type:
                            response.headers.get(
                                "Content-Type"
                            ) ||
                            "image/jpeg"
                    }
                );

            const blobURL =
                rememberImageBlob(
                    candidate.url,
                    blob
                );

            if (blobURL) {

                onProgress?.(received, received);

                return blobURL;

            }

        } catch (error) {

            if (error?.name === "AbortError")
                return null;

        } finally {

            clearTimeout(timeout);

            if (typeof activeImageLoaders !== "undefined") {

                const index =
                    activeImageLoaders.indexOf(
                        controller
                    );

                if (index !== -1) {

                    activeImageLoaders.splice(
                        index,
                        1
                    );

                }

            }

        }

    }

    return null;

}


async function resolveImageAsset(item, resolution, isActive, options) {
    if (!item?.image)
        return null;

    let cached =
        resolvedAssetCache.get(item.image);

    if (!cached) {

        cached = {};

        resolvedAssetCache.set(item.image, cached);

    }

    if (
        cached[resolution] &&
        isLiveImageBlobURL(
            cached[resolution]
        )
    ) {
        return cached[resolution];
    }

    if (cached[resolution])
        delete cached[resolution];

    const candidates =
        getImageProviderCandidates(
            item._album || currentAlbum,
            item.image,
            resolution
        );

    if (!candidates.length)
        return null;

    const priority =
        options?.priority ??
        IMAGE_PRIORITY[resolution] ??
        IMAGE_PRIORITY.thumb;

    const url =
        await resolveFirstWorkingCandidate(
            candidates,
            isActive,
            resolution,
            priority
        );

    if (!url)
        return null;

    if (isActive && !isActive())
        return null;

    cached[resolution] =
        url;

    return url;

}


/*
 * A quick, synchronous "best guess" URL for a size -- the first
 * declared candidate, no fallback probing and NO queueing. Used where a
 * full ordered-fallback resolution isn't warranted (home page covers,
 * search-result thumbnails, etc).
 *
 * Because these URLs are handed straight to <img src>, they bypass the
 * load queue above. Give those <img> elements loading="lazy" and
 * decoding="async" so the browser only requests the ones near the
 * viewport, or route them through resolveImageAsset() instead.
 */
function getBestGuessImageURL(album, imageEntry, sizeKey) {

    const candidates =
        getImageProviderCandidates(album, imageEntry, sizeKey);

    return candidates.length
        ? candidates[0].url
        : "";

}


/*
 * Convenience wrapper matching the shape the rest of the app expects
 * (getImageURLs() used to read straight off image.thumb.url etc) --
 * now backed by the provider-candidate system.
 */
function getImageURLs(image, album) {

    const activeAlbum =
        album || currentAlbum;

    const thumb =
        getBestGuessImageURL(activeAlbum, image, "thumb");

    const medium =
        getBestGuessImageURL(activeAlbum, image, "medium") || thumb;

    const full =
        getBestGuessImageURL(activeAlbum, image, "full") || medium;

    return { thumb, medium, full };

}
