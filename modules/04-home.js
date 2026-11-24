/*
 * 04-home.js
 *
 * Renders the home grid of albums, refreshes the "My Albums" list from
 * localStorage, and builds each album's tag summary.
 */

/*
 * Covers are chosen once per album per page load, then cached here by
 * album id. This is a plain in-memory cache (not persisted), so it
 * naturally resets on refresh but survives repeated showAlbums() calls
 * -- including the ones that rebuild "storage" album objects from
 * localStorage -- for the rest of the session. For Telegram albums
 * this holds the (still-pending-or-resolved) cover promise; for
 * everything else it holds the chosen image entry directly.
 */
const homeCoverCache = new Map();


/*
 * The home page renders before Telegram connects (startup is lazy), so
 * each Telegram card's <img> is remembered here. Albums whose URL
 * already knows its cover/messages get their cover immediately; the
 * rest are filled in if/when the background session restore succeeds.
 */
const homeCoverImages = new Map();

let homeRenderToken = 0;


/*
 * True when loadTelegramAlbumCover() can pick a message and build the
 * Worker URL from the album URL alone (an explicit cover, a cached
 * metadata cover, or a "?messages=" list). In that case the cover does
 * not depend on a live Telegram connection and can load right away.
 */
function canResolveTelegramCoverWithoutClient(album) {

    if (
        !album ||
        typeof parseTelegramAlbumUrl !== "function"
    ) {

        return false;

    }

    try {

        const parsed =
            parseTelegramAlbumUrl(album.url);

        if (!parsed)
            return false;

        return (
            !!parsed.cover ||
            album._telegramCoverMessageID != null ||
            (
                Array.isArray(parsed.messages) &&
                parsed.messages.length > 0
            )
        );

    } catch {

        return false;

    }

}


function enhanceHomeCoverVideo(album, img, options = {}) {

    if (!img || !img.isConnected || typeof fetchVideoBlobURL !== "function")
        return;

    const coverWrap =
        img?.parentElement;

    if (
        !coverWrap ||
        !coverWrap.classList.contains("album-cover") ||
        coverWrap.querySelector(".video-preview")
    ) {
        return;
    }

    let image =
        options.image || null;

    if (!image && options.messageID != null) {

        const images =
            album._imagesArray || buildImagesArray(album);

        image =
            images.find(entry => {

                const source =
                    entry?.[0];

                if (!source)
                    return false;

                return [
                    source.full?.key2,
                    source.medium?.key2,
                    source.thumb?.key2,
                    ...(Array.isArray(entry.parts) ? entry.parts : [])
                ].some(id =>
                    id != null &&
                    String(id) === String(options.messageID)
                );

            }) || null;

    }

    if (!image || !image.video)
        return;

    const badge =
        document.createElement("div");

    badge.className = "video-badge";
    badge.textContent = "▶";

    const video =
        document.createElement("video");

    video.className = "video-preview";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "none";

    video.addEventListener("playing", () => {
        video.classList.add("playing");
    });

    video.addEventListener("pause", () => {
        video.classList.remove("playing");
    });

    coverWrap.append(badge, video);

    let previewPromise = null;

    const ensurePreview = () => {

        if (!previewPromise) {

            previewPromise =
                fetchVideoBlobURL(album, image, "medium")
                    .catch(() => null);

        }

        return previewPromise;

    };

    coverWrap.addEventListener("mouseenter", async () => {

        const src =
            await ensurePreview();

        if (!src) {

            /* No preview available: keep the still cover, drop the badge. */
            badge.remove();
            video.remove();
            return;

        }

        if (video.src !== src)
            video.src = src;

        const played =
            video.play();

        if (played && played.catch)
            played.catch(() => {});

    });

    coverWrap.addEventListener("mouseleave", () => {
        video.pause();
    });

}


/*
 * Starts (or reuses) the cover fetch for one Telegram album and puts the
 * result into its home-page <img>. Safe to call again after the
 * background session restore.
 */
function applyTelegramCoverToImage(album, img) {

    if (!album || !img)
        return;

    let coverPromise =
        homeCoverCache.get(album.id);

    /*
     * The cache is also used for plain cover image objects on
     * non-Telegram renders. If an album just became a live Telegram
     * album (or stopped being one), replace that entry with a real
     * cover promise instead of calling .then() on an image object.
     */
    if (typeof coverPromise?.then !== "function") {

        homeCoverCache.delete(album.id);

        coverPromise =
            loadTelegramAlbumCover(album);

        homeCoverCache.set(
            album.id,
            coverPromise
        );

    }

    album._telegramCoverPromise =
        coverPromise;

    album._telegramCoverPromise
        .then(
            result => {

                if (!result || !result.url)
                    return;

                img.src =
                    result.url;

                img.style.visibility =
                    "visible";

                enhanceHomeCoverVideo(
                    album,
                    img,
                    { messageID: result.messageID }
                );

            }
        )
        .catch(
            error => {

                /*
                 * Do not keep a failed promise forever, or the next
                 * showAlbums() would reuse it and never retry.
                 */
                homeCoverCache.delete(album.id);

                console.error(
                    "[TELEGRAM COVER FAILED]",
                    error
                );

            }
        );

}


function loadHomeTelegramCovers(token) {

    if (token !== homeRenderToken)
        return;

    albums.forEach(
        album => {

            if (!usesLiveTelegram(album))
                return;

            const img =
                homeCoverImages.get(album.id);

            if (img)
                applyTelegramCoverToImage(album, img);

        }
    );

}


/*
 * Restores a saved Telegram session WITHOUT prompting, then fills in
 * the Telegram covers. Runs after the home page is already visible, so
 * a slow connection never delays the grid.
 */
async function restoreHomeTelegramCovers(token) {

    if (window.telegramClient) {

        loadHomeTelegramCovers(token);

        return;

    }

    const needsTelegram =
        albums.some(
            album => usesLiveTelegram(album)
        );

    if (!needsTelegram)
        return;

    try {

        await initTelegramFromConfig({
            silent: true,
            allowLogin: false
        });

    } catch {

        return;

    }

    if (!window.telegramClient)
        return;

    loadHomeTelegramCovers(token);

}


/*
 * Home covers are cached by album id, but the album objects themselves
 * are re-created whenever the album list or the saved copies refresh.
 * Matching by object identity alone then fails (and a stale entry can
 * even point at a different provider layout), so resolve the cached
 * cover back to the current album's own image object using stable keys.
 */
function findImageIndexByStableKey(images, image) {

    if (!Array.isArray(images) || !images.length || !image)
        return -1;

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


function resolveHomeCoverImage(album, images) {

    if (
        !album ||
        !Array.isArray(images) ||
        !images.length
    ) {
        return null;
    }

    const cached =
        homeCoverCache.get(album.id);

    let index =
        cached && !(cached instanceof Promise)
            ? findImageIndexByStableKey(images, cached)
            : -1;

    /*
     * Prefer the index the home render already settled on, then fall
     * back to a random cover only when there is nothing to preserve.
     */
    if (
        index === -1 &&
        Number.isInteger(album._homeCoverIndex) &&
        album._homeCoverIndex >= 0 &&
        album._homeCoverIndex < images.length
    ) {
        index = album._homeCoverIndex;
    }

    if (index === -1) {

        index =
            Math.floor(
                Math.random() * images.length
            );

    }

    const cover =
        images[index];

    /*
     * Store the current album's object, so the transition can find it
     * with indexOf() and every render uses a live provider layout.
     */
    homeCoverCache.set(
        album.id,
        cover
    );

    album._homeCoverIndex =
        index;

    return cover;

}


async function showAlbums() {

    if (typeof resetModalFullResolutionPreference === "function")
        resetModalFullResolutionPreference();

    /*
     * Leaving an album while its inline editor is open must clear the
     * editing chrome, otherwise the title input, X back button and the
     * body editing class follow the user to the home page.
     */
    if (
        typeof albumEditSession !== "undefined" &&
        albumEditSession &&
        typeof exitAlbumEditMode === "function"
    ) {
        exitAlbumEditMode({ reload: false });
    }

    /*
     * The album page's "edit name" button is injected directly into
     * #navCont by addAlbumPageEditButton() and isn't torn down when
     * navigating away from an album, so it has to be removed here
     * explicitly or it lingers on the home page.
     */
    const editNameButton =
        document.getElementById("EditNameButton");

    if (editNameButton)
        editNameButton.remove();

    document.getElementById("regenerateAlbum").style.display =
        "none";

    const manifestButton =
        document.getElementById("generateManifest");

    if (manifestButton)
        manifestButton.style.display = "none";

    document.getElementById("tagBar").style.display =
        "none";

    document.getElementById("tagToggle").style.display =
        "none";

    document.getElementById("imageSizeControls").style.display =
        "none";

    document.getElementById("settingsButton").style.display =
        "";

    if (typeof showingSearchResults !== "undefined")
        showingSearchResults = false;

    const searchResultsTags =
        document.getElementById("searchResultsTags");

    if (searchResultsTags)
        searchResultsTags.style.display = "none";

    document.getElementById("pageName").textContent =
        "ImgBB Galleries";

    document.title =
        "Gallery Viewer";

    const currentQuery =
        window.location.search;

    if (
        !currentQuery.startsWith("?@")
    ) {

        history.replaceState(
            null,
            "",
            window.location.pathname
        );

    }

    isQueryAlbum =
        false;

    currentAlbum =
        null;

    stopThumbnailLoading();

    thumbnailItems =
        [];

    thumbnailQueue =
        [];

    if (!albums.length) {

        await reloadAlbums();

    }
    else {

        await refreshSavedAlbums();

    }

    document.getElementById("backButton").style.display =
        "none";

    document.getElementById("tagToggle").style.display =
        "none";

    document.getElementById("imageSizeControls").style.display =
        "none";

    document.getElementById("saveButton").style.display =
        "none";

    const gallery =
        document.getElementById("gallery");

    gallery.innerHTML =
        "";

    const renderToken =
        ++homeRenderToken;

    homeCoverImages.clear();

    albums.forEach(
        album => {

            /*
             * Only albums that still need live Telegram contact get the
             * Telegram cover handling; metadata-backed ones behave like
             * any other provider album.
             */
            const isTelegram =
                usesLiveTelegram(album);

            const images =
                buildImagesArray(album);

            let cover =
                null;

            if (
                !isTelegram &&
                images.length
            ) {

                cover =
                    resolveHomeCoverImage(
                        album,
                        images
                    );

            }

            const card =
                document.createElement("div");

            card.className =
                "album";

            if (
                album.localEdited ||
                album.savedEdited
            ) {

                card.classList.add(
                    "album-local-edited"
                );

            }

            card.dataset.albumId =
                String(album.id);

            const img =
                document.createElement("img");

			img.alt = "";
            img.decoding = "async";
            img.style.visibility = "hidden";

            const title =
                document.createElement("div");

            title.className =
                "album-title";

            title.textContent =
                album.name;

            const coverWrap =
                document.createElement("div");

            coverWrap.className =
                "album-cover";

            if (typeof createMediaLoadingPlaceholder === "function")
                coverWrap.appendChild(createMediaLoadingPlaceholder());

            coverWrap.appendChild(img);

            /*
             * A live Telegram cover can take a while (or never arrive if
             * the client stays disconnected). Stop the shimmer after a
             * reasonable wait so it becomes a quiet neutral tile rather
             * than animating forever. A later successful load still hides
             * it through the normal load listener.
             */
            setTimeout(() => {

                if (!coverWrap.isConnected)
                    return;

                const placeholder =
                    coverWrap.querySelector(
                        ".media-loading-placeholder"
                    );

                if (
                    placeholder &&
                    !placeholder.classList.contains(
                        "hidden"
                    )
                ) {
                    placeholder.classList.add(
                        "failed"
                    );
                }

            }, 12000);

            img.addEventListener(
                "load",
                () => {

                    img.style.visibility =
                        "visible";

                    if (typeof setMediaLoadingPlaceholder === "function")
                        setMediaLoadingPlaceholder(
                            coverWrap,
                            false
                        );

                    /*
                     * Keep the bytes in the shared blob cache so the
                     * album grid (and the modal) can reuse the exact
                     * same image instead of requesting it again.
                     */
                    if (
                        typeof prefetchImageBlob === "function" &&
                        img.src &&
                        !img.src.startsWith("blob:")
                    ) {
                        prefetchImageBlob(
                            img.currentSrc || img.src
                        );
                    }

                }
            );

            img.addEventListener(
                "error",
                () => {

                    img.style.visibility =
                        "hidden";

                    if (typeof setMediaLoadingPlaceholder === "function")
                        setMediaLoadingPlaceholder(
                            coverWrap,
                            true,
                            true
                        );

                }
            );

            if (
                !isTelegram &&
                cover
            ) {

                const coverURL =
                    getBestGuessImageURL(
                        album,
                        cover,
                        "medium"
                    ) ||
                    getBestGuessImageURL(
                        album,
                        cover,
                        "thumb"
                    );

                if (coverURL) {

                    /*
                     * If the album grid (or a previous home render)
                     * already downloaded these bytes, point at that
                     * same live blob instead of the remote URL.
                     */
                    const cachedBlob =
                        typeof getCachedImageBlobURL === "function"
                            ? getCachedImageBlobURL(coverURL)
                            : null;

                    img.src =
                        cachedBlob || coverURL;

                }

            } else if (!isTelegram) {

                if (typeof setMediaLoadingPlaceholder === "function")
                    setMediaLoadingPlaceholder(
                        coverWrap,
                        true,
                        true
                    );

            }

            if (
                isTelegram
            ) {

                img.style.visibility =
                    "hidden";

            }

            if (
                album.localEdited ||
                album.savedEdited
            ) {

                const localBadge =
                    document.createElement("span");

                localBadge.className =
                    "album-local-badge";

                localBadge.textContent =
                    "✎";

                localBadge.title =
                    "Edited in this browser — local edits only";

                coverWrap.appendChild(
                    localBadge
                );

            }

            card.appendChild(coverWrap);

            card.appendChild(title);

            if (
                !isTelegram &&
                cover
            ) {

                enhanceHomeCoverVideo(
                    album,
                    img,
                    { image: cover }
                );

            }

            card.onclick =
                () => openAlbumWithTransition(album, img);

            const hasLocalEdits =
                album.localEdited === true ||
                album.savedEdited === true;

            /*
             * "Remove local edits" wins over "Remove saved album" so
             * the two buttons never render together. On a saved album
             * the edit button goes away once the edits are reverted,
             * leaving the normal remove-saved button behind.
             */
            if (hasLocalEdits) {

                const revertBtn =
                    document.createElement("button");

                revertBtn.className =
                    "album-delete album-delete-local";

                revertBtn.textContent =
                    "↺";

                revertBtn.title =
                    "Remove local edits";

                revertBtn.onclick =
                    async (e) => {

                        e.stopPropagation();

                        if (
                            !window.confirm(
                                "Remove all local edits from \"" +
                                (album.name || "this album") +
                                "\"? This cannot be undone."
                            )
                        ) {
                            return;
                        }

                        let reverted =
                            false;

                        if (
                            album.storage &&
                            typeof revertSavedAlbumEdits ===
                                "function"
                        ) {

                            reverted =
                                await revertSavedAlbumEdits(
                                    album.id
                                );

                        }

                        if (
                            !reverted &&
                            typeof deleteAlbumLocalEdit ===
                                "function"
                        ) {
                            deleteAlbumLocalEdit(
                                album.id
                            );
                        }

                        if (
                            typeof deletePublishedAlbumEditBase ===
                                "function"
                        ) {
                            deletePublishedAlbumEditBase(
                                album.id
                            );
                        }

                        if (
                            typeof deleteSavedAlbumEditBase ===
                                "function"
                        ) {
                            deleteSavedAlbumEditBase(
                                album.id
                            );
                        }

                        if (
                            typeof deletePublishedAlbumEditBase ===
                                "function"
                        ) {
                            deletePublishedAlbumEditBase(
                                album.id
                            );
                        }

                        await reloadAlbums();

                        showAlbums();

                    };

                coverWrap.appendChild(
                    revertBtn
                );

            } else if (
                album.storage
            ) {

                const deleteBtn =
                    document.createElement("button");

                deleteBtn.className =
                    "album-delete";

                deleteBtn.textContent =
                    "×";

                deleteBtn.title =
                    "Remove saved album";

                deleteBtn.onclick =
                    async (e) => {

                        e.stopPropagation();

                        if (
                            !window.confirm(
                                "Remove saved album \"" +
                                (album.name || "this album") +
                                "\" from this browser? " +
                                "This cannot be undone."
                            )
                        ) {
                            return;
                        }

                        const saved =
                            await getSavedAlbums();

                        const filtered =
                            saved.filter(
                                savedAlbum =>
                                    savedAlbum.id !==
                                    album.id
                            );

                        await setSavedAlbums(filtered);

                        if (
                            typeof deleteAlbumLocalEdit ===
                            "function"
                        ) {
                            deleteAlbumLocalEdit(
                                album.id
                            );
                        }

                        if (
                            typeof deleteSavedAlbumEditBase ===
                            "function"
                        ) {
                            deleteSavedAlbumEditBase(
                                album.id
                            );
                        }

                        await reloadAlbums();

                        showAlbums();

                    };

                coverWrap.appendChild(
					deleteBtn
				);

            }

            gallery.appendChild(
                card
            );

            if (isTelegram) {

                homeCoverImages.set(
                    album.id,
                    img
                );

                /*
                 * Most saved Telegram album URLs still carry their
                 * "?messages=" list, so the cover URL can be built
                 * without contacting Telegram at all. That means the
                 * cover appears immediately on refresh instead of
                 * waiting for the background session restore.
                 */
                if (
                    window.telegramClient ||
                    canResolveTelegramCoverWithoutClient(album)
                ) {

                    applyTelegramCoverToImage(
                        album,
                        img
                    );

                }

            }

        }
    );

    const addCard =
        document.createElement("div");

    addCard.className =
        "album album-add";

    const addImage =
        document.createElement("div");

    addImage.className =
        "album-add-image";

    addImage.textContent =
        "+";

    const addTitle =
        document.createElement("div");

    addTitle.className =
        "album-title";

    addTitle.textContent =
        "Add New";

    addCard.appendChild(
        addImage
    );

    addCard.appendChild(
        addTitle
    );

    addCard.onclick =
        () => {

            openAlbumInput();

        };

    gallery.appendChild(
        addCard
    );

    applyGalleryLayout(
        false
    );

    revealPageIfNeeded();

    /*
     * Deliberately not awaited: the grid is already on screen. If a
     * saved session exists, this connects in the background and then
     * fills in the Telegram covers. If not, it bails without prompting.
     */
    restoreHomeTelegramCovers(
        renderToken
    );

}


async function refreshSavedAlbums() {

    const saved =
        await getSavedAlbums();

    const savedBases =
        typeof getSavedAlbumEditBases === "function"
            ? await getSavedAlbumEditBases()
            : {};

    const savedIds =
        new Set(
            saved.map(album => album.id)
        );

    /*
     * Remove old saved entries before re-adding fresh ones, and drop
     * any remote album that shares an id with a saved local copy. The
     * saved copy wins, so editing a saved album never leaves two
     * cards for the same album on screen.
     */
    for (
        let i = albums.length - 1;
        i >= 0;
        i--
    ) {

        if (
            albums[i].storage ||
            savedIds.has(albums[i].id)
        ) {

            albums.splice(
                i,
                1
            );

        }

    }

    saved.forEach(
        album => {

            const savedAlbum = {

                ...album,

                tags:
                    album.tags ||
                    [],

                storage:
                    true

            };

            if (savedBases[album.id]) {

                savedAlbum.savedEdited = true;

                savedAlbum._savedAlbumEditBase =
                    savedBases[album.id];

            }

            albums.push(savedAlbum);

        }
    );

}


function returnToAlbums() {

    goBackToAlbumsWithTransition();

}
