/*
 * 10-modal-viewer.js
 *
 * Opening and closing the full-screen image viewer (lightbox).
 */

async function openModal(thumbSrc, mediumSrc, fullSrc, sourceThumb) {
	pauseThumbnailLoading();
	stopMediumLoading();

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

        if (
            sourceThumb &&
            sourceThumbSrc) {

            modalImgSmall.src =
                sourceThumbSrc;

            if (sourceThumbRect) {

                modalImgSmall.style.width =
                    sourceThumbRect.width +
                    "px";

                modalImgSmall.style.height =
                    sourceThumbRect.height +
                    "px";

            }

            modalImgSmall.style.visibility =
                "visible";

        }

    }

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

                        clearTimeout(fullSwitchTimer);

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

				modalMediumLoaded =
					true;

				displayingFull =
					false;

				modalImgMedium.dataset.showingFull =
					"false";

				modalImgMedium.style.visibility =
					"visible";

				modalImgMedium.style.opacity =
					"1";

				modalImgMedium.style.zIndex =
					"3";

				if (modalImgSmall) {

					modalImgSmall.style.visibility =
						"hidden";

					modalImgSmall.style.opacity =
						"0";

				}

				showMediumImage();

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

				resumeThumbnailLoading();

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
            try {
                medium = await resolveImageAsset(sourceItem, "medium", () => isModalLoadActive(loadID));
            } catch {}
        }
        if (medium && isModalLoadActive(loadID)) {
            if (knownMediumItem)
                knownMediumItem.src = medium;
            modalMediumSrc = medium;
            let full = null;
            try {
                full = await resolveImageAsset(sourceItem, "full", () => isModalLoadActive(loadID));
            } catch {}
            modalFullSrc = full || medium;
            load(medium, "medium", loadID);
        } else if (fullSrc) {
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
    } else if (mediumSrc) {
        load(mediumSrc, "medium", loadID);
    } else if (fullSrc) {
        load(fullSrc, "full", loadID);
    } else {
        resumeThumbnailLoading();
    }

}

function closeModal(resumeGallery = true) {

	modalLoadID++;
    modalRetry = null;

	cancelImageLoads();

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
