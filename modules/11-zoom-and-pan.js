/*
 * 11-zoom-and-pan.js
 *
 * Pinch-zoom, pan, and the logic that swaps between thumbnail/medium/full
 * resolution as you zoom in the viewer.
 */

let imgDragging = false;

let dragStart = {};

let imgTransform = {
    x: 0,
    y: 0,
    scale: minZoom
};


let imgMoved = false;


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

    const width =
        rect.width;

    const height =
        rect.height;

    const viewportWidth =
        window.innerWidth;

    const viewportHeight =
        window.innerHeight;

    const halfWidth =
        width / 2;

    const halfHeight =
        height / 2;

    const halfViewportWidth =
        viewportWidth / 2;

    const halfViewportHeight =
        viewportHeight / 2;

    const normalX =
        halfWidth +
        halfViewportWidth
         -
        Math.min(halfWidth,
            halfViewportWidth);

    const normalY =
        halfHeight +
        halfViewportHeight
         -
        Math.min(halfHeight,
            halfViewportHeight);

    const edgeX =
        Math.abs(
            halfWidth -
            halfViewportWidth);

    const edgeY =
        Math.abs(
            halfHeight -
            halfViewportHeight);

    const multiplier =
        Number.isFinite(imagePanBoundaryMultiplier)
         ? imagePanBoundaryMultiplier
         : 1;

    const amount =
        clamp(
            (multiplier - 1) / 0.5,
            0,
            1);

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

        clearTimeout(zoomEndTimer);

    }

    zoomEndTimer =
        setTimeout(() => {

            zooming = false;

            zoomEndTimer = null;

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

                    clearTimeout(fullSwitchTimer);

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

    const img =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (!img)
        return;

    const oldScale =
        Number.isFinite(imgTransform.scale)
         ? imgTransform.scale
         : minZoom;

    const direction =
        e.deltaY < 0
         ? 1
         : -1;

    const rect =
        img.getBoundingClientRect();

    const unscaledWidth =
        rect.width /
        oldScale;

    const unscaledHeight =
        rect.height /
        oldScale;

    const widthScale =
        window.innerWidth /
        unscaledWidth;

    const heightScale =
        window.innerHeight /
        unscaledHeight;

    const firstZoomScale =
        Math.max(widthScale,
            heightScale);

    let newScale;

    if (
        direction > 0 &&
        oldScale < firstZoomScale) {

        newScale =
            clamp(firstZoomScale,
                minZoom,
                maxZoom);

    } else {

        newScale =
            clamp(
                oldScale +
                direction * zoomStep,
                minZoom,
                maxZoom);

    }

    if (newScale === oldScale)
        return;

    const imageCenterX =
        rect.left +
        rect.width / 2;

    const imageCenterY =
        rect.top +
        rect.height / 2;

    const mouseOffsetX =
        e.clientX -
        imageCenterX;

    const mouseOffsetY =
        e.clientY -
        imageCenterY;

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

    let newX =
        newCenterX -
        viewportCenterX;

    let newY =
        newCenterY -
        viewportCenterY;

    const newWidth =
        unscaledWidth *
        newScale;

    const newHeight =
        unscaledHeight *
        newScale;

    const halfWidth =
        newWidth / 2;

    const halfHeight =
        newHeight / 2;

    const halfViewportWidth =
        window.innerWidth / 2;

    const halfViewportHeight =
        window.innerHeight / 2;

    const edgeX =
        Math.abs(
            halfWidth -
            halfViewportWidth);

    const edgeY =
        Math.abs(
            halfHeight -
            halfViewportHeight);

    const maximumX =
        halfWidth;

    const maximumY =
        halfHeight;

    const multiplier =
        Number.isFinite(imagePanBoundaryMultiplier)
         ? imagePanBoundaryMultiplier
         : 1;

    const boundaryAmount =
        clamp(
            (multiplier - 1) / 0.5,
            0,
            1);

    const boundsX =
        edgeX +
        (maximumX - edgeX) *
        boundaryAmount;

    const boundsY =
        edgeY +
        (maximumY - edgeY) *
        boundaryAmount;

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

    if (
        newScale <
        firstZoomScale) {

        scheduleCenterReturn();

    } else {

        cancelCenterReturn();

    }

    applyTransform();

    if (
        typeof showZoomLevel ===
        "function") {

        showZoomLevel();

    }

    if (manualFullEnabled)
        return;

    if (autoResolutionSwitch) {

        if (
            newScale <
            fullSwitchZoom) {

            if (fullSwitchTimer) {

                clearTimeout(fullSwitchTimer);

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

                    clearTimeout(fullSwitchTimer);

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

    if (
        resolutionSwitchOnZoom &&
        autoResolutionSwitch &&
        displayingFull &&
        modalMediumLoaded &&
        newScale >= resolutionSwitchZoom) {

        if (fullSwitchTimer) {

            clearTimeout(fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        zoomSwitchedFromFull =
            true;

        switchToMedium();

    }

    if (
        typeof endZoomGesture ===
        "function") {

        endZoomGesture();

    }

}


function imgPan(e) {

if (e.button !== 0)
    return;

if (
    e.target.closest &&
    (
        e.target.closest("#modalFullButton") ||
        e.target.closest("button"))) {

    return;

}

e.preventDefault();

const startedInFull =
    displayingFull &&
    !manualFullEnabled &&
    fullImageLoaded &&
    modalMediumLoaded;

panStartedInFull =
    startedInFull &&
    resolutionSwitchOnPan;

if (fullSwitchTimer) {

    clearTimeout(fullSwitchTimer);

    fullSwitchTimer = null;

}

const img =
    displayingFull
     ? modalImgFull
     : modalImgMedium;

if (!img)
    return;

if (
    startedInFull &&
    resolutionSwitchOnPan) {

    switchToMedium();

}

const panImg =
    displayingFull
     ? modalImgFull
     : modalImgMedium;

if (!panImg)
    return;

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

    const autoWantsFull =
        autoResolutionSwitch &&
        imgTransform.scale >=
        fullSwitchZoom;

    if (
        panStartedInFull &&
        !manualFullEnabled &&
        resolutionSwitchOnPan &&
        fullImageLoaded &&
        modalMediumLoaded) {

        if (autoWantsFull) {

            scheduleFullRestore();

        } else {

            if (fullSwitchTimer) {

                clearTimeout(fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

        }

    }

    else if (
        !panStartedInFull &&
        !manualFullEnabled &&
        !displayingFull &&
        fullImageLoaded) {

        if (autoWantsFull) {

            if (fullSwitchTimer) {

                clearTimeout(fullSwitchTimer);

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

        clearTimeout(fullSwitchTimer);

        fullSwitchTimer = null;

    }

    if (manualFullEnabled)
        return;

    if (!resolutionSwitchOnPan)
        return;

    if (
        !fullImageLoaded ||
        !modalMediumLoaded) {

        return;

    }

    fullSwitchTimer =
        setTimeout(() => {

            fullSwitchTimer = null;

            if (
                manualFullEnabled ||
                !fullImageLoaded ||
                !modalMediumLoaded ||
                displayingFull ||
                imgDragging ||
                interactingWithImage) {

                return;

            }

            switchToFull();

        }, resolutionSwitchDelay);

}


function enforceAutoResolution() {

    if (manualFullEnabled)
        return;

    if (
        !autoResolutionSwitch ||
        !fullImageLoaded) {

        return;

    }

    if (
        imgTransform.scale <
        fullSwitchZoom) {

        if (fullSwitchTimer) {

            clearTimeout(fullSwitchTimer);

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

    if (
        imgTransform.scale >=
        fullSwitchZoom &&
        !displayingFull &&
        !imgDragging &&
        !interactingWithImage) {

        if (fullSwitchTimer) {

            clearTimeout(fullSwitchTimer);

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

    if (
        !modalImgMedium ||
        !modalImgFull ||
        !modalFullSrc) {
        return;

    }

    if (!fullImageLoaded) {
        if (loadingTimer) {

            clearTimeout(loadingTimer);

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

    applyTransform();

    void modalImgFull.offsetWidth;

    displayingFull =
        true;

    modalImgFull.dataset.showingFull =
        "true";

    modalImgMedium.dataset.showingFull =
        "false";

    modalImgFull.style.visibility =
        "visible";

    modalImgFull.style.zIndex =
        "3";

    modalImgMedium.style.visibility =
        "hidden";

    modalImgMedium.style.opacity =
        "1";

    applyTransform();
}


function switchToMedium() {
    if (!modalImgMedium) {
        return;
    }

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

        clearTimeout(zoomLevelTimer);

    }

    zoomLevelTimer =
        setTimeout(() => {

            zoomLevelDisplay.classList.remove(
                "visible");

            zoomLevelTimer = null;

        }, 2000);
}


function showImage(offset) {

    if (!currentAlbum) {
        return;
    }

    const images =
        currentAlbum._imagesArray || buildImagesArray(currentAlbum);

    if (!images.length) {
        return;
    }

    const total =
        images.length;

    let index =
        currentImageIndex;

    for (let i = 0; i < total; i++) {

        index += offset;

        if (index >= total) {
            index = 0;
        }

        if (index < 0) {
            index = total - 1;
        }

        const img =
            images[index];

        if (!img) {
            continue;
        }

        const urls =
            getImageURLs(img, currentAlbum);

        if (!urls.thumb) {
            continue;
        }

        const thumb =
            document.querySelector(`.thumbnail-slot[data-index="${index}"]`);

        if (
            thumb &&
            getComputedStyle(thumb).display === "none"
        ) {
            continue;
        }

        currentImageIndex =
            index;

        scrollToCurrentThumbnail(index);
        scheduleThumbnailVisibilityCheck();
        openModal(urls.thumb, urls.medium, urls.full, thumb);

        return;
    }
}
