/**
 * Modal/Full Image Loader Module
 * Handles modal display, full image loading, resolution switching, and image manipulation
 */

const ModalLoader = (() => {
    let modalLoadID = 0;
    let activeImageLoaders = [];
    let modalRetry = null;
    let loadingTimer = null;

    // Image state
    let modalMediumLoaded = false;
    let modalMediumLoading = false;
    let modalMediumImage = null;
    let modalFullLoaded = false;
    let manualFullEnabled = false;
    let displayingFull = false;

    let fullImageLoading = false;
    let fullImageLoaded = false;

    // Modal resolution sources
    let modalMediumSrc = null;
    let modalFullSrc = null;

    // DOM elements
    let modalImgSmall = null;
    let modalImgMedium = null;
    let modalImgFull = null;
    let modalLoading = null;

    // Image transform state
    let imgTransform = {
        x: 0,
        y: 0,
        scale: 1
    };

    let imgDragging = false;
    let imgMoved = false;
    let dragStart = {};

    // Zoom constants
    const minZoom = 1;
    const maxZoom = 5;
    const zoomStep = 0.25;

    const autoResolutionSwitch = true;
    const autoResolutionSwitchDelay = 400;
    const autoResolutionSwitchRatio = 0.10;

    const resolutionSwitchOnZoom = true;
    const resolutionSwitchDelay = 100;
    const resolutionSwitchRatio = 0.10;

    let fullSwitchTimer = null;
    let zoomEndTimer = null;
    let centerReturnTimer = null;
    let centerReturnAnimation = null;

    const fullSwitchZoom = minZoom + (maxZoom - minZoom) * autoResolutionSwitchRatio;
    const resolutionSwitchZoom = minZoom + (maxZoom - minZoom) * resolutionSwitchRatio;

    /**
     * Check if modal load is still active
     */
    function isModalLoadActive(id) {
        return id === modalLoadID;
    }

    /**
     * Get next modal load ID
     */
    function getNextModalLoadID() {
        return ++modalLoadID;
    }

    /**
     * Cancel all active image loads
     */
    function cancelImageLoads() {
        if (!activeImageLoaders) return;

        for (const controller of activeImageLoaders) {
            try {
                controller.abort();
            } catch { }
        }

        activeImageLoaders.length = 0;
    }

    /**
     * Load image from URL with progress tracking
     */
    async function load(url, name, loadID) {
        if (!url) return;

        if (name === "full") {
            if (fullImageLoading) return;
            fullImageLoading = true;
        }

        const loadingBar = document.getElementById("modalLoadingBar");
        const loadingProgress = document.getElementById("modalLoadingProgress");

        const showLoadingBar = (resetProgress = true) => {
            if (loadingBar) {
                loadingBar.style.opacity = "1";
            }
            if (resetProgress && loadingProgress) {
                loadingProgress.style.width = "0%";
            }
        };

        const hideLoadingBar = () => {
            if (loadingBar) {
                loadingBar.style.opacity = "0";
            }
        };

        if (name === "medium" || name === "full") {
            if (loadingBar) {
                loadingBar.style.opacity = "0";
            }
            if (loadingProgress) {
                loadingProgress.style.width = "0%";
            }
        }

        const controller = new AbortController();
        activeImageLoaders.push(controller);

        const removeLoader = () => {
            const index = activeImageLoaders.indexOf(controller);
            if (index !== -1) {
                activeImageLoaders.splice(index, 1);
            }
        };

        try {
            const response = await fetch(url, {
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const total = Number(response.headers.get("Content-Length")) || 0;
            const reader = response.body.getReader();
            const chunks = [];
            let received = 0;
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                chunkCount++;
                chunks.push(value);
                received += value.length;

                if (chunkCount === 1 && isModalLoadActive(loadID) && loadingBar) {
                    const downloadComplete = total && received >= total;
                    if (!downloadComplete) {
                        showLoadingBar();
                    }
                }

                if (isModalLoadActive(loadID) && loadingProgress) {
                    if (total) {
                        const percent = Math.min(100, (received / total) * 100);
                        loadingProgress.style.width = `${percent}%`;
                    } else {
                        const pseudoPercent = 10 + ((received / (received + 1024 * 1024)) * 80);
                        loadingProgress.style.width = `${Math.min(90, pseudoPercent)}%`;
                    }
                }
            }

            if (isModalLoadActive(loadID) && loadingProgress) {
                loadingProgress.style.width = "100%";
            }

            const blob = new Blob(chunks, {
                type: response.headers.get("Content-Type") || "image/jpeg"
            });

            const blobURL = URL.createObjectURL(blob);

            if (!isModalLoadActive(loadID)) {
                URL.revokeObjectURL(blobURL);
                if (name === "full") {
                    fullImageLoading = false;
                }
                return;
            }

            const decodedImage = new Image();
            decodedImage.src = blobURL;

            await new Promise((resolve, reject) => {
                decodedImage.onload = resolve;
                decodedImage.onerror = reject;
            });

            if (decodedImage.decode) {
                try {
                    await decodedImage.decode();
                } catch { }
            }

            if (!isModalLoadActive(loadID)) {
                URL.revokeObjectURL(blobURL);
                if (name === "full") {
                    fullImageLoading = false;
                }
                return;
            }

            processLoadedImage(name, blobURL, decodedImage, loadID, url);

        } catch (error) {
            handleLoadError(error, name, loadID, url);
        } finally {
            removeLoader();
        }
    }

    /**
     * Process successfully loaded image
     */
    function processLoadedImage(name, blobURL, decodedImage, loadID, url) {
        if (name === "thumb") {
            if (modalImgSmall) {
                modalImgSmall.src = blobURL;
                resizeThumb(modalImgSmall);
                modalImgSmall.style.visibility = "visible";
                modalImgSmall.style.zIndex = "4";
            }

            if (modalMediumSrc) {
                load(modalMediumSrc, "medium", loadID);
            } else if (modalFullSrc) {
                load(modalFullSrc, "full", loadID);
            }
            return;
        }

        if (name === "medium") {
            if (modalRetry && modalRetry.loadID === loadID && modalRetry.name === name)
                modalRetry = null;

            if (!modalImgMedium) {
                modalMediumLoading = false;
                return;
            }

            const loadingProgress = document.getElementById("modalLoadingProgress");
            const loadingBar = document.getElementById("modalLoadingBar");

            modalImgMedium.style.visibility = "hidden";
            modalImgMedium.style.opacity = "1";
            modalImgMedium.style.zIndex = "3";
            modalImgMedium.src = blobURL;

            if (decodedImage?.naturalWidth && decodedImage?.naturalHeight) {
                const wW = window.innerWidth;
                const wH = window.innerHeight;
                const iW = decodedImage.naturalWidth;
                const iH = decodedImage.naturalHeight;
                const scale = Math.min(wW / iW, wH / iH);

                modalImgMedium.style.width = `${iW * scale}px`;
                modalImgMedium.style.height = `${iH * scale}px`;
            }

            modalMediumLoaded = true;
            modalMediumLoading = false;
            modalMediumImage = decodedImage;
            displayingFull = false;
            modalImgMedium.dataset.showingFull = "false";

            modalImgMedium.style.visibility = "visible";
            modalImgMedium.style.opacity = "1";
            modalImgMedium.style.filter = "none";
            modalImgMedium.style.zIndex = "3";

            if (modalImgSmall) {
                modalImgSmall.style.visibility = "hidden";
                modalImgSmall.style.opacity = "0";
            }

            if (modalImgFull) {
                modalImgFull.style.visibility = "hidden";
                modalImgFull.style.zIndex = "2";
            }

            applyTransform();

            if (loadingProgress) {
                loadingProgress.style.width = "100%";
            }

            if (modalFullSrc) {
                load(modalFullSrc, "full", loadID);
            } else {
                setTimeout(() => {
                    if (isModalLoadActive(loadID) && !fullImageLoading) {
                        if (loadingBar) loadingBar.style.opacity = "0";
                    }
                }, 250);
            }
            return;
        }

        if (name === "full") {
            if (modalRetry && modalRetry.loadID === loadID && modalRetry.name === name)
                modalRetry = null;

            if (!modalImgFull) {
                fullImageLoading = false;
                const loadingBar = document.getElementById("modalLoadingBar");
                if (loadingBar) loadingBar.style.opacity = "0";
                return;
            }

            const loadingProgress = document.getElementById("modalLoadingProgress");
            const loadingBar = document.getElementById("modalLoadingBar");

            modalImgFull.src = blobURL;
            modalImgFull.style.visibility = "hidden";
            modalImgFull.style.opacity = "1";
            modalImgFull.style.filter = "none";

            fullImageLoaded = true;
            modalFullLoaded = true;
            fullImageLoading = false;

            if (loadingProgress) {
                loadingProgress.style.width = "100%";
            }

            setTimeout(() => {
                if (isModalLoadActive(loadID) && !fullImageLoading) {
                    if (loadingBar) loadingBar.style.opacity = "0";
                }
            }, 300);

            if (loadingTimer) {
                clearTimeout(loadingTimer);
                loadingTimer = null;
            }

            if (modalLoading) {
                modalLoading.classList.remove("active");
                modalLoading.style.opacity = "0";
            }

            if (!modalMediumSrc) {
                imgResize(modalImgFull);
                modalImgFull.style.left = "50%";
                modalImgFull.style.top = "50%";
                modalImgFull.style.visibility = "visible";
                modalImgFull.style.zIndex = "3";

                displayingFull = true;
                modalImgFull.dataset.showingFull = "true";

                if (modalImgSmall) {
                    modalImgSmall.style.visibility = "hidden";
                    modalImgSmall.style.opacity = "0";
                }

                applyTransform();
                return;
            }

            if (modalImgMedium) {
                modalImgFull.style.width = modalImgMedium.style.width;
                modalImgFull.style.height = modalImgMedium.style.height;
            }

            modalImgFull.style.left = "50%";
            modalImgFull.style.top = "50%";
            modalImgFull.style.visibility = "hidden";

            applyTransform();

            if (!displayingFull && !imgDragging && !manualFullEnabled) {
                const wantsFull = autoResolutionSwitch && imgTransform.scale >= fullSwitchZoom;

                if (wantsFull) {
                    if (fullSwitchTimer) {
                        clearTimeout(fullSwitchTimer);
                        fullSwitchTimer = null;
                    }

                    fullSwitchTimer = setTimeout(() => {
                        fullSwitchTimer = null;

                        if (manualFullEnabled || displayingFull) {
                            return;
                        }

                        const stillWantsFull = autoResolutionSwitch && imgTransform.scale >= fullSwitchZoom;
                        if (stillWantsFull) {
                            switchToFull();
                        }
                    }, resolutionSwitchOnZoom ? resolutionSwitchDelay : autoResolutionSwitchDelay);
                }
            }
        }
    }

    /**
     * Handle image load errors
     */
    function handleLoadError(error, name, loadID, url) {
        if (error?.name !== "AbortError") {
            if (typeof window.noteImageFailure === 'function') {
                window.noteImageFailure();
            }
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

        if (error.name === "AbortError") {
            if (name === "full") {
                fullImageLoading = false;
            }
            if (name === "medium") {
                modalMediumLoading = false;
            }
            return;
        }

        if (!isModalLoadActive(loadID)) {
            if (name === "full") {
                fullImageLoading = false;
            }
            if (name === "medium") {
                modalMediumLoading = false;
            }
            return;
        }

        const loadingBar = document.getElementById("modalLoadingBar");
        const loadingProgress = document.getElementById("modalLoadingProgress");

        if (name === "full") {
            fullImageLoading = false;
            fullImageLoaded = false;
            modalFullLoaded = false;
        }

        if (loadingBar) loadingBar.style.opacity = "0";
        if (loadingProgress) loadingProgress.style.width = "0%";

        if (modalLoading) {
            modalLoading.classList.remove("active");
            modalLoading.style.opacity = "0";
        }

        if (name === "medium") {
            modalMediumLoaded = false;
            modalMediumLoading = false;

            if (modalFullSrc) {
                load(modalFullSrc, "full", loadID);
            }
            return;
        }

        if (name === "full") {
            if (modalMediumSrc && modalMediumLoaded) {
                displayingFull = false;
                showMediumImage();
            }
        }
    }

    /**
     * Apply transform to images
     */
    function applyTransform() {
        const transform =
            `translate(-50%, -50%) ` +
            `translate(${imgTransform.x}px, ${imgTransform.y}px) ` +
            `scale(${imgTransform.scale})`;

        if (modalImgMedium) {
            modalImgMedium.style.transform = transform;
        }

        if (modalImgFull) {
            modalImgFull.style.transform = transform;
        }
    }

    /**
     * Resize thumbnail for modal
     */
    function resizeThumb(elem) {
        if (!elem || !elem.naturalWidth || !elem.naturalHeight) return;

        const maxSize = Math.min(window.innerWidth, window.innerHeight) / 1.5;
        const scale = maxSize / Math.max(elem.naturalWidth, elem.naturalHeight);

        elem.style.width = `${elem.naturalWidth * scale}px`;
        elem.style.height = `${elem.naturalHeight * scale}px`;
    }

    /**
     * Resize image to fit viewport
     */
    function imgResize(elem) {
        const wH = window.innerHeight;
        const wW = window.innerWidth;
        const iH = elem.naturalHeight;
        const iW = elem.naturalWidth;

        const scale = Math.min(wW / iW, wH / iH);

        elem.style.width = `${iW * scale}px`;
        elem.style.height = `${iH * scale}px`;
    }

    /**
     * Get image bounds for panning
     */
    function getBounds(img) {
        if (!img) {
            return { x: 0, y: 0 };
        }

        const rect = img.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const halfViewportWidth = viewportWidth / 2;
        const halfViewportHeight = viewportHeight / 2;

        const edgeX = Math.abs(halfWidth - halfViewportWidth);
        const edgeY = Math.abs(halfHeight - halfViewportHeight);

        return {
            x: edgeX,
            y: edgeY
        };
    }

    /**
     * Switch to full resolution image
     */
    function switchToFull() {
        if (!modalImgMedium || !modalImgFull || !modalFullSrc) {
            return;
        }

        if (!fullImageLoaded) {
            if (loadingTimer) {
                clearTimeout(loadingTimer);
                loadingTimer = null;
            }

            if (!fullImageLoading) {
                load(modalFullSrc, "full", modalLoadID);
            }
            return;
        }

        if (loadingTimer) {
            clearTimeout(loadingTimer);
            loadingTimer = null;
        }

        if (modalLoading) {
            modalLoading.classList.remove("active");
            modalLoading.style.opacity = "0";
        }

        modalImgFull.style.width = modalImgMedium.style.width;
        modalImgFull.style.height = modalImgMedium.style.height;
        modalImgFull.style.left = "50%";
        modalImgFull.style.top = "50%";
        modalImgFull.style.opacity = "1";
        modalImgFull.style.filter = "none";

        applyTransform();

        void modalImgFull.offsetWidth;

        displayingFull = true;
        modalImgFull.dataset.showingFull = "true";
        modalImgMedium.dataset.showingFull = "false";

        modalImgFull.style.visibility = "visible";
        modalImgFull.style.zIndex = "3";
        modalImgMedium.style.visibility = "hidden";
        modalImgMedium.style.opacity = "1";

        applyTransform();
    }

    /**
     * Switch to medium resolution image
     */
    function switchToMedium() {
        if (!modalImgMedium) {
            return;
        }

        if (modalImgFull) {
            modalImgMedium.style.width = modalImgFull.style.width;
            modalImgMedium.style.height = modalImgFull.style.height;
        }

        modalImgMedium.style.opacity = "1";

        if (modalImgFull)
            modalImgFull.style.opacity = "1";

        modalImgMedium.style.filter = "blur(4px)";
        modalImgMedium.style.visibility = "visible";

        applyTransform();

        requestAnimationFrame(() => {
            modalImgMedium.style.filter = "blur(0px)";
        });

        if (modalImgFull)
            modalImgFull.style.visibility = "hidden";

        displayingFull = false;
        modalImgMedium.dataset.showingFull = "false";

        setTimeout(() => {
            if (modalImgMedium) {
                modalImgMedium.style.filter = "none";
                modalImgMedium.style.opacity = "1";
            }

            if (modalImgFull) {
                modalImgFull.style.filter = "none";
                modalImgFull.style.opacity = "1";
            }
        }, 150);
    }

    /**
     * Show medium image
     */
    function showMediumImage() {
        if (!modalImgMedium) return;

        modalImgMedium.style.visibility = "visible";

        if (modalImgFull)
            modalImgFull.style.visibility = "hidden";

        displayingFull = false;
        applyTransform();
    }

    /**
     * Close modal and cleanup
     */
    function closeModal(resumeGallery = true) {
        modalLoadID++;
        modalRetry = null;

        cancelImageLoads();

        fullImageLoading = false;
        modalMediumLoading = false;

        if (resumeGallery && typeof window.resumeThumbnailLoading === 'function') {
            window.resumeThumbnailLoading();
        }

        const modal = document.getElementById("modal");

        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";

        const mediumImg = document.getElementById("modalImgMedium");
        const fullImg = document.getElementById("modalImgFull");
        const loader = document.getElementById("modalLoading");

        if (modal) modal.style.display = "none";

        if (mediumImg) {
            mediumImg.src = "";
            mediumImg.style.width = "";
            mediumImg.style.height = "";
            mediumImg.style.transform = "none";
            mediumImg.style.visibility = "hidden";
        }

        if (fullImg) {
            fullImg.src = "";
            fullImg.style.width = "";
            fullImg.style.height = "";
            fullImg.style.transform = "none";
            fullImg.style.visibility = "hidden";
        }

        if (loader) {
            loader.classList.remove("active");
        }

        const loadingBar = document.getElementById("modalLoadingBar");
        const loadingProgress = document.getElementById("modalLoadingProgress");

        if (loadingBar) {
            loadingBar.style.opacity = "0";
        }

        if (loadingProgress) {
            loadingProgress.style.width = "0%";
        }

        if (loadingTimer) {
            clearTimeout(loadingTimer);
            loadingTimer = null;
        }

        imgTransform = {
            x: 0,
            y: 0,
            scale: minZoom
        };

        resetImageState();
    }

    /**
     * Reset image interaction state
     */
    function resetImageState() {
        imgDragging = false;
        imgMoved = false;
        dragStart = {};
        displayingFull = false;
        fullImageLoading = false;
        fullImageLoaded = false;
        modalMediumLoaded = false;
        modalMediumLoading = false;
        modalMediumImage = null;
        modalFullLoaded = false;
        manualFullEnabled = false;
        modalMediumSrc = null;
        modalFullSrc = null;
    }

    /**
     * Clamp utility
     */
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    // Public API
    return {
        // State accessors
        getModalLoadID: () => modalLoadID,
        getNextModalLoadID,
        isModalLoadActive,
        getDisplayingFull: () => displayingFull,
        getImgTransform: () => imgTransform,

        // Modal control
        load,
        openModal: (thumbSrc, mediumSrc, fullSrc, sourceThumb) => {
            // To be implemented - requires integration with thumbnail system
        },
        closeModal,

        // Image manipulation
        applyTransform,
        getBounds,
        switchToFull,
        switchToMedium,
        showMediumImage,

        // Resizing utilities
        resizeThumb,
        imgResize,

        // Image loading control
        cancelImageLoads,
        resetImageState,

        // Constants
        minZoom,
        maxZoom,
        zoomStep,
        fullSwitchZoom,
        resolutionSwitchZoom
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModalLoader;
}
