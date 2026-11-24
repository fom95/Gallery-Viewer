/*
 * 11-full-image-loader.js
 *
 * Full-resolution image loading for the lightbox/zoom viewer, plus the
 * zoom/pan/auto-resolution-switch tuning constants.
 */

let fullImageLoading = false;

let fullImageLoaded = false;

let displayingFull = false;

let manualFullEnabled = false;

/*
 * Session preference for the modal's full-resolution toggle. It
 * survives opening/closing the modal and navigating between images in
 * the same album, but is cleared when the album or page changes.
 */
let modalForceFullResolution = false;


function resetModalFullResolutionPreference() {

    modalForceFullResolution = false;
    manualFullEnabled = false;

    updateModalFullButtonState();

}


function updateModalFullButtonState() {

    const button =
        document.getElementById("modalFullButton");

    if (!button)
        return;

    const label =
        document.getElementById("modalFullLabel");

    const fill =
        document.getElementById("modalFullFill");

    const spinner =
        document.getElementById("modalFullSpinner");

    /*
     * The button now contains the progress fill and label spans, so
     * textContent must never be written on the button itself.
     */
    if (label) {

        label.textContent = "HD";

        label.style.visibility =
            "visible";

    } else {

        button.textContent = "HD";

    }

    if (spinner)
        spinner.style.display = "none";

    if (fill)
        fill.style.width = "0%";

    button.dataset.state =
        "ready";

    button.title =
        modalForceFullResolution
            ? "Showing full resolution — click for medium"
            : "Show full resolution";
    button.setAttribute(
        "aria-pressed",
        modalForceFullResolution
            ? "true"
            : "false"
    );
    button.classList.toggle(
        "modal-full-active",
        modalForceFullResolution
    );

}


let fullImageProgress = 0;

let fullImageCached = false;

let fullImageFailed = false;

/*
 * The circle shows a spinner while the full image is still being
 * prepared, a percentage once a download has been running long enough
 * to be worth watching, and "HD" only once it is ready (or already in
 * the blob cache). Fast cached loads therefore never flash a number.
 */
const FULL_PROGRESS_REVEAL_MS = 500;

let fullImageProgressStartedAt = 0;

let fullProgressRevealTimer = null;

let fullProgressRevealed = false;


function beginFullImageProgress() {

    fullImageProgress = 0;
    fullProgressRevealed = false;
    fullImageProgressStartedAt =
        performance.now();

    if (fullProgressRevealTimer)
        clearTimeout(fullProgressRevealTimer);

    fullProgressRevealTimer =
        setTimeout(() => {

            fullProgressRevealTimer =
                null;

            updateModalFullButtonVisibility();

        }, FULL_PROGRESS_REVEAL_MS);

}


function updateModalFullProgress(percent) {

    const value =
        Number(percent);

    const clamped =
        Number.isFinite(value)
            ? Math.max(0, Math.min(100, value))
            : 0;

    /*
     * Progress must never run backwards. A fallback candidate or a
     * range restart used to reset the readout mid-download, which
     * looked like the download finishing, dropping to ~50%, then
     * finishing again.
     */
    fullImageProgress =
        Math.max(
            fullImageProgress,
            clamped
        );

    if (fullImageLoaded)
        return;

    updateModalFullButtonVisibility();

}


function updateModalFullButtonVisibility() {

    const button =
        document.getElementById("modalFullButton");

    if (!button)
        return;

    const label =
        document.getElementById("modalFullLabel");

    const fill =
        document.getElementById("modalFullFill");

    const spinner =
        document.getElementById("modalFullSpinner");

    const hasDistinctFull =
        !!modalFullSrc &&
        modalFullSrc !== modalMediumSrc;

    /*
     * The control's presence tracks whether a distinct full size
     * exists, not whether it has finished loading. That keeps it from
     * disappearing and reappearing while arrowing between images.
     */
    if (
        !hasDistinctFull ||
        fullImageFailed
    ) {

        button.style.display =
            "none";

        button.disabled =
            true;

        button.dataset.loading =
            "false";

        button.dataset.state =
            "hidden";

        return;

    }

    button.style.display =
        "block";

    if (fullImageLoaded) {

        button.disabled =
            false;

        button.dataset.loading =
            "false";

        updateModalFullButtonState();

        return;

    }

    /*
     * The full bytes are already in the shared blob cache (a reopen or
     * an arrow switch between images seen in this session). Go
     * straight to a clickable HD instead of flashing a spinner; if the
     * click arrives before the decode finishes, it is applied as soon
     * as the load event fires.
     */
    if (fullImageCached) {

        button.disabled =
            false;

        button.dataset.loading =
            "false";

        updateModalFullButtonState();

        return;

    }

    button.disabled =
        true;

    button.dataset.loading =
        "false";

    button.classList.remove(
        "modal-full-active");

    button.setAttribute(
        "aria-pressed",
        "false"
    );

    /*
     * Only reveal a number when the download has been running long
     * enough to be worth watching and has not almost finished. Faster
     * loads (including HTTP-cached bytes on a fresh page) stay on the
     * spinner and then go straight to HD.
     */
    if (
        fullImageProgress > 0 &&
        fullImageProgress < 95 &&
        performance.now() -
            fullImageProgressStartedAt >=
            FULL_PROGRESS_REVEAL_MS
    ) {
        fullProgressRevealed = true;
    }

    if (fullProgressRevealed) {

        const percent =
            Math.min(
                99,
                Math.round(fullImageProgress || 0)
            );

        button.dataset.loading =
            "true";

        button.dataset.state =
            "progress";

        if (label) {

            label.textContent =
                percent + "%";

            label.style.visibility =
                "visible";

        }

        if (spinner)
            spinner.style.display = "none";

        if (fill)
            fill.style.width = percent + "%";

        button.title =
            "Loading full resolution — " +
            percent +
            "%";

        return;

    }

    /*
     * Otherwise the circle is a small spinner. HD only appears once
     * the full image is actually loaded and clickable.
     */
    button.dataset.state =
        "spinner";

    if (label)
        label.style.visibility =
            "hidden";

    if (spinner)
        spinner.style.display = "block";

    if (fill)
        fill.style.width = "0%";

    button.title =
        "Preparing full resolution";

}


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


const MODAL_REVEAL_MS = 420;

/*
 * If a resolution becomes ready to show within this many ms of
 * openModal() being called, it's treated as "already available" (the
 * grid's medium image was already loaded, or resolveImageAsset()
 * returned an already-cached blob instantly) rather than "just
 * finished loading" -- so no grow/blur animation plays for it.
 */
const MODAL_INSTANT_THRESHOLD_MS = 100;

/*
 * Set at the top of every openModal() call (see 12-modal-viewer.js).
 * Every reveal measures its own elapsed time against this to decide
 * whether a real load just happened.
 */
let modalOpenStartedAt = 0;

/*
 * A snapshot of whatever the modal was previously showing, created by
 * openModal() when navigating to a different image while the modal is
 * already open. It fades away once the new image is ready to reveal
 * (see revealModalResolution()) instead of the previous image just
 * vanishing outright.
 */
let modalOutgoingClone = null;


function fadeOutOutgoingClone() {

    const clone =
        modalOutgoingClone;

    if (!clone)
        return;

    modalOutgoingClone =
        null;

    requestAnimationFrame(() => {

        clone.style.opacity = "0";

    });

    setTimeout(() => {

        clone.remove();

    }, 320);

}


/*
 * Grows an about-to-be-revealed modal image from the thumbnail's
 * current on-screen size up to its real display size while it
 * un-blurs, rather than just popping in at full size. The thumbnail
 * itself blurs out and fades at the same time.
 *
 * "reveal-instant" (see styles.css) briefly kills the transition so
 * the starting (small, blurred) state is applied immediately rather
 * than itself animating in from whatever the element's previous size/
 * filter was; "modal-reveal-transition" is then the one that actually
 * animates the grow.
 */
function revealModalImageGrow(imgEl, finalWidth, finalHeight) {

    if (!imgEl)
        return;

    const startWidth =
        (modalImgSmall && modalImgSmall.style.width) ||
        finalWidth + "px";

    const startHeight =
        (modalImgSmall && modalImgSmall.style.height) ||
        finalHeight + "px";

    imgEl.classList.add("reveal-instant");

    imgEl.style.width = startWidth;
    imgEl.style.height = startHeight;
    imgEl.style.filter = "blur(20px)";
    imgEl.style.visibility = "visible";

    void imgEl.offsetWidth;

    imgEl.classList.remove("reveal-instant");
    imgEl.classList.add("modal-reveal-transition");

    if (modalImgSmall) {

        modalImgSmall.classList.add("modal-reveal-transition");
        modalImgSmall.style.filter = "blur(20px)";
        modalImgSmall.style.opacity = "0";

    }

    requestAnimationFrame(() => {

        imgEl.style.width = finalWidth + "px";
        imgEl.style.height = finalHeight + "px";
        imgEl.style.filter = "blur(0px)";

    });

    setTimeout(() => {

        imgEl.classList.remove("modal-reveal-transition");

        if (modalImgSmall) {

            modalImgSmall.classList.remove("modal-reveal-transition");
            modalImgSmall.style.visibility = "hidden";

        }

    }, MODAL_REVEAL_MS);

}


/*
 * Streamed full-image responses from the media Worker use chunked
 * transfer encoding and therefore have no Content-Length. A tiny HEAD
 * request gives the real size so the progress bar and the 10% partial
 * threshold are accurate instead of using a fake progress estimate.
 */
const knownImageContentLengths =
    new Map();

async function getImageContentLength(url, signal) {

    if (!url)
        return 0;

    const cached =
        knownImageContentLengths.get(url);

    if (cached)
        return cached;

    try {

        const response =
            await fetch(
                url,
                {
                    method: "HEAD",
                    signal
                }
            );

        if (!response.ok)
            return 0;

        const length =
            Number(
                response.headers.get(
                    "Content-Length"
                )
            ) || 0;

        if (length > 0) {

            knownImageContentLengths.set(
                url,
                length
            );

            while (
                knownImageContentLengths.size >
                100
            ) {

                const oldest =
                    knownImageContentLengths
                        .keys()
                        .next()
                        .value;

                knownImageContentLengths.delete(
                    oldest
                );

            }

        }

        return length;

    } catch {

        return 0;

    }

}


function modalImageInteractionReady() {

    const img =
        displayingFull
            ? modalImgFull
            : modalImgMedium;

    return !!(
        img &&
        img.naturalWidth > 0 &&
        img.style.visibility !== "hidden"
    );

}


/*
 * Single entry point for revealing a modal image once its medium/full
 * resolution is ready. Decides, based on how long this openModal()
 * call has actually been running, whether this is a genuine load
 * (grow in from the thumbnail, blurred) or something that was already
 * available (show it directly, no animation) -- and either way, fades
 * out any outgoing snapshot of the previously-displayed image.
 */
function revealModalResolution(imgEl, finalWidth, finalHeight) {

    if (!imgEl)
        return;

    if (typeof clearModalPlaceholderState === "function")
        clearModalPlaceholderState();

    const elapsed =
        performance.now() - modalOpenStartedAt;

    const wasInstant =
        elapsed < MODAL_INSTANT_THRESHOLD_MS;

    if (finalWidth == null || wasInstant) {

        if (finalWidth != null) {

            imgEl.style.width = finalWidth + "px";
            imgEl.style.height = finalHeight + "px";

        }

        imgEl.style.filter = "none";
        imgEl.style.visibility = "visible";

        if (modalImgSmall) {

            modalImgSmall.style.visibility = "hidden";
            modalImgSmall.style.opacity = "0";

        }

    } else {

        revealModalImageGrow(imgEl, finalWidth, finalHeight);

    }

    fadeOutOutgoingClone();

}


async function load(url, name, loadID) {

	if (!url)
		return;

	if (name === "full") {

		if (fullImageLoading)
			return;

		fullImageLoading =
			true;

		beginFullImageProgress();

		fullImageFailed =
			false;

		updateModalFullButtonVisibility();

	}

	const loadingBar =
		document.getElementById(
			"modalLoadingBar");

	const loadingProgress =
		document.getElementById(
			"modalLoadingProgress");

	/*
	 * Once the medium is already on screen, the full resolution is a
	 * silent background upgrade: it must not bring the download bar
	 * back over an image the user can already see.
	 */
	const trackProgress =
		name === "medium"
			? !modalMediumLoaded
			: name === "full"
				? !modalMediumLoaded
				: true;

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

	/*
	 * Do not flash the progress bar for a response that is already
	 * cached (or simply arrives faster than a blink). Wait briefly,
	 * and only reveal it if the download is still running.
	 */
	let loadingBarShowTimer =
		null;

	let downloadFinished =
		false;

	const cancelLoadingBarShow = () => {

		if (!loadingBarShowTimer)
			return;

		clearTimeout(loadingBarShowTimer);

		loadingBarShowTimer =
			null;

	};

	const removeLoader = () => {

		const index =
			activeImageLoaders.indexOf(controller);

		if (index !== -1) {

			activeImageLoaders.splice(
				index,
				1);

		}

	};

	let resumeChunks =
		[];

	let resumeReceived =
		0;

	let resumeTotal =
		0;

	let resumeContentType =
		"image/jpeg";

	let resumeEtag =
		"";

	let resumeLastModified =
		"";

	try {

		let blobURL =
			typeof getCachedImageBlobURL === "function"
				? getCachedImageBlobURL(url)
				: null;

		let blobIsShared =
			!!blobURL;

		if (blobURL) {

			if (typeof forgetPartialImageDownload === "function")
				forgetPartialImageDownload(url);

			/*
			 * Another surface (the image editor preview, or an
			 * earlier modal open) already downloaded these bytes.
			 * Skip the request and reuse the blob directly.
			 */
			downloadFinished =
				true;

			if (name === "full")
				fullImageCached =
					true;

			cancelLoadingBarShow();

			if (
				isModalLoadActive(loadID) &&
				loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

		} else {

			const partial =
				name === "full" &&
				typeof getPartialImageDownload === "function"
					? getPartialImageDownload(url)
					: null;

			if (partial) {

				resumeChunks =
					partial.chunks || [];

				resumeReceived =
					partial.bytes || 0;

				resumeTotal =
					partial.total || 0;

				resumeContentType =
					partial.contentType ||
					resumeContentType;

				resumeEtag =
					partial.etag || "";

				resumeLastModified =
					partial.lastModified || "";

			}

			let response;

			const rangeUrl =
				resumeReceived > 0
					? url +
						(
							url.includes("?")
								? "&"
								: "?"
						) +
						"_partial_range=1"
					: url;

			try {

				response =
					await fetch(
						rangeUrl, {
						signal:
							controller.signal,
						headers:
							resumeReceived > 0
								? {
									Range:
										`bytes=${resumeReceived}-`,
									...(resumeEtag ||
										resumeLastModified
										? {
											"If-Range":
												resumeEtag ||
												resumeLastModified
										}
										: {})
								}
								: undefined
					});

			} catch (error) {

				/*
				 * Some browsers/proxies reject a Range header (for
				 * example a failed CORS preflight). Fall back to a
				 * normal full request so the image still loads.
				 */
				if (
					resumeReceived <= 0 ||
					error?.name === "AbortError"
				) {
					throw error;
				}

				if (typeof forgetPartialImageDownload === "function")
					forgetPartialImageDownload(url);

				resumeChunks = [];
				resumeReceived = 0;
				resumeTotal = 0;

				response =
					await fetch(
						url, {
						signal:
							controller.signal
					});

			}

			if (
				resumeReceived > 0 &&
				response.status === 416
			) {

				/*
				 * The server no longer has this range (or the
				 * partial is stale). Drop it and request the whole
				 * file again.
				 */
				if (typeof forgetPartialImageDownload === "function")
					forgetPartialImageDownload(url);

				resumeChunks = [];
				resumeReceived = 0;
				resumeTotal = 0;

				response =
					await fetch(
						url, {
						signal:
							controller.signal
					});

			}

			if (
				resumeReceived > 0 &&
				response.status === 206
			) {

				const contentRange =
					response.headers.get(
						"Content-Range"
					) || "";

				const match =
					/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(
						contentRange
					);

				/*
				 * Browsers do not expose Content-Range to CORS
				 * scripts unless the server lists it in
				 * Access-Control-Expose-Headers. Firefox hides it,
				 * Chromium may not. A 206 still means the range was
				 * accepted, so only enforce the start when the header
				 * is actually readable.
				 */
				if (
					match &&
					Number(match[1]) !==
						resumeReceived
				) {

					if (typeof forgetPartialImageDownload === "function")
						forgetPartialImageDownload(url);

					try {
						response.body?.cancel?.();
					} catch {}

					resumeChunks = [];
					resumeReceived = 0;
					resumeTotal = 0;

					response =
						await fetch(
							url, {
							signal:
								controller.signal
						});

				} else if (
					match &&
					match[3] !== "*" &&
					Number(match[3]) > 0
				) {

					resumeTotal =
						Number(match[3]);

				} else if (!resumeTotal) {

					const remaining =
						Number(
							response.headers.get(
								"Content-Length"
							)
						) || 0;

					if (remaining > 0) {

						resumeTotal =
							resumeReceived +
							remaining;

					}

				}

			} else if (
				resumeReceived > 0 &&
				response.status === 200
			) {

				/*
				 * Range was ignored (or If-Range failed): this is a
				 * fresh full response, so throw away the partial.
				 */
				if (typeof forgetPartialImageDownload === "function")
					forgetPartialImageDownload(url);

				resumeChunks = [];
				resumeReceived = 0;
				resumeTotal = 0;

			}

			if (
				!response.ok &&
				response.status !== 206
			) {

				throw new Error(
					`HTTP ${response.status} ${response.statusText}`);

			}

			if (!resumeTotal) {

				const contentLength =
					Number(
						response.headers.get(
							"Content-Length"
						)
					) || 0;

				resumeTotal =
					contentLength +
					(
						response.status === 206
							? resumeReceived
							: 0
					);

			}

			if (
				!resumeTotal &&
				name === "full"
			) {

				void getImageContentLength(
					url,
					controller.signal
				).then(size => {

					if (
						!size ||
						resumeTotal ||
						downloadFinished ||
						!isModalLoadActive(loadID)
					) {
						return;
					}

					resumeTotal =
						size;

					const percent =
						Math.min(
							100,
							resumeReceived /
								resumeTotal * 100
						);

					if (
						trackProgress &&
						loadingProgress
					) {

						loadingProgress.style.width =
							`${percent}%`;

					}

					if (name === "full")
						updateModalFullProgress(
							percent
						);

				});

			}

			resumeContentType =
				response.headers.get(
					"Content-Type"
				) ||
				resumeContentType;

			resumeEtag =
				response.headers.get("ETag") ||
				resumeEtag;

			resumeLastModified =
				response.headers.get(
					"Last-Modified"
				) ||
				resumeLastModified;

			const reader =
				response.body.getReader();

			let chunkCount =
				0;

			if (
				resumeReceived > 0 &&
				resumeTotal > 0 &&
				isModalLoadActive(loadID)
			) {

				const percent =
					Math.min(
						100,
						resumeReceived /
							resumeTotal * 100
					);

				if (trackProgress) {

					showLoadingBar(false);

					if (loadingProgress) {

						loadingProgress.style.width =
							`${percent}%`;

					}

				}

				if (name === "full")
					updateModalFullProgress(
						percent
					);

			}

			while (true) {

				const {
					done,
					value
				} =
					await reader.read();

				if (done)
					break;

				chunkCount++;

				resumeChunks.push(value);

				resumeReceived +=
					value.length;

				if (
					trackProgress &&
					chunkCount === 1 &&
					isModalLoadActive(loadID) &&
					loadingBar) {

					const downloadComplete =
						resumeTotal &&
						resumeReceived >=
							resumeTotal;

					if (
						!downloadComplete &&
						!loadingBarShowTimer
					) {

						loadingBarShowTimer =
							setTimeout(
								() => {

									loadingBarShowTimer =
										null;

									if (
										downloadFinished ||
										!isModalLoadActive(loadID)
									) {
										return;
									}

									showLoadingBar(false);

								},
								300
							);

					}

				}

				if (isModalLoadActive(loadID)) {

					const percent =
						resumeTotal
							? Math.min(
								100,
								(
									resumeReceived /
									resumeTotal
								) * 100
							)
							: Math.min(
								90,
								10 +
								(
									(
										resumeReceived /
										(
											resumeReceived +
											1024 * 1024
										)
									) * 80
								)
							);

					if (
						trackProgress &&
						loadingProgress
					) {

						loadingProgress.style.width =
							`${percent}%`;

					}

					if (name === "full")
						updateModalFullProgress(
							percent
						);

				}

			}

			downloadFinished =
				true;

			cancelLoadingBarShow();

			if (
				trackProgress &&
				isModalLoadActive(loadID) &&
				loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

			if (
				name === "full" &&
				isModalLoadActive(loadID)
			) {
				updateModalFullProgress(100);
			}

			if (typeof forgetPartialImageDownload === "function")
				forgetPartialImageDownload(url);

			const blob =
				new Blob(
					resumeChunks, {
					type:
						resumeContentType ||
						"image/jpeg"
				});

			blobURL =
				typeof rememberImageBlob === "function"
					? rememberImageBlob(url, blob)
					: null;

			if (blobURL) {

				blobIsShared =
					true;

			} else {

				blobURL =
					URL.createObjectURL(blob);

			}

		}

		if (!isModalLoadActive(loadID)) {

			if (!blobIsShared)
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

			if (!blobIsShared)
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

			modalImgMedium.style.zIndex =
				"3";

			modalImgMedium.src =
				blobURL;

			let finalWidth =
				null;

			let finalHeight =
				null;

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

				finalWidth =
					iW * scale;

				finalHeight =
					iH * scale;

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

			modalImgMedium.style.opacity =
				"1";

			modalImgMedium.style.zIndex =
				"3";

			/*
			 * revealModalResolution() decides whether this counts as
			 * "just finished a real load" (grow in from the
			 * thumbnail, blurred) or "was already available" (show it
			 * directly) based on how long this openModal() call has
			 * actually taken so far.
			 */
			revealModalResolution(
				modalImgMedium,
				finalWidth,
				finalHeight
			);

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

				fullImageFailed =
					true;

				hideLoadingBar();

				return;

			}

			modalImgFull.src =
				blobURL;

			modalImgFull.style.opacity =
				"1";

			fullImageLoaded =
				true;

			modalFullLoaded =
				true;

			fullImageLoading =
				false;

			fullImageFailed =
				false;

			updateModalFullButtonVisibility();

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

				/*
				 * No medium stage for this image -- it goes straight
				 * from the thumbnail to full resolution, so it gets
				 * the same grow-and-unblur treatment the medium stage
				 * normally would.
				 */
				imgResize(modalImgFull);

				const finalWidth =
					parseFloat(modalImgFull.style.width) || null;

				const finalHeight =
					parseFloat(modalImgFull.style.height) || null;

				modalImgFull.style.left =
					"50%";

				modalImgFull.style.top =
					"50%";

				modalImgFull.style.zIndex =
					"3";

				displayingFull =
					true;

				modalImgFull.dataset.showingFull =
					"true";

				revealModalResolution(
					modalImgFull,
					finalWidth,
					finalHeight
				);

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

			modalImgFull.style.filter =
				"none";

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

		downloadFinished =
			true;

		cancelLoadingBarShow();

		if (
			name === "full" &&
			resumeReceived > 0 &&
			typeof savePartialImageDownload === "function"
		) {

			savePartialImageDownload(
				url,
				{
					chunks:
						resumeChunks,
					bytes:
						resumeReceived,
					total:
						resumeTotal,
					contentType:
						resumeContentType,
					etag:
						resumeEtag,
					lastModified:
						resumeLastModified
				}
			);

		}

        if (
            error?.name !== "AbortError" &&
            isModalLoadActive(loadID)
        ) {
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

			/*
			 * Aborts normally mean this image was replaced or the
			 * modal closed. Never let that old load clear the
			 * loading flag the new image now owns.
			 */
			if (!isModalLoadActive(loadID))
				return;

			if (name === "full") {

				fullImageLoading =
					false;

				fullImageFailed =
					true;

				updateModalFullButtonVisibility();

			}

			if (name === "medium") {

				modalMediumLoading =
					false;

			}

			return;

		}

		if (!isModalLoadActive(loadID))
			return;

		if (name === "full") {

			fullImageLoading =
				false;

			fullImageLoaded =
				false;

			modalFullLoaded =
				false;

			fullImageProgress =
				0;

			fullImageCached =
				false;

			fullImageFailed =
				true;

			updateModalFullButtonVisibility();

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
