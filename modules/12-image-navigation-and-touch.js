/*
 * 12-image-navigation-and-touch.js
 *
 * Next/previous image navigation, keyboard shortcuts, touch gesture
 * handling, and browser back/forward (popstate) support.
 */

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

    if (touchIsLong)
        return;

    const elapsed = Date.now() - touchStartTime;

    if (elapsed > 300)
        return;

    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;

    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    if (Math.abs(diffY) > Math.abs(diffX))
        return;

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
`.thumbnail-slot[data-index="${index}"]`);

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


/*
 * The browser's own back/forward buttons don't go through
 * openAlbumWithTransition()/goBackToAlbumsWithTransition() -- they
 * land here instead, via popstate. This wraps the same fade used
 * everywhere else around whatever this handler decides to show, so
 * back/forward gets the same "hide the load behind a fade" treatment.
 * There's no flying-cover animation here, since popstate doesn't carry
 * a reference to which thumbnail/card triggered it, only a plain fade.
 */
window.addEventListener("popstate", async () => {

        const previousTemporaryID =
            currentTemporaryAlbumID;

        currentTemporaryAlbumID =
            null;

        const query =
            decodeURIComponent(
                location.search.substring(1)
            );

        closeModal();

        await fadeOutCurrentView();

        if (
            !query
        ) {

            if (
                previousTemporaryID
            ) {

                deleteTemporaryAlbum(previousTemporaryID);

            }

            await showAlbums();

            fadeInCurrentView();

            return;

        }

        if (
            query.startsWith("$")
        ) {

            if (
                previousTemporaryID
            ) {

                deleteTemporaryAlbum(previousTemporaryID);

            }

            const albumID =
                query.substring(1);

            await reloadAlbums();

            const album =
                albums.find(
                    a =>
                        a.id === albumID
                );

            if (
                album
            ) {

                const layoutReady =
                    waitForAlbumLayout();

                loadAlbum(album, false);

                await layoutReady;

                fadeInCurrentView();

                return;

            }

            await showAlbums();

            fadeInCurrentView();

            return;

        }

        if (
            query.startsWith("=")
        ) {

            const albumID =
                query.substring(1);

            const album =
                getTemporaryAlbum(albumID);

            if (
                album
            ) {

                currentTemporaryAlbumID =
                    albumID;

                const layoutReady =
                    waitForAlbumLayout();

                loadAlbum(album, false);

                await layoutReady;

                fadeInCurrentView();

                return;

            }

            await showAlbums();

            fadeInCurrentView();

            return;

        }

        if (
            previousTemporaryID
        ) {

            deleteTemporaryAlbum(previousTemporaryID);

        }

        const albumQuery =
            createQueryAlbum(query);

        const layoutReady =
            waitForAlbumLayout();

        loadAlbum(albumQuery, false);

        await layoutReady;

        fadeInCurrentView();

    }
);


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
