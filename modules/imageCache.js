/**
 * Image Caching and Asset Resolution Module
 * Handles loading, caching, and resolving images from various sources
 */

const ImageCache = (() => {
    const imageAssetCache = new WeakMap();
    const imageResponseCacheName = "gallery-image-assets-v1";

    /**
     * Convert response to blob URL and cache it
     */
    async function blobURLFromResponse(response, assets, key) {
        if (!response || !response.ok)
            return null;
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        assets[key] = url;
        return url;
    }

    /**
     * Resolve a URL with caching support
     */
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
            response = await fetch(url, { cache: "force-cache" });
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

    /**
     * Get image URLs from various formats
     */
    function getImageURLs(image) {
        const thumb = image.thumb?.url || image.image?.url || image.medium?.url || "";
        const medium = image.medium?.url || image.image?.url || thumb;
        const full = image.image?.url || image.medium?.url || thumb;
        return { thumb, medium, full };
    }

    /**
     * Image source resolvers
     */
    const imageSources = {
        url: {
            resolve: async (image, resolution, isActive) =>
                resolveCachedURL(getImageURLs(image)[resolution], image, resolution, isActive)
        },
        telegram: {
            resolve: async (image, resolution, isActive) => {
                const key = resolution === "thumb" ? "thumb" : "full";
                let assets = imageAssetCache.get(image);
                if (!assets) {
                    assets = {};
                    imageAssetCache.set(image, assets);
                }
                if (assets[key])
                    return assets[key];

                const fileID = resolution === "thumb"
                    ? image.telegramThumbnailFileID
                    : image.telegramFileID;
                if (!fileID || !window.telegramClient)
                    return null;

                const cacheKey = `https://gallery-image.invalid/telegram/${encodeURIComponent(fileID)}/${key}`;
                try {
                    if (window.caches) {
                        const cache = await caches.open(imageResponseCacheName);
                        const cached = await cache.match(cacheKey);
                        if (cached)
                            return blobURLFromResponse(cached, assets, key);
                    }
                } catch { }

                const chunks = [];
                for await (const chunk of window.telegramClient.download(fileID, {
                    chunkSize: key === "thumb" ? 64 * 1024 : 256 * 1024
                })) {
                    if (isActive && !isActive())
                        return null;
                    chunks.push(chunk);
                }
                if (isActive && !isActive())
                    return null;

                const blob = new Blob(chunks, { type: image.mimeType || "image/jpeg" });
                const url = URL.createObjectURL(blob);
                assets[key] = url;

                try {
                    if (window.caches) {
                        const cache = await caches.open(imageResponseCacheName);
                        await cache.put(cacheKey, new Response(blob, {
                            headers: { "Content-Type": blob.type || "image/jpeg" }
                        }));
                    }
                } catch { }

                return url;
            }
        }
    };

    /**
     * Resolve an image asset from any source
     */
    async function resolveImageAsset(item, resolution, isActive) {
        if (!item?.image)
            return null;
        const source = imageSources[item.source] || imageSources.url;
        return source.resolve(item.image, resolution, isActive);
    }

    // Public API
    return {
        getImageURLs,
        resolveImageAsset,
        resolveCachedURL,
        imageSources
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageCache;
}
