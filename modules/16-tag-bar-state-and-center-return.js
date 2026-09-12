/*
 * 16-tag-bar-state-and-center-return.js
 *
 * Persists tag bar UI state and handles the "snap back to center"
 * animation.
 */

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

    tagBar.classList.add("noTransition");

    if (hidden) {
        tagBar.classList.add("hidden");
    } else {
        tagBar.classList.remove("hidden");
        tagBar.style.visibility = "visible";
    }

    tagBar.offsetWidth;

    tagBar.classList.remove("noTransition");
}


function cancelCenterReturn() {

    if (centerReturnTimer !== null) {

        clearTimeout(centerReturnTimer);

        centerReturnTimer = null;

    }

    if (centerReturnAnimation !== null) {

        cancelAnimationFrame(centerReturnAnimation);

        centerReturnAnimation = null;

    }

}


function scheduleCenterReturn() {

    if (centerReturnTimer !== null)
        return;

    if (
        Math.abs(imgTransform.x) < 0.01 &&
        Math.abs(imgTransform.y) < 0.01 &&
        Math.abs(imgTransform.scale - minZoom) < 0.001) {

        return;

    }

    centerReturnTimer =
        setTimeout(() => {

            centerReturnTimer = null;

            if (
                imgDragging ||
                interactingWithImage ||
                zooming) {

                return;

            }

            const img =
                displayingFull
                 ? modalImgFull
                 : modalImgMedium;

            if (!img)
                return;

            const startX =
                imgTransform.x;

            const startY =
                imgTransform.y;

            const startScale =
                imgTransform.scale;

            if (
                Math.abs(startX) < 0.01 &&
                Math.abs(startY) < 0.01 &&
                Math.abs(startScale - minZoom) < 0.001) {

                return;

            }

            const startTime =
                performance.now();

            const duration =
                centerAnimationDuration;

            function animateCenter(now) {

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

                const eased =
                    1 -
                    Math.pow(
                        1 - progress,
                        3);

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
                        requestAnimationFrame(animateCenter);

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
                requestAnimationFrame(animateCenter);

        }, 3000);

}
