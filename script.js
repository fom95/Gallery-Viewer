//FIX THUMBNAIL AND MEDIUM LOADER
const albums = [];
let currentAlbum = null;
let isQueryAlbum = false;
let currentImageIndex = 0;
let modalLoadID = 0;
let activeImageLoaders = [];
let loadingTimer = null;
const selectedTags = new Set();
const excludedTags = new Set();
let filterMode = "any"; // "any" or "all"

const galleryGap = 1; // 1% of gallery width
const minColumns = 2;
const maxColumns = 10;
const minThumbWidth = 180;
const homeMinColumns = 2;
const homeMaxColumns = 10;
const homeMinThumbWidth = 180;
const homeHeightMultiplier = 1.12;

function generateAlbumID(name, currentID) {

    const usedIDs = new Set();

    albums.forEach(album => {

        if (album.id && album.id !== currentID) {
            usedIDs.add(album.id);
        }

    });

    if (typeof MANUAL_ALBUMS !== "undefined") {

        MANUAL_ALBUMS.forEach(album => {

            if (album.id && album.id !== currentID) {
                usedIDs.add(album.id);
            }

        });

    }

    const base = name
        .trim()
        .replace(/[^\w -]/g, "")
        .replace(/\s+/g, "_");

    // The base ID is available
    if (!usedIDs.has(base)) {
        return base;
    }

    // Base exists elsewhere, so find the first available number
    let number = 1;
    while (usedIDs.has(base + number)) {
        number++;
    }

    return base + number;
}

function getAlbumQuery(url) {

    if (!url)
        return "";

    /*
     * Full URL containing an album query.
     *
     * Example:
     *
     * https://example.com/?$ALBUM_ID
     *
     * Only strip the "?$" routing prefix if it
     * actually exists.
     */

    if (url.includes("?$")) {

        return url.split("?$")[1];

    }

    /*
     * Full URL containing a normal ImgBB query.
     */

    if (url.includes("?")) {

        return url.split("?")[1];

    }

    /*
     * Already just the query.
     */

    return url;

}

async function initAlbums() {

    /*
     * Keep the query encoded.
     *
     * Routing:
     *
     * ?$ALBUM_ID
     *     Saved/manual album
     *
     * ?@PASTEPILE_ID
     *     Pastepile album database
     *
     * ?=ALBUM_ID
     *     Unsaved/local album
     *
     * Anything else:
     *     Existing ImgBB image-query URL
     */

    const query =
        location.search.substring(1);

    if (!query) {

        await showAlbums();

        return;

    }

    /*
     * -------------------------------------------------
     * PASTEPILE ALBUM DATABASE
     * -------------------------------------------------
     */

    if (
        query.startsWith("@")
    ) {

        /*
         * The Pastepile ID is everything after @.
         */

        const pasteID =
            decodeURIComponent(
                query.substring(1)
            );

        /*
         * Store the Pastepile ID so reloadAlbums()
         * knows which source to load.
         */

        currentPastepileID =
            pasteID;

        /*
         * Load the albums from Pastepile.
         */

        await reloadAlbums();

        /*
         * Now display the album list.
         */

        await showAlbums(
            false
        );

        return;

    }

    /*
     * -------------------------------------------------
     * MANUAL / SAVED ALBUM
     * -------------------------------------------------
     *
     * ?$ALBUM_ID
     */

    if (
        query.startsWith("$")
    ) {

        const albumID =
            decodeURIComponent(
                query.substring(1)
            );

        /*
         * Load MANUAL_ALBUMS / Pastepile albums /
         * localStorage albums.
         */

        await reloadAlbums();

        const album =
            albums.find(
                a =>
                    a.id === albumID
            );

        if (album) {

            currentAlbum =
                album;

            isQueryAlbum =
                false;

            loadAlbumFromURL(
                album
            );

            showAlbumButtons(
                true
            );

            return;

        }

        console.warn(
            "Album not found:",
            albumID
        );

        await showAlbums();

        return;

    }

    /*
     * -------------------------------------------------
     * UNSAVED ALBUM
     * -------------------------------------------------
     *
     * ?=ALBUM_ID
     *
     * Keep your existing unsaved-album handling here.
     */

    if (
        query.startsWith("=")
    ) {

        const albumID =
            decodeURIComponent(
                query.substring(1)
            );

        /*
         * Put your existing ?= handling here.
         *
         * If your current code has a specific way
         * of retrieving unsaved albums, preserve
         * that logic.
         */

        /*console.log(
            "[ALBUM] Unsaved album:",
            albumID
        );*/

        /*
         * -------------------------------------------------
         * TEMPORARY FALLBACK
         * -------------------------------------------------
         *
         * If your existing ?= logic is elsewhere,
         * this prevents it from being interpreted as
         * an ImgBB image query.
         */

        await showAlbums();

        return;

    }

    /*
     * -------------------------------------------------
     * EXISTING IMGBB QUERY
     * -------------------------------------------------
     *
     * Anything that doesn't use one of the special
     * prefixes is still treated as an ImgBB query.
     */

    const albumQuery =
        createQueryAlbum(
            query
        );

    currentAlbum =
        albumQuery;

    isQueryAlbum =
        true;

    loadAlbumFromURL(
        albumQuery
    );

    showAlbumButtons(
        true
    );

}

function createQueryAlbum(query) {

    return {
        name: "Shared Album",
        images: parseQuery(query),
        tags: []
    };

}

function parseQuery(query) {

    return query.split("|").map(entry => {

        /*
         * -----------------------------------------
         * NEW JSON FORMAT
         * -----------------------------------------
         */
        try {

            const data =
                JSON.parse(
                    decodeURIComponent(entry));

            /*
             * Keep the filename EXACTLY as stored.
             *
             * Do not decode it again.
             */
            const fileName =
                data.n || "";

            /*
             * Build URLs only when the ID exists.
             *
             * This prevents:
             *
             * https://i.ibb.co//filename.jpg
             */
            const thumbURL =
                data.t
                 ? `https://i.ibb.co/${data.t}/${fileName}`
                 : null;

            const mediumURL =
                data.m
                 ? `https://i.ibb.co/${data.m}/${fileName}`
                 : null;

            const fullURL =
                data.f
                 ? `https://i.ibb.co/${data.f}/${fileName}`
                 : null;

            /*
            console.log(
            "[QUERY] Parsed image:",{
            thumbID: data.t,
            mediumID: data.m,
            fullID: data.f,
            fileName: fileName,
            thumbURL: thumbURL,
            mediumURL: mediumURL,
            fullURL: fullURL
            }
            );
             */

            return {

                thumb: thumbURL
                 ? {
                    url: thumbURL
                }
                 : null,

                medium: mediumURL
                 ? {
                    url: mediumURL
                }
                 : null,

                image: fullURL
                 ? {
                    url: fullURL
                }
                 : null,

                tags:
                (data.d?.tags || [])
                .map(tag => decodeURIComponent(tag))

            };

        }

        /*
         * -----------------------------------------
         * OLD FORMAT
         * -----------------------------------------
         */
        catch (e) {

            const [
                thumbId,
                mediumId,
                imageId,
                fileName
            ] =
                entry.split(",");

            return {

                thumb:
                thumbId
                 ? {
                    url:
`https://i.ibb.co/${thumbId}/${fileName}`
                }
                 : null,

                medium:
                mediumId
                 ? {
                    url:
`https://i.ibb.co/${mediumId}/${fileName}`
                }
                 : null,

                image:
                imageId
                 ? {
                    url:
`https://i.ibb.co/${imageId}/${fileName}`
                }
                 : null,

                tags: []

            };

        }

    });
}

function createAlbumQuery(album) {

    function getId(url) {
        if (!url)
            return "";

        const match = url.match(/\/([A-Za-z0-9]+)\//);
        return match ? match[1] : "";
    }

    function getFile(url) {
        if (!url)
            return "";

        return url.split("/").pop();
    }

    return album.images.map(img => {

        const file =
            getFile(
                img.image?.url ||
                img.thumb?.url);

        return encodeURIComponent(JSON.stringify({
                t: getId(img.thumb?.url),
                m: getId(img.medium?.url),
                f: getId(img.image?.url),
                n: file,
                d: {
                    tags: img.tags || []
                }
            }));

    }).join("|");
}

async function showAlbums() {

    document.getElementById("regenerateAlbum").style.display =
        "none";

    document.getElementById("tagBar").style.display =
        "none";

    document.getElementById("tagToggle").style.display =
        "none";

    closeModal();

    document.getElementById("pageName").textContent =
        "ImgBB Galleries";

    document.title =
        "Gallery Viewer";

    /*
     * -------------------------------------------------
     * PRESERVE PASTEPILE URL
     * -------------------------------------------------
     *
     * If the page was opened with:
     *
     * ?@PASTEPILE_ID
     *
     * keep that query in the URL.
     *
     * For normal album-list pages, continue removing
     * the query exactly as before.
     */

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

    /*
     * -------------------------------------------------
     * LOAD ALBUMS
     * -------------------------------------------------
     */

    await reloadAlbums();

    document.getElementById("backButton").style.display =
        "none";

    document.getElementById("saveButton").style.display =
        "none";

    const gallery =
        document.getElementById("gallery");

    gallery.innerHTML =
        "";

    if (!albums.length) {

        gallery.textContent =
            "No data loaded.";

        return;

    }

    albums.forEach(
        album => {

            const cover =
                album.images[
                    Math.floor(
                        Math.random() *
                        album.images.length
                    )
                ];

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "album";

            const img =
                document.createElement(
                    "img"
                );

            img.src =
                cover.thumb.url;

            const title =
                document.createElement(
                    "div"
                );

            title.textContent =
                album.name;

            card.appendChild(
                img
            );

            card.appendChild(
                title
            );

            card.onclick =
                () => loadAlbum(album);

            /*
             * -------------------------------------------------
             * LOCALSTORAGE ALBUM BUTTONS
             * -------------------------------------------------
             */

            if (album.storage) {

                const deleteBtn =
                    document.createElement(
                        "button"
                    );

                deleteBtn.className =
                    "album-delete";

                deleteBtn.textContent =
                    "×";

                deleteBtn.title =
                    "Remove saved album";

                deleteBtn.onclick =
                    (e) => {

                        e.stopPropagation();

                        let saved =
                            JSON.parse(
                                localStorage.getItem(
                                    "savedAlbums"
                                ) || "[]"
                            );

                        saved =
                            saved.filter(
                                savedAlbum =>
                                    savedAlbum.id !==
                                    album.id
                            );

                        localStorage.setItem(
                            "savedAlbums",
                            JSON.stringify(
                                saved
                            )
                        );

                        showAlbums();

                    };

                card.appendChild(
                    deleteBtn
                );

                const exportBtn =
                    document.createElement(
                        "button"
                    );

                exportBtn.className =
                    "album-export";

                exportBtn.textContent =
                    "↗";

                exportBtn.title =
                    "Copy to albums.js";

                exportBtn.onclick =
                    (e) => {

                        e.stopPropagation();

                        const query =
                            createAlbumQuery(
                                album
                            );

                        const id =
                            generateAlbumID(
                                album.name
                            );

                        const js =
                            `,
	{
		id: "${id.replace(
            /"/g,
            '\\"'
        )}",
		name: "${album.name.replace(
            /"/g,
            '\\"'
        )}",
		url: \`
		?${query}
		\`.trim(),
		tags: ${JSON.stringify(
            album.tags || []
        )}
	}`;

                        navigator.clipboard
                            .writeText(js)
                            .then(
                                () => {
                                    alert(
                                        "Copied album.js entry!"
                                    );
                                }
                            )
                            .catch(
                                () => {
                                    prompt(
                                        "Copy this:",
                                        js
                                    );
                                }
                            );

                    };

                card.appendChild(
                    exportBtn
                );

            }

            gallery.appendChild(
                card
            );

        }
    );

    applyGalleryLayout(
        false
    );

    document.documentElement.classList.remove(
        "pageLoading"
    );

}

async function buildAlbumTags(album) {

    const tagSet = new Set();

    album.images.forEach(img => {

        (img.tags || []).forEach(tag => {
            tagSet.add(tag);
        });

    });

    album.tags = [...tagSet];

    buildTagList(album.tags);
}

//gets all unique tags, requires all loaded
//document.querySelectorAll(".thumb").forEach((el)=>{el.alt.split(",").forEach((tag)=>{if (!currentAlbum.tags.includes(tag)) {currentAlbum.tags.push(tag)}})})

//remember:
//?@pastepileID
//?$albumID
//?=unsavedID

function loadAlbum(album) {

	selectedTags.clear();

	document.getElementById("tagBar").style.display =
		"";

	document.getElementById("tagList").innerHTML =
		"";

	document.getElementById("pageName").innerHTML =
		album.name;

	document.title =
		album.name;

	currentAlbum =
		album;

	history.pushState(
		null,
		"",
		"?$" +
		encodeURIComponent(
			album.id));

	showAlbumButtons(
		true);

	const gallery =
		document.getElementById("gallery");

	gallery.innerHTML =
		"";

	/*
	 * -------------------------------------------------
	 * RESET THUMBNAIL LOADER
	 * -------------------------------------------------
	 */

	stopThumbnailLoading();

	thumbnailItems =
		[];

	thumbnailQueue =
		[];

	thumbnailLoading =
		false;

	/*
	 * -------------------------------------------------
	 * CREATE ALL THUMBNAIL SLOTS
	 * -------------------------------------------------
	 *
	 * The slots exist immediately so the gallery
	 * has its complete layout before any images
	 * are requested.
	 */

	album.images.forEach(
		(img, index) => {

		if (
			!img.thumb?.url ||
			!img.image?.url) {

			return;

		}

		/*
		 * The slot itself is an image element.
		 *
		 * It starts without a src, so the browser
		 * does not download anything yet.
		 */

		const el =
			document.createElement("div");

		el.className =
			"thumbnail-slot";

		el.dataset.index =
			index;

		el.dataset.thumbnailIndex =
			index;

		el.dataset.src =
			img.thumb.url;

		el.dataset.loaded =
			"false";

		el.dataset.loading =
			"false";

		el.style.visibility =
			"hidden";

		el._thumbnailItem =
			null;


		/*
		 * -------------------------------------------------
		 * THUMBNAIL IMAGE
		 * -------------------------------------------------
		 */

		const thumbImg =
			document.createElement("img");

		thumbImg.className =
			"thumb thumbnail-image";

		/*thumbImg.style.visibility =
			"hidden";*/


		/*
		 * -------------------------------------------------
		 * MEDIUM IMAGE
		 * -------------------------------------------------
		 */

		const mediumImg =
			document.createElement("img");

		mediumImg.className =
			"thumb medium-image";

		mediumImg.style.visibility =
			"hidden";

		mediumImg.style.opacity =
			"0";


		/*
		 * Medium sits above the thumbnail.
		 */

		el.appendChild(
			thumbImg);

		el.appendChild(
			mediumImg);

		gallery.appendChild(
			el);

		thumbnailItems.push({

			index:
				index,

			slotIndex:
				gallery.children.length - 1,

			src:
				img.thumb.url,

			tags:
				img.tags || [],

			mediumSrc:
				img.medium?.url ||
				img.image?.url ||
				"",

			fullSrc:
				img.image?.url ||
				"",

			slot:
				el,

			img:
				thumbImg,

			mediumImg:
				mediumImg,

			loaded:
				false,

			loading:
				false,

			assigned:
				false,

			mediumLoaded:
				false,

			mediumLoading:
				false,

			mediumImage:
				null

		});
		const mediumSrc =
			img.medium?.url ||
			img.image?.url ||
			"";

		mediumItems.push({

			index:
				index,

			src:
				mediumSrc,

			mediumLoaded:
				false,

			mediumLoading:
				false,

			mediumImage:
				mediumImg,

			mediumBlobURL:
				null

		});
	});

	if (album.tags?.length) {

		buildTagList(
			album.tags);

	}

	requestAnimationFrame(() => {

		requestAnimationFrame(() => {

			loadTagBarState();

			applyGalleryLayout(
				false);

			/*
			 * Start only after the gallery has
			 * actually settled into its layout.
			 */

			startThumbnailLoading();

		});

	});

	document.documentElement.classList.remove(
		"pageLoading");

}

function loadAlbumFromURL(album) {

	selectedTags.clear();

	document.getElementById("tagBar").style.display =
		"";

	document.getElementById("tagList").innerHTML =
		"";

	document.getElementById("pageName").textContent =
		album.name;

	document.title =
		album.name;

	currentAlbum =
		album;

	const gallery =
		document.getElementById("gallery");

	gallery.innerHTML =
		"";

	/*
	 * -------------------------------------------------
	 * RESET THUMBNAIL LOADER
	 * -------------------------------------------------
	 */

	stopThumbnailLoading();

	thumbnailItems =
		[];

	thumbnailQueue =
		[];

	thumbnailLoading =
		false;
		
	stopMediumLoading();

	mediumItems =
		[];

	mediumQueue =
		[];

	mediumLoading =
		false;

	/*
	 * -------------------------------------------------
	 * CREATE ALL THUMBNAIL SLOTS
	 * -------------------------------------------------
	 */

	album.images.forEach(
		(img, index) => {

		if (
			!img.thumb?.url ||
			!img.image?.url) {

			return;

		}

		const el =
			document.createElement("div");

		el.className =
			"thumbnail-slot";

		el.dataset.index =
			index;

		el.dataset.thumbnailIndex =
			index;

		el.dataset.src =
			img.thumb.url;

		el.dataset.loaded =
			"false";

		el.dataset.loading =
			"false";

		el.style.visibility =
			"hidden";

		el._thumbnailItem =
			null;


		/*
		 * -------------------------------------------------
		 * THUMBNAIL IMAGE
		 * -------------------------------------------------
		 */

		const thumbImg =
			document.createElement("img");

		thumbImg.className =
			"thumb thumbnail-image";

		/*thumbImg.style.visibility =
			"hidden";*/


		/*
		 * -------------------------------------------------
		 * MEDIUM IMAGE
		 * -------------------------------------------------
		 */

		const mediumImg =
			document.createElement("img");

		mediumImg.className =
			"thumb medium-image";

		mediumImg.style.visibility =
			"hidden";

		mediumImg.style.opacity =
			"0";


		/*
		 * Medium sits above the thumbnail.
		 */

		el.appendChild(
			thumbImg);

		el.appendChild(
			mediumImg);

		gallery.appendChild(
			el);

		thumbnailItems.push({

			index:
				index,

			slotIndex:
				gallery.children.length - 1,

			src:
				img.thumb.url,

			tags:
				img.tags || [],

			mediumSrc:
				img.medium?.url ||
				img.image?.url ||
				"",

			fullSrc:
				img.image?.url ||
				"",

			slot:
				el,

			img:
				thumbImg,

			mediumImg:
				mediumImg,

			loaded:
				false,

			loading:
				false,

			assigned:
				false,

			mediumLoaded:
				false,

			mediumLoading:
				false,

			mediumImage:
				null

		});
		const mediumSrc =
			img.medium?.url ||
			img.image?.url ||
			"";

		mediumItems.push({

			index:
				index,

			src:
				mediumSrc,

			mediumLoaded:
				false,

			mediumLoading:
				false,

			mediumImage:
				mediumImg,

			mediumBlobURL:
				null

		});

	});

	if (album.tags?.length) {

		buildTagList(
			album.tags);

	} else {

		buildAlbumTags(
			album);

	}

	requestAnimationFrame(() => {

		requestAnimationFrame(() => {

			loadTagBarState();

			applyGalleryLayout(
				false);

			startThumbnailLoading();

		});

	});

	document.documentElement.classList.remove(
		"pageLoading");

}

let thumbnailItems = [];
let thumbnailQueue =[];
let thumbnailLoading = false;
let thumbnailObserver = null;
let thumbnailScrollTimer = null;
let thumbnailCheckScheduled = false;
const THUMBNAIL_SETTLE_DELAY = 1000;
let thumbnailLoadSession = 0;
let thumbnailPriorityMode = false;
let thumbnailPriorityPaused = false;

function pauseThumbnailLoading() {

    thumbnailPriorityPaused =
        true;

    clearTimeout(
        thumbnailScrollTimer
    );

    thumbnailScrollTimer =
        null;
}

function resumeThumbnailLoading() {

	thumbnailPriorityPaused =
		false;

	/*
	 * Give currently visible thumbnails priority
	 * immediately when the modal finishes.
	 */

	prioritizeVisibleThumbnails();

	/*
	 * -------------------------------------------------
	 * RESUME THUMBNAILS ONLY
	 * -------------------------------------------------
	 *
	 * IMPORTANT:
	 *
	 * Do NOT start the Medium queue here.
	 *
	 * This function is also called when a modal
	 * finishes loading. The Medium background queue
	 * must never be started merely because a modal
	 * finished.
	 */

	if (
		!thumbnailLoading &&
		thumbnailQueue.length
	) {

		processThumbnailQueue(
			thumbnailLoadSession
		);

	}

}

function stopThumbnailLoading() {

	thumbnailLoadSession++;

	clearTimeout(
		thumbnailScrollTimer);

	thumbnailScrollTimer =
		null;

	if (thumbnailObserver) {

		thumbnailObserver.disconnect();

		thumbnailObserver =
			null;

	}

	thumbnailCheckScheduled =
		false;

	thumbnailPriorityMode =
		false;

}

function getThumbnailSlots() {

	const gallery =
		document.getElementById(
			"gallery");

	if (!gallery)
		return [];

	return Array.from(
		gallery.querySelectorAll(
			".thumbnail-slot"
		));

}

function getVisibleThumbnailSlots() {

	return getThumbnailSlots()
		.filter(
			slot => {

				const rect =
					slot.getBoundingClientRect();

				return (
					rect.bottom > 0 &&
					rect.top < window.innerHeight &&
					rect.right > 0 &&
					rect.left < window.innerWidth
				);

			}
		)
		.sort(
			(a, b) => {

				const aRect =
					a.getBoundingClientRect();

				const bRect =
					b.getBoundingClientRect();

				if (
					Math.abs(
						aRect.top -
						bRect.top
					) > 1
				) {

					return (
						aRect.top -
						bRect.top
					);

				}

				return (
					aRect.left -
					bRect.left
				);

			}
		);

}

function isThumbnailLoaded(item) {

	return (
		item &&
		item.loaded === true
	);

}

function assignThumbnailToSlot(
    item,
    slot) {

    if (
        !item ||
        !slot
    ) {

        return;

    }

    if (
        slot._thumbnailItem ===
        item
    ) {

        return;

    }

    const thumbnailImg =
        slot.querySelector(
            ".thumbnail-image");

    const mediumImg =
        slot.querySelector(
            ".medium-image");

    if (
        !thumbnailImg ||
        !mediumImg
    ) {

        return;

    }

    /*
     * -------------------------------------------------
     * RESET SLOT
     * -------------------------------------------------
     */

    slot.style.visibility =
        "hidden";

    slot._thumbnailItem =
        item;

    slot.dataset.index =
        item.index;

    slot.dataset.src =
        item.src;

    slot.dataset.loaded =
        "false";

    slot.dataset.loading =
        "false";

    /*
     * Reset the Medium layer.
     *
     * This is important because the slot may have
     * previously represented a completely different
     * album image.
     */

    mediumImg.style.visibility =
        "hidden";

    mediumImg.style.opacity =
        "0";

    mediumImg.removeAttribute(
        "src");

    /*
     * -------------------------------------------------
     * ALT / CLICK
     * -------------------------------------------------
     */

    slot.alt =
        item.tags.join(",");

    slot.onclick =
        () => {

        if (
            !slot._thumbnailItem
        ) {

            return;

        }

        const current =
            slot._thumbnailItem;

        currentImageIndex =
            current.index;

        openModal(
            current.src,
            current.mediumSrc,
            current.fullSrc,
            slot
        );

    };

    /*
     * -------------------------------------------------
     * THUMBNAIL
     * -------------------------------------------------
     */

    if (
        item.loaded
    ) {

        thumbnailImg.src =
            item.src;

        thumbnailImg.style.visibility =
            "visible";

        slot.dataset.loaded =
            "true";

        slot.dataset.loading =
            "false";

        slot.style.visibility =
            "visible";

    }

    /*
     * -------------------------------------------------
     * MEDIUM
     * -------------------------------------------------
     *
     * If this image's Medium was already loaded,
     * immediately put the existing decoded image
     * into this slot.
     */

    if (
        item.mediumLoaded &&
        item.mediumImage
    ) {

        mediumImg.src =
            item.mediumImage.src;

        mediumImg.style.visibility =
            "visible";

        mediumImg.style.opacity =
            "1";

    }

}

function getNextAvailableVisibleSlot() {

	const visibleSlots =
		getVisibleThumbnailSlots();

	for (
		const slot of visibleSlots
	) {

		if (
			slot.dataset.loaded ===
			"true"
		) {

			continue;

		}

		if (
			slot.dataset.loading ===
			"true"
		) {

			continue;

		}

		return slot;

	}

	return null;

}

function loadThumbnail(
	item,
	session) {

	return new Promise(
		resolve => {

			if (
				!item ||
				item.loaded ||
				item.loading
			) {

				resolve();

				return;

			}

			if (
				session !==
				thumbnailLoadSession
			) {

				resolve();

				return;

			}

			/*
			 * -------------------------------------------------
			 * CHOOSE SLOT
			 * -------------------------------------------------
			 */

			let targetSlot =
				null;

			if (
				thumbnailPriorityMode
			) {

				targetSlot =
					getNextAvailableVisibleSlot();

			}

			if (!targetSlot) {

				const slots =
					getThumbnailSlots();

				targetSlot =
					slots.find(
						slot => {

							if (
								slot.dataset.loading ===
								"true"
							) {

								return false;

							}

							if (
								slot.dataset.loaded ===
								"true"
							) {

								return false;

							}

							return true;

						}
					);

			}

			if (!targetSlot) {

				resolve();

				return;

			}

			/*
			 * -------------------------------------------------
			 * GET THE ACTUAL THUMBNAIL IMAGE
			 * -------------------------------------------------
			 */

			const img =
				targetSlot.querySelector(
					".thumbnail-image"
				);

			if (!img) {

				resolve();

				return;

			}

			item.loading =
				true;

			assignThumbnailToSlot(
				item,
				targetSlot
			);

			const finish =
				success => {

				img.removeEventListener(
					"load",
					onLoad
				);

				img.removeEventListener(
					"error",
					onError
				);

				item.loading =
					false;

				/*
				 * IMPORTANT:
				 *
				 * Loading/loaded state belongs
				 * to the SLOT, not the image.
				 */

				targetSlot.dataset.loading =
					"false";

				if (
					session !==
					thumbnailLoadSession
				) {

					resolve();

					return;

				}

				if (success) {

					item.loaded =
						true;

					item.assigned =
						true;

					targetSlot.dataset.loaded =
						"true";

					targetSlot.style.visibility =
						"visible";

					/*
					 * The thumbnail image itself
					 * is already visible here.
					 */

					img.style.visibility =
						"visible";

				}
				else {

					console.warn(
						"[THUMBNAIL] Failed:",
						item.src
					);

					targetSlot.dataset.loaded =
						"false";

				}

				resolve();

			};

			const onLoad =
				() => {

				finish(
					true
				);

			};

			const onError =
				() => {

				finish(
					false
				);

			};

			img.addEventListener(
				"load",
				onLoad
			);

			img.addEventListener(
				"error",
				onError
			);

			/*
			 * IMPORTANT:
			 *
			 * Again, loading state belongs
			 * to the SLOT.
			 */

			targetSlot.dataset.loading =
				"true";

			img.src =
				item.src;

		}
	);

}

async function processThumbnailQueue(
    session) {

    if (
        thumbnailPriorityPaused
    ) {

        return;

    }

    if (
        thumbnailLoading
    ) {

        return;

    }

    thumbnailLoading =
        true;

    while (
        thumbnailQueue.length &&
        session ===
            thumbnailLoadSession &&
        !thumbnailPriorityPaused
    ) {

        /*
         * -------------------------------------------------
         * PRIORITY MODE
         * -------------------------------------------------
         */

        if (
            thumbnailPriorityMode
        ) {

            const visibleSlots =
                getVisibleThumbnailSlots();

            if (
                !visibleSlots.length
            ) {

                break;

            }

            prioritizeVisibleQueue();

        }

        /*
         * -------------------------------------------------
         * GET NEXT ITEM
         * -------------------------------------------------
         */

        const item =
            thumbnailQueue.shift();

        if (
            !item ||
            item.loaded ||
            item.loading
        ) {

            continue;

        }

        /*
         * -------------------------------------------------
         * LOAD
         * -------------------------------------------------
         */

        await loadThumbnail(
            item,
            session
        );

    }

    thumbnailLoading =
        false;

    /*
     * -------------------------------------------------
     * DO NOT START MEDIUM WHILE THUMBNAILS ARE
     * STILL ACTIVE OR PRIORITY WORK IS ACTIVE
     * -------------------------------------------------
     */

    if (
        thumbnailPriorityPaused ||
        thumbnailPriorityMode ||
        session !== thumbnailLoadSession
    ) {

        return;

    }

    /*
     * -------------------------------------------------
     * CHECK WHETHER ANY THUMBNAILS ARE STILL LOADING
     * -------------------------------------------------
     */

    const thumbnailStillLoading =
        thumbnailItems.some(
            item =>
                item &&
                item.loading
        );

    if (
        thumbnailStillLoading
    ) {

        return;

    }

    /*
     * -------------------------------------------------
     * CHECK WHETHER ANY THUMBNAILS REMAIN
     * -------------------------------------------------
     */

    const thumbnailsRemaining =
        thumbnailItems.some(
            item =>
                item &&
                !item.loaded
        );

    if (
        thumbnailsRemaining
    ) {

        /*
         * The current queue may have been exhausted
         * because visible-priority work rearranged it.
         *
         * Rebuild it in absolute album order.
         */

        thumbnailQueue =
            thumbnailItems
                .filter(
                    item =>
                        item &&
                        !item.loaded &&
                        !item.loading
                )
                .sort(
                    (a, b) =>
                        a.index -
                        b.index
                );

        /*
         * Continue thumbnails.
         */

        processThumbnailQueue(
            session
        );

        return;

    }

    /*
     * -------------------------------------------------
     * ALL THUMBNAILS ARE ACTUALLY FINISHED
     * -------------------------------------------------
     *
     * Only NOW may Medium begin.
     */

    startMediumLoading();

}

function prioritizeVisibleQueue() {

	const visibleSlots =
		getVisibleThumbnailSlots();

	if (
		!visibleSlots.length
	) {

		return;

	}

	const priority =
		[];

	const seen =
		new Set();

	/*
	 * Determine which album images belong to
	 * the currently visible positions.
	 */

	visibleSlots.forEach(
		slot => {

			const index =
				Number(
					slot.dataset.index
				);

			const item =
				thumbnailItems.find(
					entry =>
						entry.index ===
						index
				);

			if (
				!item ||
				item.loaded ||
				item.loading
			) {

				return;

			}

			if (
				seen.has(item)
			) {

				return;

			}

			seen.add(item);

			priority.push(
				item);

		}
	);

	if (
		!priority.length
	) {

		return;

	}

	priority.sort(
		(a, b) =>
			a.index -
			b.index
	);

	const prioritySet =
		new Set(
			priority
		);

	thumbnailQueue =
		priority.concat(
			thumbnailQueue.filter(
				item =>
					!prioritySet.has(
						item
					)
			)
		);

}

function prioritizeVisibleThumbnails() {

    /*
     * -------------------------------------------------
     * ENTER PRIORITY MODE
     * -------------------------------------------------
     */

    thumbnailPriorityMode =
        true;

    /*
     * Move currently visible images to the
     * front of the queue.
     */

    prioritizeVisibleQueue();

    /*
     * Start/resume the queue.
     */

    processThumbnailQueue(
        thumbnailLoadSession
    );

    /*
     * -------------------------------------------------
     * CHECK WHETHER PRIORITY WORK IS FINISHED
     * -------------------------------------------------
     */

    const finishPriorityCheck =
        () => {

        if (
            !thumbnailPriorityMode
        ) {

            return;

        }

        const visibleSlots =
            getVisibleThumbnailSlots();

        let pendingVisible =
            false;

        visibleSlots.forEach(
            slot => {

                const index =
                    Number(
                        slot.dataset.index
                    );

                const item =
                    thumbnailItems.find(
                        entry =>
                            entry.index ===
                            index
                    );

                if (
                    item &&
                    !item.loaded
                ) {

                    pendingVisible =
                        true;

                }

            }
        );

        if (
            pendingVisible
        ) {

            /*
             * Visible images are still being
             * processed.
             *
             * Check again after they have had
             * time to finish.
             */

            setTimeout(
                finishPriorityCheck,
                50
            );

            return;

        }

        /*
         * -------------------------------------------------
         * VISIBLE IMAGES ARE DONE
         * -------------------------------------------------
         *
         * Leave priority mode.
         *
         * IMPORTANT:
         *
         * Do NOT continue using the existing queue
         * position.
         *
         * Rebuild the normal queue from the actual
         * thumbnail item state so the next image is
         * always the lowest-index image that has not
         * loaded yet.
         */

        thumbnailPriorityMode =
            false;

        thumbnailQueue =
            thumbnailItems
                .filter(
                    item =>
                        item &&
                        !item.loaded &&
                        !item.loading
                )
                .sort(
                    (a, b) =>
                        a.index -
                        b.index
                );

        /*
         * Continue normal thumbnail loading.
         */

        processThumbnailQueue(
            thumbnailLoadSession
        );

        };

    /*
     * Check after the current image has had
     * a chance to finish.
     */

    setTimeout(
        finishPriorityCheck,
        0
    );

}

function scheduleThumbnailVisibilityCheck() {

	clearTimeout(
		thumbnailScrollTimer
	);

	/*
	 * -------------------------------------------------
	 * PAUSE BACKGROUND QUEUE
	 * -------------------------------------------------
	 *
	 * This does NOT cancel an active image download.
	 * It simply prevents the queue from immediately
	 * starting another background image.
	 */

	thumbnailPriorityMode =
		true;

	thumbnailScrollTimer =
		setTimeout(
			() => {

				thumbnailScrollTimer =
					null;

				prioritizeVisibleThumbnails();

			},
			THUMBNAIL_SETTLE_DELAY
		);

}

function startThumbnailLoading() {

	stopThumbnailLoading();

	const gallery =
		document.getElementById(
			"gallery");

	if (!gallery)
		return;

	const session =
		thumbnailLoadSession;

	const slots =
		getThumbnailSlots();

	if (
		!slots.length
	) {

		return;

	}

	/*
	 * -------------------------------------------------
	 * INITIAL LOAD
	 * -------------------------------------------------
	 *
	 * Initial visible images first.
	 */

	const visibleSlots =
		getVisibleThumbnailSlots();

	const initial =
		[];

	visibleSlots.forEach(
		slot => {

			const index =
				Number(
					slot.dataset.index
				);

			const item =
				thumbnailItems.find(
					entry =>
						entry.index ===
						index
				);

			if (
				item &&
				!item.loaded
			) {

				initial.push(
					item);

			}

		}
	);

	initial.sort(
		(a, b) =>
			a.index -
			b.index
	);

	const initialSet =
		new Set(
			initial
		);

	/*
	 * After the initial visible images,
	 * resume normal album order.
	 */

	thumbnailQueue =
		initial.concat(
			thumbnailItems.filter(
				item =>
					!initialSet.has(
						item
					)
			)
		);

	/*
	 * IMPORTANT:
	 *
	 * Initial loading is NOT priority mode.
	 *
	 * Once the initial visible images are handled,
	 * the queue is allowed to continue normally
	 * through offscreen images.
	 */

	thumbnailPriorityMode =
		false;

	processThumbnailQueue(
		session
	);

	/*
	 * -------------------------------------------------
	 * INTERSECTION OBSERVER
	 * -------------------------------------------------
	 */

	thumbnailObserver =
		new IntersectionObserver(
			entries => {

				const entered =
					entries.some(
						entry =>
							entry.isIntersecting
					);

				if (
					entered
				) {

					scheduleThumbnailVisibilityCheck();

				}

			},
			{
				root:
					null,

				rootMargin:
					"0px",

				threshold:
					0
			}
		);

	slots.forEach(
		slot => {

			thumbnailObserver.observe(
				slot
			);

		}
	);

	/*
	 * -------------------------------------------------
	 * SCROLL
	 * -------------------------------------------------
	 */

	window.addEventListener(
		"scroll",
		scheduleThumbnailVisibilityCheck,
		{
			passive:
				true
		}
	);

	window.addEventListener(
		"resize",
		scheduleThumbnailVisibilityCheck
	);

}

let mediumItems = [];
let mediumQueue = [];
let mediumLoading = false;

let mediumLoadSession = 0;

function stopMediumLoading() {

    mediumLoadSession++;

    mediumQueue =
        [];

    mediumLoading =
        false;
}

function loadMedium(
	item,
	session) {

	/*console.log(
		"[MEDIUM DEBUG] BACKGROUND REQUEST:",
		{
			index:
				item && item.index,

			src:
				item && item.src,

			mediumLoaded:
				item && item.mediumLoaded,

			mediumLoading:
				item && item.mediumLoading,

			hasImage:
				!!(
					item &&
					item.mediumImage
				)
		}
	);*/

	return new Promise(
		resolve => {

			if (
				!item ||
				item.mediumLoaded ||
				item.mediumLoading
			) {

				resolve();

				return;

			}

			if (
				session !==
				mediumLoadSession
			) {

				resolve();

				return;

			}

			/*
			 * -------------------------------------------------
			 * MEDIUM URL
			 * -------------------------------------------------
			 */

			const mediumURL =
				item.mediumSrc ||
				item.src;

			if (!mediumURL) {

				resolve();

				return;

			}

			/*
			 * -------------------------------------------------
			 * GET THE EXISTING MEDIUM IMAGE
			 * -------------------------------------------------
			 *
			 * The Medium queue now uses the actual image
			 * already contained inside the thumbnail slot.
			 *
			 * Do NOT create another Image() here.
			 */

			const img =
				item.mediumImage;

			if (!img) {

				console.warn(
					"[MEDIUM] No Medium image element:",
					item.index,
					mediumURL
				);

				resolve();

				return;

			}

			/*
			 * -------------------------------------------------
			 * START MEDIUM LOAD
			 * -------------------------------------------------
			 */

			item.mediumLoading =
				true;

			const finish =
				success => {

				img.onload =
					null;

				img.onerror =
					null;

				item.mediumLoading =
					false;

				if (
					session !==
					mediumLoadSession
				) {

					resolve();

					return;

				}

				if (success) {

					item.mediumLoaded =
						true;

					/*
					 * The actual Medium image in the
					 * gallery has now finished loading.
					 */

					img.style.visibility =
						"visible";
						
					img.style.opacity =
						"1";

					/*
					 * Keep the Medium image above the
					 * thumbnail.
					 */

					/*img.style.zIndex =
						"2";*/

					/*console.log(
						"[MEDIUM] LOADED:",
						item.index,
						mediumURL
					);*/

				}
				else {

					console.warn(
						"[MEDIUM] Failed:",
						mediumURL
					);

					/*
					 * Only clear the src. Do not throw
					 * away the DOM element because the
					 * slot still owns it.
					 */

					img.removeAttribute(
						"src"
					);

				}

				resolve();

			};

			const onLoad =
				() => {

				finish(
					true
				);

			};

			const onError =
				() => {

				finish(
					false
				);

			};

			img.onload =
				onLoad;

			img.onerror =
				onError;

			/*
			 * -------------------------------------------------
			 * LOAD INTO THE EXISTING DOM IMAGE
			 * -------------------------------------------------
			 */

			img.src =
				mediumURL;

		}
	);
}

async function processMediumQueue(
    session) {

    if (
        mediumLoading ||
        thumbnailPriorityPaused
    ) {

        return;

    }

    mediumLoading =
        true;

    while (
        mediumQueue.length &&
        session ===
            mediumLoadSession &&
        !thumbnailPriorityPaused
    ) {

        const item =
            mediumQueue.shift();

        if (
            !item ||
            item.mediumLoaded ||
            item.mediumLoading
        ) {

            continue;

        }

        await loadMedium(
            item,
            session
        );

    }

    mediumLoading =
        false;
}

function prioritizeVisibleMediums() {

    if (
        thumbnailPriorityPaused
    ) {

        return;

    }

    const slots =
        getThumbnailSlots();

    if (
        !slots.length
    )
        return;

    const visibleSlots =
        slots
            .map(
                (slot, position) => {

                    const rect =
                        slot.getBoundingClientRect();

                    return {
                        slot,
                        position,
                        rect
                    };

                }
            )
            .filter(
                item => {

                    return (
                        item.rect.bottom > 0 &&
                        item.rect.top <
                            window.innerHeight &&
                        item.rect.right > 0 &&
                        item.rect.left <
                            window.innerWidth
                    );

                }
            )
            .sort(
                (a, b) => {

                    if (
                        Math.abs(
                            a.rect.top -
                            b.rect.top
                        ) > 1
                    ) {

                        return (
                            a.rect.top -
                            b.rect.top
                        );

                    }

                    return (
                        a.rect.left -
                        b.rect.left
                    );

                }
            );

    const priority =
        [];

    const seen =
        new Set();

    visibleSlots.forEach(
        visible => {

            const item =
                mediumItems[
                    visible.position
                ];

            if (!item)
                return;

            if (
                item.mediumLoaded ||
                item.mediumLoading
            )
                return;

            if (
                seen.has(item)
            )
                return;

            seen.add(item);

            priority.push(item);

        }
    );

    if (
        !priority.length
    )
        return;

    const prioritySet =
        new Set(priority);

    mediumQueue =
        mediumQueue.filter(
            item =>
                !prioritySet.has(item)
        );

    priority.sort(
        (a, b) =>
            a.index -
            b.index
    );

    mediumQueue =
        priority.concat(
            mediumQueue
        );

    processMediumQueue(
        mediumLoadSession
    );
}

function startMediumLoading() {
	if (
		mediumLoading
	) {

		return;

	}
    stopMediumLoading();

    const session =
        mediumLoadSession;

    if (
        !mediumItems.length
    )
        return;

    const slots =
        getThumbnailSlots();

    const visibleSlots =
        slots
            .filter(
                slot => {

                    const rect =
                        slot.getBoundingClientRect();

                    return (
                        rect.bottom > 0 &&
                        rect.top <
                            window.innerHeight &&
                        rect.right > 0 &&
                        rect.left <
                            window.innerWidth
                    );

                }
            );

    const initial =
        [];

    visibleSlots.forEach(
        slot => {

            const index =
                Number(
                    slot.dataset.index
                );

            const item =
                mediumItems.find(
                    entry =>
                        entry.index ===
                        index
                );

            if (
                item &&
                !item.mediumLoaded &&
                !item.mediumLoading &&
                item.src
            ) {

                initial.push(
                    item
                );

            }

        }
    );

    initial.sort(
        (a, b) =>
            a.index -
            b.index
    );

    const initialSet =
        new Set(initial);

    mediumQueue =
        initial.concat(
            mediumItems.filter(
                item =>
                    !initialSet.has(item) &&
                    !item.mediumLoaded &&
                    !item.mediumLoading &&
                    item.src
            )
        );

    processMediumQueue(
        session
    );
}

function findMediumItem(
	src) {

	if (!src)
		return null;

	return mediumItems.find(
		item =>
			item &&
			(
				item.mediumSrc === src ||
				item.src === src
			)
	) || null;
}

function markMediumItemLoaded(
	url,
	image,
	blobURL = null
) {

	if (!url)
		return null;

	const item =
		findMediumItem(
			url
		);

	if (!item) {

		console.warn(
			"[MEDIUM] Could not find item for modal URL:",
			url
		);

		return null;

	}

	/*
	 * -------------------------------------------------
	 * KEEP THE EXISTING MEDIUM IMAGE ELEMENT
	 * -------------------------------------------------
	 *
	 * item.mediumImage must remain the actual
	 * <img> element belonging to the thumbnail slot.
	 *
	 * DO NOT replace it with the decoded Image()
	 * produced by the modal loader.
	 */

	const img =
		item.mediumImage;

	if (!img) {

		console.warn(
			"[MEDIUM] Item has no Medium image element:",
			item.index,
			url
		);

		return null;

	}

	/*
	 * -------------------------------------------------
	 * USE THE MODAL DOWNLOAD IN THE EXISTING ELEMENT
	 * -------------------------------------------------
	 *
	 * The modal has already downloaded and decoded
	 * this image, so use its blob URL instead of
	 * starting another network request.
	 */

	const mediumURL =
		blobURL;

	if (!mediumURL) {

		console.warn(
			"[MEDIUM] Modal Medium has no blob URL:",
			url
		);

		return null;

	}

	item.mediumLoading =
		true;

	/*
	 * -------------------------------------------------
	 * WAIT FOR THE EXISTING DOM IMAGE TO PROCESS IT
	 * -------------------------------------------------
	 *
	 * This deliberately mirrors loadMedium().
	 */

	const finish =
		success => {

		img.onload =
			null;

		img.onerror =
			null;

		item.mediumLoading =
			false;

		if (success) {

			item.mediumLoaded =
				true;

			img.style.visibility =
				"visible";

			img.style.opacity =
				"1";

			/*console.log(
				"[MEDIUM] MODAL -> DOM LOADED:",
				item.index,
				url
			);*/

		}
		else {

			item.mediumLoaded =
				false;

			console.warn(
				"[MEDIUM] Modal -> DOM failed:",
				url
			);

			img.removeAttribute(
				"src"
			);

		}

	};

	const onLoad =
		() => {

		finish(
			true
		);

	};

	const onError =
		() => {

		finish(
			false
		);

	};

	img.onload =
		onLoad;

	img.onerror =
		onError;

	/*
	 * -------------------------------------------------
	 * PUT THE MODAL'S BLOB INTO THE EXISTING
	 * MEDIUM-IMAGE ELEMENT
	 * -------------------------------------------------
	 */

	img.src =
		mediumURL;

	/*
	 * -------------------------------------------------
	 * STORE THE BLOB URL
	 * -------------------------------------------------
	 */

	item.mediumBlobURL =
		mediumURL;

	/*
	 * -------------------------------------------------
	 * REMOVE FROM BACKGROUND QUEUE
	 * -------------------------------------------------
	 */

	mediumQueue =
		mediumQueue.filter(
			queueItem =>
				queueItem !== item
		);

	return item;
}

async function reloadAlbums() {

    albums.length = 0;

    /*
     * -------------------------------------------------
     * PASTEPILE ID
     * -------------------------------------------------
     */

    const PASTEPILE_STORAGE_KEY =
        "pastepileID";

    const query =
        window.location.search.substring(1);

    let pasteID =
        null;

    /*
     * Explicit Pastepile ID in URL:
     *
     * ?@pastepileID
     */

    if (
        query.startsWith("@")
    ) {

        pasteID =
            decodeURIComponent(
                query.substring(1)
            );

        /*
         * Save it for future page loads.
         */

        localStorage.setItem(
            PASTEPILE_STORAGE_KEY,
            pasteID
        );

        /*console.log(
            "[ALBUMS] Saved Pastepile ID:",
            pasteID
        );*/

    }

    /*
     * No Pastepile ID in URL.
     *
     * Try the previously saved one.
     */

    else {

        pasteID =
            localStorage.getItem(
                PASTEPILE_STORAGE_KEY
            );

        if (pasteID) {

            /*console.log(
                "[ALBUMS] Using saved Pastepile ID:",
                pasteID
            );*/

        }

    }

    /*
     * -------------------------------------------------
     * GET MANUAL ALBUMS
     * -------------------------------------------------
     */

    let manualAlbums = [];

    /*
     * -------------------------------------------------
     * PASTEPILE
     * -------------------------------------------------
     */

    if (pasteID) {

        try {

            /*console.log(
                "[ALBUMS] Loading Pastepile:",
                pasteID
            );*/

            const response =
                await fetch(
                    `https://www.pastepile.com/raw/${pasteID}`
                );

            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );

            }

            const text =
                await response.text();

            /*console.log(
                "[ALBUMS] Pastepile text received:",
                text
            );*/

            /*
             * -------------------------------------------------
             * FIND MANUAL_ALBUMS
             * -------------------------------------------------
             */

            const start =
                text.indexOf(
                    "MANUAL_ALBUMS"
                );

            if (
                start === -1
            ) {

                throw new Error(
                    "MANUAL_ALBUMS was not found in Pastepile."
                );

            }

            const arrayStart =
                text.indexOf(
                    "[",
                    start
                );

            if (
                arrayStart === -1
            ) {

                throw new Error(
                    "MANUAL_ALBUMS array start was not found."
                );

            }

            /*
             * -------------------------------------------------
             * FIND MATCHING ]
             * -------------------------------------------------
             */

            let depth =
                0;

            let arrayEnd =
                -1;

            let inString =
                false;

            let stringChar =
                null;

            let escaped =
                false;

            for (
                let i = arrayStart;
                i < text.length;
                i++
            ) {

                const char =
                    text[i];

                if (escaped) {

                    escaped =
                        false;

                    continue;

                }

                if (inString) {

                    if (
                        char === "\\"
                    ) {

                        escaped =
                            true;

                    }
                    else if (
                        char === stringChar
                    ) {

                        inString =
                            false;

                        stringChar =
                            null;

                    }

                    continue;

                }

                if (
                    char === '"' ||
                    char === "'" ||
                    char === "`"
                ) {

                    inString =
                        true;

                    stringChar =
                        char;

                    continue;

                }

                if (
                    char === "["
                ) {

                    depth++;

                }
                else if (
                    char === "]"
                ) {

                    depth--;

                    if (
                        depth === 0
                    ) {

                        arrayEnd =
                            i;

                        break;

                    }

                }

            }

            if (
                arrayEnd === -1
            ) {

                throw new Error(
                    "Could not find end of MANUAL_ALBUMS."
                );

            }

            const arrayText =
                text.substring(
                    arrayStart,
                    arrayEnd + 1
                );

            /*console.log(
                "[ALBUMS] Extracted MANUAL_ALBUMS:"
            );*/

            /*console.log(
                arrayText
            );*/

            /*
             * -------------------------------------------------
             * CONVERT TEXT TO ARRAY
             * -------------------------------------------------
             */

            manualAlbums =
                Function(
                    `"use strict"; return (${arrayText});`
                )();

            if (
                !Array.isArray(
                    manualAlbums
                )
            ) {

                throw new Error(
                    "Extracted MANUAL_ALBUMS is not an array."
                );

            }

            /*console.log(
                "[ALBUMS] Parsed Pastepile albums:",
                manualAlbums.length
            );*/

        }
        catch (error) {

            console.error(
                "[ALBUMS] Pastepile error:",
                error
            );

            manualAlbums =
                [];

        }

    }

    /*
     * -------------------------------------------------
     * LOCAL albums.js
     * -------------------------------------------------
     *
     * Only use the local MANUAL_ALBUMS when there
     * is no saved/explicit Pastepile ID.
     */

    else if (
        typeof MANUAL_ALBUMS !==
        "undefined"
    ) {

        manualAlbums =
            MANUAL_ALBUMS;

    }

    /*
     * -------------------------------------------------
     * ADD MANUAL / PASTEPILE ALBUMS
     * -------------------------------------------------
     */

    manualAlbums.forEach(
        album => {

            albums.push({

                id:
                    album.id,

                name:
                    album.name,

                images:
                    parseQuery(
                        getAlbumQuery(
                            album.url
                        )
                    ),

                tags:
                    album.tags ||
                    []

            });

        }
    );

    /*
     * -------------------------------------------------
     * SAVED LOCALSTORAGE ALBUMS
     * -------------------------------------------------
     */

    const saved =
        JSON.parse(
            localStorage.getItem(
                "savedAlbums"
            ) || "[]"
        );

    saved.forEach(
        album => {

            albums.push({

                ...album,

                tags:
                    album.tags ||
                    [],

                storage:
                    true

            });

        }
    );

}

function showAlbumButtons(show) {

    document.getElementById("backButton").style.display =
        show ? "" : "none";

    document.getElementById("saveButton").style.display =
        (show && isQueryAlbum) ? "flex" : "none";
}

function saveCurrentAlbum() {

    if (!currentAlbum)
        return;

    const saved = JSON.parse(
            localStorage.getItem("savedAlbums") || "[]");

    // Find next album number
    // Find next Temp album number
    let number = 1;

    saved.forEach(album => {

        const match = album.name.match(/^Temp_(\d+)$/);

        if (match) {
            const n = Number(match[1]);

            if (n >= number) {
                number = n + 1;
            }
        }

    });

    saved.push({
        id: crypto.randomUUID(),
        name: `Temp_${number}`,
        images: currentAlbum.images,
        tags: currentAlbum.tags || []
    });

    localStorage.setItem(
        "savedAlbums",
        JSON.stringify(saved));

    alert("Album saved as " + `Temp_${number}`);
}

const modal =
    document.getElementById("modal");

let suppressModalClick = false;

function resetImageTransform() {

    imgTransform.x = 0;
    imgTransform.y = 0;
    imgTransform.scale = minZoom;

    applyTransform();
}

let modalImgSmall = null;
let modalImgMedium = null;
let modalImgFull = null;

let modalMediumLoaded = false;
let modalMediumLoading = false;
let modalMediumImage = null;

let fullImageLoading = false;
let fullImageLoaded = false;
let displayingFull = false;

let modalTemporaryMedium = false;
let modalMediumTimer = null;

const minZoom = 1;
const maxZoom = 5;
const zoomStep = 0.25;
const zoomTargetStrength = 1.85;
const imagePanBoundaryMultiplier = 1;

const autoResolutionSwitch = true;
const autoResolutionSwitchDelay = 500;
const autoResolutionSwitchRatio = 0.125;

const resolutionSwitchOnZoom = true;
const resolutionSwitchOnPan = false;
const resolutionSwitchDelay = 100;
const resolutionSwitchRatio = 0.250;

let centerAnimationFrame = null;
let centerAnimationStart = 0;

let centerReturnTimer = null;
let centerReturnAnimation = null;
const centerAnimationDuration = 3000;
const centerAnimationThreshold = 0.50;

let zoomEndTimer = null

    let zoomLevelTimer = null;
const zoomLevelDisplay = document.getElementById("zoomLevel");

const fullSwitchZoom =
    minZoom +
    (maxZoom - minZoom) *
    autoResolutionSwitchRatio;

const resolutionSwitchZoom =
    minZoom +
    (maxZoom - minZoom) *
    resolutionSwitchRatio;

let fullSwitchTimer = null;

let interactingWithImage = false;
let zoomSwitchedFromFull = false;
let panStartedInFull = false;

async function load(url, name, loadID) {

	if (!url)
		return;

	/*
	 * -------------------------------------------------
	 * PREVENT DUPLICATE FULL DOWNLOADS
	 * -------------------------------------------------
	 */

	if (name === "full") {

		if (fullImageLoading)
			return;

		fullImageLoading =
			true;

	}

	/*
	 * -------------------------------------------------
	 * LOADING UI
	 * -------------------------------------------------
	 */

	const loadingBar =
		document.getElementById(
			"modalLoadingBar");

	const loadingProgress =
		document.getElementById(
			"modalLoadingProgress");

	const showLoadingBar = (
		resetProgress = true) => {

		if (loadingBar) {

			loadingBar.style.opacity =
				"1";

		}

		if (
			resetProgress &&
			loadingProgress) {

			loadingProgress.style.width =
				"0%";

		}

	};

	const hideLoadingBar = () => {

		if (loadingBar) {

			loadingBar.style.opacity =
				"0";

		}

	};

	/*
	 * -------------------------------------------------
	 * RESET LOADING BAR
	 * -------------------------------------------------
	 */

	if (
		name === "medium" ||
		name === "full") {

		if (loadingBar) {

			loadingBar.style.opacity =
				"0";

		}

		if (loadingProgress) {

			loadingProgress.style.width =
				"0%";

		}

	}

	/*
	 * -------------------------------------------------
	 * ABORT CONTROLLER
	 * -------------------------------------------------
	 */

	const controller =
		new AbortController();

	activeImageLoaders.push(
		controller);

	const removeLoader = () => {

		const index =
			activeImageLoaders.indexOf(
				controller);

		if (index !== -1) {

			activeImageLoaders.splice(
				index,
				1);

		}

	};

	try {

		const response =
			await fetch(
				url, {
				signal:
				controller.signal
			});

		if (!response.ok) {

			throw new Error(
				`HTTP ${response.status} ${response.statusText}`);

		}

		/*
		 * -------------------------------------------------
		 * CONTENT LENGTH
		 * -------------------------------------------------
		 */

		const total =
			Number(
				response.headers.get(
					"Content-Length")) || 0;

		const reader =
			response.body.getReader();

		const chunks =
			[];

		let received =
			0;

		let chunkCount =
			0;

		/*
		 * -------------------------------------------------
		 * DOWNLOAD
		 * -------------------------------------------------
		 */

		while (true) {

			const {
				done,
				value
			} =
				await reader.read();

			if (done)
				break;

			chunkCount++;

			chunks.push(
				value);

			received +=
				value.length;

			/*
			 * -------------------------------------------------
			 * SHOW BAR AFTER FIRST REAL CHUNK
			 * -------------------------------------------------
			 */

			if (
				chunkCount === 1 &&
				isModalLoadActive(loadID) &&
				loadingBar) {

				const downloadComplete =
					total &&
					received >= total;

				if (!downloadComplete) {

					showLoadingBar();

				}

			}

			/*
			 * -------------------------------------------------
			 * UPDATE PROGRESS
			 * -------------------------------------------------
			 */

			if (
				isModalLoadActive(loadID) &&
				loadingProgress) {

				if (total) {

					const percent =
						Math.min(
							100,
							(
								received /
								total
							) * 100);

					loadingProgress.style.width =
						`${percent}%`;

				} else {

					const pseudoPercent =
						10 +
						(
							(
								received /
								(
									received +
									1024 * 1024
								)
							) * 80
						);

					loadingProgress.style.width =
						`${Math.min(
							90,
							pseudoPercent
						)}%`;

				}

			}

		}

		/*
		 * -------------------------------------------------
		 * DOWNLOAD COMPLETE
		 * -------------------------------------------------
		 */

		if (
			isModalLoadActive(loadID) &&
			loadingProgress) {

			loadingProgress.style.width =
				"100%";

		}

		/*
		 * -------------------------------------------------
		 * BUILD BLOB
		 * -------------------------------------------------
		 */

		const blob =
			new Blob(
				chunks, {
				type:
					response.headers.get(
						"Content-Type") ||
					"image/jpeg"
			});

		const blobURL =
			URL.createObjectURL(
				blob);

		/*
		 * -------------------------------------------------
		 * CHECK FOR CLOSED / STALE MODAL
		 * -------------------------------------------------
		 */

		if (!isModalLoadActive(loadID)) {

			URL.revokeObjectURL(
				blobURL);

			/*
			 * IMPORTANT:
			 *
			 * AbortController cannot cancel a decode
			 * that has already progressed beyond fetch.
			 *
			 * Therefore explicitly release the Full
			 * loading lock here.
			 */

			if (name === "full") {

				fullImageLoading =
					false;

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * DECODE
		 * -------------------------------------------------
		 */

		const decodedImage =
			new Image();

		decodedImage.src =
			blobURL;

		await new Promise(
			(
				resolve,
				reject) => {

				decodedImage.onload =
					resolve;

				decodedImage.onerror =
					reject;

			});

		if (decodedImage.decode) {

			try {

				await decodedImage.decode();

			} catch {}

		}

		/*
		 * -------------------------------------------------
		 * CHECK AGAIN AFTER DECODE
		 * -------------------------------------------------
		 *
		 * THIS is the important cancellation path.
		 */

		if (!isModalLoadActive(loadID)) {

			URL.revokeObjectURL(
				blobURL);

			if (name === "full") {

				fullImageLoading =
					false;

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * THUMBNAIL
		 * -------------------------------------------------
		 */

		if (name === "thumb") {

			if (modalImgSmall) {

				modalImgSmall.src =
					blobURL;

				resizeThumb(
					modalImgSmall);

				modalImgSmall.style.visibility =
					"visible";

				modalImgSmall.style.zIndex =
					"4";

			}

			if (modalMediumSrc) {

				load(
					modalMediumSrc,
					"medium",
					loadID);

			} else if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * MEDIUM
		 * -------------------------------------------------
		 */

		if (name === "medium") {

			/*console.log(
				"[MEDIUM DEBUG] MODAL LOAD REACHED:",
				{
					url,
					modalImgMedium:
						!!modalImgMedium,
					loadID
				}
			);*/

			if (!modalImgMedium) {

				modalMediumLoading =
					false;

				return;

			}

			const registeredMedium =
				markMediumItemLoaded(
					url,
					decodedImage,
					blobURL
				);

			/*console.log(
				"[MEDIUM DEBUG] MODAL REGISTERED:",
				registeredMedium &&
				{
					index:
						registeredMedium.index,

					src:
						registeredMedium.src,

					mediumLoaded:
						registeredMedium.mediumLoaded,

					mediumLoading:
						registeredMedium.mediumLoading,

					hasImage:
						!!registeredMedium.mediumImage
				}
			);*/

			/*
			 * -------------------------------------------------
			 * MEDIUM IMAGE
			 * -------------------------------------------------
			 */

			modalImgMedium.style.visibility =
				"hidden";

			modalImgMedium.style.opacity =
				"1";

			modalImgMedium.style.zIndex =
				"3";

			modalImgMedium.src =
				blobURL;

			if (
				decodedImage &&
				decodedImage.naturalWidth &&
				decodedImage.naturalHeight
			) {

				const wW =
					window.innerWidth;

				const wH =
					window.innerHeight;

				const iW =
					decodedImage.naturalWidth;

				const iH =
					decodedImage.naturalHeight;

				const scale =
					Math.min(
						wW / iW,
						wH / iH
					);

				modalImgMedium.style.width =
					`${iW * scale}px`;

				modalImgMedium.style.height =
					`${iH * scale}px`;

			}

			modalMediumLoaded =
				true;

			modalMediumLoading =
				false;

			modalMediumImage =
				decodedImage;

			displayingFull =
				false;

			modalImgMedium.dataset.showingFull =
				"false";

			/*
			 * -------------------------------------------------
			 * SHOW MEDIUM
			 * -------------------------------------------------
			 */

			modalImgMedium.style.visibility =
				"visible";

			modalImgMedium.style.opacity =
				"1";

			modalImgMedium.style.filter =
				"none";

			modalImgMedium.style.zIndex =
				"3";

			if (modalImgSmall) {

				modalImgSmall.style.visibility =
					"hidden";

				modalImgSmall.style.opacity =
					"0";

			}

			if (modalImgFull) {

				modalImgFull.style.visibility =
					"hidden";

				modalImgFull.style.zIndex =
					"2";

			}

			applyTransform();

			/*
			 * -------------------------------------------------
			 * MEDIUM LOADING UI
			 * -------------------------------------------------
			 */

			if (loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

			/*
			 * -------------------------------------------------
			 * START FULL BACKGROUND DOWNLOAD
			 * -------------------------------------------------
			 */

			if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID
				);

			} else {

				setTimeout(
					() => {

						if (
							isModalLoadActive(loadID) &&
							!fullImageLoading
						) {

							hideLoadingBar();

						}

					},
					250
				);

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * FULL
		 * -------------------------------------------------
		 */

		if (name === "full") {

			if (!modalImgFull) {

				fullImageLoading =
					false;

				hideLoadingBar();

				return;

			}

			modalImgFull.src =
				blobURL;

			modalImgFull.style.visibility =
				"hidden";

			modalImgFull.style.opacity =
				"1";

			modalImgFull.style.filter =
				"none";

			fullImageLoaded =
				true;

			modalFullLoaded =
				true;

			fullImageLoading =
				false;

			if (loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

			setTimeout(
				() => {

				if (
					isModalLoadActive(loadID) &&
					!fullImageLoading) {

					hideLoadingBar();

				}

			},
				300);

			if (loadingTimer) {

				clearTimeout(
					loadingTimer);

				loadingTimer =
					null;

			}

			if (modalLoading) {

				modalLoading.classList.remove(
					"active");

				modalLoading.style.opacity =
					"0";

			}

			/*
			 * -------------------------------------------------
			 * NO MEDIUM
			 * -------------------------------------------------
			 */

			if (!modalMediumSrc) {

				imgResize(
					modalImgFull);

				modalImgFull.style.left =
					"50%";

				modalImgFull.style.top =
					"50%";

				modalImgFull.style.visibility =
					"visible";

				modalImgFull.style.zIndex =
					"3";

				displayingFull =
					true;

				modalImgFull.dataset.showingFull =
					"true";

				if (modalImgSmall) {

					modalImgSmall.style.visibility =
						"hidden";

					modalImgSmall.style.opacity =
						"0";

				}

				applyTransform();

				return;

			}

			/*
			 * -------------------------------------------------
			 * MEDIUM EXISTS
			 * -------------------------------------------------
			 */

			if (modalImgMedium) {

				modalImgFull.style.width =
					modalImgMedium.style.width;

				modalImgFull.style.height =
					modalImgMedium.style.height;

			}

			modalImgFull.style.left =
				"50%";

			modalImgFull.style.top =
				"50%";

			modalImgFull.style.visibility =
				"hidden";

			applyTransform();

			/*
			 * -------------------------------------------------
			 * AUTOMATIC / ZOOM RESOLUTION SWITCH
			 * -------------------------------------------------
			 */

			if (
				!displayingFull &&
				!imgDragging &&
				!interactingWithImage &&
				!manualFullEnabled) {

				const wantsFull =
					autoResolutionSwitch &&
					imgTransform.scale >=
					fullSwitchZoom;

				if (wantsFull) {

					if (fullSwitchTimer) {

						clearTimeout(
							fullSwitchTimer);

						fullSwitchTimer =
							null;

					}

					fullSwitchTimer =
						setTimeout(
							() => {

							fullSwitchTimer =
								null;

							if (
								manualFullEnabled ||
								displayingFull ||
								imgDragging ||
								interactingWithImage) {

								return;

							}

							const stillWantsFull =
								autoResolutionSwitch &&
								imgTransform.scale >=
								fullSwitchZoom;

							if (!stillWantsFull)
								return;

							switchToFull();

						},

							resolutionSwitchOnZoom
								? resolutionSwitchDelay
								: autoResolutionSwitchDelay);

				}

			}

			return;

		}

	} catch (error) {

		/*
		 * -------------------------------------------------
		 * ABORTED
		 * -------------------------------------------------
		 */

		if (
			error.name ===
			"AbortError") {

			if (name === "full") {

				fullImageLoading =
					false;

			}

			if (name === "medium") {

				modalMediumLoading =
					false;

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * STALE MODAL
		 * -------------------------------------------------
		 */

		if (!isModalLoadActive(loadID)) {

			if (name === "full") {

				fullImageLoading =
					false;

			}

			if (name === "medium") {

				modalMediumLoading =
					false;

			}

			return;

		}

		console.warn(
			`[MODAL] ${name.toUpperCase()} failed:`,
			url,
			error);

		/*
		 * -------------------------------------------------
		 * FULL FAILED
		 * -------------------------------------------------
		 */

		if (name === "full") {

			fullImageLoading =
				false;

			fullImageLoaded =
				false;

			modalFullLoaded =
				false;

		}

		hideLoadingBar();

		if (loadingProgress) {

			loadingProgress.style.width =
				"0%";

		}

		if (modalLoading) {

			modalLoading.classList.remove(
				"active");

			modalLoading.style.opacity =
				"0";

		}

		/*
		 * -------------------------------------------------
		 * MEDIUM FAILED
		 * -------------------------------------------------
		 */

		if (name === "medium") {

			modalMediumLoaded =
				false;

			modalMediumLoading =
				false;

			console.warn(
				"[MODAL] Medium failed, falling back to Full:",
				url);

			if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * FULL FAILED
		 * -------------------------------------------------
		 */

		if (name === "full") {

			if (
				modalMediumSrc &&
				modalMediumLoaded) {

				displayingFull =
					false;

				showMediumImage();

			}

			return;

		}

		/*
		 * -------------------------------------------------
		 * THUMBNAIL FAILED
		 * -------------------------------------------------
		 */

		if (name === "thumb") {

			if (modalMediumSrc) {

				load(
					modalMediumSrc,
					"medium",
					loadID);

			} else if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

		}

	} finally {

		removeLoader();

	}

}

function isModalLoadActive(id) {
    return id === modalLoadID;
}

function openModal(thumbSrc, mediumSrc, fullSrc, sourceThumb) {
	pauseThumbnailLoading();
	stopMediumLoading();

	const sourceItem =
		sourceThumb?._thumbnailItem || null;

	const mediumItem =
		findMediumItem(
			mediumSrc
		);

	const sourceMediumImage =
		(
			mediumItem &&
			mediumItem.mediumLoaded &&
			mediumItem.mediumImage
		)
			? mediumItem.mediumImage
			: null;
			
	/*console.log(
    "[MEDIUM DEBUG] OPEN MODAL:",
    {
        mediumSrc:
            mediumSrc,

        mediumItem:
            mediumItem
                ? {
                    index:
                        mediumItem.index,

                    src:
                        mediumItem.src,

                    mediumLoaded:
                        mediumItem.mediumLoaded,

                    mediumLoading:
                        mediumItem.mediumLoading,

                    mediumImage:
                        !!mediumItem.mediumImage,

                    loaded:
                        mediumItem.loaded,

                    loading:
                        mediumItem.loading,

                    image:
                        !!mediumItem.image
                }
                : null,

        sourceMediumImage:
            !!sourceMediumImage
    }
);*/

    const loadID =
        ++modalLoadID;

    manualFullEnabled =
        false;

    modalMediumSrc =
        mediumSrc;

    modalFullSrc =
        fullSrc;

    modalMediumLoaded =
        false;

    modalMediumLoading =
        false;

    modalMediumImage =
        null;

    modalTemporaryMedium =
        false;

    modalFullLoaded =
        false;

    modalShowingFull =
        false;

    fullImageLoading =
        false;

    fullImageLoaded =
        false;

    displayingFull =
        false;

    /*
     * -------------------------------------------------
     * CANCEL PREVIOUS LOADS / TIMERS
     * -------------------------------------------------
     */

    if (modalMediumTimer) {

        clearTimeout(
            modalMediumTimer);

        modalMediumTimer =
            null;

    }

    if (fullSwitchTimer) {

        clearTimeout(
            fullSwitchTimer);

        fullSwitchTimer =
            null;

    }

    cancelImageLoads();

    /*
     * -------------------------------------------------
     * MODAL
     * -------------------------------------------------
     */

    const modal =
        document.getElementById(
            "modal");

    document.documentElement.style.overflow =
        "hidden";

    document.body.style.overflow =
        "hidden";

    modalImgSmall =
        document.getElementById(
            "modalImgSmall");

    modalImgMedium =
        document.getElementById(
            "modalImgMedium");

    modalImgFull =
        document.getElementById(
            "modalImgFull");

    const loader =
        document.getElementById(
            "modalLoading");

    const fullButton =
        document.getElementById(
            "modalFullButton");

    /*
     * -------------------------------------------------
     * SHOW MODAL IMMEDIATELY
     * -------------------------------------------------
     *
     * This is important when navigating between images.
     *
     * The old Medium / Full images are hidden first,
     * then the already-existing album thumbnail becomes
     * the only visible image.
     */

    modal.style.display =
        "flex";

	/*
	 * -------------------------------------------------
	 * CAPTURE SOURCE THUMBNAIL
	 * -------------------------------------------------
	 *
	 * sourceThumb is now the thumbnail SLOT/container,
	 * not the actual thumbnail <img>.
	 *
	 * Get the actual thumbnail image from inside it.
	 */

	let sourceThumbRect =
		null;

	let sourceThumbSrc =
		null;

	let sourceThumbnailImage =
		null;

	if (sourceThumb) {

		sourceThumbnailImage =
			sourceThumb.querySelector(
				".thumbnail-image"
			);

		if (sourceThumbnailImage) {

			const rect =
				sourceThumbnailImage.getBoundingClientRect();

			sourceThumbRect = {

				left:
					rect.left,

				top:
					rect.top,

				width:
					rect.width,

				height:
					rect.height

			};

			sourceThumbSrc =
				sourceThumbnailImage.currentSrc ||
				sourceThumbnailImage.src ||
				null;

		}

	}

    /*
     * -------------------------------------------------
     * RESET SMALL
     * -------------------------------------------------
     *
     * Small is the temporary/initial image.
     *
     * It is placed ABOVE Medium and Full so there is
     * never a frame where an old resolution can show
     * through while the new image is downloading.
     */

    if (modalImgSmall) {

        modalImgSmall.style.visibility =
            "hidden";

        modalImgSmall.style.opacity =
            "1";

        modalImgSmall.style.zIndex =
            "4";

        modalImgSmall.style.position =
            "absolute";

        modalImgSmall.style.left =
            "50%";

        modalImgSmall.style.top =
            "50%";

        modalImgSmall.style.contain =
            "none";

        modalImgSmall.style.objectFit =
            "contain";

        modalImgSmall.style.transform =
            "translate(-50%, -50%)";

        modalImgSmall.src =
            "";

        /*
         * -------------------------------------------------
         * REUSE ALBUM THUMBNAIL
         * -------------------------------------------------
         *
         * Do NOT fetch thumbSrc here.
         *
         * The thumbnail is already loaded by the gallery.
         */

        if (
            sourceThumb &&
            sourceThumbSrc) {

            modalImgSmall.src =
                sourceThumbSrc;

            /*
             * Preserve the thumbnail's current displayed
             * dimensions.
             */

            if (sourceThumbRect) {

                modalImgSmall.style.width =
                    sourceThumbRect.width +
                    "px";

                modalImgSmall.style.height =
                    sourceThumbRect.height +
                    "px";

            }

            /*
             * Make it visible immediately.
             */

            modalImgSmall.style.visibility =
                "visible";

        }

    }

    /*
     * -------------------------------------------------
     * RESET MEDIUM
     * -------------------------------------------------
     *
     * IMPORTANT:
     *
     * Medium starts HIDDEN.
     *
     * Previously this was "visible", which allowed the
     * previous image to remain visible while the new
     * Medium was downloading.
     */

    if (modalImgMedium) {

        modalImgMedium.style.visibility =
            "hidden";

        modalImgMedium.style.opacity =
            "1";

        modalImgMedium.style.zIndex =
            "3";

        modalImgMedium.style.position =
            "absolute";

        modalImgMedium.style.left =
            "50%";

        modalImgMedium.style.top =
            "50%";

        modalImgMedium.style.contain =
            "none";

        modalImgMedium.style.objectFit =
            "contain";

    }

    /*
     * -------------------------------------------------
     * RESET FULL
     * -------------------------------------------------
     */

    if (modalImgFull) {

        modalImgFull.style.visibility =
            "hidden";

        modalImgFull.style.opacity =
            "1";

        modalImgFull.style.filter =
            "none";

        modalImgFull.style.zIndex =
            "3";

        modalImgFull.style.position =
            "absolute";

        modalImgFull.style.left =
            "50%";

        modalImgFull.style.top =
            "50%";

        modalImgFull.style.contain =
            "none";

        modalImgFull.style.objectFit =
            "contain";

        modalImgFull.style.transform =
            "translate(-50%, -50%) translate(0px, 0px) scale(1)";

        modalImgFull.src =
            "";

    }

    /*
     * -------------------------------------------------
     * RESET LOADING UI
     * -------------------------------------------------
     */

    if (loadingTimer) {

        clearTimeout(
            loadingTimer);

        loadingTimer =
            null;

    }

    if (loader) {

        loader.classList.remove(
            "active");

    }

    /*
     * -------------------------------------------------
     * RESET TRANSFORM
     * -------------------------------------------------
     */

    imgTransform = {

        x:
        0,

        y:
        0,

        scale:
        minZoom

    };

    applyTransform();

    imgDragging =
        false;

    imgMoved =
        false;

    interactingWithImage =
        false;

    zoomSwitchedFromFull =
        false;

    /*
     * -------------------------------------------------
     * RESET ZOOM ANCHOR
     * -------------------------------------------------
     */

    zooming =
        false;

    zoomAnchorX =
        0;

    zoomAnchorY =
        0;

    let stage =
        -1;

    /*
     * -------------------------------------------------
     * FULL-RESOLUTION BUTTON
     * -------------------------------------------------
     */

    if (fullButton) {

        const hasMedium =
            !!mediumSrc;

        const hasFull =
            !!fullSrc;

        const hasMultipleResolutions =
            hasMedium &&
            hasFull;

        fullButton.style.display =
            hasMultipleResolutions
             ? "block"
             : "none";

        fullButton.disabled =
            false;

        fullButton.style.opacity =
            "0.8";

        if (!hasMultipleResolutions) {

            fullButton.onclick =
                null;

            fullButton.onpointerdown =
                null;

            fullButton.onpointerup =
                null;

        } else {

            fullButton.onclick =
                e => {

                e.stopPropagation();

                if (manualFullEnabled) {

                    manualFullEnabled =
                        false;

                    enforceAutoResolution();

                    return;

                }

                if (fullImageLoaded) {

                    manualFullEnabled =
                        true;

                    if (fullSwitchTimer) {

                        clearTimeout(
                            fullSwitchTimer);

                        fullSwitchTimer =
                            null;

                    }

                    switchToFull();

                }

            };

            fullButton.onpointerdown =
                e => {

                e.stopPropagation();

            };

            fullButton.onpointerup =
                e => {

                e.stopPropagation();

            };

        }

    }

    /*
     * -------------------------------------------------
     * DISPLAY A LOADED STAGE
     * -------------------------------------------------
     */

    function display(
        url,
        resize,
        newStage) {

        if (!isModalLoadActive(loadID))
            return;

        if (newStage <= stage)
            return;

        /*
         * Full loads in the background.
         */

        if (newStage === 2) {

            fullImageLoaded =
                true;

            modalFullLoaded =
                true;
				
			resumeThumbnailLoading();

            return;

        }

        stage =
            newStage;

        /*
         * -------------------------------------------------
         * THUMBNAIL
         * -------------------------------------------------
         */

        if (newStage === 0) {

            if (!modalImgSmall)
                return;

            modalImgSmall.src =
                url;

            resizeThumb(
                modalImgSmall);

            modalImgSmall.style.visibility =
                "visible";

            modalImgSmall.style.opacity =
                "1";

            modalImgSmall.style.filter =
                "none";

            modalImgSmall.style.zIndex =
                "4";

            applyTransform();

            return;

        }

		/*
		 * -------------------------------------------------
		 * MEDIUM
		 * -------------------------------------------------
		 */

		if (newStage === 1) {

			if (!modalImgMedium)
				return;

			const showMedium =
				() => {

				if (!isModalLoadActive(loadID))
					return;

				/*
				 * The modal's own Medium image is now
				 * actually loaded, so naturalWidth and
				 * naturalHeight are available.
				 */

				imgResize(
					modalImgMedium
				);

				modalMediumLoaded =
					true;

				displayingFull =
					false;

				modalImgMedium.dataset.showingFull =
					"false";

				/*
				 * Medium is now ready.
				 */

				modalImgMedium.style.visibility =
					"visible";

				modalImgMedium.style.opacity =
					"1";

				modalImgMedium.style.zIndex =
					"3";

				/*
				 * Only now remove the temporary
				 * thumbnail.
				 */

				if (modalImgSmall) {

					modalImgSmall.style.visibility =
						"hidden";

					modalImgSmall.style.opacity =
						"0";

				}

				showMediumImage();

				applyTransform();

				if (loadingTimer) {

					clearTimeout(
						loadingTimer
					);

					loadingTimer =
						null;

				}

				if (loader) {

					loader.classList.remove(
						"active"
					);

				}

				if (!fullSrc) {

					resumeThumbnailLoading();

				}

			};

			/*
			 * Give the modal Medium the URL.
			 */

			modalImgMedium.src =
				url;

			/*
			 * If the browser already has the image
			 * available synchronously, use it now.
			 *
			 * Otherwise wait for the modal image's
			 * own load event.
			 */

			if (
				modalImgMedium.complete &&
				modalImgMedium.naturalWidth > 0
			) {

				showMedium();

			} else {

				modalImgMedium.onload =
					() => {

					modalImgMedium.onload =
						null;

					showMedium();

				};

				modalImgMedium.onerror =
					() => {

					modalImgMedium.onload =
						null;

				};

			}

		}

    }
	
	/*
     * -------------------------------------------------
     * MODAL-WIDE INTERACTION
     * -------------------------------------------------
     */

    modal.addEventListener(
        "wheel",
        imgZoom, {
        passive: false
    });

    modal.addEventListener(
        "pointerdown",
        imgPan);

    modal.addEventListener(
        "pointermove",
        panImage);

    modal.addEventListener(
        "pointerup",
        imgPanEnd);

    modal.addEventListener(
        "pointercancel",
        imgPanEnd);

    /*
     * -------------------------------------------------
     * PINCH ZOOM
     * -------------------------------------------------
     */

    modal.addEventListener(
        "touchstart",
        e => {

        if (e.touches.length === 2) {

            e.preventDefault();

            lastPinchDistance =
                getPinchDistance(
                    e.touches);

        }

    }, {
        passive: false
    });

    modal.addEventListener(
        "touchmove",
        e => {

        if (e.touches.length === 2) {

            e.preventDefault();

            const distance =
                getPinchDistance(
                    e.touches);

            const change =
                distance -
                lastPinchDistance;

            imgTransform.scale =
                clamp(
                    imgTransform.scale +
                    change * 0.005,

                    minZoom,
                    maxZoom);

            lastPinchDistance =
                distance;

            applyTransform();

            const img =
                displayingFull
                 ? modalImgFull
                 : modalImgMedium;

            if (img)
                constrainImage(img);

        }

    }, {
        passive: false
    });

    modal.addEventListener(
        "touchend",
        e => {

        if (e.touches.length < 2)
            lastPinchDistance =
                0;

    });

	/*
	 * -------------------------------------------------
	 * FULL IMAGE LOAD = RESUME THUMBNAIL LOADING
	 * -------------------------------------------------
	 *
	 * The actual Full image load event is the
	 * authoritative signal that modal priority is done.
	 */

	if (modalImgFull) {

		modalImgFull.addEventListener(
			"load",
			() => {

				if (
					!isModalLoadActive(loadID)
				) {

					return;

				}

				fullImageLoaded =
					true;

				modalFullLoaded =
					true;

				/*
				 * Full is actually loaded.
				 * Resume the gallery loader now.
				 */

				resumeThumbnailLoading();

			},
			{
				once:
					true
			}
		);

	}

    /*
	 * -------------------------------------------------
	 * START MEDIUM / FULL LOADING
	 * -------------------------------------------------
	 *
	 * The thumbnail is already visible.
	 *
	 * Do NOT load the thumbnail again.
	 */

	if (sourceMediumImage) {

		/*
		 * -------------------------------------------------
		 * MEDIUM ALREADY LOADED BY BACKGROUND LOADER
		 * -------------------------------------------------
		 *
		 * Reuse the already-loaded Medium.
		 *
		 * Do NOT call load().
		 *
		 * This means:
		 *
		 * - no second Medium fetch()
		 * - no second Medium loading bar
		 * - no second Medium download
		 *
		 * The existing Image element from the background
		 * loader is used as the source.
		 */

		modalMediumLoaded =
			true;

		modalMediumLoading =
			false;

		modalMediumImage =
			sourceMediumImage;

		display(
			sourceMediumImage.src,
			true,
			1
		);

		/*
		 * The Medium is already loaded.
		 *
		 * Full still needs to load normally.
		 */

		if (fullSrc) {

			load(
				fullSrc,
				"full",
				loadID
			);

		} else {

			/*
			 * There is no Full image, so modal priority
			 * is finished as soon as Medium is displayed.
			 */

			resumeThumbnailLoading();

		}

	} else if (mediumSrc) {

		/*
		 * -------------------------------------------------
		 * MEDIUM NOT LOADED YET
		 * -------------------------------------------------
		 *
		 * Let the modal's existing load() function handle
		 * the Medium normally.
		 *
		 * This preserves:
		 *
		 * - fetch()
		 * - blob URL
		 * - Medium loading bar
		 * - existing Medium loading behavior
		 *
		 * The thumbnail loader was stopped above, so the
		 * background Medium loader cannot race this load.
		 */

		load(
			mediumSrc,
			"medium",
			loadID
		);

	} else if (fullSrc) {

		/*
		 * -------------------------------------------------
		 * NO MEDIUM EXISTS
		 * -------------------------------------------------
		 *
		 * Go directly to Full.
		 */

		load(
			fullSrc,
			"full",
			loadID
		);

	} else {

		/*
		 * -------------------------------------------------
		 * NOTHING ELSE TO LOAD
		 * -------------------------------------------------
		 */

		resumeThumbnailLoading();

	}
}

function closeModal() {

	/*
	 * -------------------------------------------------
	 * INVALIDATE CURRENT MODAL LOAD
	 * -------------------------------------------------
	 */

	modalLoadID++;

	/*
	 * -------------------------------------------------
	 * CANCEL MODAL NETWORK LOADS
	 * -------------------------------------------------
	 */

	cancelImageLoads();

	/*
	 * -------------------------------------------------
	 * RELEASE MODAL LOADING STATE
	 * -------------------------------------------------
	 */

	fullImageLoading =
		false;

	modalMediumLoading =
		false;

	/*
	 * -------------------------------------------------
	 * RESUME NORMAL GALLERY LOADING
	 * -------------------------------------------------
	 *
	 * The modal may have paused the normal thumbnail
	 * loading chain.
	 *
	 * Do NOT start Medium directly.
	 *
	 * processThumbnailQueue() will determine whether
	 * there are still thumbnails to load. If there are,
	 * it continues thumbnails. If all thumbnails are
	 * finished, it automatically calls startMediumLoading().
	 */

	thumbnailPriorityPaused =
		false;

	processThumbnailQueue(
		thumbnailLoadSession
	);

	/*
	 * -------------------------------------------------
	 * RESET MODAL
	 * -------------------------------------------------
	 */

	const modal =
		document.getElementById("modal");

	document.documentElement.style.overflow =
		"";

	document.body.style.overflow =
		"";

	const mediumImg =
		document.getElementById("modalImgMedium");

	const fullImg =
		document.getElementById("modalImgFull");

	const loader =
		document.getElementById("modalLoading");

	modal.style.display =
		"none";

	if (mediumImg) {

		mediumImg.src =
			"";

		mediumImg.style.width =
			"";

		mediumImg.style.height =
			"";

		mediumImg.style.transform =
			"none";

		mediumImg.style.visibility =
			"hidden";

	}

	if (fullImg) {

		fullImg.src =
			"";

		fullImg.style.width =
			"";

		fullImg.style.height =
			"";

		fullImg.style.transform =
			"none";

		fullImg.style.visibility =
			"hidden";

	}

	if (loader) {

		loader.classList.remove(
			"active");

	}

	/*
	 * -------------------------------------------------
	 * RESET LOADING UI
	 * -------------------------------------------------
	 */

	const loadingBar =
		document.getElementById(
			"modalLoadingBar");

	const loadingProgress =
		document.getElementById(
			"modalLoadingProgress");

	if (loadingBar) {

		loadingBar.style.opacity =
			"0";

	}

	if (loadingProgress) {

		loadingProgress.style.width =
			"0%";

	}

	/*
	 * -------------------------------------------------
	 * STOP LOADING SPINNER TIMER
	 * -------------------------------------------------
	 */

	if (loadingTimer) {

		clearTimeout(
			loadingTimer);

		loadingTimer =
			null;

	}

	/*
	 * -------------------------------------------------
	 * RESET TRANSFORM
	 * -------------------------------------------------
	 */

	imgTransform = {
		x: 0,
		y: 0,
		scale: minZoom
	};

}

window.addEventListener("resize", () => {

    const modal =
        document.getElementById("modal");

    if (
        !modal ||
        modal.style.display === "none") {

        return;

    }

    let img = null;

    if (displayingFull) {

        img =
            modalImgFull;

    } else if (
        modalMediumLoaded &&
        modalImgMedium &&
        modalImgMedium.style.visibility !==
        "hidden") {

        img =
            modalImgMedium;

    } else if (modalImgSmall) {

        img =
            modalImgSmall;

    }

    if (!img)
        return;

    /*
     * Recalculate the image's base size
     * for the new viewport.
     */

    if (img === modalImgSmall) {

        resizeThumb(
            img);

    } else {

        imgResize(
            img);

    }

    /*
     * Reapply the current zoom/pan.
     */

    applyTransform();

    /*
     * Keep the image inside the new viewport.
     */

    constrainImage(
        img);

});

let imgDragging = false;
let dragStart = {};
let imgTransform = {
    x: 0,
    y: 0,
    scale: minZoom
};

let imgMoved = false;
let imgDownPos = {};

initAlbums();

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function applyTransform() {

    const transform =
        `translate(-50%, -50%) ` + 
        `translate(${imgTransform.x}px, ${imgTransform.y}px) ` + 
`scale(${imgTransform.scale})`;

    if (modalImgMedium) {
        modalImgMedium.style.transform =
            transform;
    }

    if (modalImgFull) {
        modalImgFull.style.transform =
            transform;
    }

    const visibleImg =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (visibleImg) {

        /*console.log(
        "[TRANSFORM STATE]", {
        x: imgTransform.x,
        y: imgTransform.y,
        scale: imgTransform.scale,

        displayingFull,

        stack:
        new Error().stack
        });*/

    }

}

const zoomAnchorDuration = 150;

function getBounds(img) {

    if (!img) {
        return {
            x: 0,
            y: 0
        };
    }

    const rect =
        img.getBoundingClientRect();

    /*
     * -------------------------------------------------
     * IMAGE SIZE
     * -------------------------------------------------
     */

    const width =
        rect.width;

    const height =
        rect.height;

    const viewportWidth =
        window.innerWidth;

    const viewportHeight =
        window.innerHeight;

    /*
     * -------------------------------------------------
     * NORMAL POSITION
     * -------------------------------------------------
     *
     * The image is centered by:
     *
     * translate(-50%, -50%)
     *
     * so imgTransform.x/y represent movement of the
     * image center away from the viewport center.
     */

    /*
     * How far the image center can move before an
     * image edge reaches the corresponding viewport
     * edge.
     */

    const halfWidth =
        width / 2;

    const halfHeight =
        height / 2;

    const halfViewportWidth =
        viewportWidth / 2;

    const halfViewportHeight =
        viewportHeight / 2;

    /*
     * -------------------------------------------------
     * NORMAL EDGE BOUNDS
     * -------------------------------------------------
     *
     * These are the normal limits for each axis.
     *
     * If the image is larger than the viewport,
     * it can move until one of its edges reaches
     * the viewport edge.
     *
     * If the image is smaller than the viewport,
     * the center can move freely until its edge
     * reaches the viewport edge.
     */

    const normalX =
        halfWidth +
        halfViewportWidth
         -
        Math.min(
            halfWidth,
            halfViewportWidth);

    const normalY =
        halfHeight +
        halfViewportHeight
         -
        Math.min(
            halfHeight,
            halfViewportHeight);

    /*
     * -------------------------------------------------
     * SIMPLER FORM
     * -------------------------------------------------
     *
     * This is the actual maximum movement of the
     * image center before an edge reaches an edge
     * of the viewport.
     */

    const edgeX =
        Math.abs(
            halfWidth -
            halfViewportWidth);

    const edgeY =
        Math.abs(
            halfHeight -
            halfViewportHeight);

    /*
     * -------------------------------------------------
     * EXTRA BOUNDARY
     * -------------------------------------------------
     *
     * 1.0 = normal edge touching.
     *
     * 1.5 = allow half the image to extend beyond
     * the viewport, as before.
     */

    const multiplier =
        Number.isFinite(
            imagePanBoundaryMultiplier)
         ? imagePanBoundaryMultiplier
         : 1;

    const amount =
        clamp(
            (multiplier - 1) / 0.5,
            0,
            1);

    /*
     * Maximum possible center movement at 1.5x.
     */

    const maximumX =
        halfWidth;

    const maximumY =
        halfHeight;

    return {

        x:
        edgeX +
        (maximumX - edgeX) *
        amount,

        y:
        edgeY +
        (maximumY - edgeY) *
        amount

    };

}

function endZoomGesture() {

    if (zoomEndTimer) {

        clearTimeout(
            zoomEndTimer);

    }

    zoomEndTimer =
        setTimeout(() => {

            zooming = false;

            zoomEndTimer = null;

            /*
             * IMPORTANT:
             *
             * Do NOT constrain or reposition the image
             * here.
             *
             * imgZoom() already keeps the image inside
             * the active pan boundary.
             *
             * This prevents the image from teleporting
             * after the final wheel tick.
             */

            /*
             * -------------------------------------------------
             * EXISTING RESOLUTION LOGIC
             * -------------------------------------------------
             */

            if (!autoResolutionSwitch)
                return;

            if (manualFullEnabled)
                return;

            const autoWantsFull =
                imgTransform.scale >=
                fullSwitchZoom;

            if (!autoWantsFull) {

                if (
                    displayingFull &&
                    modalMediumLoaded) {

                    switchToMedium();

                }

                zoomSwitchedFromFull =
                    false;

                return;

            }

            if (
                resolutionSwitchOnZoom &&
                zoomSwitchedFromFull &&
                fullImageLoaded &&
                modalMediumLoaded &&
                !displayingFull) {

                zoomSwitchedFromFull =
                    false;

                if (fullSwitchTimer) {

                    clearTimeout(
                        fullSwitchTimer);

                    fullSwitchTimer =
                        null;

                }

                fullSwitchTimer =
                    setTimeout(() => {

                        fullSwitchTimer =
                            null;

                        if (
                            manualFullEnabled ||
                            !autoResolutionSwitch ||
                            !fullImageLoaded ||
                            imgDragging ||
                            interactingWithImage ||
                            displayingFull) {

                            return;

                        }

                        if (
                            imgTransform.scale <
                            fullSwitchZoom) {

                            return;

                        }

                        switchToFull();

                    }, resolutionSwitchDelay);

                return;

            }

            if (
                !displayingFull &&
                fullImageLoaded &&
                !imgDragging &&
                !interactingWithImage) {

                switchToFull();

            }

        }, resolutionSwitchDelay);

}

function imgZoom(e) {

    e.preventDefault();

    /*
     * -------------------------------------------------
     * CURRENT IMAGE
     * -------------------------------------------------
     */

    const img =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (!img)
        return;

    /*
     * -------------------------------------------------
     * CURRENT SCALE
     * -------------------------------------------------
     */

    const oldScale =
        Number.isFinite(imgTransform.scale)
         ? imgTransform.scale
         : minZoom;

    const direction =
        e.deltaY < 0
         ? 1
         : -1;

    /*
     * -------------------------------------------------
     * CURRENT IMAGE RECT
     * -------------------------------------------------
     */

    const rect =
        img.getBoundingClientRect();

    /*
     * -------------------------------------------------
     * UN-SCALED IMAGE SIZE
     * -------------------------------------------------
     *
     * rect includes the current transform scale.
     * Remove that scale to get the actual image size.
     */

    const unscaledWidth =
        rect.width /
        oldScale;

    const unscaledHeight =
        rect.height /
        oldScale;

    /*
     * -------------------------------------------------
     * DYNAMIC FIRST ZOOM LEVEL
     * -------------------------------------------------
     *
     * This is the scale at which the image's SHORT
     * axis first reaches the corresponding viewport
     * edge.
     *
     * Example:
     *
     * Landscape image:
     *     height reaches viewport height.
     *
     * Portrait image:
     *     width reaches viewport width.
     *
     * At this scale the image is guaranteed to fill
     * at least one entire viewport axis.
     */

    const widthScale =
        window.innerWidth /
        unscaledWidth;

    const heightScale =
        window.innerHeight /
        unscaledHeight;

    const firstZoomScale =
        Math.max(
            widthScale,
            heightScale);

    /*
     * -------------------------------------------------
     * CALCULATE NEW ZOOM
     * -------------------------------------------------
     */

    let newScale;

    /*
     * -------------------------------------------------
     * FIRST UPWARD ZOOM TICK
     * -------------------------------------------------
     *
     * If the image is currently below the dynamic
     * first-zoom level, jump directly to that level.
     *
     * This applies even if we are NOT exactly at
     * minZoom.
     */

    if (
        direction > 0 &&
        oldScale < firstZoomScale) {

        newScale =
            clamp(
                firstZoomScale,
                minZoom,
                maxZoom);

    } else {

        /*
         * -------------------------------------------------
         * NORMAL ZOOM
         * -------------------------------------------------
         */

        newScale =
            clamp(
                oldScale +
                direction * zoomStep,
                minZoom,
                maxZoom);

    }

    /*
     * Nothing changed.
     */

    if (newScale === oldScale)
        return;

    /*
     * -------------------------------------------------
     * CURRENT IMAGE CENTER
     * -------------------------------------------------
     */

    const imageCenterX =
        rect.left +
        rect.width / 2;

    const imageCenterY =
        rect.top +
        rect.height / 2;

    /*
     * -------------------------------------------------
     * MOUSE OFFSET FROM IMAGE CENTER
     * -------------------------------------------------
     */

    const mouseOffsetX =
        e.clientX -
        imageCenterX;

    const mouseOffsetY =
        e.clientY -
        imageCenterY;

    /*
     * -------------------------------------------------
     * SCALE AROUND MOUSE
     * -------------------------------------------------
     */

    const ratio =
        newScale /
        oldScale;

    const viewportCenterX =
        window.innerWidth / 2;

    const viewportCenterY =
        window.innerHeight / 2;

    const newCenterX =
        e.clientX -
        mouseOffsetX * ratio;

    const newCenterY =
        e.clientY -
        mouseOffsetY * ratio;

    /*
     * -------------------------------------------------
     * CONVERT CENTER TO TRANSFORM POSITION
     * -------------------------------------------------
     */

    let newX =
        newCenterX -
        viewportCenterX;

    let newY =
        newCenterY -
        viewportCenterY;

    /*
     * -------------------------------------------------
     * IMAGE SIZE AT NEW SCALE
     * -------------------------------------------------
     */

    const newWidth =
        unscaledWidth *
        newScale;

    const newHeight =
        unscaledHeight *
        newScale;

    /*
     * -------------------------------------------------
     * PAN BOUNDARY
     * -------------------------------------------------
     */

    const halfWidth =
        newWidth / 2;

    const halfHeight =
        newHeight / 2;

    const halfViewportWidth =
        window.innerWidth / 2;

    const halfViewportHeight =
        window.innerHeight / 2;

    /*
     * -------------------------------------------------
     * NORMAL EDGE BOUNDS
     * -------------------------------------------------
     *
     * ABS allows an image smaller than the viewport
     * to move until its own edge touches the viewport.
     */

    const edgeX =
        Math.abs(
            halfWidth -
            halfViewportWidth);

    const edgeY =
        Math.abs(
            halfHeight -
            halfViewportHeight);

    /*
     * -------------------------------------------------
     * EXTENDED BOUNDARY
     * -------------------------------------------------
     */

    const maximumX =
        halfWidth;

    const maximumY =
        halfHeight;

    const multiplier =
        Number.isFinite(
            imagePanBoundaryMultiplier)
         ? imagePanBoundaryMultiplier
         : 1;

    const boundaryAmount =
        clamp(
            (multiplier - 1) / 0.5,
            0,
            1);

    /*
     * -------------------------------------------------
     * FINAL BOUNDS
     * -------------------------------------------------
     */

    const boundsX =
        edgeX +
        (maximumX - edgeX) *
        boundaryAmount;

    const boundsY =
        edgeY +
        (maximumY - edgeY) *
        boundaryAmount;

    /*
     * -------------------------------------------------
     * CONSTRAIN ZOOM TARGET
     * -------------------------------------------------
     */

    newX =
        clamp(
            newX,
            -boundsX,
            boundsX);

    newY =
        clamp(
            newY,
            -boundsY,
            boundsY);

    /*
     * -------------------------------------------------
     * STORE TRANSFORM
     * -------------------------------------------------
     */

    imgTransform.x =
        Number.isFinite(newX)
         ? newX
         : imgTransform.x;

    imgTransform.y =
        Number.isFinite(newY)
         ? newY
         : imgTransform.y;

    imgTransform.scale =
        newScale;

    /*
     * -------------------------------------------------
     * CENTER RETURN
     * -------------------------------------------------
     *
     * IMPORTANT:
     *
     * This is NO LONGER based on a percentage of
     * minZoom.
     *
     * Instead, the dynamic firstZoomScale is the
     * boundary.
     *
     * If the image is below the level where its
     * short axis fills the viewport, start/maintain
     * the 3-second center-return countdown.
     *
     * Once it reaches the first-zoom level or higher,
     * cancel the return.
     */

    if (
        newScale <
        firstZoomScale) {

        scheduleCenterReturn();

    } else {

        cancelCenterReturn();

    }

    /*
     * -------------------------------------------------
     * APPLY TRANSFORM
     * -------------------------------------------------
     */

    applyTransform();

    if (
        typeof showZoomLevel ===
        "function") {

        showZoomLevel();

    }

    /*
     * -------------------------------------------------
     * MANUAL FULL OVERRIDES EVERYTHING
     * -------------------------------------------------
     */

    if (manualFullEnabled)
        return;

    /*
     * =================================================
     * AUTO RESOLUTION
     * =================================================
     */

    if (autoResolutionSwitch) {

        if (
            newScale <
            fullSwitchZoom) {

            if (fullSwitchTimer) {

                clearTimeout(
                    fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

            if (
                displayingFull &&
                modalMediumLoaded) {

                switchToMedium();

            }

        } else {

            if (
                !displayingFull &&
                fullImageLoaded &&
                !imgDragging &&
                !interactingWithImage) {

                if (fullSwitchTimer) {

                    clearTimeout(
                        fullSwitchTimer);

                    fullSwitchTimer =
                        null;

                }

                fullSwitchTimer =
                    setTimeout(() => {

                        fullSwitchTimer =
                            null;

                        if (
                            manualFullEnabled ||
                            !autoResolutionSwitch ||
                            !fullImageLoaded ||
                            displayingFull ||
                            imgDragging ||
                            interactingWithImage) {

                            return;

                        }

                        if (
                            imgTransform.scale >=
                            fullSwitchZoom) {

                            switchToFull();

                        }

                    }, autoResolutionSwitchDelay);

            }

        }

    }

    /*
     * =================================================
     * ZOOM PERFORMANCE SWITCH
     * =================================================
     */

    if (
        resolutionSwitchOnZoom &&
        autoResolutionSwitch &&
        displayingFull &&
        modalMediumLoaded &&
        newScale >= resolutionSwitchZoom) {

        if (fullSwitchTimer) {

            clearTimeout(
                fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        zoomSwitchedFromFull =
            true;

        switchToMedium();

    }

    /*
     * -------------------------------------------------
     * DETECT END OF ZOOM GESTURE
     * -------------------------------------------------
     */

    if (
        typeof endZoomGesture ===
        "function") {

        endZoomGesture();

    }

}

function imgPan(e) {
/*console.log(
"[PAN DEBUG] pointerdown", {
imgDragging,
interactingWithImage,
displayingFull,
scale: imgTransform.scale
});*/

if (e.button !== 0)
    return;

/*
 * Don't start a pan on UI controls.
 */

if (
    e.target.closest &&
    (
        e.target.closest("#modalFullButton") ||
        e.target.closest("button"))) {

    return;

}

e.preventDefault();

/*
 * -------------------------------------------------
 * Remember the resolution at the START of the pan.
 * -------------------------------------------------
 *
 * This is important.
 *
 * Don't use displayingFull later to determine
 * whether this particular pan started in Full.
 */

const startedInFull =
    displayingFull &&
    !manualFullEnabled &&
    fullImageLoaded &&
    modalMediumLoaded;

/*
 * Only treat this as a temporary Full -> Medium
 * pan switch when resolutionSwitchOnPan is enabled.
 */

panStartedInFull =
    startedInFull &&
    resolutionSwitchOnPan;

/*
 * -------------------------------------------------
 * Cancel pending Full restore.
 * -------------------------------------------------
 */

if (fullSwitchTimer) {

    clearTimeout(
        fullSwitchTimer);

    fullSwitchTimer = null;

}

/*
 * Get the image BEFORE switching resolution.
 */

const img =
    displayingFull
     ? modalImgFull
     : modalImgMedium;

if (!img)
    return;

/*
 * -------------------------------------------------
 * FULL -> MEDIUM FOR PAN
 * -------------------------------------------------
 *
 * Only do this when resolutionSwitchOnPan is
 * actually enabled.
 */

if (
    startedInFull &&
    resolutionSwitchOnPan) {

    switchToMedium();

}

/*
 * Get the image AFTER the resolution switch.
 *
 * Pan should now operate on Medium.
 */

const panImg =
    displayingFull
     ? modalImgFull
     : modalImgMedium;

if (!panImg)
    return;

/*
 * Cancel any pending or active return-to-center
 * animation as soon as the user starts panning.
 */

cancelCenterReturn();

interactingWithImage =
    true;

imgDragging =
    true;

imgMoved =
    false;

dragStart = {

    x: e.clientX,
    y: e.clientY,

    imgX: imgTransform.x,
    imgY: imgTransform.y

};

try {

    modal.setPointerCapture(
        e.pointerId);

} catch {}

}

function panImage(e) {

    if (!imgDragging || !dragStart)
        return;

    const img =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (!img)
        return;

    const dx =
        e.clientX -
        dragStart.x;

    const dy =
        e.clientY -
        dragStart.y;

    if (
        Math.abs(dx) > 5 ||
        Math.abs(dy) > 5) {

        imgMoved = true;

    }

    /*
     * Use the SAME boundary system as zooming.
     */

    const bounds =
        getBounds(img);

    imgTransform.x =
        clamp(
            dragStart.imgX + dx,
            -bounds.x,
            bounds.x);

    imgTransform.y =
        clamp(
            dragStart.imgY + dy,
            -bounds.y,
            bounds.y);

    applyTransform();

}

function imgPanEnd(e) {
    /*console.log(
    "[PAN DEBUG] pointerup", {
    imgDragging,
    interactingWithImage
    });*/

    if (!imgDragging)
        return;

    imgDragging =
        false;

    interactingWithImage =
        false;

    try {

        if (
            modal.hasPointerCapture(
                e.pointerId)) {

            modal.releasePointerCapture(
                e.pointerId);

        }

    } catch {}

    /*
     * -------------------------------------------------
     * CLICK WITHOUT MOVEMENT
     * -------------------------------------------------
     */

    if (!imgMoved) {

        dragStart =
            null;

        panStartedInFull =
            false;

        closeModal();

        return;

    }

    dragStart =
        null;

    /*
     * -------------------------------------------------
     * CURRENT AUTO RESOLUTION STATE
     * -------------------------------------------------
     *
     * IMPORTANT:
     *
     * resolutionSwitchOnZoom is NOT allowed to make
     * Medium -> Full.
     *
     * Only Auto Resolution can determine whether Full
     * is appropriate.
     */

    const autoWantsFull =
        autoResolutionSwitch &&
        imgTransform.scale >=
        fullSwitchZoom;

    /*
     * -------------------------------------------------
     * PAN STARTED IN FULL
     * -------------------------------------------------
     *
     * Full was temporarily changed to Medium when
     * the pan began.
     */

    if (
        panStartedInFull &&
        !manualFullEnabled &&
        resolutionSwitchOnPan &&
        fullImageLoaded &&
        modalMediumLoaded) {

        /*
         * Only restore Full if Auto Resolution is
         * currently requesting Full.
         */

        if (autoWantsFull) {

            scheduleFullRestore();

        } else {

            /*
             * Current zoom no longer qualifies for
             * Auto Full.
             *
             * Stay Medium.
             */

            if (fullSwitchTimer) {

                clearTimeout(
                    fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

        }

    }

    /*
     * -------------------------------------------------
     * PAN STARTED IN MEDIUM
     * -------------------------------------------------
     *
     * If the user started panning in Medium and
     * crossed the Auto threshold during the pan,
     * Auto may promote to Full.
     *
     * resolutionSwitchOnZoom does NOT participate.
     */
    else if (
        !panStartedInFull &&
        !manualFullEnabled &&
        !displayingFull &&
        fullImageLoaded) {

        if (autoWantsFull) {

            if (fullSwitchTimer) {

                clearTimeout(
                    fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

            switchToFull();

        }

    }

    panStartedInFull =
        false;

}

function scheduleFullRestore() {

    if (fullSwitchTimer) {

        clearTimeout(
            fullSwitchTimer);

        fullSwitchTimer = null;

    }

    /*
     * Manual Full always wins.
     */

    if (manualFullEnabled)
        return;

    /*
     * Pan switching must be enabled.
     */

    if (!resolutionSwitchOnPan)
        return;

    /*
     * Need both resolutions ready.
     */

    if (
        !fullImageLoaded ||
        !modalMediumLoaded) {

        return;

    }

    fullSwitchTimer =
        setTimeout(() => {

            fullSwitchTimer = null;

            /*
             * Anything that invalidates the restore
             * cancels it.
             */

            if (
                manualFullEnabled ||
                !fullImageLoaded ||
                !modalMediumLoaded ||
                displayingFull ||
                imgDragging ||
                interactingWithImage) {

                return;

            }

            /*
             * Restore Full because THIS pan started
             * while Full was displayed.
             *
             * Do NOT check fullSwitchZoom here.
             *
             * resolutionSwitchOnPan is deliberately
             * independent of the zoom threshold.
             */

            switchToFull();

        }, resolutionSwitchDelay);

}

function enforceAutoResolution() {

    /*
     * Manual Full always wins.
     */

    if (manualFullEnabled)
        return;

    /*
     * Auto Resolution is disabled.
     *
     * Therefore Auto must NEVER change resolution.
     */

    if (
        !autoResolutionSwitch ||
        !fullImageLoaded) {

        return;

    }

    /*
     * -------------------------------------------------
     * BELOW AUTO THRESHOLD
     * -------------------------------------------------
     */

    if (
        imgTransform.scale <
        fullSwitchZoom) {

        if (fullSwitchTimer) {

            clearTimeout(
                fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        if (
            displayingFull &&
            modalMediumLoaded) {

            switchToMedium();

        }

        return;

    }

    /*
     * -------------------------------------------------
     * AT / ABOVE AUTO THRESHOLD
     * -------------------------------------------------
     */

    if (
        imgTransform.scale >=
        fullSwitchZoom &&
        !displayingFull &&
        !imgDragging &&
        !interactingWithImage) {

        if (fullSwitchTimer) {

            clearTimeout(
                fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        fullSwitchTimer =
            setTimeout(() => {

                fullSwitchTimer =
                    null;

                if (
                    manualFullEnabled ||
                    !autoResolutionSwitch ||
                    !fullImageLoaded ||
                    displayingFull ||
                    imgDragging ||
                    interactingWithImage) {

                    return;

                }

                if (
                    imgTransform.scale >=
                    fullSwitchZoom) {

                    switchToFull();

                }

            }, autoResolutionSwitchDelay);

    }

}

function switchToFull() {
    /*
     * -------------------------------------------------
     * BASIC VALIDATION
     * -------------------------------------------------
     */

    if (
        !modalImgMedium ||
        !modalImgFull ||
        !modalFullSrc) {
        return;

    }

    /*
     * -------------------------------------------------
     * FULL NOT READY
     * -------------------------------------------------
     */

    if (!fullImageLoaded) {
        if (loadingTimer) {

            clearTimeout(
                loadingTimer);

            loadingTimer =
                null;

        }

        if (!fullImageLoading) {
			load(
				fullSrc,
				"full",
				loadID);

        }

        return;

    }

    /*
     * -------------------------------------------------
     * FULL IS READY
     * -------------------------------------------------
     */
    /*
     * Stop loading UI.
     */

    if (loadingTimer) {

        clearTimeout(
            loadingTimer);

        loadingTimer =
            null;

    }

    if (modalLoading) {

        modalLoading.classList.remove(
            "active");

        modalLoading.style.opacity =
            "0";

    }

    /*
     * -------------------------------------------------
     * MATCH MEDIUM'S PHYSICAL SIZE
     * -------------------------------------------------
     *
     * The Full image uses the exact same displayed
     * dimensions as Medium.
     */

    modalImgFull.style.width =
        modalImgMedium.style.width;

    modalImgFull.style.height =
        modalImgMedium.style.height;

    modalImgFull.style.left =
        "50%";

    modalImgFull.style.top =
        "50%";

    modalImgFull.style.opacity =
        "1";

    modalImgFull.style.filter =
        "none";

    /*
     * -------------------------------------------------
     * APPLY CURRENT TRANSFORM BEFORE SWITCH
     * -------------------------------------------------
     */

    applyTransform();

    /*
     * Force the browser to resolve the Full image's
     * dimensions before making it visible.
     */

    void modalImgFull.offsetWidth;

    /*
     * -------------------------------------------------
     * SWITCH IMAGES
     * -------------------------------------------------
     *
     * IMPORTANT:
     *
     * Set displayingFull BEFORE revealing Full.
     *
     * This prevents another event from seeing the
     * old state during the transition.
     */

    displayingFull =
        true;

    modalImgFull.dataset.showingFull =
        "true";

    modalImgMedium.dataset.showingFull =
        "false";

    /*
     * Full first.
     */

    modalImgFull.style.visibility =
        "visible";

    modalImgFull.style.zIndex =
        "3";

    /*
     * Medium second.
     */

    modalImgMedium.style.visibility =
        "hidden";

    modalImgMedium.style.opacity =
        "1";

    /*
     * Reapply the transform after the state change.
     */

    applyTransform();
}

function switchToMedium() {
    if (!modalImgMedium) {
        return;
    }

    /*
     * Match Medium's physical dimensions to Full.
     */

    if (modalImgFull) {

        modalImgMedium.style.width =
            modalImgFull.style.width;

        modalImgMedium.style.height =
            modalImgFull.style.height;

    }

    modalImgMedium.style.opacity =
        "1";

    if (modalImgFull)
        modalImgFull.style.opacity =
            "1";

    modalImgMedium.style.filter =
        "blur(4px)";

    modalImgMedium.style.visibility =
        "visible";

    applyTransform();

    requestAnimationFrame(() => {

        modalImgMedium.style.filter =
            "blur(0px)";

    });

    if (modalImgFull)
        modalImgFull.style.visibility =
            "hidden";

    displayingFull =
        false;

    modalImgMedium.dataset.showingFull =
        "false";

    setTimeout(() => {

        if (modalImgMedium) {

            modalImgMedium.style.filter =
                "none";

            modalImgMedium.style.opacity =
                "1";

        }

        if (modalImgFull) {

            modalImgFull.style.filter =
                "none";

            modalImgFull.style.opacity =
                "1";

        }

    }, 150);
}

function showMediumImage() {

    if (!modalImgMedium)
        return;

    modalImgMedium.style.visibility =
        "visible";

    if (modalImgFull)
        modalImgFull.style.visibility =
            "hidden";

    displayingFull = false;

    applyTransform();
}

function showFullImage() {

    if (
        !modalImgMedium ||
        !modalImgFull ||
        !fullImageLoaded)
        return;

    modalImgFull.style.width =
        modalImgMedium.style.width;

    modalImgFull.style.height =
        modalImgMedium.style.height;

    modalImgFull.style.left = "50%";
    modalImgFull.style.top = "50%";

    applyTransform();

    modalImgFull.style.visibility =
        "visible";

    modalImgMedium.style.visibility =
        "hidden";

    displayingFull = true;
}

function resizeThumb(elem) {

    if (
        !elem ||
        !elem.naturalWidth ||
        !elem.naturalHeight)
        return;

    const maxSize =
        Math.min(
            window.innerWidth,
            window.innerHeight) / 1.5;

    const scale =
        maxSize /
        Math.max(
            elem.naturalWidth,
            elem.naturalHeight);

    elem.style.width =
`${elem.naturalWidth * scale}px`;

    elem.style.height =
`${elem.naturalHeight * scale}px`;
}

function imgResize(elem) {

    const wH = window.innerHeight;
    const wW = window.innerWidth;

    const iH = elem.naturalHeight;
    const iW = elem.naturalWidth;

    const scale = Math.min(
            wW / iW,
            wH / iH);

    elem.style.width =
`${iW * scale}px`;

    elem.style.height =
`${iH * scale}px`;

}

function constrainImage(img) {

    if (!img)
        return;

    const bounds =
        getBounds(img);

    imgTransform.x =
        clamp(
            imgTransform.x,
            -bounds.x,
            bounds.x);

    imgTransform.y =
        clamp(
            imgTransform.y,
            -bounds.y,
            bounds.y);

}

function showZoomLevel() {

    if (!zoomLevelDisplay)
        return;

    zoomLevelDisplay.textContent =
`${parseFloat(imgTransform.scale.toFixed(2))}x`;

    zoomLevelDisplay.classList.add("visible");

    if (zoomLevelTimer) {

        clearTimeout(
            zoomLevelTimer);

    }

    zoomLevelTimer =
        setTimeout(() => {

            zoomLevelDisplay.classList.remove(
                "visible");

            zoomLevelTimer = null;

        }, 2000);
}

function showImage(offset) {

    if (
        !currentAlbum ||
        !currentAlbum.images ||
        !currentAlbum.images.length
    ) {
        return;
    }

    /*
     * -------------------------------------------------
     * FIND THE NEXT VALID / VISIBLE IMAGE
     * -------------------------------------------------
     *
     * Navigate using currentAlbum.images rather than
     * rebuilding the order from the DOM.
     *
     * This keeps currentImageIndex authoritative.
     */

    const total =
        currentAlbum.images.length;

    let index =
        currentImageIndex;

    for (let i = 0; i < total; i++) {

        index += offset;

        /*
         * Loop around.
         */

        if (index >= total) {
            index = 0;
        }

        if (index < 0) {
            index = total - 1;
        }

        const img =
            currentAlbum.images[index];

        if (
            !img ||
            !img.thumb?.url ||
            !img.image?.url
        ) {
            continue;
        }

        /*
         * -------------------------------------------------
         * CHECK WHETHER THIS IMAGE IS FILTERED OUT
         * -------------------------------------------------
         */

        const thumb =
            document.querySelector(
                `.thumb[data-index="${index}"]`
            );

        /*
         * If the thumbnail exists and is hidden by the
         * tag filter, skip it.
         *
         * If it doesn't exist in the DOM, still allow the
         * image because the album data itself is valid.
         */

        if (
            thumb &&
            getComputedStyle(thumb).display === "none"
        ) {
            continue;
        }

        /*
         * Found the next valid image.
         */

        currentImageIndex =
            index;

        /*
         * -------------------------------------------------
         * IMAGE SOURCES
         * -------------------------------------------------
         */

        const thumbSrc =
            img.thumb?.url ||
            "";

        const mediumSrc =
            img.medium?.url ||
            img.image?.url ||
            "";

        const fullSrc =
            img.image?.url ||
            "";

        /*
         * -------------------------------------------------
         * REUSE THE EXISTING GALLERY THUMBNAIL
         * -------------------------------------------------
         */

        openModal(
            thumbSrc,
            mediumSrc,
            fullSrc,
            thumb
        );

        /*
         * Keep the gallery thumbnail positioned around
         * the current image.
         */

        scrollToCurrentThumbnail(
            index
        );

        return;
    }
}

function nextImage() {
    showImage(1);
}

function previousImage() {
    showImage(-1);
}

document.addEventListener("keydown", e => {

    const modal = document.getElementById("modal");

    if (modal.style.display !== "flex")
        return;

    if (e.key === "ArrowRight") {
        nextImage();
    }

    if (e.key === "ArrowLeft") {
        previousImage();
    }

});

let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let touchStartTime = 0;
let touchIsLong = false;
let touchTimer = null;
let lastPinchDistance = 0;

function getPinchDistance(touches) {

    const dx =
        touches[0].clientX -
        touches[1].clientX;

    const dy =
        touches[0].clientY -
        touches[1].clientY;

    return Math.sqrt(
        dx * dx +
        dy * dy);
}

document.addEventListener("touchstart", e => {

    const modal = document.getElementById("modal");

    if (modal.style.display !== "flex")
        return;

    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    touchStartTime = Date.now();

    touchIsLong = false;

    touchTimer = setTimeout(() => {
        touchIsLong = true;
    }, 250);

}, {
    passive: true
});

document.addEventListener("touchmove", e => {

    if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
    }

    // If the user is holding or dragging,
    // don't allow swipe detection
    if (touchIsLong)
        return;

}, {
    passive: true
});

document.addEventListener("touchend", e => {

    const modal = document.getElementById("modal");

    if (modal.style.display !== "flex")
        return;

    if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
    }

    // Held long enough = let image dragging handle it
    if (touchIsLong)
        return;

    const elapsed = Date.now() - touchStartTime;

    // Extra safety: ignore slow touches
    if (elapsed > 300)
        return;

    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;

    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Ignore vertical swipes
    if (Math.abs(diffY) > Math.abs(diffX))
        return;

    // Minimum swipe distance
    if (Math.abs(diffX) < 50)
        return;

    if (diffX < 0) {
        nextImage();
    } else {
        previousImage();
    }

}, {
    passive: true
});

function scrollToCurrentThumbnail(index) {

    const thumb = document.querySelector(
`.thumb[data-index="${index}"]`);

    if (!thumb)
        return;

    const rect = thumb.getBoundingClientRect();

    const scrollY =
        window.scrollY +
        rect.top -
        (window.innerHeight / 2) +
        (rect.height / 2);

    window.scrollTo({
        top: scrollY,
        behavior: "smooth"
    });
}

function cancelImageLoads() {

    if (!activeImageLoaders)
        return;

    for (
        const controller
        of activeImageLoaders) {

        try {

            controller.abort();

        } catch {}

    }

    activeImageLoaders.length = 0;
}

window.addEventListener("popstate", () => {

    const query = decodeURIComponent(
            location.search.substring(1));

    if (!query) {
        closeModal();
        showAlbums();
        return;
    }

    if (query.startsWith("$")) {

        const albumID = query.substring(1);

        reloadAlbums();

        const album = albums.find(a =>
                a.id === albumID);

        if (album) {
            closeModal();
            loadAlbumFromURL(album);
            return;
        }

        showAlbums();
        return;
    }

    // ImgBB image-query URL
    const albumQuery = createQueryAlbum(query);

    closeModal();
    loadAlbumFromURL(albumQuery);
});

document.getElementById("filterMode").onclick = function () {

    filterMode =
        filterMode === "any"
         ? "all"
         : "any";

    this.textContent =
        filterMode === "any"
         ? "Any"
         : "All";

    applyTagFilter();

};

function applyTagFilter() {

    /*
     * -------------------------------------------------
     * HOMEPAGE
     * -------------------------------------------------
     *
     * Homepage cards are still .album elements.
     */

    if (!currentAlbum) {

        const albums =
            document.querySelectorAll(".album");

        albums.forEach(element => {

            const tags =
                (element.alt || "")
                .split(",")
                .map(t => t.trim());

            const excluded =
                [...excludedTags].some(
                    tag => tags.includes(tag)
                );

            if (excluded) {

                element.style.display =
                    "none";

                return;

            }

            if (!selectedTags.size) {

                element.style.display =
                    "";

                return;

            }

            let show;

            if (
                filterMode === "all"
            ) {

                show =
                    [...selectedTags].every(
                        tag =>
                            tags.includes(tag)
                    );

            } else {

                show =
                    [...selectedTags].some(
                        tag =>
                            tags.includes(tag)
                    );

            }

            element.style.display =
                show ? "" : "none";

        });

        updateGalleryLayout();

        return;

    }

    /*
     * -------------------------------------------------
     * ALBUM
     * -------------------------------------------------
     *
     * The thumbnail-slot is now the gallery item.
     *
     * Do NOT filter .thumb directly because both the
     * thumbnail and Medium images are .thumb elements.
     */

    const slots =
        document.querySelectorAll(
            ".thumbnail-slot"
        );

    slots.forEach(slot => {

        const item =
            slot._thumbnailItem;

        const tags =
            item && item.tags
                ? item.tags
                : [];

        /*
         * Exclusions always apply first.
         */

        const excluded =
            [...excludedTags].some(
                tag =>
                    tags.includes(tag)
            );

        if (excluded) {

            slot.style.display =
                "none";

            return;

        }

        /*
         * No inclusion filters active.
         */

        if (!selectedTags.size) {

            slot.style.display =
                "";

            return;

        }

        let show;

        if (
            filterMode === "all"
        ) {

            show =
                [...selectedTags].every(
                    tag =>
                        tags.includes(tag)
                );

        } else {

            show =
                [...selectedTags].some(
                    tag =>
                        tags.includes(tag)
                );

        }

        slot.style.display =
            show ? "" : "none";

    });

    updateGalleryLayout();

}

/*
=========================================================
GALLERY SETTINGS
=========================================================
 */

function updateGalleryLayout(animate = true) {
    applyGalleryLayout(animate);
}

/*
=========================================================
CALCULATE HOW MANY COLUMNS FIT
=========================================================
 */

function getGalleryColumnCount(
    width,
    minColumnsToUse = minColumns,
    maxColumnsToUse = maxColumns,
    minWidthToUse = minThumbWidth) {

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const columns =
        Math.floor(
            (width + gap) /
            (minWidthToUse + gap));

    return Math.max(
        minColumnsToUse,
        Math.min(
            maxColumnsToUse,
            columns));
}

/*
=========================================================
CALCULATE TARGET LAYOUT
=========================================================
 */

function calculateGalleryLayout() {

    const gallery =
        document.getElementById("gallery");

    /*
     * Determine whether we're on the homepage
     * or inside an album.
     */

    const isHomePage =
        !currentAlbum;

    /*
     * -------------------------------------------------
     * GET ACTUAL GALLERY ITEMS
     * -------------------------------------------------
     *
     * Homepage:
     *     .album
     *
     * Album:
     *     .thumbnail-slot
     *
     * The individual thumbnail/Medium <img> elements
     * are NOT layout items.
     */

    const items =
        isHomePage

        ? [
            ...gallery.querySelectorAll(".album")
        ].filter(
            element =>
                getComputedStyle(
                    element
                ).display !== "none"
        )

        : [
            ...gallery.querySelectorAll(
                ".thumbnail-slot"
            )
        ].filter(
            element =>
                getComputedStyle(
                    element
                ).display !== "none"
        );

    const minColumnsToUse =
        isHomePage
        ? homeMinColumns
        : minColumns;

    const maxColumnsToUse =
        isHomePage
        ? homeMaxColumns
        : maxColumns;

    const minWidthToUse =
        isHomePage
        ? homeMinThumbWidth
        : minThumbWidth;

    const style =
        getComputedStyle(
            gallery
        );

    const paddingLeft =
        parseFloat(
            style.paddingLeft
        ) || 0;

    const paddingRight =
        parseFloat(
            style.paddingRight
        ) || 0;

    const paddingTop =
        parseFloat(
            style.paddingTop
        ) || 0;

    const paddingBottom =
        parseFloat(
            style.paddingBottom
        ) || 0;

    /*
     * Width available INSIDE the padding.
     */

    const galleryRect =
        gallery.getBoundingClientRect();

    const galleryWidth =
        galleryRect.width -
        paddingLeft -
        paddingRight;

    const columns =
        getGalleryColumnCount(
            galleryWidth,
            minColumnsToUse,
            maxColumnsToUse,
            minWidthToUse
        );

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const itemWidth =
        (
            galleryWidth -
            gap * (columns - 1)
        ) /
        columns;

    const itemHeight =
        isHomePage
        ? itemWidth *
            homeHeightMultiplier
        : itemWidth;

    const positions =
        [];

    items.forEach(
        (item, index) => {

            const column =
                index %
                columns;

            const row =
                Math.floor(
                    index /
                    columns
                );

            const left =
                paddingLeft +
                column *
                (
                    itemWidth +
                    gap
                );

            const top =
                paddingTop +
                row *
                (
                    itemHeight +
                    gap
                );

            positions.push({

                element:
                    item,

                left:
                    left,

                top:
                    top,

                width:
                    itemWidth,

                height:
                    itemHeight

            });

        }
    );

    const rows =
        items.length > 0
        ? Math.ceil(
            items.length /
            columns
        )
        : 0;

    /*
     * Height of the actual image/card area.
     */

    const imageAreaHeight =
        rows > 0

        ? (
            rows *
            itemHeight +
            (
                rows - 1
            ) *
            gap
        )

        : 0;

    /*
     * Include BOTH top and bottom padding.
     */

    const requiredHeight =
        paddingTop +
        imageAreaHeight +
        paddingBottom;

    return {

        positions,

        height:
            requiredHeight,

        columns

    };

}

/*
=========================================================
APPLY GALLERY LAYOUT
=========================================================
 */

function applyGalleryLayout(animate = true) {

    const gallery =
        document.getElementById("gallery");

    const layout =
        calculateGalleryLayout();

    gallery.style.height =
        layout.height + "px";

    layout.positions.forEach(info => {

        const item =
            info.element;

        if (!animate) {
            item.style.transition = "none";
        }

        item.style.position = "absolute";

        item.style.left =
            info.left + "px";

        item.style.top =
            info.top + "px";

        item.style.width =
            info.width + "px";

        item.style.height =
            info.height + "px";

        if (!animate) {

            item.offsetWidth;

            item.style.transition = "";

        }

    });

    return layout;
}

const tagToggle =
    document.getElementById("tagToggle");

const tagBar =
    document.getElementById("tagBar");

tagToggle.addEventListener("click", () => {

    tagBar.classList.toggle("hidden");
    saveTagBarState();

    const startTime =
        performance.now();

    function animateTagGallery(time) {

        const elapsed =
            time - startTime;

        /*
         * Keep recalculating while the tag bar
         * is animating.
         */
        applyGalleryLayout(true);

        if (elapsed < 500) {

            requestAnimationFrame(
                animateTagGallery);

        }
    }

    requestAnimationFrame(
        animateTagGallery);

});

let galleryResizeCheck = null;
let lastMeasuredGalleryWidth = null;
let stableChecks = 0;

function startGalleryResizeTracking() {

    clearInterval(galleryResizeCheck);

    stableChecks = 0;
    lastMeasuredGalleryWidth = null;

    galleryResizeCheck = setInterval(() => {

        const gallery =
            document.getElementById("gallery");

        if (!gallery) {
            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;
            return;
        }

        const width =
            gallery.getBoundingClientRect().width;

        /*
         * Check whether the actual gallery width
         * has stopped changing.
         */
        if (
            lastMeasuredGalleryWidth !== null &&
            Math.abs(
                width -
                lastMeasuredGalleryWidth) < 0.01) {

            stableChecks++;

        } else {

            stableChecks = 0;

        }

        lastMeasuredGalleryWidth = width;

        /*
         * Recalculate the layout.
         */
        updateGalleryLayout();

        /*
         * Stop checking once the gallery has
         * remained stable for several checks.
         */
        if (stableChecks >= 3) {

            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;

        }

    }, 75);
}

window.addEventListener("resize", () => {

    /*
     * Restart the 50ms checking period whenever
     * another resize event occurs.
     */
    startGalleryResizeTracking();

});

function buildTagList(tags) {
    const tagContainer = document.getElementById("tagList");

    tagContainer.innerHTML = "";
    //console.log("buildTagList()");
    //console.log("length:", currentAlbum.tags.length);
    //console.log([...tagList]);
    //console.log(currentAlbum.tags.length);
    //currentAlbum.tags.sort().forEach((tag)=>{console.log(tag)})
    tags
    .sort((a, b) => a.localeCompare(b))
    .forEach(tag => {

        const btn = document.createElement("button");

        btn.className = "tag";
        btn.textContent = tag;

        btn.onclick = () => {

            // If it was excluded, remove exclusion first
            if (excludedTags.has(tag)) {

                excludedTags.delete(tag);
                btn.classList.remove("excluded");

            }

            // Toggle normal selection
            if (selectedTags.has(tag)) {

                selectedTags.delete(tag);
                btn.classList.remove("selected");

            } else {

                selectedTags.add(tag);
                btn.classList.add("selected");

            }

            clearButton.style.display =
                (selectedTags.size || excludedTags.size)
             ? ""
             : "none";

            applyTagFilter();

        };

        btn.oncontextmenu = (e) => {

            //e.preventDefault();


            // Remove normal selection if present
            if (selectedTags.has(tag)) {

                selectedTags.delete(tag);
                btn.classList.remove("selected");

            }

            // Toggle exclusion
            if (excludedTags.has(tag)) {

                excludedTags.delete(tag);
                btn.classList.remove("excluded");

            } else {

                excludedTags.add(tag);
                btn.classList.add("excluded");

            }

            clearButton.style.display =
                (selectedTags.size || excludedTags.size)
             ? ""
             : "none";

            applyTagFilter();

        };

        tagContainer.appendChild(btn);

    });

}

const clearButton = document.getElementById("clearTags");

clearButton.onclick = () => {

    selectedTags.clear();
    excludedTags.clear();

    document.querySelectorAll("#tagList .tag")
    .forEach(btn => {
        btn.classList.remove("selected");
        btn.classList.remove("excluded");
    });

    applyTagFilter();

    clearButton.style.display = "none";

};

const XMP = {

    getData: function (img, callback) {

        fetch(img.src)
        .then(r => r.arrayBuffer())
        .then(buffer => {

            const xmpString = findXMP(buffer);

            if (!xmpString) {
                callback.call(img, null);
                return;
            }

            img.xmpraw = xmpString;
            img.xmp = parseXMP(xmpString);
            img.xmptags = createXMPShortcuts(img.xmp);

            callback.call(img, img.xmp);

        });

    }

};

function findXMP(buffer) {

    const bytes = new Uint8Array(buffer);

    const text = new TextDecoder("utf-8")
        .decode(bytes);

    const start = text.indexOf("<x:xmpmeta");

    if (start === -1)
        return null;

    const end = text.indexOf("</x:xmpmeta>", start);

    if (end === -1)
        return null;

    return text.substring(
        start,
        end + "</x:xmpmeta>".length);

}

function parseXMP(xmpString) {

    const xml = new DOMParser()
        .parseFromString(xmpString, "application/xml");

    function cleanName(name) {

        return name.includes(":")
         ? name.split(":")[1]
         : name;

    }

    function addChild(obj, key, value) {

        if (obj[key] === undefined)
            obj[key] = value;
        else if (Array.isArray(obj[key]))
            obj[key].push(value);
        else
            obj[key] = [obj[key], value];

    }

    function parseNode(node) {

        const obj = {};

        for (const attr of node.attributes || []) {

            obj[cleanName(attr.name)] =
                attr.value;

        }

        if (node.children.length === 0) {

            const text = node.textContent.trim();

            return text || obj;

        }

        for (const child of node.children) {

            addChild(
                obj,
                cleanName(child.nodeName),
                parseNode(child));

        }

        return obj;

    }

    return parseNode(xml.documentElement);

}

function createXMPShortcuts(xmp) {

    const desc =
        xmp.RDF?.Description || {};

    return {

        subject:
        Array.isArray(desc.subject?.Bag?.li)
         ? desc.subject.Bag.li
         : desc.subject?.Bag?.li
         ? [desc.subject.Bag.li]
         : [],

        dimensions:
        desc.Regions?.AppliedToDimensions || null,

        faces:
        (() => {

            const faces =
                desc.Regions?.RegionList?.Bag?.li || [];

            const list =
                Array.isArray(faces)
                 ? faces
                 : [faces];

            return list.map(f => {

                const d =
                    f.Description || f;

                return {
                    name: d.Name,
                    type: d.Type,
                    area: d.Area
                };

            });

        })()

    };

}

function getAllTags() {

    const tags = new Set();

    albums.forEach(album => {

        (album.tags || []).forEach(tag => {
            tags.add(tag.toLowerCase());
        });

    });

    return [...tags];

}

const searchInput = document.getElementById("tagSearch");
const suggestionBox = document.getElementById("tagSuggestions");
let suggestions = [];
let selectedSuggestionIndex = -1;

let activeTagIndex = 0;
let previousTagIndex = 0;

function getTagParts() {

    return searchInput.value.split(",");
}

function getCurrentTagIndex() {

    const value = searchInput.value;
    const cursor = searchInput.selectionStart;

    return value
    .slice(0, cursor)
    .split(",")
    .length - 1;
}

function isValidTag(tag) {

    const lower =
        tag.trim().toLowerCase();

    if (!lower)
        return false;

    return getAllTags().some(existing =>
        existing.trim().toLowerCase() === lower);
}

function removeTagAt(index) {

    const parts = getTagParts();

    if (
        index < 0 ||
        index >= parts.length) {
        return;
    }

    // Find the character position where this
    // tag begins.
    let start = 0;

    for (let i = 0; i < index; i++) {
        start += parts[i].length + 1;
    }

    parts.splice(index, 1);

    searchInput.value =
        parts
        .map(part => part.trim())
        .filter(Boolean)
        .join(", ");

    const newPosition =
        Math.min(
            start,
            searchInput.value.length);

    searchInput.setSelectionRange(
        newPosition,
        newPosition);
}

function validatePreviousTag() {

    const parts = getTagParts();

    if (
        previousTagIndex < 0 ||
        previousTagIndex >= parts.length) {
        return;
    }

    const tag =
        parts[previousTagIndex].trim();

    if (!tag)
        return;

    if (isValidTag(tag))
        return;

    removeTagAt(previousTagIndex);
}

function removeCurrentPartialTag() {

    const value = searchInput.value;

    /*
     * If the input already ends with ", ",
     * there is no partial tag.
     */
    if (value.endsWith(", "))
        return;

    /*
     * Find which comma-separated segment the
     * cursor is currently editing.
     */
    const cursor =
        searchInput.selectionStart;

    const beforeCursor =
        value.slice(0, cursor);

    const start =
        beforeCursor.lastIndexOf(",") + 1;

    const afterCursor =
        value.indexOf(",", cursor);

    const end =
        afterCursor === -1
         ? value.length
         : afterCursor;

    /*
     * Remove the current segment.
     */
    const before =
        value.slice(0, start);

    const after =
        value.slice(end);

    /*
     * Clean up the comma/space around the removed
     * segment without disturbing the other tags.
     */
    let newValue =
        before + after;

    newValue =
        newValue
        .replace(/,\s*,/g, ", ")
        .replace(/^,\s*/, "")
        .replace(/\s+,/g, ",")
        .replace(/,\s*$/, ", ");

    /*
     * If there is a comma immediately before the
     * removed segment and nothing follows it,
     * preserve the ", " completion format.
     */
    if (
        newValue &&
        !newValue.endsWith(", ")) {
        newValue =
            newValue.replace(/,\s*$/, ", ");
    }

    searchInput.value =
        newValue;

    selectedSuggestionIndex = -1;

    suggestionBox.innerHTML = "";

    /*
     * Update the "previous" value so the next
     * input event doesn't think the deletion was
     * something else.
     */
    previousSearchValue =
        searchInput.value;
}

const getSortedMatches = (text, excludedTags = []) => {

    const lowerText = text.toLowerCase();

    const excluded = new Set(
            excludedTags.map(tag =>
                tag.trim().toLowerCase()));

    return getAllTags()
    .filter(tag => {

        const lowerTag =
            tag.trim().toLowerCase();

        return (
            lowerTag.includes(lowerText) &&
            !excluded.has(lowerTag));

    })
    .sort((a, b) => {

        const aLower =
            a.trim().toLowerCase();

        const bLower =
            b.trim().toLowerCase();

        const aStarts =
            aLower.startsWith(lowerText);

        const bStarts =
            bLower.startsWith(lowerText);

        if (aStarts && !bStarts)
            return -1;

        if (!aStarts && bStarts)
            return 1;

        return aLower.localeCompare(bLower);

    });

};

let previousSearchValue = "";

searchInput.addEventListener("input", () => {

    const value = searchInput.value;

    const currentIndex =
        getCurrentTagIndex();

    /*
     * If the user moved to a different tag,
     * validate the one they just left.
     */
    if (
        currentIndex !== activeTagIndex) {

        previousTagIndex =
            activeTagIndex;

        validatePreviousTag();

        // Recalculate because removing a tag
        // may have changed the indexes.
        activeTagIndex =
            getCurrentTagIndex();

    } else {

        activeTagIndex =
            currentIndex;

    }

    selectedSuggestionIndex = -1;

    suggestionBox.innerHTML = "";
    suggestions.length = 0;

    const parts =
        searchInput.value.split(",");

    const currentTag =
        (parts[activeTagIndex] || "").trim();

    const text =
        currentTag.toLowerCase();

    /*
     * Tags before and after the current one are
     * excluded from suggestions.
     */
    const enteredTags = parts
        .map((tag, index) => ({
                tag: tag.trim(),
                index
            }))
        .filter(item =>
            item.tag &&
            item.index !== activeTagIndex)
        .map(item => item.tag.toLowerCase());

    if (text) {

        getSortedMatches(
            text,
            enteredTags).forEach(tag => {

            const div =
                document.createElement("div");

            div.className =
                "suggestion";

            div.textContent =
                tag;

            div.onclick = () => {

                const parts =
                    searchInput.value.split(",");

                parts[activeTagIndex] =
                    tag;

                searchInput.value =
                    parts
                    .map(part => part.trim())
                    .join(", ");

                // If this was the final tag, give
                // the user the normal trailing
                // comma/space editing position.
                if (
                    activeTagIndex ===
                    parts.length - 1) {

                    searchInput.value += ", ";

                }

                suggestionBox.innerHTML = "";
                suggestions.length = 0;
                selectedSuggestionIndex = -1;

                searchInput.focus();

                const newPosition =
                    searchInput.value.length;

                searchInput.setSelectionRange(
                    newPosition,
                    newPosition);

            };

            suggestionBox.appendChild(div);

            suggestions.push(div);

        });

    }

    previousSearchValue =
        searchInput.value;

});

searchInput.addEventListener("click", () => {

    const newIndex =
        getCurrentTagIndex();

    if (
        newIndex !== activeTagIndex) {

        previousTagIndex =
            activeTagIndex;

        validatePreviousTag();

        activeTagIndex =
            getCurrentTagIndex();

    }

});

searchInput.addEventListener("keydown", e => {
    // =========================================
    // TAB = AUTOCORRECT CURRENT PARTIAL TAG
    // =========================================

    if (e.key === "Tab" && !e.shiftKey) {

        e.preventDefault();
        e.stopImmediatePropagation();

        const parts =
            searchInput.value.split(",");

        const partial =
            (parts[activeTagIndex] || "").trim();

        if (!partial)
            return;

        const enteredTags = parts
            .map((tag, index) => ({
                    tag: tag.trim(),
                    index
                }))
            .filter(item =>
                item.tag &&
                item.index !== activeTagIndex)
            .map(item => item.tag);

        const matches =
            getSortedMatches(
                partial,
                enteredTags);

        if (matches.length) {

            parts[activeTagIndex] =
                matches[0];

            searchInput.value =
                parts
                .map(part => part.trim())
                .join(", ");

            /*
             * We have now completed this tag.
             * Treat the NEXT tag as the active editing
             * position.
             */
            const nextIndex =
                activeTagIndex + 1;

            // If this was the final tag, create the
            // empty editing position after it.
            if (
                nextIndex >= parts.length) {

                searchInput.value += ", ";

            }

            /*
             * Recalculate the active tag based on the
             * position immediately after the corrected
             * tag.
             */
            let cursorPosition = 0;

            for (
                let i = 0;
                i <= activeTagIndex;
                i++) {

                cursorPosition +=
                parts[i].trim().length;

                if (i < activeTagIndex)
                    cursorPosition += 2;
            }

            // Move past the comma and space after
            // the corrected tag.
            cursorPosition += 2;

            activeTagIndex =
                Math.min(
                    nextIndex,
                    searchInput.value.split(",").length - 1);

            suggestionBox.innerHTML = "";
            suggestions.length = 0;
            selectedSuggestionIndex = -1;

            searchInput.focus();

            searchInput.setSelectionRange(
                cursorPosition,
                cursorPosition);

        }

        return;
    }

    // =========================================
    // SHIFT+TAB = REMOVE CURRENT PARTIAL TAG
    // OR RIGHTMOST COMPLETED TAG
    // =========================================

    if (e.key === "Tab" && e.shiftKey) {

        e.preventDefault();
        e.stopImmediatePropagation();

        const parts =
            searchInput.value.split(",");

        const current =
            (parts[activeTagIndex] || "").trim();

        let removeIndex;

        // If there is text in the current area,
        // remove that tag.
        if (current) {

            removeIndex =
                activeTagIndex;

        }

        // Otherwise we're in the empty area after
        // the last comma, so remove the rightmost tag.
        else {

            removeIndex =
                parts.length - 2;

        }

        if (
            removeIndex < 0 ||
            removeIndex >= parts.length) {
            return;
        }

        parts.splice(removeIndex, 1);

        searchInput.value =
            parts
            .map(part => part.trim())
            .filter(Boolean)
            .join(", ");

        if (searchInput.value)
            searchInput.value += ", ";

        suggestionBox.innerHTML = "";
        suggestions.length = 0;
        selectedSuggestionIndex = -1;

        activeTagIndex =
            Math.max(
                0,
                Math.min(
                    removeIndex,
                    searchInput.value.split(",").length - 1));

        searchInput.focus();

        const position =
            searchInput.value.length;

        searchInput.setSelectionRange(
            position,
            position);

        return;
    }

    // =========================================
    // DOWN = NEXT SUGGESTION
    // =========================================

    if (e.key === "ArrowDown") {

        if (!suggestions.length)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        selectedSuggestionIndex++;

        if (
            selectedSuggestionIndex >=
            suggestions.length) {
            selectedSuggestionIndex = 0;
        }

        updateSelectedSuggestion();

        return;
    }

    // =========================================
    // UP = PREVIOUS SUGGESTION
    // =========================================

    if (e.key === "ArrowUp") {

        if (!suggestions.length)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        selectedSuggestionIndex--;

        if (selectedSuggestionIndex < 0) {
            selectedSuggestionIndex =
                suggestions.length - 1;
        }

        updateSelectedSuggestion();

        return;
    }

    if (e.key === "Escape") {

        e.preventDefault();

        removeCurrentPartialTag();

        searchInput.blur();

        return;
    }

    // =========================================
    // ENTER = ACCEPT SELECTED SUGGESTION
    // =========================================

    if (
        e.key === "Enter" &&
        selectedSuggestionIndex >= 0 &&
        suggestions.length) {

        e.preventDefault();
        e.stopImmediatePropagation();

        suggestions[
            selectedSuggestionIndex
        ].click();

        return;
    }

}, true);

//listen on entire doc
document.addEventListener("mousedown", e => {

    if (
        e.target !== searchInput &&
        !suggestionBox.contains(e.target)) {

        removeCurrentPartialTag();

    }

});

function updateSelectedSuggestion() {

    suggestions.forEach((suggestion, index) => {

        if (index === selectedSuggestionIndex) {

            suggestion.style.backgroundColor = "#ccc";
            suggestion.style.color = "black";

        } else {

            suggestion.style.backgroundColor = "";
            suggestion.style.color = "";

        }

    });

    if (
        selectedSuggestionIndex >= 0 &&
        selectedSuggestionIndex < suggestions.length) {

        suggestions[
            selectedSuggestionIndex
        ].scrollIntoView({
            block: "nearest"
        });

    }

}

function searchAlbumsByTags() {

    const query = searchInput.value
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

    if (!query.length)
        return;

    const results = albums.filter(album => {

        const albumTags = (album.tags || [])
        .map(t => t.toLowerCase());

        return query.every(tag =>
            albumTags.includes(tag));

    });

    showSearchResults(results);

}

function showSearchResults(results) {

    closeModal();

    // Remove album URL state
    history.replaceState(
        null,
        "",
        window.location.pathname);

    // Reset album state
    isQueryAlbum = false;
    currentAlbum = null;

    // Hide album controls
    document.getElementById("backButton").style.display = "none";
    document.getElementById("saveButton").style.display = "none";

    // Hide / clear tags
    const tagContainer = document.getElementById("tagBar");

    if (tagContainer) {
        tagContainer.style.display = "none";
        document.getElementById("tagToggle").style.display = "none";
    }

    const gallery = document.getElementById("gallery");

    gallery.innerHTML = "";

    if (!results.length) {

        gallery.textContent = "No albums found.";

        return;

    }

    results.forEach(album => {

        const cover = album.images[
                Math.floor(Math.random() * album.images.length)
            ];

        const card = document.createElement("div");

        card.className = "album";

        const img = document.createElement("img");
        img.src = cover.thumb.url;

        const title = document.createElement("div");
        title.textContent = album.name;

        card.appendChild(img);
        card.appendChild(title);

        card.onclick = () => loadAlbum(album);

        gallery.appendChild(card);

    });

}

const clearSearch =
    document.getElementById("clearSearch");

clearSearch.addEventListener("click", () => {

    searchInput.value = "";

    suggestionBox.innerHTML = "";
    suggestions.length = 0;
    selectedSuggestionIndex = -1;

    activeTagIndex = 0;
    previousTagIndex = 0;

    searchInput.focus();

});

document.getElementById("searchButton").onclick =
    searchAlbumsByTags;

searchInput.addEventListener("keydown", e => {

    if (e.key === "Enter") {
        searchAlbumsByTags();
    }

});

document.getElementById("regenerateAlbum").onclick = () => {

    if (!currentAlbum)
        return;

    const newID = generateAlbumID(
            currentAlbum.name,
            currentAlbum.id);

    currentAlbum.id = newID;

    history.replaceState(
        null,
        "",
        "?$" + encodeURIComponent(newID));

    const query = createAlbumQuery(currentAlbum);

    const js = `,
	{
		id: "${newID.replace(/"/g, '\\"')}",
		name: "${currentAlbum.name.replace(/"/g, '\\"')}",
		url: \`
			?${query}
		\`.trim(),
		tags: ${JSON.stringify(currentAlbum.tags || [])}
	}`;

    navigator.clipboard.writeText(js)
    .then(() => {
        alert("Regenerated albums.js entry and copied it to clipboard!");
    })
    .catch(() => {
        prompt("Copy this into albums.js:", js);
    });

};

function showAlbumButtons(show) {

    document.getElementById("backButton").style.display =
        show ? "" : "none";

    document.getElementById("saveButton").style.display =
        (show && isQueryAlbum) ? "flex" : "none";

    document.getElementById("regenerateAlbum").style.display =
        show ? "" : "none";

    document.getElementById("tagToggle").style.display =
        show ? "" : "none";
}

function saveTagBarState() {

    const tagBar =
        document.getElementById("tagBar");
    if (!tagBar.classList.contains("hidden")) {
        tagBar.style.visibility = "visible";
    }

    localStorage.setItem(
        "tagBarHidden",
        tagBar.classList.contains("hidden"));
}

function loadTagBarState() {

    const tagBar =
        document.getElementById("tagBar");

    const hidden =
        localStorage.getItem("tagBarHidden") === "true";

    /*
     * Prevent the saved state from animating.
     */
    tagBar.classList.add("noTransition");

    if (hidden) {
        tagBar.classList.add("hidden");
    } else {
        tagBar.classList.remove("hidden");
        tagBar.style.visibility = "visible";
    }

    /*
     * Force the browser to acknowledge the
     * non-animated state.
     */
    tagBar.offsetWidth;

    /*
     * Restore normal transitions for future
     * user-triggered toggles.
     */
    tagBar.classList.remove("noTransition");
}

function cancelCenterReturn() {

    if (centerReturnTimer !== null) {

        clearTimeout(centerReturnTimer);

        centerReturnTimer = null;

    }

    if (centerReturnAnimation !== null) {

        cancelAnimationFrame(
            centerReturnAnimation);

        centerReturnAnimation = null;

    }

}

function scheduleCenterReturn() {

    /*
     * If a countdown is already running,
     * don't start another one.
     */

    if (centerReturnTimer !== null)
        return;

    /*
     * Don't schedule anything if already centered
     * and already at the minimum zoom.
     */

    if (
        Math.abs(imgTransform.x) < 0.01 &&
        Math.abs(imgTransform.y) < 0.01 &&
        Math.abs(imgTransform.scale - minZoom) < 0.001) {

        return;

    }

    /*
     * -------------------------------------------------
     * WAIT BEFORE STARTING
     * -------------------------------------------------
     */

    centerReturnTimer =
        setTimeout(() => {

            centerReturnTimer = null;

            /*
             * User interacted while waiting.
             */

            if (
                imgDragging ||
                interactingWithImage ||
                zooming) {

                return;

            }

            /*
             * Get the current image.
             */

            const img =
                displayingFull
                 ? modalImgFull
                 : modalImgMedium;

            if (!img)
                return;

            /*
             * Capture the current position and zoom.
             */

            const startX =
                imgTransform.x;

            const startY =
                imgTransform.y;

            const startScale =
                imgTransform.scale;

            /*
             * Already completely centered.
             */

            if (
                Math.abs(startX) < 0.01 &&
                Math.abs(startY) < 0.01 &&
                Math.abs(startScale - minZoom) < 0.001) {

                return;

            }

            /*
             * -------------------------------------------------
             * ANIMATION
             * -------------------------------------------------
             */

            const startTime =
                performance.now();

            const duration =
                centerAnimationDuration;

            function animateCenter(now) {

                /*
                 * User interaction cancels the animation.
                 */

                if (
                    imgDragging ||
                    interactingWithImage ||
                    zooming) {

                    centerReturnAnimation =
                        null;

                    return;

                }

                const progress =
                    Math.min(
                        1,
                        (now - startTime) /
                        duration);

                /*
                 * Ease-out.
                 */

                const eased =
                    1 -
                    Math.pow(
                        1 - progress,
                        3);

                /*
                 * Animate BOTH position and zoom.
                 */

                imgTransform.x =
                    startX *
                    (1 - eased);

                imgTransform.y =
                    startY *
                    (1 - eased);

                imgTransform.scale =
                    startScale +
                    (
                        minZoom -
                        startScale) *
                    eased;

                applyTransform();

                if (progress < 1) {

                    centerReturnAnimation =
                        requestAnimationFrame(
                            animateCenter);

                } else {

                    imgTransform.x = 0;
                    imgTransform.y = 0;
                    imgTransform.scale = minZoom;

                    applyTransform();

                    centerReturnAnimation =
                        null;

                }

            }

            centerReturnAnimation =
                requestAnimationFrame(
                    animateCenter);

        }, 3000);

}
