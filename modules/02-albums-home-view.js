/*
 * 02-albums-home-view.js
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


async function showAlbums() {

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

    document.getElementById("tagBar").style.display =
        "none";

    document.getElementById("tagToggle").style.display =
        "none";

    document.getElementById("settingsButton").style.display =
        "";

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

    document.getElementById("saveButton").style.display =
        "none";

    const gallery =
        document.getElementById("gallery");

    gallery.innerHTML =
        "";

    albums.forEach(
        album => {

            const isTelegram =
                typeof album.url === "string" &&
                album.url.startsWith(
                    "tg://chat/"
                );

            const images =
                buildImagesArray(album);

            let cover =
                null;

            if (
                !isTelegram &&
                images.length
            ) {

                if (!homeCoverCache.has(album.id)) {

                    homeCoverCache.set(
                        album.id,
                        images[
                            Math.floor(
                                Math.random() *
                                images.length
                            )
                        ]
                    );

                }

                cover =
                    homeCoverCache.get(album.id);

            }

            const card =
                document.createElement("div");

            card.className =
                "album";

            card.dataset.albumId =
                String(album.id);

            const img =
                document.createElement("img");
			
			img.alt = (album.tags || []).join(",");

            if (
                !isTelegram &&
                cover
            ) {

                const coverURL =
                    getBestGuessImageURL(album, cover, "thumb");

                if (coverURL)
                    img.src = coverURL;

            }

            if (
                isTelegram
            ) {

                img.style.visibility =
                    "hidden";

            }

            const title =
                document.createElement("div");

            title.textContent =
                album.name;

            card.appendChild(img);

            card.appendChild(title);

            card.onclick =
                () => openAlbumWithTransition(album, img);

            /*
             * Telegram albums always have their Telegram
             * export button because they originate from
             * a Telegram chat record.
             */
            if (
                isTelegram
            ) {

                const exportBtn =
                    document.createElement("button");

                exportBtn.className =
                    "album-export";

                exportBtn.textContent =
                    "↗";

                exportBtn.title =
                    "Copy album.txt line";

                exportBtn.onclick = async (e) => {
					e.stopPropagation();

					try {

						if (!Object.keys(album.images || {}).length) {

							/*
							 * This can happen for an album record
							 * that hasn't been opened yet and has no
							 * pre-populated image list. Load it once
							 * so its image records exist.
							 */
							await loadTelegramAlbum(album);
							buildImagesArray(album);

						}
						
						//set storage to false when export is meant for the txt
						album.storage = false;

						const line =
							await compressAlbum(album);

						navigator.clipboard
							.writeText(line)
							.then(() => {
								alert(
									"Copied a line for album.txt!"
								);
							})
							.catch(() => {
								prompt(
									"Copy this:",
									line
								);
							});

					}
					catch (error) {

						alert(
							"Failed to load Telegram album data:\n\n" +
							(
								error &&
								error.message
									? error.message
									: String(error)
							)
						);

					}
				};

                card.appendChild(
                    exportBtn
                );

            }

            if (
                album.storage
            ) {

                const deleteBtn =
                    document.createElement("button");

                deleteBtn.className =
                    "album-delete";

                deleteBtn.textContent =
                    "×";

                deleteBtn.title =
                    album.edited
                        ? "Delete local edits"
                        : "Remove saved album";

                if (
                    album.edited
                ) {

                    deleteBtn.classList.add(
                        "album-delete-edited"
                    );

                }

                deleteBtn.onclick =
                    async (e) => {

                        e.stopPropagation();

                        const saved =
                            await getSavedAlbums();

                        const filtered =
                            saved.filter(
                                savedAlbum =>
                                    savedAlbum.id !==
                                    album.id
                            );

                        await setSavedAlbums(filtered);

                        showAlbums();

                    };

                card.appendChild(
					deleteBtn
				);

				/*
				 * Non-Telegram saved albums get an export
				 * button only when they contain local edits.
				 */
				if (
					album.edited &&
					!isTelegram
				) {

                    const exportBtn =
                        document.createElement("button");

                    exportBtn.className =
                        "album-export";

                    exportBtn.textContent =
                        "↗";

                    exportBtn.title =
                        "Copy album.txt line";

                    exportBtn.onclick =
                        async (e) => {

                            e.stopPropagation();
							
							//set storage to false when export is meant for the txt
							album.storage = false;

                            const line =
                                await compressAlbum(album);

                            navigator.clipboard
                                .writeText(line)
                                .then(
                                    () => {

                                        alert(
                                            "Copied a line for album.txt!"
                                        );

                                    }
                                )
                                .catch(
                                    () => {

                                        prompt(
                                            "Copy this:",
                                            line
                                        );

                                    }
                                );

                        };

                    card.appendChild(
                        exportBtn
                    );

                }

            }

            gallery.appendChild(
                card
            );

            if (
                isTelegram &&
                window.telegramClient
            ) {

                /*
                 * Only fetch a Telegram cover once per album id per
                 * session. Re-using the cached promise (instead of
                 * calling loadTelegramAlbumCover() again) is what
                 * keeps the randomly-chosen cover stable across
                 * repeated visits to the home page.
                 */
                if (!homeCoverCache.has(album.id)) {

                    homeCoverCache.set(
                        album.id,
                        loadTelegramAlbumCover(album)
                    );

                }

                album._telegramCoverPromise =
                    homeCoverCache.get(album.id);

                album._telegramCoverPromise
                    .then(
                        result => {

                            img.src =
                                result.url;

                            img.style.visibility =
                                "visible";

                        }
                    )
                    .catch(
                        error => {

                            console.error(
                                "[TELEGRAM COVER FAILED]",
                                error
                            );

                        }
                    );

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
}


async function refreshSavedAlbums() {

    for (
        let i = albums.length - 1;
        i >= 0;
        i--
    ) {

        if (
            albums[i].storage
        ) {

            albums.splice(
                i,
                1
            );

        }

    }

    const saved =
        await getSavedAlbums();

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


function returnToAlbums() {

    goBackToAlbumsWithTransition();

}
