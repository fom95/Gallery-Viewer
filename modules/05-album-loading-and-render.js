/*
 * 05-album-loading-and-render.js
 *
 * Loads an album's contents and creates the DOM thumbnail slot + backing
 * data item for each image in it.
 */

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

    if (album.url?.startsWith("tg://chat/")) {
		try {
			await loadTelegramAlbum(album);
		} catch (error) {
			alert("Failed to load Telegram album:\n\n" + (error?.message || String(error)));
			return;
		}

		await updateTelegramFullCacheAlbums(
			album.id
		);
	}

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

    album.images.forEach((image, index) => {
		if (image.source === "telegram") {
			console.log(
				"[TELEGRAM SAVED IMAGE]",
				image.messageID,
				image.tags
			);
		}

		createAlbumImageItems(
			album,
			image,
			index,
			gallery
		);
	});

    createAddImageTile(gallery);

    if (album.tags?.length)
        buildTagList(album.tags);
    else
        buildAlbumTags(album);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        loadTagBarState();
        applyGalleryLayout(false);
        startThumbnailLoading();

        /*
         * Signal that the gallery grid has been laid out and its
         * thumbnail slots now have their real, final positions. The
         * view-transition module waits for this before flying the
         * clicked cover image into its slot.
         */
        document.dispatchEvent(
            new CustomEvent("albumLayoutReady", {
                detail: { album }
            })
        );
    }));

    revealPageIfNeeded();
}


function createAlbumImageItems(album, image, index, gallery) {
    const source = image.source || "url";
    const urls = getImageURLs(image);
    if (!urls.thumb && source === "url")
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
	thumbImg.alt = (image.tags || []).join(",");

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
            album.images.splice(index, 1);
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
		tags: image.tags || [],
        src: urls.thumb,
        mediumSrc: urls.medium,
        fullSrc: urls.full,
        source,
        telegramFileID: image.telegramFileID || null,
        telegramThumbnailFileID: image.telegramThumbnailFileID || null,
        mimeType: image.mimeType || "",
        fileName: image.fileName || "",
        messageID: image.messageID || null,
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
        src: urls.medium,
        source,
        telegramFileID: image.telegramFileID || null,
        mimeType: image.mimeType || "",
        fileName: image.fileName || "",
        messageID: image.messageID || null,
        mediumLoaded: false,
        mediumLoading: false,
        mediumFailed: false,
        mediumImage: mediumImg,
        mediumBlobURL: null
    });
}


function getImageURLs(image) {
    const thumb = image.thumb?.url || image.image?.url || image.medium?.url || "";
    const medium = image.medium?.url || image.image?.url || thumb;
    const full = image.image?.url || image.medium?.url || thumb;
    return { thumb, medium, full };
}
