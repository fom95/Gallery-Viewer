/*
 * 09-full-image-loader.js
 *
 * Full-resolution image loading for the lightbox/zoom viewer, plus the
 * zoom/pan/auto-resolution-switch tuning constants.
 */

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

const autoResolutionSwitchDelay = 400;

const autoResolutionSwitchRatio = 0.10;


const resolutionSwitchOnZoom = true;

const resolutionSwitchOnPan = false;

const resolutionSwitchDelay = 100;

const resolutionSwitchRatio = 0.10;


let centerAnimationFrame = null;


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

	if (name === "full") {

		if (fullImageLoading)
			return;

		fullImageLoading =
			true;

	}

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

	const controller =
		new AbortController();

	activeImageLoaders.push(controller);

	const removeLoader = () => {

		const index =
			activeImageLoaders.indexOf(controller);

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

		while (true) {

			const {
				done,
				value
			} =
				await reader.read();

			if (done)
				break;

			chunkCount++;

			chunks.push(value);

			received +=
				value.length;

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

		if (
			isModalLoadActive(loadID) &&
			loadingProgress) {

			loadingProgress.style.width =
				"100%";

		}

		const blob =
			new Blob(
				chunks, {
				type:
					response.headers.get(
						"Content-Type") ||
					"image/jpeg"
			});

		const blobURL =
			URL.createObjectURL(blob);

		if (!isModalLoadActive(loadID)) {

			URL.revokeObjectURL(blobURL);

			if (name === "full") {

				fullImageLoading =
					false;

			}

			return;

		}

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

		if (!isModalLoadActive(loadID)) {

			URL.revokeObjectURL(blobURL);

			if (name === "full") {

				fullImageLoading =
					false;

			}

			return;

		}

		if (name === "thumb") {

			if (modalImgSmall) {

				modalImgSmall.src =
					blobURL;

				resizeThumb(modalImgSmall);

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

		if (name === "medium") {

            if (modalRetry && modalRetry.loadID === loadID && modalRetry.name === name)
                modalRetry = null;

			if (!modalImgMedium) {

				modalMediumLoading =
					false;

				return;

			}

			const registeredMedium =
				markMediumItemLoaded(url,
					decodedImage,
					blobURL);

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

			if (loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

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

		if (name === "full") {

            if (modalRetry && modalRetry.loadID === loadID && modalRetry.name === name)
                modalRetry = null;

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

				clearTimeout(loadingTimer);

				loadingTimer =
					null;

			}

			if (modalLoading) {

				modalLoading.classList.remove(
					"active");

				modalLoading.style.opacity =
					"0";

			}

			if (!modalMediumSrc) {

				imgResize(modalImgFull);

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

						clearTimeout(fullSwitchTimer);

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

        if (error?.name !== "AbortError") {
            noteImageFailure();
            console.debug(`[MODAL ${name.toUpperCase()}] Load failed; deferred for retry`, {
                url,
                errorName: error?.name,
                errorMessage: error?.message
            });
            modalRetry = {
                url,
                name,
                loadID
            };
        }

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

		if (name === "medium") {

			modalMediumLoaded =
				false;

			modalMediumLoading =
				false;

			if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

			return;

		}

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
