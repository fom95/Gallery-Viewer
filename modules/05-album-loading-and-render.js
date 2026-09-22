/*
 * 05-album-loading-and-render.js
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
 * 17-add-image-editor.js) update both the map and this array together.
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


async function loadAlbum(album, pushHistory = true) {

    selectedTags.clear();

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

	document.getElementById("settingsButton").style.display =
		"none";

    if (album.url?.startsWith("tg://chat/")) {
		try {
			await loadTelegramAlbum(album);
		} catch (error) {
			alert("Failed to load Telegram album:\n\n" + (error?.message || String(error)));
			return;
		}
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

    createAddImageTile(gallery);

    buildTagList(album.tags || []);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        loadTagBarState();
        applyGalleryLayout(false);
        startThumbnailLoading();

        document.dispatchEvent(
            new CustomEvent("albumLayoutReady", {
                detail: { album }
            })
        );
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


function createAlbumImageItems(album, image, index, gallery) {

    const tags =
        resolveImageTagStrings(album, image);

    const urls =
        getImageURLs(image, album);

    if (!urls.thumb)
        return;

    const slot = document.createElement("div");
    slot.className = "thumbnail-slot";
    slot.dataset.index = index;
    slot.dataset.thumbnailIndex = index;
    slot.dataset.src = urls.thumb || "";
    slot.dataset.loaded = "false";
    slot.dataset.loading = "false";
    slot.style.visibility = "hidden";
    slot._thumbnailItem = null;

    const thumbImg = document.createElement("img");
    thumbImg.className = "thumb thumbnail-image";
	thumbImg.alt = tags.join(",");

    const mediumImg = document.createElement("img");
    mediumImg.className = "thumb medium-image";
    mediumImg.style.visibility = "hidden";
    mediumImg.style.opacity = "0";

    slot.append(thumbImg, mediumImg);
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
}
