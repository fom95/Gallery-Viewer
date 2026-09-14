/*
 * 06-image-asset-sources.js
 *
 * The pluggable "image source" layer: resolves a thumb/medium/full URL
 * to an actual displayable asset, for either plain URLs (fetch + Cache
 * API) or Telegram file IDs (chunked download). This is the extension
 * point for adding new import sources later.
 */

const TELEGRAM_MEDIA_SERVER =
    "https://private-http-test.onrender.com";
const imageAssetCache = new WeakMap();

const imageResponseCacheName = "gallery-image-assets-v1";

const telegramDownloadFailures =
    new WeakMap();
	
const telegramFullCacheStateKey =
    "telegramFullImageCacheState-v1";

async function blobURLFromResponse(response, assets, key) {
    if (!response || !response.ok)
        return null;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    assets[key] = url;
    return url;
}


async function resolveCachedURL(url, image, resolution, isActive) {
    if (!url)
        return null;

    let assets = imageAssetCache.get(image);
    if (!assets) {
        assets = {};
        imageAssetCache.set(image, assets);
    }
    if (assets[resolution])
        return assets[resolution];

    const cacheKey = `https://gallery-image.invalid/url/${resolution}/${encodeURIComponent(url)}`;
    let cache = null;

    try {
        if (window.caches) {
            cache = await caches.open(imageResponseCacheName);
            const cached = await cache.match(cacheKey);
            if (cached)
                return blobURLFromResponse(cached, assets, resolution);
        }
    } catch (error) {
        console.debug("[IMAGE CACHE] Cache lookup failed", {
            resolution,
            url,
            error
        });
    }

    let response;
    try {
        response = await fetch(url, {cache: "force-cache"});
    } catch (error) {
        console.debug("[IMAGE FETCH] Fetch failed", {
            resolution,
            url,
            errorName: error?.name,
            errorMessage: error?.message
        });
        return null;
    }

    if (isActive && !isActive())
        return null;

    if (!response.ok) {
        console.debug("[IMAGE FETCH] Server returned an error", {
            resolution,
            url,
            status: response.status,
            statusText: response.statusText
        });
        return null;
    }

    try {
        if (cache)
            await cache.put(cacheKey, response.clone());
    } catch (error) {
        console.debug("[IMAGE CACHE] Cache store failed", {
            resolution,
            url,
            error
        });
    }

    try {
        return await blobURLFromResponse(response, assets, resolution);
    } catch (error) {
        console.debug("[IMAGE FETCH] Response-to-Blob failed", {
            resolution,
            url,
            errorName: error?.name,
            errorMessage: error?.message
        });
        return null;
    }
}

const imageSources = {
    url: {
        resolve: async (image, resolution, isActive) =>
            resolveCachedURL(
                getImageURLs(image)[resolution],
                image,
                resolution,
                isActive
            )
    },

    telegram: {
		resolve: async (
			image,
			resolution,
			isActive
		) => {

			const key =
				resolution === "thumb"
					? "thumb"
					: "full";

			let assets =
				imageAssetCache.get(image);

			if (!assets) {

				assets = {};

				imageAssetCache.set(
					image,
					assets
				);

			}

			if (assets[key])
				return assets[key];

			const url =
				getTelegramMediaURL(
					image,
					resolution
				);

			if (!url)
				return null;

			if (
				isActive &&
				!isActive()
			) {
				return null;
			}

			assets[key] =
				url;

			return url;
		}
	}
};

async function resolveImageAsset(item, resolution, isActive) {
    if (!item?.image)
        return null;
    const source = imageSources[item.source] || imageSources.url;
    return source.resolve(item.image, resolution, isActive);
}


function openTemporaryAlbumFromURL(url) {

    if (!url)
        return;

    const query =
        getAlbumQuery(
            url.trim()
        );

    if (!query) {

        alert("No album query was found in that URL.");

        return;

    }

    const album =
        createQueryAlbum(query);

    const id =
        generateAlbumID(album.name);

    album.id =
        id;

    album.temporary =
        true;

    currentTemporaryAlbumID =
        id;

    saveTemporaryAlbum(album);

    history.pushState(
        null,
        "",
        "?=" +
        encodeURIComponent(id)
    );

    loadAlbum(album, false);

    showAlbumButtons(true);

}

async function updateTelegramFullCacheAlbums(albumID) {

    if (!albumID)
        return;

    let state = {
        current: null,
        previous: null
    };

    try {

        const stored =
            localStorage.getItem(
                telegramFullCacheStateKey
            );

        if (stored) {

            const parsed =
                JSON.parse(stored);

            if (parsed && typeof parsed === "object") {

                state.current =
                    parsed.current || null;

                state.previous =
                    parsed.previous || null;

            }

        }

    } catch (error) {

        console.debug(
            "[TELEGRAM CACHE] Failed to read full-cache state",
            {
                errorName: error?.name,
                errorMessage: error?.message
            }
        );

    }

    const newAlbumID =
        String(albumID);

    const oldCurrent =
        state.current
            ? String(state.current)
            : null;

    /*
     * Opening the album that is already current does not
     * change the current/previous ordering.
     */
    if (oldCurrent !== newAlbumID) {

        state.previous =
            oldCurrent;

        state.current =
            newAlbumID;

    }

    /*
     * Do not keep a duplicate current album as the previous album.
     */
    if (
        state.previous &&
        String(state.previous) ===
            String(state.current)
    ) {

        state.previous =
            null;

    }

    try {

        localStorage.setItem(
            telegramFullCacheStateKey,
            JSON.stringify({
                current: state.current,
                previous: state.previous
            })
        );

    } catch (error) {

        console.debug(
            "[TELEGRAM CACHE] Failed to save full-cache state",
            {
                errorName: error?.name,
                errorMessage: error?.message
            }
        );

    }

    /*
     * Nothing further can be done if Cache Storage isn't available.
     */
    if (!window.caches)
        return;

    const retainedAlbums =
        new Set();

    if (state.current)
        retainedAlbums.add(
            String(state.current)
        );

    if (state.previous)
        retainedAlbums.add(
            String(state.previous)
        );

    try {

        const cache =
            await caches.open(
                imageResponseCacheName
            );

        const requests =
            await cache.keys();

        let deletedCount = 0;

        for (const request of requests) {

            const url =
                new URL(request.url);

            /*
             * Full Telegram cache entries have this form:
             *
             * /telegram/full/<albumID>/<fileID>
             *
             * Thumbnail entries use a different path and are
             * intentionally left completely untouched.
             */
            const parts =
                url.pathname
                    .split("/")
                    .filter(Boolean);

            if (
                parts.length < 4 ||
                parts[0] !== "telegram" ||
                parts[1] !== "full"
            ) {

                continue;

            }

            let cachedAlbumID;

            try {

                cachedAlbumID =
                    decodeURIComponent(
                        parts[2]
                    );

            } catch {

                cachedAlbumID =
                    parts[2];

            }

            if (
                !retainedAlbums.has(
                    String(cachedAlbumID)
                )
            ) {

                try {

                    if (
                        await cache.delete(
                            request
                        )
                    ) {

                        deletedCount++;

                    }

                } catch (error) {

                    console.debug(
                        "[TELEGRAM CACHE] Failed to delete old full image",
                        {
                            url: request.url,
                            errorName: error?.name,
                            errorMessage: error?.message
                        }
                    );

                }

            }

        }

        console.debug(
            "[TELEGRAM CACHE] Full-image album retention updated",
            {
                currentAlbum:
                    state.current,
                previousAlbum:
                    state.previous,
                deletedEntries:
                    deletedCount
            }
        );

    } catch (error) {

        console.debug(
            "[TELEGRAM CACHE] Failed to update full-image retention",
            {
                errorName: error?.name,
                errorMessage: error?.message
            }
        );

    }

}

function getTelegramMediaURL(image, resolution) {

    if (
        !image ||
        image.telegramChatID == null ||
        image.messageID == null
    ) {
        return null;
    }

    const base =
        `${TELEGRAM_MEDIA_SERVER}/media/` +
        `${encodeURIComponent(image.telegramChatID)}/` +
        `${encodeURIComponent(image.messageID)}`;

    return resolution === "thumb"
        ? `${base}?thumb=1`
        : base;
}