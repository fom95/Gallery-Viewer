/*
 * 12-modal-viewer.js
 *
 * Opening and closing the full-screen image viewer (lightbox).
 */

/*
 * While the modal is waiting for the larger variant, the grid thumbnail
 * is fitted to the same area the larger image will occupy and blurred,
 * with a centered loading bar. This avoids the tiny grid-sized thumb
 * pop and gives the incoming resolution nothing to resize against.
 */
function clearModalPlaceholderState() {

    const loadingBar =
        document.getElementById("modalLoadingBar");

    if (loadingBar) {

        loadingBar.classList.remove("placeholder");
        loadingBar.classList.remove("determinate");
        loadingBar.style.opacity = "0";

    }

    const loadingProgress =
        document.getElementById("modalLoadingProgress");

    if (loadingProgress)
        loadingProgress.style.width = "0%";

    if (modalImgSmall)
        modalImgSmall.classList.remove("modal-thumb-placeholder");

}


function showModalPlaceholder(sourceImage) {

    if (!modalImgSmall)
        return;

    const naturalWidth =
        sourceImage?.naturalWidth ||
        modalImgSmall.naturalWidth;

    const naturalHeight =
        sourceImage?.naturalHeight ||
        modalImgSmall.naturalHeight;

    if (naturalWidth && naturalHeight) {

        const scale =
            Math.min(
                window.innerWidth / naturalWidth,
                window.innerHeight / naturalHeight
            );

        modalImgSmall.style.width =
            `${naturalWidth * scale}px`;

        modalImgSmall.style.height =
            `${naturalHeight * scale}px`;

    }

    modalImgSmall.classList.add(
        "modal-thumb-placeholder"
    );

    modalImgSmall.style.filter =
        "blur(26px) brightness(0.7)";

    modalImgSmall.style.transform =
        "translate(-50%, -50%) scale(1.06)";

    modalImgSmall.style.visibility =
        "visible";

    const loadingBar =
        document.getElementById("modalLoadingBar");

    if (loadingBar) {

        loadingBar.classList.add("placeholder");
        loadingBar.style.opacity = "1";

    }

    const loadingProgress =
        document.getElementById("modalLoadingProgress");

    if (loadingProgress)
        loadingProgress.style.width = "";

}


function beginModalPlaceholderProgress() {

    const loadingBar =
        document.getElementById("modalLoadingBar");

    const loadingProgress =
        document.getElementById("modalLoadingProgress");

    if (!loadingBar || !loadingProgress)
        return;

    loadingBar.classList.add(
        "placeholder",
        "determinate"
    );

    loadingBar.style.opacity =
        "1";

    loadingProgress.style.width =
        "0%";

}


function updateModalPlaceholderProgress(received, total) {

    const loadingBar =
        document.getElementById("modalLoadingBar");

    const loadingProgress =
        document.getElementById("modalLoadingProgress");

    if (!loadingBar || !loadingProgress)
        return;

    loadingBar.classList.add("placeholder");

    if (total > 0) {

        loadingBar.classList.add(
            "determinate"
        );

        loadingProgress.style.width =
            `${Math.min(
                100,
                received / total * 100
            )}%`;

    } else {

        loadingBar.classList.remove(
            "determinate"
        );

        loadingProgress.style.width =
            "";

    }

}


function showModalPlaceholderIndeterminate() {

    const loadingBar =
        document.getElementById("modalLoadingBar");

    const loadingProgress =
        document.getElementById("modalLoadingProgress");

    if (!loadingBar || !loadingProgress)
        return;

    loadingBar.classList.add("placeholder");
    loadingBar.classList.remove("determinate");
    loadingBar.style.opacity = "1";
    loadingProgress.style.width = "";

}


function hasCachedFullImage(image, album, fullSrc) {

    const seen =
        new Set();

    const check =
        url => {

            if (!url || seen.has(url))
                return false;

            seen.add(url);

            return (
                typeof getCachedImageBlobURL === "function" &&
                !!getCachedImageBlobURL(url)
            );

        };

    if (check(fullSrc))
        return true;

    if (
        image &&
        typeof getImageProviderCandidates === "function"
    ) {

        for (
            const candidate of
                getImageProviderCandidates(
                    album,
                    image,
                    "full"
                )
        ) {

            if (check(candidate?.url))
                return true;

        }

    }

    return false;

}


async function openModal(thumbSrc, mediumSrc, fullSrc, sourceThumb) {
	if (typeof handleVideoModal === "function" && handleVideoModal(sourceThumb))
		return;

	pauseThumbnailLoading();
	stopMediumLoading();

	modalOpenStartedAt =
		performance.now();

	const modalWasOpenCheck =
		document.getElementById("modal");

	const wasModalOpen =
		!!modalWasOpenCheck &&
		modalWasOpenCheck.style.display === "flex";

	/*
	 * Clean up any stale snapshot left over from an interrupted
	 * previous transition before possibly creating a new one below.
	 */
	if (modalOutgoingClone) {

		modalOutgoingClone.remove();

		modalOutgoingClone =
			null;

	}

	/*
	 * Navigating to a different image while the modal is already
	 * open (arrow keys, etc) -- snapshot whatever is currently on
	 * screen so it can fade away independently of however the new
	 * image ends up being revealed (see revealModalResolution() in
	 * 11-full-image-loader.js).
	 */
	if (wasModalOpen) {

		const activeImg =
			(
				displayingFull &&
				modalImgFull &&
				modalImgFull.style.visibility !== "hidden"
			)
				? modalImgFull
				: (
					modalImgMedium &&
					modalImgMedium.style.visibility !== "hidden"
				)
					? modalImgMedium
					: (
						modalImgSmall &&
						modalImgSmall.style.visibility !== "hidden"
					)
						? modalImgSmall
						: null;

		if (activeImg && (activeImg.currentSrc || activeImg.src)) {

			const rect =
				activeImg.getBoundingClientRect();

			if (rect.width && rect.height) {

				modalOutgoingClone =
					document.createElement("img");

				modalOutgoingClone.src =
					activeImg.currentSrc || activeImg.src;

				modalOutgoingClone.className =
					"modal-nav-outgoing";

				modalOutgoingClone.style.left =
					rect.left + "px";

				modalOutgoingClone.style.top =
					rect.top + "px";

				modalOutgoingClone.style.width =
					rect.width + "px";

				modalOutgoingClone.style.height =
					rect.height + "px";

				document.body.appendChild(
					modalOutgoingClone
				);

			}

		}

	}

	const sourceItem =
		sourceThumb?._thumbnailItem || null;

	const mediumItem =
		findMediumItem(mediumSrc);

	const sourceMediumImage =
		(
			mediumItem &&
			mediumItem.mediumLoaded &&
			mediumItem.mediumImage
		)
			? mediumItem.mediumImage
			: null;

    const showModalThumbPlaceholder =
        !sourceMediumImage &&
        !!(mediumSrc || fullSrc);

    const loadID =
        ++modalLoadID;

    manualFullEnabled =
        modalForceFullResolution;

    modalMediumSrc =
        mediumSrc;

    /*
     * Telegram-backed albums don't hand openModal() a full URL (their
     * sizes are resolved later), so derive one from the image entry.
     * That way the HD control can stay present from the moment the
     * image opens instead of vanishing until the full download ends.
     */
    let resolvedFullSrc =
        fullSrc;

    if (
        !resolvedFullSrc &&
        sourceItem?.image &&
        typeof getBestGuessImageURL === "function"
    ) {

        const album =
            sourceItem._album || currentAlbum;

        const candidate =
            getBestGuessImageURL(
                album,
                sourceItem.image,
                "full"
            );

        if (candidate)
            resolvedFullSrc = candidate;

    }

    modalFullSrc =
        resolvedFullSrc;

    fullImageCached =
        !!(
            resolvedFullSrc &&
            resolvedFullSrc !== mediumSrc &&
            hasCachedFullImage(
                sourceItem?.image,
                sourceItem?._album || currentAlbum,
                resolvedFullSrc
            )
        );

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

    fullImageProgress =
        0;

    fullProgressRevealed =
        false;

    fullImageFailed =
        false;

    displayingFull =
        false;

    if (modalMediumTimer) {

        clearTimeout(modalMediumTimer);

        modalMediumTimer =
            null;

    }

    if (fullSwitchTimer) {

        clearTimeout(fullSwitchTimer);

        fullSwitchTimer =
            null;

    }

    cancelImageLoads();

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

    clearModalPlaceholderState();

    const loader =
        document.getElementById(
            "modalLoading");

    const fullButton =
        document.getElementById(
            "modalFullButton");

    modal.style.display =
        "flex";

	let sourceThumbRect =
		null;

	let sourceThumbSrc =
		null;

	let sourceThumbnailImage =
		null;

	if (sourceThumb) {

		sourceThumbnailImage =
			sourceThumb.querySelector(".thumbnail-image");

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

    if (modalImgSmall) {

        modalImgSmall.classList.remove(
            "modal-reveal-transition");

        modalImgSmall.style.visibility =
            "hidden";

        modalImgSmall.style.opacity =
            "1";

        modalImgSmall.style.filter =
            "none";

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

        if (
            sourceThumb &&
            sourceThumbSrc) {

            modalImgSmall.src =
                sourceThumbSrc;

            if (showModalThumbPlaceholder) {

                showModalPlaceholder(
                    sourceThumbnailImage ||
                    modalImgSmall
                );

            } else {

                if (sourceThumbRect) {

                    modalImgSmall.style.width =
                        sourceThumbRect.width +
                        "px";

                    modalImgSmall.style.height =
                        sourceThumbRect.height +
                        "px";

                }

                modalImgSmall.style.filter =
                    "none";

                modalImgSmall.style.transform =
                    "translate(-50%, -50%)";

                modalImgSmall.style.visibility =
                    "visible";

            }

        }

    }

    if (modalImgMedium) {

        modalImgMedium.classList.remove(
            "modal-reveal-transition");

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

    if (modalImgFull) {

        modalImgFull.classList.remove(
            "modal-reveal-transition");

        modalImgFull.style.transition =
            "";

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

    if (loadingTimer) {

        clearTimeout(loadingTimer);

        loadingTimer =
            null;

    }

    if (loader) {

        loader.classList.remove(
            "active");

    }

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

    zooming =
        false;

    zoomAnchorX =
        0;

    zoomAnchorY =
        0;

    let stage =
        -1;

    if (fullButton) {

        const hasMultipleResolutions =
            !!modalFullSrc &&
            modalFullSrc !== modalMediumSrc;

        fullButton.style.opacity =
            "0.8";

        updateModalFullButtonState();

        updateModalFullButtonVisibility();

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

                    modalForceFullResolution =
                        false;

                    updateModalFullButtonState();

                    enforceAutoResolution();

                    return;

                }

                if (
                    fullImageLoaded ||
                    fullImageCached
                ) {

                    manualFullEnabled =
                        true;

                    modalForceFullResolution =
                        true;

                    updateModalFullButtonState();

                    if (fullSwitchTimer) {

                        clearTimeout(fullSwitchTimer);

                        fullSwitchTimer =
                            null;

                    }

                    /*
                     * A cached full may still be decoding; the load
                     * listener applies the pending switch.
                     */
                    if (fullImageLoaded)
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

    function display(url,
        resize,
        newStage) {

        if (!isModalLoadActive(loadID))
            return;

        if (newStage <= stage)
            return;

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

        if (newStage === 0) {

            if (!modalImgSmall)
                return;

            modalImgSmall.src =
                url;

            resizeThumb(modalImgSmall);

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

		if (newStage === 1) {

			if (!modalImgMedium)
				return;

			const showMedium =
				() => {

				if (!isModalLoadActive(loadID))
					return;

				imgResize(modalImgMedium);

				const finalWidth =
					parseFloat(modalImgMedium.style.width) || null;

				const finalHeight =
					parseFloat(modalImgMedium.style.height) || null;

				modalMediumLoaded =
					true;

				displayingFull =
					false;

				modalImgMedium.dataset.showingFull =
					"false";

				modalImgMedium.style.opacity =
					"1";

				modalImgMedium.style.zIndex =
					"3";

				/*
				 * revealModalResolution() decides whether this counts
				 * as a genuine load (grow in from the thumbnail's
				 * on-screen size, blurred) or something that was
				 * already available (show it directly, no animation)
				 * based on how long this openModal() call has
				 * actually taken so far.
				 */
				revealModalResolution(
					modalImgMedium,
					finalWidth,
					finalHeight
				);

				showMediumImage();

				if (
					modalForceFullResolution &&
					fullImageLoaded
				) {
					switchToFull();
				}

				applyTransform();

				if (loadingTimer) {

					clearTimeout(loadingTimer);

					loadingTimer =
						null;

				}

				if (loader) {

					loader.classList.remove("active");

				}

				if (!fullSrc) {

					resumeThumbnailLoading();

				}

			};

			modalImgMedium.src =
				url;

			/*
			 * img.decode() resolves as a microtask once the image is
			 * ready to paint -- for an image that's already decoded
			 * elsewhere (e.g. this exact blob URL is currently showing
			 * in the grid), that resolves before the browser's next
			 * paint, so the thumbnail placeholder is swapped out
			 * before it's ever actually shown on screen. The old
			 * `.complete` / "load" event check couldn't guarantee
			 * that -- "load" fires as a separate task, which is
			 * scheduled *after* a paint has already happened, so the
			 * thumbnail would flash even when the medium image was
			 * sitting right there, fully decoded, the whole time.
			 */
			if (modalImgMedium.decode) {

				modalImgMedium.decode()
					.then(showMedium)
					.catch(() => {

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

					});

			} else if (
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

    modal.addEventListener(
        "touchstart",
        e => {

        if (e.touches.length === 2) {

            e.preventDefault();

            if (!modalImageInteractionReady())
                return;

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

            if (!modalImageInteractionReady())
                return;

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

				fullImageLoading =
					false;

				fullImageFailed =
					false;

				updateModalFullButtonVisibility();

				resumeThumbnailLoading();

				if (
					modalForceFullResolution &&
					modalMediumLoaded
				) {
					switchToFull();
				}

			},
			{
				once:
					true
			}
		);

	}

    if (sourceItem && !sourceItem.loaded) {
        let thumbnailURL = null;
        try {
            thumbnailURL = await forceLoadThumbnail(sourceItem);
        } catch (error) {
            console.debug("[MODAL THUMBNAIL] Asset resolution failed", {
                index: sourceItem.index,
                source: sourceItem.source,
                errorName: error?.name,
                errorMessage: error?.message
            });
        }

        if (!thumbnailURL && isModalLoadActive(loadID)) {
            sourceItem.thumbnailFailed = true;
            noteImageFailure();
            console.debug("[MODAL THUMBNAIL] Failed; medium/full deferred until thumbnail succeeds", {
                index: sourceItem.index,
                source: sourceItem.source
            });
            modalRetry = {
                name: "open",
                loadID,
                thumbSrc: sourceItem.source === "telegram" ? "" : getImageURLs(sourceItem.image).thumb,
                mediumSrc: sourceItem.source === "telegram" ? "" : getImageURLs(sourceItem.image).medium,
                fullSrc: sourceItem.source === "telegram" ? "" : getImageURLs(sourceItem.image).full,
                slot: sourceThumb
            };
            return;
        }

        if (
            thumbnailURL &&
            isModalLoadActive(loadID) &&
            showModalThumbPlaceholder &&
            modalImgSmall
        ) {

            modalImgSmall.src =
                thumbnailURL;

            showModalPlaceholder(
                sourceItem.img ||
                modalImgSmall
            );

        }

    }

    if (sourceMediumImage) {
        modalMediumLoaded = true;
        modalMediumLoading = false;
        modalMediumImage = sourceMediumImage;
        display(sourceMediumImage.src, true, 1);
        if (fullSrc)
            load(fullSrc, "full", loadID);
        else
            resumeThumbnailLoading();
    } else if (sourceItem?.image) {
        const knownMediumItem = mediumItems.find(item => item && item.index === sourceItem.index);
        let medium = knownMediumItem?.mediumLoaded
            ? knownMediumItem.mediumBlobURL || knownMediumItem.src
            : null;
        if (!medium) {
            if (showModalThumbPlaceholder)
                beginModalPlaceholderProgress();
            try {
                medium = await resolveImageAssetBlobWithProgress(
                    sourceItem,
                    "medium",
                    (received, total) =>
                        updateModalPlaceholderProgress(
                            received,
                            total
                        ),
                    () => isModalLoadActive(loadID)
                );
            } catch {}

            /*
             * Fetching bytes for progress can fail on a non-CORS
             * provider. Fall back to the normal probe path and switch
             * the bar back to its indeterminate sweep.
             */
            if (!medium && isModalLoadActive(loadID)) {
                showModalPlaceholderIndeterminate();
                try {
                    medium = await resolveImageAsset(sourceItem, "medium", () => isModalLoadActive(loadID));
                } catch {}
            }
        }
        if (medium && isModalLoadActive(loadID)) {
            if (knownMediumItem)
                knownMediumItem.src = medium;
            modalMediumSrc = medium;

            /*
             * Show the medium as soon as its bytes are ready. The full
             * resolution is a background upgrade: awaiting it here held
             * the placeholder and the full progress bar on screen
             * while a much larger file finished downloading.
             */
            display(medium, true, 1);

            void (async () => {
                fullImageLoading = true;
                beginFullImageProgress();
                fullImageFailed = false;
                updateModalFullButtonVisibility();

                let full = null;
                let firstProgress = true;

                try {
                    full = await resolveImageAssetBlobWithProgress(
                        sourceItem,
                        "full",
                        (received, total) => {
                            if (!isModalLoadActive(loadID))
                                return;

                            if (firstProgress) {
                                firstProgress = false;

                                /*
                                 * A blob already in memory reports its
                                 * whole size at once; there is nothing
                                 * to show a percentage for.
                                 */
                                if (total > 0 && received >= total)
                                    fullImageCached = true;
                            }

                            updateModalFullProgress(
                                total > 0
                                    ? received / total * 100
                                    : 10 + (received / (received + 1024 * 1024)) * 80
                            );
                        },
                        () => isModalLoadActive(loadID)
                    );
                } catch {}

                if (!full && isModalLoadActive(loadID)) {
                    try {
                        full = await resolveImageAsset(sourceItem, "full", () => isModalLoadActive(loadID));
                    } catch {}
                }

                if (!isModalLoadActive(loadID)) {
                    /*
                     * This load belongs to an image that is no longer
                     * open. Do not touch the shared flags: the new
                     * image's load may already own them.
                     */
                    return;
                }

                if (!full) {
                    fullImageLoading = false;
                    fullImageFailed = true;
                    updateModalFullButtonVisibility();
                    return;
                }

                modalFullSrc = full;

                if (modalImgFull)
                    modalImgFull.src = full;
            })();

        } else if (
            fullSrc &&
            isModalLoadActive(loadID)
        ) {
            load(fullSrc, "full", loadID);
        } else {
            if (isModalLoadActive(loadID)) {
                noteImageFailure();
                modalRetry = {
                    url: mediumSrc || fullSrc,
                    name: mediumSrc ? "medium" : "full",
                    loadID
                };
            }
            resumeThumbnailLoading();
        }
    } else if (
        mediumSrc &&
        isModalLoadActive(loadID)
    ) {
        load(mediumSrc, "medium", loadID);
    } else if (
        fullSrc &&
        isModalLoadActive(loadID)
    ) {
        load(fullSrc, "full", loadID);
    } else {
        resumeThumbnailLoading();
    }

}

function closeModal(resumeGallery = true) {

	if (typeof teardownModalVideo === "function")
		teardownModalVideo();


	modalLoadID++;
    modalRetry = null;

	cancelImageLoads();

	if (modalOutgoingClone) {

		modalOutgoingClone.remove();

		modalOutgoingClone =
			null;

	}

	fullImageLoading =
		false;

	modalMediumLoading =
		false;

	if (
		resumeGallery
	) {

		thumbnailPriorityPaused =
			false;

		processThumbnailQueue(thumbnailLoadSession);

	}

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

	if (typeof clearModalPlaceholderState === "function")
		clearModalPlaceholderState();

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

	if (loadingTimer) {

		clearTimeout(loadingTimer);

		loadingTimer =
			null;

	}

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

    if (img === modalImgSmall) {

        resizeThumb(img);

    } else {

        imgResize(img);

    }

    applyTransform();

    constrainImage(img);

});
