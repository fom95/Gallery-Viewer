/*
 * 06-image-asset-sources.js
 *
 * The pluggable "image source" layer: resolves a thumb/medium/full URL
 * to an actual displayable asset, for either plain URLs (fetch + Cache
 * API) or Telegram file IDs (chunked download). This is the extension
 * point for adding new import sources later.
 */

const imageAssetCache = new WeakMap();

const imageResponseCacheName = "gallery-image-assets-v1";

const telegramDownloadFailures =
    new WeakMap();
	
const telegramFullCacheStateKey =
    "telegramFullImageCacheState-v1";

async function downloadTelegramRaw(fileID, options = {}) {

    if (
        !fileID ||
        !window.telegramClient
    ) {
        throw new Error(
            "Telegram client or file ID is unavailable."
        );
    }

    if (!window.__galleryMTKrutoModule) {

        window.__galleryMTKrutoModule =
            import(
                "https://esm.sh/@mtkruto/browser@0.217.0"
            );

    }

    const mtkruto =
        await window.__galleryMTKrutoModule;

    const decoded =
        mtkruto.deserializeFileId(fileID);

    if (
        !decoded ||
        !decoded.location
    ) {
        throw new Error(
            "Telegram file ID could not be decoded."
        );
    }

    let location;

    if (
        decoded.location.type === "common"
    ) {

        location = {

            _:
                "inputDocumentFileLocation",

            id:
                decoded.location.id,

            access_hash:
                decoded.location.accessHash,

            file_reference:
                decoded.fileReference ||
                new Uint8Array(),

            thumb_size:
                ""

        };

    }
    else if (
        decoded.location.type === "photo"
    ) {

        location = {

            _:
                "inputPhotoFileLocation",

            id:
                decoded.location.id,

            access_hash:
                decoded.location.accessHash,

            file_reference:
                decoded.fileReference ||
                new Uint8Array(),

            thumb_size:
                decoded.location.thumbSize ||
                decoded.location.thumb_size ||
                ""

        };

    }
    else {

        throw new Error(
            "Unsupported Telegram file location: " +
            decoded.location.type
        );

    }

    return downloadTelegramLocationRaw(
        location,
        options
    );
}

async function downloadTelegramLocationRaw(
    location,
    options = {}
) {

    if (
        !location ||
        !window.telegramClient
    ) {

        throw new Error(
            "Telegram client or file location is unavailable."
        );

    }

    const chunkSize =
        options.chunkSize ||
        256 * 1024;

    const limit =
        Math.max(
            1024,
            Math.floor(
                chunkSize / 1024
            ) * 1024
        );

    const chunks =
        [];

    let offset =
        0n;

    while (true) {

        const result =
            await window.telegramClient.invoke({

                _:
                    "upload.getFile",

                location,

                offset,

                limit

            });

        if (
            result?._ !== "upload.file"
        ) {

            throw new Error(
                "Telegram returned an unexpected file response."
            );

        }

        const bytes =
            result.bytes;

        if (
            !bytes ||
            !bytes.byteLength
        ) {

            break;

        }

        chunks.push(
            bytes
        );

        offset +=
            BigInt(
                bytes.byteLength
            );

        if (
            bytes.byteLength <
            limit
        ) {

            break;

        }

    }

    return chunks;
}

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

async function refreshTelegramThumbnailFileID(image) {

    if (
        !image ||
        !window.telegramClient ||
        image.telegramChatID == null ||
        image.messageID == null
    ) {

        return null;

    }

    const client =
        window.telegramClient;


    /*
     * MTKruto's normal getMessages() already works for this
     * channel. We therefore use its entity-aware input peer
     * and convert the resulting inputPeerChannel into the
     * inputChannel constructor required by channels.getMessages.
     */

    const inputChannel =
		await client.getInputChannel(
			image.telegramChatID
		);


    const result =
		await client.invoke({
			_: "channels.getMessages",
			channel: inputChannel,
			id: [
				{
					_: "inputMessageID",
					id: Number(image.messageID)
				}
			]
		});


    if (
        !result ||
        !Array.isArray(result.messages) ||
        !result.messages.length
    ) {

        throw new Error(
            "Telegram returned no message during thumbnail refresh."
        );

    }


    const rawMessage =
        result.messages.find(
            message =>
                message &&
                Number(
                    message.id
                ) ===
                Number(
                    image.messageID
                )
        );


    if (!rawMessage) {

        throw new Error(
            "Telegram did not return the requested message."
        );

    }


    /*
     * This album contains documents.
     */

    const rawDocument =
        rawMessage.media?._ ===
            "messageMediaDocument" &&
        rawMessage.media.document?._ ===
            "document"
            ? rawMessage.media.document
            : null;


    if (!rawDocument) {

        throw new Error(
            "Telegram message does not contain a raw document."
        );

    }


    /*
     * Telegram calls these "thumbs" in the raw document
     * structure. They are the actual generated thumbnails
     * belonging to the document.
     */

    const thumbs =
        Array.isArray(
            rawDocument.thumbs
        )
            ? rawDocument.thumbs
            : [];


    if (!thumbs.length) {

        throw new Error(
            "Telegram document contains no thumbnails."
        );

    }


    const usableThumbs =
        thumbs.filter(
            thumb =>
                thumb &&
                (
                    thumb._ ===
                        "photoSize" ||
                    thumb._ ===
                        "photoCachedSize"
                )
        );


    if (!usableThumbs.length) {

        throw new Error(
            "Telegram document contains no usable thumbnails."
        );

    }


    const smallest =
        usableThumbs
            .slice()
            .sort(
                (a, b) =>
                    (
                        (a.w || 0) *
                        (a.h || 0)
                    ) -
                    (
                        (b.w || 0) *
                        (b.h || 0)
                    )
            )[0];


    /*
     * photoCachedSize already contains the thumbnail bytes
     * in the Telegram response. There is nothing to download.
     */

    if (
        smallest._ ===
            "photoCachedSize"
    ) {

        if (
            smallest.bytes &&
            smallest.bytes.byteLength
        ) {

            return {

                type:
                    "cached",

                bytes:
                    smallest.bytes,

                width:
                    smallest.w,

                height:
                    smallest.h,

                thumbSize:
                    smallest.type ||
                    ""

            };

        }

    }


    /*
     * Normal photoSize thumbnails must be downloaded through
     * inputDocumentFileLocation.
     */

    if (
        !rawDocument.file_reference
    ) {

        throw new Error(
            "Telegram document has no current file reference."
        );

    }


    const location = {

        _:
            "inputDocumentFileLocation",

        id:
            rawDocument.id,

        access_hash:
            rawDocument.access_hash,

        file_reference:
            rawDocument.file_reference,

        thumb_size:
            smallest.type ||
            ""

    };


    return {

        type:
            "location",

        location,

        width:
            smallest.w,

        height:
            smallest.h,

        thumbSize:
            smallest.type ||
            ""

    };
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

            const fileID =
                resolution === "thumb"
                    ? image.telegramThumbnailFileID
                    : image.telegramFileID;

            if (
                !fileID ||
                !window.telegramClient
            ) {

                return null;

            }

            let failureState =
                telegramDownloadFailures.get(
                    image
                );

            if (!failureState) {

                failureState = {};

                telegramDownloadFailures.set(
                    image,
                    failureState
                );

            }

            if (
                failureState[key] &&
                failureState[key].fileID === fileID
            ) {

                return null;

            }

            /*
             * Telegram thumbnails have one persistent cache namespace.
             *
             * Telegram full images are persistent only for the current
             * album and the immediately previous album.
             */
            let cacheKey = null;
            let persistentFullCache = false;

            if (key === "thumb") {

                cacheKey =
                    `https://gallery-image.invalid/telegram/` +
                    `${encodeURIComponent(fileID)}/thumb`;

            }
            else {

                const albumID =
                    currentAlbum?.id;

                if (albumID) {

                    let state = null;

                    try {

                        const stored =
                            localStorage.getItem(
                                telegramFullCacheStateKey
                            );

                        if (stored)
                            state =
                                JSON.parse(stored);

                    }
                    catch (error) {

                        console.debug(
                            "[TELEGRAM CACHE] Failed to read full-cache state",
                            {
                                errorName:
                                    error?.name,

                                errorMessage:
                                    error?.message
                            }
                        );

                    }

                    const albumIDString =
                        String(albumID);

                    if (
                        state &&
                        (
                            String(state.current || "") ===
                                albumIDString ||
                            String(state.previous || "") ===
                                albumIDString
                        )
                    ) {

                        persistentFullCache = true;

                        cacheKey =
                            `https://gallery-image.invalid/telegram/full/` +
                            `${encodeURIComponent(albumIDString)}/` +
                            `${encodeURIComponent(fileID)}`;

                    }

                }

            }

            /*
             * Persistent cache lookup.
             */
            if (
                cacheKey &&
                (
                    key === "thumb" ||
                    persistentFullCache
                )
            ) {

                try {

                    if (window.caches) {

                        const cache =
                            await caches.open(
                                imageResponseCacheName
                            );

                        const cached =
                            await cache.match(
                                cacheKey
                            );

                        if (cached) {

                            return blobURLFromResponse(
                                cached,
                                assets,
                                key
                            );

                        }

                    }

                }
                catch (error) {

                    console.debug(
                        "[TELEGRAM CACHE] Cache lookup failed",
                        {
                            key,
                            fileID,
                            errorName:
                                error?.name,
                            errorMessage:
                                error?.message
                        }
                    );

                }

            }

            let chunks;

            try {

                if (key === "thumb") {

                    const refreshed =
                        await refreshTelegramThumbnailFileID(
                            image
                        );

                    if (
                        refreshed?.type ===
                        "cached"
                    ) {

                        chunks = [
                            refreshed.bytes
                        ];

                    }
                    else if (
                        refreshed?.type ===
                        "location"
                    ) {

                        chunks =
                            await downloadTelegramLocationRaw(
                                refreshed.location,
                                {
                                    chunkSize:
                                        64 * 1024
                                }
                            );

                    }
                    else {

                        throw new Error(
                            "Telegram thumbnail refresh returned no usable thumbnail."
                        );

                    }

                }
                else {

                    chunks =
                        await downloadTelegramRaw(
                            fileID,
                            {
                                chunkSize:
                                    256 * 1024
                            }
                        );

                }

            }
            catch (error) {

                console.debug(
                    "[TELEGRAM DOWNLOAD] Raw download failed",
                    {
                        key,
                        fileID,
                        messageID:
                            image.messageID,
                        errorName:
                            error?.name,
                        errorMessage:
                            error?.message,
                        error
                    }
                );

                failureState[key] = {
                    fileID,
                    error
                };

                return null;

            }

            if (
                isActive &&
                !isActive()
            ) {

                return null;

            }

            const totalBytes =
                chunks.reduce(
                    (total, chunk) =>
                        total +
                        chunk.byteLength,
                    0
                );

            if (!totalBytes) {

                failureState[key] = {
                    fileID,
                    error:
                        new Error(
                            "Telegram returned an empty file."
                        )
                };

                console.debug(
                    "[TELEGRAM DOWNLOAD] Empty file returned",
                    {
                        key,
                        fileID
                    }
                );

                return null;

            }

            delete failureState[key];

            const blob =
                new Blob(
                    chunks,
                    {
                        type:
                            image.mimeType ||
                            "image/jpeg"
                    }
                );

            /*
             * Temporary Telegram albums use the original full-size
             * download for their one-time XMP extraction.
             *
             * The Blob already contains the exact original bytes
             * that are about to be displayed, so this does not
             * perform another Telegram download.
             */
            if (
                key === "full" &&
                currentAlbum?.temporary &&
                !image._telegramXMPProcessed
            ) {

                try {

                    const buffer =
                        await blob.arrayBuffer();

                    const metadata =
                        await getTelegramXMPMetadata(
                            buffer
                        );

                    const tags =
                        [];

                    const seen =
                        new Set();

                    for (
                        const tag of
                        Array.isArray(
                            metadata?.xmptags?.subject
                        )
                            ? metadata.xmptags.subject
                            : []
                    ) {

                        if (
                            typeof tag !==
                            "string"
                        ) {

                            continue;

                        }

                        const clean =
                            tag.trim();

                        if (!clean) {
                            continue;
                        }

                        const normalized =
                            clean.toLowerCase();

                        if (
                            seen.has(
                                normalized
                            )
                        ) {

                            continue;

                        }

                        seen.add(
                            normalized
                        );

                        tags.push(
                            clean
                        );

                    }

                    image.tags =
						tags;

					updateTelegramImageTagsLive(
						image
					);

					image._telegramXMPProcessed =
						true;

					console.log(
						"[Telegram XMP]",
						image.messageID,
						image.fileName,
						image.tags
					);

                }
                catch (error) {

                    console.warn(
                        "Failed to parse XMP from Telegram message " +
                        image.messageID,
                        error
                    );

                }

            }

            const url =
                URL.createObjectURL(
                    blob
                );

            assets[key] =
                url;

            /*
             * Persist:
             *
             * - every Telegram thumbnail
             * - full images only for the current/previous albums
             */
            if (
                cacheKey &&
                (
                    key === "thumb" ||
                    persistentFullCache
                )
            ) {

                try {

                    if (window.caches) {

                        const cache =
                            await caches.open(
                                imageResponseCacheName
                            );

                        await cache.put(
                            cacheKey,
                            new Response(
                                blob,
                                {
                                    headers: {
                                        "Content-Type":
                                            blob.type ||
                                            "image/jpeg"
                                    }
                                }
                            )
                        );

                    }

                }
                catch (error) {

                    console.debug(
                        "[TELEGRAM CACHE] Cache store failed",
                        {
                            key,
                            fileID,
                            errorName:
                                error?.name,
                            errorMessage:
                                error?.message
                        }
                    );

                }

            }

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