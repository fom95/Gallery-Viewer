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
 * localStorage -- for the rest of the session.
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

        refreshSavedAlbums();

    }

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

            const isTelegram =
                typeof album.url === "string" &&
                album.url.startsWith(
                    "tg://chat/"
                );

            let cover =
                null;

            if (
                !isTelegram &&
                album.images &&
                album.images.length
            ) {

                if (!homeCoverCache.has(album.id)) {

                    homeCoverCache.set(
                        album.id,
                        album.images[
                            Math.floor(
                                Math.random() *
                                album.images.length
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
                cover &&
                cover.thumb &&
                cover.thumb.url
            ) {

                img.src =
                    cover.thumb.url;

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
                    "Copy Telegram album record";

                exportBtn.onclick = async (e) => {
					e.stopPropagation();

					try {

						const telegramImages =
							(album.images || [])
							.filter(
								image =>
									image &&
									image.source === "telegram" &&
									image.messageID != null
							);

						if (!telegramImages.length) {

							/*
							 * This can happen for a MANUAL_ALBUMS Telegram
							 * record which has not yet been opened.
							 *
							 * Load it once so that its image records exist.
							 */
							await loadTelegramAlbum(album);

						}

						const images =
							(album.images || [])
							.filter(
								image =>
									image &&
									image.source === "telegram" &&
									image.messageID != null
							);

						if (!images.length) {

							alert(
								"No Telegram image messages were found."
							);

							return;
						}

						const match =
							album.url.match(
								/^tg:\/\/chat\/(-?\d+)/
							);

						if (!match) {

							alert(
								"Invalid Telegram album URL."
							);

							return;
						}

						const chatId =
							match[1];

						const messageIDs =
							images.map(
								image =>
									image.messageID
							);

						const coverID =
							album._telegramCoverMessageID ||
							messageIDs[0];

						const messageIDString =
							messageIDs.join(",");

						const id =
							generateAlbumID(album.name);

						const js =
							`,
	{
		id: "${id.replace(/"/g, '\\"')}",
		name: "${album.name.replace(/"/g, '\\"')}",
		url: \`
		tg://chat/${chatId}?cover=${coverID}&messages=${messageIDString}
		\`.trim(),
		tags: ${JSON.stringify(album.tags || [])}
	}`;

						navigator.clipboard
							.writeText(js)
							.then(() => {
								alert(
									"Copied Telegram album entry!"
								);
							})
							.catch(() => {
								prompt(
									"Copy this:",
									js
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
                            JSON.stringify(saved)
                        );

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

            }

            gallery.appendChild(
                card
            );

            if (
				isTelegram &&
				album.images &&
				album.images.length
			) {

				const cover =
					album.images.find(
						image =>
							image &&
							image.source === "telegram" &&
							image.messageID != null
					);

				if (cover) {

					const url =
						getTelegramMediaURL(
							cover,
							"thumb"
						);

					if (url) {

						img.src =
							url;

						img.style.visibility =
							"visible";

					}

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


function refreshSavedAlbums() {

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
        JSON.parse(
            localStorage.getItem("savedAlbums") || "[]"
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


function returnToAlbums() {

    goBackToAlbumsWithTransition();

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
