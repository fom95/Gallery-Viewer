/*
 * 06-image-asset-sources.js
 *
 * Resolves an image + size ("thumb"/"medium"/"full") to an actual
 * displayable URL, by trying each of that image's declared source
 * candidates in order (see getImageProviderCandidates() in
 * 00b-config-and-providers.js) until one actually loads.
 *
 * Every provider -- imgbb, Telegram (now served through your
 * Cloudflare Worker as plain HTTP), or anything else declared in the
 * user's config -- is just a URL from here on. There's no more raw
 * MTProto downloading in the browser for image bytes, and no need for
 * this app's own manual response cache: every candidate is a normal,
 * cacheable HTTP(S) URL, so the browser's native HTTP cache already
 * gives repeat visits the same instant-load behavior for every source
 * uniformly.
 */

const RESOLVED_URL_ATTEMPTS_PER_CANDIDATE =
    2;

const RESOLVED_URL_TIMEOUT_MS =
    15000;

const resolvedAssetCache =
    new WeakMap();


/*
 * Tries to load exactly one candidate URL via a throwaway <img>,
 * resolving with the URL itself on success (the browser now has it in
 * its own HTTP cache, so handing this same URL to the real <img> a
 * moment later is effectively instant) or rejecting on error/timeout.
 */
function probeImageURL(url, timeoutMs, isActive) {

    return new Promise((resolve, reject) => {

        if (isActive && !isActive()) {

            reject(new Error("Load was cancelled."));

            return;

        }

        const probe =
            new Image();

        let settled =
            false;

        const timer =
            setTimeout(() => {

                if (settled)
                    return;

                settled = true;

                probe.src = "";

                reject(new Error("Timed out."));

            }, timeoutMs);

        probe.onload = () => {

            if (settled)
                return;

            settled = true;

            clearTimeout(timer);

            resolve(url);

        };

        probe.onerror = () => {

            if (settled)
                return;

            settled = true;

            clearTimeout(timer);

            reject(new Error("Failed to load."));

        };

        probe.src =
            url;

    });

}


/*
 * Works through an ordered list of {url, providerName} candidates,
 * retrying each one a limited number of times before moving on to the
 * next. Returns the first URL that actually loads, or null if every
 * candidate is exhausted.
 */
async function resolveFirstWorkingCandidate(candidates, isActive) {

    for (const candidate of candidates) {

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
                    RESOLVED_URL_TIMEOUT_MS,
                    isActive
                );

            } catch (error) {

                console.debug(
                    "[IMAGE] Candidate failed",
                    {
                        provider: candidate.providerName,
                        url: candidate.url,
                        attempt,
                        errorMessage: error?.message
                    }
                );

            }

        }

    }

    return null;

}


/*
 * item.image is the raw album.images[n] entry (see
 * 00b-config-and-providers.js); item._album is the album it came from
 * (needed to look up album.sources). Both are set when the item is
 * created -- see createAlbumImageItems() in
 * 05-album-loading-and-render.js.
 */
async function resolveImageAsset(item, resolution, isActive) {

    if (!item?.image)
        return null;

    let cached =
        resolvedAssetCache.get(item.image);

    if (!cached) {

        cached = {};

        resolvedAssetCache.set(item.image, cached);

    }

    if (cached[resolution])
        return cached[resolution];

    const candidates =
        getImageProviderCandidates(
            item._album || currentAlbum,
            item.image,
            resolution
        );

    if (!candidates.length)
        return null;

    const url =
        await resolveFirstWorkingCandidate(candidates, isActive);

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
 * declared candidate, no fallback probing. Used where a full
 * ordered-fallback resolution isn't warranted (home page covers,
 * search-result thumbnails, etc); the main gallery/modal pipeline
 * uses resolveImageAsset() above for real reliability.
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
