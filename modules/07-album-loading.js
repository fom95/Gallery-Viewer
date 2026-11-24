/*
 * 07-album-loading.js
 *
 * Loads an album's contents and creates the DOM thumbnail slot + backing
 * data item for each image in it.
 */

/*
 * album.images (as stored/decompressed) is a sparse map keyed by image
 * number -- convenient for storage and editing, but the rest of the
 * rendering pipeline wants a plain ordered array to iterate and index
 * into. This derives that array (album._imagesArray), in ascending
 * numeric-key order, and keeps it around so re-deriving isn't needed
 * on every render. Editing operations (add/remove -- see
 * 19-image-editor.js) update both the map and this array together.
 */
function buildImagesArray(album) {

    if (!album.images || typeof album.images !== "object") {

        album._imagesArray =
            [];

        return album._imagesArray;

    }

    album._imagesArray =
        Object.keys(album.images)
            .sort((a, b) => Number(a) - Number(b))
            .map(number => {

                const entry =
                    album.images[number];

                entry._imageNumber =
                    number;

                return entry;

            });

    return album._imagesArray;

}


let albumLoadCoverTimer = null;


function showAlbumLoadCover(label) {

    let cover =
        document.getElementById(
            "albumLoadCover"
        );

    if (!cover) {

        cover =
            document.createElement("div");

        cover.id =
            "albumLoadCover";

        const spinner =
            document.createElement("div");

        spinner.className =
            "album-load-cover-spinner";

        const text =
            document.createElement("div");

        text.className =
            "album-load-cover-label";

        cover.append(spinner, text);

        document.body.appendChild(cover);

    }

    cover.querySelector(
        ".album-load-cover-label"
    ).textContent =
        label || "Loading album…";

    requestAnimationFrame(() => {

        cover.classList.add("visible");

    });

}


function hideAlbumLoadCover() {

    if (albumLoadCoverTimer) {

        clearTimeout(albumLoadCoverTimer);

        albumLoadCoverTimer =
            null;

    }

    const cover =
        document.getElementById(
            "albumLoadCover"
        );

    if (!cover)
        return;

    cover.classList.remove("visible");

    setTimeout(() => {

        if (cover.isConnected)
            cover.remove();

    }, 220);

}


async function loadAlbum(album, pushHistory = true, options = {}) {

    /*
     * Opening straight from the home page (imports, shared links,
     * startup) has no card-flight transition. Give it the same clean
     * top-of-page start, and veil any slow Telegram/manifest loading
     * with a full-screen cover instead of letting the old page show
     * through in slices.
     */
    const openedFromHome =
        !currentAlbum;

    const useLoadCover =
        openedFromHome &&
        !options.transition &&
        !document.documentElement.classList.contains(
            "pageLoading"
        );

    if (openedFromHome && !options.transition)
        window.scrollTo(0, 0);

    if (useLoadCover) {

        if (albumLoadCoverTimer)
            clearTimeout(albumLoadCoverTimer);

        albumLoadCoverTimer =
            setTimeout(() => {

                albumLoadCoverTimer =
                    null;

                showAlbumLoadCover(
                    album?.name
                        ? "Loading " + album.name + "…"
                        : "Loading album…"
                );

            }, 120);

    }

    if (typeof resetModalFullResolutionPreference === "function")
        resetModalFullResolutionPreference();

    /*
     * A reload of the album page replaces #pageName's contents, which
     * would orphan the inline editor. Tear it down first; save/cancel
     * already do this explicitly, so this only catches external reloads.
     */
    if (
        typeof albumEditSession !== "undefined" &&
        albumEditSession &&
        typeof exitAlbumEditMode === "function"
    ) {
        exitAlbumEditMode({ reload: false });
    }

    /*
     * Switching albums starts with a clean filter. Reloading the same
     * album (for example after saving edit mode) keeps the tag bar
     * filter the user had before entering edit mode.
     */
    const keepTagFilters =
        currentAlbum &&
        String(currentAlbum.id) === String(album.id);

    if (!keepTagFilters) {
        selectedTags.clear();
        excludedTags.clear();
    }

    document.getElementById(
        "tagBar"
    ).style.display =
        "";

    document.getElementById(
        "tagList"
    ).innerHTML =
        "";

    document.getElementById(
        "pageName"
    ).textContent =
        album.name;

    document.title =
        album.name;

    currentAlbum =
        album;

    addAlbumPageEditButton(
        album
    );

    if (pushHistory) {
        history.pushState(null, "", "?$" + encodeURIComponent(album.id));
    }
	
	showAlbumButtons(true);
	addAlbumPageEditButton(album);

	/*
	 * Settings stays available on the album page as well as the home
	 * screen; only the back button distinguishes the two views.
	 */
	document.getElementById("settingsButton").style.display =
		"";

    document.getElementById("tagToggle").style.display =
        "";

    document.getElementById("imageSizeControls").style.display =
        "";

	if (typeof showingSearchResults !== "undefined")
		showingSearchResults = false;

	const searchResultsTags =
		document.getElementById("searchResultsTags");

	if (searchResultsTags)
		searchResultsTags.style.display = "none";

    if (album.isWorkerLibrary && typeof loadVideoLibraryAlbum === "function") {
        try {
            await loadVideoLibraryAlbum(album);
        } catch (error) {
            alert("Failed to load the video library:\n\n" + (error?.message || String(error)));
            hideAlbumLoadCover();
            return;
        }
    }

    if (usesLiveTelegram(album)) {

        const hasStoredImages =
            album.images &&
            typeof album.images === "object" &&
            Object.keys(album.images).length > 0;

        /*
         * A published or locally edited record already has its final
         * image list. Re-reading the live Telegram manifest here would
         * overwrite removed tags and reorder/rename edits with the
         * original message data.
         */
        if (!(album.edited === true && hasStoredImages)) {

            try {
                await loadTelegramAlbum(album);
            } catch (error) {
                alert("Failed to load Telegram album:\n\n" + (error?.message || String(error)));
                hideAlbumLoadCover();
                return;
            }

        }
	}

    /*
     * Non-Telegram albums may opt into a manifest the same way. No URL
     * means this returns immediately; one URL means one cached request.
     */
    if (
        !album._manifest &&
        typeof loadAlbumFromManifestIfAvailable === "function" &&
        !(
            typeof album.url === "string" &&
            album.url.startsWith("tg://chat/")
        )
    ) {

        await loadAlbumFromManifestIfAvailable(album);

    }

    const images =
        buildImagesArray(album);

    const gallery = document.getElementById("gallery");
    gallery.innerHTML = "";
    stopThumbnailLoading();
    thumbnailItems = [];
    thumbnailQueue = [];
    thumbnailLoading = false;
    stopMediumLoading();
    if (typeof releaseVideoBlobs === "function")
        releaseVideoBlobs();
    mediumItems = [];
    mediumQueue = [];
    mediumLoading = false;

    images.forEach((image, index) => {

		createAlbumImageItems(
			album,
			image,
			index,
			gallery
		);
	});

    buildTagList(album.tags || []);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        loadTagBarState();
        applyGalleryLayout(false);

        if (typeof applyTagFilter === "function")
            applyTagFilter();

        startThumbnailLoading();

        document.dispatchEvent(
            new CustomEvent("albumLayoutReady", {
                detail: { album }
            })
        );

        hideAlbumLoadCover();
    }));

    revealPageIfNeeded();
}


/*
 * Resolves an image entry's tags (indices into album.tags) to their
 * actual tag strings. Anything the rest of the app touches (tag
 * filtering, alt text, the tag bar) works with tag strings, same as
 * before -- this is the one place indices get translated.
 */
function resolveImageTagStrings(album, image) {

    if (!Array.isArray(image?.tags))
        return [];

    const albumTags =
        Array.isArray(album?.tags)
            ? album.tags
            : [];

    return image.tags
        .map(index => albumTags[index])
        .filter(tag => typeof tag === "string" && tag);

}


/*
 * Subtle placeholder used by gallery slots and home covers until their
 * image is ready. The moving sheen is deliberately low-contrast; it
 * signals activity without competing with the eventual artwork.
 */
function createMediaLoadingPlaceholder() {

    const placeholder =
        document.createElement("div");

    placeholder.className =
        "media-loading-placeholder";

    const sheen =
        document.createElement("div");

    sheen.className =
        "media-loading-sheen";

    placeholder.appendChild(sheen);

    return placeholder;

}


function setMediaLoadingPlaceholder(
    parent,
    visible,
    failed = false
) {

    const placeholder =
        parent?.querySelector(
            ".media-loading-placeholder"
        );

    if (!placeholder)
        return;

    placeholder.classList.toggle(
        "hidden",
        !visible
    );

    placeholder.classList.toggle(
        "failed",
        visible && failed
    );

}


function createAlbumImageItems(album, image, index, gallery) {

    const tags =
        resolveImageTagStrings(album, image);

    const urls =
        getImageURLs(image, album);

    if (!urls.thumb)
        return null;

    const slot = document.createElement("div");
    slot.className = "thumbnail-slot";
    slot.dataset.index = index;
    slot.dataset.thumbnailIndex = index;
    slot.dataset.src = urls.thumb || "";
    slot.dataset.loaded = "false";
    slot.dataset.loading = "false";
    slot.style.visibility = "visible";
    slot._thumbnailItem = null;

    const placeholder =
        createMediaLoadingPlaceholder();

    slot.appendChild(placeholder);

    const thumbImg = document.createElement("img");
    thumbImg.className = "thumb thumbnail-image";
	thumbImg.alt = tags.join(",");
    thumbImg.style.visibility = "hidden";

    const mediumImg = document.createElement("img");
    mediumImg.className = "thumb medium-image";
    mediumImg.alt = "";
    mediumImg.style.visibility = "hidden";
    mediumImg.style.opacity = "0";

    slot.append(thumbImg, mediumImg);

    if (image.video) {
        const badge = document.createElement("div");
        badge.className = "video-badge";
        badge.textContent = "▶";
        slot.appendChild(badge);
    }
    gallery.appendChild(slot);

    if (album.edited && image.added) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "image-remove";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove added image";
        removeBtn.onclick = e => {
            e.stopPropagation();
            if (!confirm("Remove this added image?"))
                return;
            if (image._imageNumber != null)
                delete album.images[image._imageNumber];
            album.edited = true;
            showEditedAlbumSaveButton();
            loadAlbum(album, false);
        };
        slot.appendChild(removeBtn);
    }

    const thumbnailItem = {
        index,
        slotIndex: gallery.children.length - 1,
        image,
        _album: album,
		tags,
        src: urls.thumb,
        mediumSrc: urls.medium,
        fullSrc: urls.full,
        slot,
        img: thumbImg,
        mediumImg,
        loaded: false,
        loading: false,
        assigned: false,
        mediumLoaded: false,
        mediumLoading: false,
        mediumFailed: false,
        mediumImage: null
    };
    slot._thumbnailItem = thumbnailItem;
    slot.onclick = () => {
        if (!slot._thumbnailItem)
            return;
        const current = slot._thumbnailItem;
        currentImageIndex = current.index;
        openModal(current.src, current.mediumSrc, current.fullSrc, slot);
    };
    thumbnailItems.push(thumbnailItem);

    mediumItems.push({
        index,
        image,
        _album: album,
        src: urls.medium,
        mediumLoaded: false,
        mediumLoading: false,
        mediumFailed: false,
        mediumImage: mediumImg,
        mediumBlobURL: null
    });

    return slot;
}
