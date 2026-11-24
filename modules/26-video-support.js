/*
 * 26-video-support.js
 *
 * Video entries (image.video === true, set when an album is built from
 * a metadata.json -- see buildAlbumFromTelegramMetadata() in
 * 06-telegram-import.js) behave like this:
 *
 *   thumb  -> a still image, shown in the grid right away (normal
 *             thumbnail pipeline).
 *   medium -> the short "quick" clip. Loaded in full in the background
 *             (10-medium-loading.js calls loadVideoMedium()
 *             instead of the image path). Until it has completely
 *             loaded, only the still image is shown. Once loaded, it
 *             plays muted on a loop while the mouse is over the cell
 *             and pauses when the mouse leaves.
 *   full   -> streamed in the modal viewer (openVideoModal()), so it
 *             can play while it is still downloading. For an original
 *             that was split into parts, the worker serves the whole
 *             file from any part's link; entry.parts lists them all.
 */

/* Every blob: URL created for a grid preview, so they can be released. */
const videoBlobURLs = new Set();


/*
 * The media Worker requires the same signed ?auth= token on its API
 * routes (flood state, client timing). Without it those calls 401,
 * which only costs diagnostics -- playback itself uses signed media
 * URLs already.
 */
function workerAuthQuerySuffix() {

    const token =
        providerAuthTokens?.telegram;

    return token
        ? "?auth=" + encodeURIComponent(token)
        : "";

}


/*
 * Cloudflare's edge answers the FIRST request for a media URL without
 * passing the Range header through. The 200 it returns is a chunked
 * stream with no Content-Range and no Content-Length, so Chrome has no
 * size for the resource and marks the video unseekable (seekable stays
 * [0, 0]); every seek is then clamped and the video restarts from 0.
 *
 * The request right after it goes through untouched and gets a proper
 * 206, so a cheap HEAD to the exact same URL is enough to make the
 * <video> element's own request the second one. The URL (including the
 * auth query) must match exactly.
 *
 * Best effort: if the warm-up fails the video still plays, it just
 * cannot be seeked.
 */
async function warmMediaRangeSupport(url) {

    if (!url || url.startsWith("blob:"))
        return;

    try {

        await Promise.race([
            fetch(url, {
                method: "HEAD",
                cache: "no-store",
                mode: "cors"
            }),
            new Promise(resolve => setTimeout(resolve, 6000))
        ]);

    } catch {}

}


function releaseVideoBlobs() {

    for (const url of videoBlobURLs) {

        try {

            URL.revokeObjectURL(url);

        } catch {}

    }

    videoBlobURLs.clear();

}


function pauseAllVideoPreviews() {

    document
        .querySelectorAll(".video-preview")
        .forEach(video => video.pause());

}


/* ============================================================
 * Grid preview
 * ========================================================== */


/*
 * Downloads a video candidate completely and returns a blob: URL for
 * it, or null if no candidate could be fetched (e.g. no CORS headers
 * from the provider -- the caller then falls back to the plain URL).
 */
async function fetchVideoBlobURL(album, image, sizeKey, maxBytes = 0) {

    const candidates =
        getImageProviderCandidates(album, image, sizeKey);

    for (const candidate of candidates) {

        const controller =
            new AbortController();

        const timer =
            setTimeout(
                () => controller.abort(),
                120000
            );

        try {

            const response =
                await fetch(candidate.url, {
                    signal: controller.signal
                });

            if (!response.ok)
                continue;

            const declared =
                Number(response.headers.get("content-length")) || 0;

            if (maxBytes > 0 && declared > maxBytes)
                continue;

            const reader =
                response.body?.getReader();

            if (!reader)
                continue;

            const chunks = [];
            let total = 0;
            let tooBig = false;

            for (;;) {

                const { done, value } =
                    await reader.read();

                if (done)
                    break;

                total += value.length;

                if (maxBytes > 0 && total > maxBytes) {

                    tooBig = true;
                    break;

                }

                chunks.push(value);

            }

            if (tooBig) {

                try {
                    await reader.cancel();
                } catch {}

                continue;

            }

            const type =
                response.headers.get("content-type") || "";

            let blob =
                new Blob(chunks, type ? { type } : undefined);

            if (!blob.size || /^image\//i.test(blob.type))
                continue;

            if (!/^video\//i.test(blob.type))
                blob = new Blob([blob], { type: "video/mp4" });

            const url =
                URL.createObjectURL(blob);

            videoBlobURLs.add(url);

            return url;

        } catch (error) {

            console.debug(
                "[VIDEO] Candidate fetch failed",
                {
                    provider: candidate.providerName,
                    errorMessage: error?.message
                }
            );

        } finally {

            clearTimeout(timer);

        }

    }

    return null;

}


function fullVideoDelivery(album, image) {

    const candidate =
        getImageProviderCandidates(album, image, "full")[0];

    if (!candidate)
        return "external";

    return chooseVideoDelivery(candidate.providerName, image);

}


/*
 * Ask the Worker to hold the first megabytes of a video in its memory.
 *
 * Firefox requests the start of a video in several short ranges and
 * aborts them as it goes, so the first seconds cost multiple Telegram
 * round trips. Warming the Worker while the grid is being browsed makes
 * those requests local. Fire and forget: `?prefetch=1` answers 204
 * immediately and the download continues in waitUntil.
 */
const prefetchedUrls = new Set();

/*
 * The Worker's prefetch cache cannot serve right now (see fix 33: serving it
 * produced decode errors), so prefetching would only compete with playback
 * for Telegram bandwidth -- the modal measured ~19 s to first play with it
 * running and nothing consuming the result. Skip it entirely until the cache
 * is trustworthy again.
 */
const PREFETCH_ENABLED = false;

async function prefetchVideoUrl(url, wait) {

    if (!PREFETCH_ENABLED)
        return false;

    if (!url || url.startsWith("blob:"))
        return false;

    const target =
        url + (url.includes("?") ? "&" : "?") +
        (wait ? "prefetch=1&wait=1" : "prefetch=1");

    if (!wait) {

        if (prefetchedUrls.has(target))
            return true;

        if (prefetchedUrls.size > 40)
            prefetchedUrls.clear();

        prefetchedUrls.add(target);

    }

    try {

        const controller =
            wait ? new AbortController() : null;

        const timer =
            controller
                ? setTimeout(() => controller.abort(), 3500)
                : null;

        await fetch(target, {
            mode: "cors",
            cache: "no-store",
            keepalive: !wait,
            signal: controller?.signal
        });

        if (timer)
            clearTimeout(timer);

        return true;

    } catch (error) {

        return false;

    }

}

/*
 * Block until the Worker has the opening seconds in memory. Called right
 * before the player is given a URL, so the first request never waits on
 * Telegram. Hovering the tile usually did this already, in which case the
 * worker answers immediately.
 */
async function prepareVideoStart(url) {

    await prefetchVideoUrl(url, true);

}

function prefetchVideoStart(item) {

    if (!item?.image)
        return;

    const album =
        item._album || (typeof currentAlbum !== "undefined" ? currentAlbum : null);

    try {

        const candidate =
            getImageProviderCandidates(album, item.image, "full")[0];

        if (
            candidate?.url &&
            fullVideoDelivery(album, item.image) === "stream"
        ) {
            prefetchVideoUrl(candidate.url);
        }

    } catch {}

}


function bindSlotVideoHover(slot) {

    if (slot._videoHoverBound)
        return;

    slot._videoHoverBound =
        true;

    slot.addEventListener("mouseenter", () => {

        prefetchVideoStart(slot._thumbnailItem);

        const video =
            slot.querySelector(".video-preview");

        if (video && video.dataset.ready === "true") {

            const played = video.play();

            if (played && played.catch)
                played.catch(() => {});

        }

    });

    slot.addEventListener("mouseleave", () => {

        const video =
            slot.querySelector(".video-preview");

        if (video)
            video.pause();

    });

}


function ensureSlotVideo(slot) {

    if (!slot)
        return null;

    let video =
        slot.querySelector(".video-preview");

    if (!video) {

        video =
            document.createElement("video");

        video.className =
            "video-preview";

        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";

        video.addEventListener("pause", () => {

            video.classList.remove("playing");

        });

        video.addEventListener("playing", () => {

            video.classList.add("playing");

        });

        slot.appendChild(video);

    }

    bindSlotVideoHover(slot);

    return video;

}


/*
 * Called from loadMedium() (10-medium-loading.js) for video
 * entries. `item` is the mediumItems entry, `thumbnail` the matching
 * thumbnailItems entry. Keeps the same flag bookkeeping as the image
 * path so the queues and completion logic keep working.
 */
async function loadVideoMedium(item, thumbnail, session) {

    item.mediumLoading =
        true;

    item.mediumFailed =
        false;

    try {

        const album =
            item._album || currentAlbum;

        let src =
            item.videoBlobURL ||
            await fetchVideoBlobURL(album, item.image, "medium");

        let readyEvent =
            "loadeddata";

        if (src && !item.videoBlobURL)
            item.videoBlobURL = src;

        if (!src) {

            /* Couldn't fetch it as a blob; let the element stream it. */
            const candidate =
                getImageProviderCandidates(album, item.image, "medium")[0];

            if (!candidate)
                throw new Error("No medium video source.");

            src =
                candidate.url;

            readyEvent =
                "canplaythrough";

        }

        /*
         * The album changed while this was downloading: drop it.
         * If only the session changed (e.g. a modal opened), the blob
         * stays cached on the item for the next pass.
         */
        if (!mediumItems.includes(item)) {

            if (item.videoBlobURL) {

                URL.revokeObjectURL(item.videoBlobURL);

                videoBlobURLs.delete(item.videoBlobURL);

            }

            item.mediumLoading = false;

            return;

        }

        if (session !== mediumLoadSession) {

            item.mediumLoading = false;

            return;

        }

        const slot =
            thumbnail.slot;

        const video =
            ensureSlotVideo(slot);

        if (!video)
            throw new Error("No slot for video preview.");

        await new Promise((resolve, reject) => {

            video.addEventListener(readyEvent, resolve, { once: true });

            video.addEventListener(
                "error",
                () => reject(new Error("Video failed to load.")),
                { once: true }
            );

            video.src =
                src;

            video.load();

        });

        video.dataset.ready =
            "true";

        item.mediumLoaded =
            true;

        thumbnail.mediumLoaded =
            true;

        /* Already hovering when it finished loading? Start now. */
        if (slot.matches(":hover")) {

            const played = video.play();

            if (played && played.catch)
                played.catch(() => {});

        }

    } catch (error) {

        item.mediumLoaded =
            false;

        item.mediumFailed =
            true;

        noteImageFailure();

        console.debug(
            "[VIDEO] Medium failed",
            {
                index: item.index,
                errorMessage: error?.message
            }
        );

    } finally {

        item.mediumLoading =
            false;

    }

}


/* ============================================================
 * Modal streaming
 * ========================================================== */


function teardownModalVideo() {

    if (typeof activeHlsPlayer !== "undefined" && activeHlsPlayer)
        activeHlsPlayer.destroy();

    const video =
        document.getElementById("modalVideo");

    if (video?._seekBufferTimer) {

        clearInterval(video._seekBufferTimer);
        video._seekBufferTimer = null;

    }

    /*
     * The overlay's progress animation belongs to the poster element,
     * which is removed below; without this it keeps ticking against a
     * detached video for the rest of the session.
     */
    const poster =
        document.getElementById("modalVideoPoster");

    if (poster?._timer) {

        clearInterval(poster._timer);
        poster._timer = null;

    }

    if (video?._stallWatch) {

        clearInterval(video._stallWatch);
        video._stallWatch = null;

    }

    if (video) {

        video.pause();

        /* Dropping the source aborts any download still in flight. */
        video.removeAttribute("src");

        video.load();

        video.remove();

    }

    document.getElementById("modalVideoClose")?.remove();

    document.getElementById("modalVideoError")?.remove();

    document.getElementById("modalVideoPoster")?.remove();

    /* Restore the image viewer's translucent backdrop. */
    const modalOverlay =
        document.getElementById("modal");

    if (modalOverlay)
        modalOverlay.style.background = "";

}


/*
 * Hook called at the very top of openModal() (12-modal-viewer.js).
 * Always clears any video left over from a previous modal view; opens
 * the video viewer and returns true if the clicked entry is a video.
 */
function handleVideoModal(sourceThumb) {

    teardownModalVideo();

    const item =
        sourceThumb?._thumbnailItem;

    if (!item?.image?.video)
        return false;

    openVideoModal(item, sourceThumb).catch(error => {
        console.debug(
            "[VIDEO] Modal open failed",
            { errorMessage: error?.message }
        );
    });

    return true;

}


async function openVideoModal(item, sourceThumb) {

    pauseAllVideoPreviews();

    /* Invalidate any in-flight image modal load. */
    modalLoadID++;

    cancelImageLoads();

    if (modalOutgoingClone) {

        modalOutgoingClone.remove();

        modalOutgoingClone = null;

    }

    const modal =
        document.getElementById("modal");

    const container =
        document.getElementById("modalImageContainer");

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    modal.style.display =
        "flex";

    /*
     * The modal's own backdrop is rgba(0, 0, 0, .9); over a page with any
     * brightness that reads as "the page showing through" for the frame
     * or two before the video overlay paints. Make it solid while a video
     * is loading and restore it on teardown.
     */
    modal.style.background =
        "#000";

    for (const id of ["modalImgSmall", "modalImgMedium", "modalImgFull"]) {

        const img = document.getElementById(id);

        if (img)
            img.style.visibility = "hidden";

    }

    const fullButton =
        document.getElementById("modalFullButton");

    if (fullButton)
        fullButton.style.display = "none";

    const loadingBar =
        document.getElementById("modalLoadingBar");

    if (loadingBar)
        loadingBar.style.opacity = "0";

    const album =
        item._album || currentAlbum;

    if (item.image?.hls && typeof createHlsPlayer === "function") {

        pauseThumbnailLoading();

        createHlsPlayer(container, modal, item);

        return;

    }

    /*
     * Delivery method for full playback. The source decides (and may
     * leave it on auto); the site only acts on the URL it was given.
     */
    const videoDelivery =
        fullVideoDelivery(album, item.image);

    const fullCandidate =
        getImageProviderCandidates(album, item.image, "full")[0];

    if (videoDelivery === "external") {

        if (fullCandidate?.url) {

            window.open(
                fullCandidate.url,
                "_blank",
                "noopener,noreferrer"
            );

        }

        closeModal(false);

        return;

    }

    let videoDownloadPromise = null;

    if (videoDelivery === "download") {

        const cap =
            getProviderDelivery(
                fullCandidate?.providerName || ""
            ).maxDownloadMB * 1024 * 1024;

        if (
            Number(item.image?.size) > 0 &&
            Number(item.image.size) > cap
        ) {

            if (fullCandidate?.url) {

                window.open(
                    fullCandidate.url,
                    "_blank",
                    "noopener,noreferrer"
                );

            }

            closeModal(false);

            return;

        }

        videoDownloadPromise =
            fetchVideoBlobURL(
                album,
                item.image,
                "full",
                cap
            );

    }

    const urls = [];

    /*
     * While the video prepares (Worker prefetch, first buffering, every
     * seek) the player area is covered by this overlay: black, then the
     * video's own frame, with a single progress bar in the middle. It
     * fades out the moment playback starts, so there is exactly one
     * loading indicator and no native spinner flashing underneath.
     */
    const poster =
        document.createElement("div");

    poster.id = "modalVideoPoster";

    Object.assign(poster.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        /*
         * Solid black, not the thumbnail: the thumbnail may not be
         * painted yet, and a half-loaded poster let the page show
         * through. The first decoded frame fades in over this instead.
         */
        background: "#000",
        opacity: "1",
        pointerEvents: "none",
        transition: "opacity .25s ease"
    });

    /*
     * The video's own frame, painted while it loads. At the first play
     * that is frame zero; after a seek it is the frame the seek lands on,
     * so the overlay shows exactly what is about to play.
     *
     * Two layers: `posterFrame` keeps the frame that is on screen and
     * `posterFrameTop` receives the next one, which fades in from a blur
     * so a seek blends out of the old position instead of snapping.
     */
    const posterFrame =
        document.createElement("canvas");

    Object.assign(posterFrame.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "none"
    });

    const posterFrameTop =
        document.createElement("canvas");

    Object.assign(posterFrameTop.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "none",
        opacity: "0",
        willChange: "opacity, filter"
    });

    /*
     * The last frame the player actually displayed, kept off-screen and
     * refreshed a few times a second. Firefox blanks the element's own
     * frame as soon as a seek begins, so drawing from the video at that
     * moment produced a black overlay; this copy is always the frame the
     * user was looking at.
     */
    const posterFrameLast =
        document.createElement("canvas");

    posterFrameLast.style.display = "none";

    const posterShade =
        document.createElement("div");

    Object.assign(posterShade.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(0, 0, 0, .55)"
    });

    const posterTrack =
        document.createElement("div");

    Object.assign(posterTrack.style, {
        position: "relative",
        width: "min(55%, 320px)",
        height: "4px",
        borderRadius: "2px",
        background: "rgba(255, 255, 255, .25)",
        overflow: "hidden"
    });

    const posterFill =
        document.createElement("div");

    Object.assign(posterFill.style, {
        height: "100%",
        width: "0%",
        background: "#fff",
        transition: "width .12s linear"
    });

    /*
     * How much video to have buffered before playback is revealed, and
     * the longest the overlay will wait for it. The target is generous on
     * purpose: the stream runs only a little faster than real time, so
     * releasing with the bare minimum means the picture reappears, plays
     * a couple of seconds, and stalls again. The timeouts are a ceiling;
     * the hold keeps waiting while bytes are still arriving.
     */
    const SEEK_BUFFER_SECONDS = 5;
    const SEEK_BUFFER_TIMEOUT_MS = 12000;

    const START_BUFFER_SECONDS = 6;
    const START_BUFFER_TIMEOUT_MS = 12000;

    posterTrack.appendChild(posterFill);
    poster.appendChild(posterFrame);
    poster.appendChild(posterFrameTop);
    poster.appendChild(posterShade);
    poster.appendChild(posterTrack);
    /*
     * Attached to the document, not the modal's image container: the
     * modal zooms in from the thumbnail over ~300 ms, and an overlay
     * inside it inherits that, leaving the dimmed page visible first.
     * Fixed and on top means it is opaque from the first frame after the
     * click. `pointer-events: none` still lets a click outside reach the
     * modal and close it.
     */
    document.body.appendChild(poster);

    let posterTarget = 0;
    let posterVisible = false;
    let posterTimer = null;
    let posterPhase = "prepare";
    let posterPhaseStartedAt = 0;
    let posterShown = 0;

    /*
     * Up immediately, in the same task as the click: the overlay must not
     * wait for the player, the prefetch or a frame. The thumbnail behind
     * it is the one already painted in the grid, so it is in cache.
     */
    showPoster(START_BUFFER_SECONDS, "prepare");

    /*
     * Two phases, so the bar moves for the whole wait:
     *
     *   prepare - from the moment the modal opens until the player gets a
     *             URL. There is no byte progress to read here, so it
     *             eases towards 25% with the time spent waiting.
     *   buffer  - once the player is loading: real buffered-ahead over the
     *             hold's target, mapped onto 25..100%.
     *
     * The displayed value chases the computed one on a 50 ms timer, which
     * hides the 1 MiB steps of the stream (otherwise the bar jumps in 10%
     * chunks and then snaps to full).
     */
    function posterComputedTarget() {

        if (posterPhase === "prepare") {

            const elapsed =
                Date.now() - posterPhaseStartedAt;

            return Math.min(25, elapsed / 4000 * 25);

        }

        if (posterTarget <= 0)
            return 25;

        /*
         * Measure at the position playback will resume from, not at the
         * playhead. During a hold the element moves on under the overlay,
         * so measuring there could show a full bar while the resume
         * position has almost nothing buffered -- the overlay then lifted
         * straight into a spinner.
         */
        const buffered =
            Math.min(
                100,
                (bufferHoldStartedAt
                    ? bufferedAheadAt(holdStartPosition)
                    : bufferedAhead()) / posterTarget * 100
            );

        return 25 + buffered * 0.75;

    }

    function updatePosterProgress() {

        if (!posterVisible)
            return;

        const target =
            posterComputedTarget();

        /* Never runs backwards, so switching phase cannot rewind it. */
        if (target > posterShown)
            posterShown += (target - posterShown) * 0.18;

        if (target > posterShown && target - posterShown < 0.3)
            posterShown = target;

        posterFill.style.width =
            posterShown.toFixed(1) + "%";

    }

    function showPoster(target, phase) {

        posterTarget = target;

        if (!posterVisible) {

            posterVisible = true;
            posterShown = 0;
            posterFill.style.width = "0%";

        }

        if (phase === "prepare") {

            posterPhase = "prepare";
            posterPhaseStartedAt = Date.now();

        } else {

            posterPhase = "buffer";

        }

        poster.style.opacity = "1";

        /*
         * Appear instantly (a fade-in would show the player underneath for
         * a quarter of a second); only the fade-out is animated.
         */
        poster.style.transition = "none";
        void poster.offsetWidth;
        poster.style.transition = "opacity .25s ease";

        if (!posterTimer) {

            posterTimer = setInterval(updatePosterProgress, 50);
            poster._timer = posterTimer;

        }

    }

    function posterBeginBuffering() {

        if (!posterVisible)
            return;

        posterPhase = "buffer";
        posterPhaseStartedAt = Date.now();

    }

    function hidePoster() {

        posterVisible = false;

        if (posterTimer) {

            clearInterval(posterTimer);
            posterTimer = null;
            poster._timer = null;

        }

        poster.style.opacity = "0";
        posterFrame.style.filter = "none";

    }

    /*
     * Paint the frame the element is currently showing into the overlay.
     * A cross-origin video taints the canvas, which is fine: the pixels
     * are never read back, only displayed.
     */
    let frameBlendTimer = null;

    function drawFrameInto(canvas) {

        const width = video.videoWidth;
        const height = video.videoHeight;

        if (!width || !height)
            return false;

        const boxWidth =
            poster.clientWidth || width;

        const boxHeight =
            poster.clientHeight || height;

        canvas.width = boxWidth;
        canvas.height = boxHeight;

        const context =
            canvas.getContext("2d");

        if (!context)
            return false;

        context.fillStyle = "#000";
        context.fillRect(0, 0, boxWidth, boxHeight);

        const scale =
            Math.min(
                boxWidth / width,
                boxHeight / height
            );

        const drawWidth = width * scale;
        const drawHeight = height * scale;

        context.drawImage(
            video,
            (boxWidth - drawWidth) / 2,
            (boxHeight - drawHeight) / 2,
            drawWidth,
            drawHeight
        );

        canvas.style.display = "block";

        return true;

    }

    /*
     * Blend from whatever frame the overlay is showing to the current one:
     * the new frame fades in from a heavy blur on a second canvas, then
     * becomes the base frame. After a seek this reads as the old position
     * melting into the new one while the buffer fills.
     */
    function captureFrame() {

        try {

            if (!drawFrameInto(posterFrameTop))
                return false;

            if (frameBlendTimer) {

                clearTimeout(frameBlendTimer);
                frameBlendTimer = null;

            }

            /*
             * Only now, with the new frame in hand, soften the old one --
             * blurring it when the overlay appears would look like the
             * wrong frame going out of focus before there is anything to
             * replace it.
             */
            if (posterFrame.style.display === "block") {

                posterFrame.style.transition = "filter .45s ease";
                posterFrame.style.filter = "blur(9px)";

            }

            posterFrameTop.style.transition = "none";
            posterFrameTop.style.filter = "blur(18px)";
            posterFrameTop.style.opacity = "0";

            void posterFrameTop.offsetWidth;

            posterFrameTop.style.transition =
                "opacity .5s ease, filter .5s ease";

            posterFrameTop.style.opacity = "1";
            posterFrameTop.style.filter = "blur(0px)";

            frameBlendTimer = setTimeout(() => {

                frameBlendTimer = null;

                /* Fold the top layer into the base one. */
                try {

                    if (posterFrame.width !== posterFrameTop.width) {

                        posterFrame.width = posterFrameTop.width;
                        posterFrame.height = posterFrameTop.height;

                    }

                    const context =
                        posterFrame.getContext("2d");

                    context.clearRect(
                        0,
                        0,
                        posterFrame.width,
                        posterFrame.height
                    );

                    context.drawImage(posterFrameTop, 0, 0);

                    posterFrame.style.display = "block";
                    posterFrame.style.transition = "filter .4s ease";
                    posterFrame.style.filter = "none";

                } catch (error) {}

                posterFrameTop.style.opacity = "0";
                posterFrameTop.style.filter = "none";

            }, 520);

            return true;

        } catch (error) {

            return false;

        }

    }

    /*
     * Put the frame the element is showing right now on the overlay with
     * no blend. Used when a seek starts: the overlay should show where the
     * user left off, not whatever frame the last seek captured minutes ago.
     */
    function captureFrameNow() {

        try {

            if (!drawFrameInto(posterFrame))
                return false;

            posterFrame.style.transition = "none";
            posterFrame.style.filter = "none";

            posterFrameTop.style.transition = "none";
            posterFrameTop.style.opacity = "0";
            posterFrameTop.style.filter = "none";

            return true;

        } catch (error) {

            return false;

        }

    }

    /*
     * Show the last displayed frame, copied from the rolling snapshot.
     * Falls back to a live capture if no snapshot exists yet.
     */
    function showLastFrame() {

        try {

            if (!posterFrameLast.width || !posterFrameLast.height)
                return captureFrameNow();

            posterFrame.width = posterFrameLast.width;
            posterFrame.height = posterFrameLast.height;

            const context =
                posterFrame.getContext("2d");

            context.clearRect(
                0,
                0,
                posterFrame.width,
                posterFrame.height
            );

            context.drawImage(posterFrameLast, 0, 0);

            posterFrame.style.display = "block";
            posterFrame.style.filter = "none";

            posterFrameTop.style.opacity = "0";

            return true;

        } catch (error) {

            return captureFrameNow();

        }

    }


    const addURL = url => {

        if (url && !urls.includes(url))
            urls.push(url);

    };

    let downloadedFullURL = null;

    if (videoDownloadPromise)
        downloadedFullURL = await videoDownloadPromise;

    if (downloadedFullURL) {

        addURL(downloadedFullURL);

    } else {

        for (const candidate of getImageProviderCandidates(album, item.image, "full"))
            addURL(candidate.url);

    }

    /*
     * A split original: the worker serves the whole file from any
     * part's link, so the other parts are valid fallbacks too.
     */
    const chatKey =
        item.image?.[0]?.full?.key1;

    if (chatKey != null && Array.isArray(item.image.parts)) {

        for (const partID of item.image.parts) {

            addURL(resolveProviderUrl(
                "telegram",
                { key1: String(chatKey), key2: String(partID) }
            ));

        }

    }

    for (const candidate of getImageProviderCandidates(album, item.image, "medium"))
        addURL(candidate.url);

    /* Warm the Worker's memory with this video's opening seconds. */
    if (urls.length)
        prefetchVideoUrl(urls[0]);

    const video =
        document.createElement("video");

    video.id = "modalVideo";
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";

    /*
     * Firefox blocks audible playback that starts without a gesture, and
     * every play() here happens after an await (prefetch, buffer hold) --
     * so the video simply sat ready and never started until the user
     * clicked somewhere. Starting muted is allowed, and the click that
     * opened the modal gives the document user activation, so the first
     * frame can unmute itself.
     */
    video.muted = true;

    Object.assign(video.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        objectFit: "contain",
        background: "#000",
        zIndex: "6",
        /*
         * Hidden until the overlay lifts: the native player must never be
         * visible (controls, spinner and all) before the first frame is
         * ready to play.
         */
        opacity: "0",
        transition: "opacity .18s ease"
    });

    /*
     * The modal's pan/zoom/swipe/click-to-close handlers listen on
     * #modal and the document; keep them from seeing interactions with
     * the video's own controls.
     */
    for (const type of [
        "pointerdown", "pointerup", "pointermove", "pointercancel",
        "wheel", "touchstart", "touchmove", "touchend", "click"
    ]) {

        video.addEventListener(
            type,
            e => e.stopPropagation(),
            { passive: true }
        );

    }

    let index = 0;

    /* The URL the player currently has, for seek-time prefetches. */
    let currentVideoUrl = null;

    /*
     * Startup timing, visible in the console as "[video] <ms> <step>".
     * The interesting number is how long the first frames take once the
     * modal opens: the Worker answers the first byte in ~1.2 s and feeds
     * ~1.8 MB/s, so anything past a couple of seconds is either a cold
     * Durable Object or one of the player's own stalls.
     */
    const openStartedAt =
        performance.now();

    /*
     * Firefox is the browser that actually watches these videos, and its
     * media buffering differs enough from Chromium that measurements
     * taken there were misleading. Report the timeline to the Worker so
     * /api/diag can show it.
     */
    const timingReport = [];

    let timingOrigin = null;
    let timingsSent = 0;

    const flushTimings = () => {

        if (timingsSent >= 5 || !timingOrigin || timingReport.length === 0)
            return;

        timingsSent++;

        try {

            fetch(timingOrigin + "/api/client-timing" + workerAuthQuerySuffix(), {
                method: "POST",
                mode: "no-cors",
                keepalive: true,
                body: JSON.stringify({
                    ua: navigator.userAgent.slice(0, 140),
                    part: timingsSent,
                    events: timingReport.slice(0, 80)
                })
            }).catch(() => {});

        } catch {}

    };

    const logTiming = (name, extra) => {

        const ms =
            Math.round(performance.now() - openStartedAt);

        console.debug(
            "[video]",
            ms + "ms",
            name,
            extra ?? ""
        );

        timingReport.push(
            ms + "ms " + name + (extra ? " " + extra : "")
        );

        if (name === "playing")
            setTimeout(flushTimings, 6000);

        if (name === "error")
            flushTimings();

    };

    const tryNext = () => {

        if (index >= urls.length) {

            const message =
                document.createElement("div");

            message.id = "modalVideoError";
            message.textContent = "This video couldn't be loaded.";

            Object.assign(message.style, {
                position: "absolute",
                zIndex: "7",
                color: "#fff"
            });

            container.appendChild(message);

            return;

        }

        /*
         * A unique query per playback. Browsers keep media they have
         * already read keyed by URL, and an entry left over from an
         * interrupted stream is a truncated file: Firefox reported
         * "62.9 s buffered, file is 62.9 s long" before downloading
         * anything, then failed and fell through to the preview clip.
         * A fresh URL cannot match a stale entry.
         */
        let next =
            urls[index++];

        if (!next.startsWith("blob:")) {

            try {

                const unique =
                    new URL(next);

                unique.searchParams.set(
                    "v",
                    String(Date.now())
                );

                next = unique.toString();

            } catch {}

        }

        /*
         * warmMediaRangeSupport() must finish before the element
         * requests the URL, otherwise Chrome loads a non-seekable
         * stream. The HEAD costs one cheap round trip and only the
         * metadata of the message is touched.
         */
        warmMediaRangeSupport(next).then(() => {

            if (!video.isConnected)
                return;

            try {

                timingOrigin = next.startsWith("blob:")
                    ? null
                    : new URL(next).origin;

            } catch {

                timingOrigin = null;

            }

            logTiming("warmed", next.slice(-60));

            /*
             * Make sure the opening seconds are in the Worker's memory
             * before the player asks for anything; the gallery's loading
             * bar covers the wait.
             */

            prepareVideoStart(next).finally(() => {

                if (!video.isConnected)
                    return;

                currentVideoUrl = next;

                if (!primaryVideoUrl)
                    primaryVideoUrl = next;

                video.src = next;

                posterBeginBuffering();

                logTiming("src set");

                const started =
                    video.play();

                if (started && started.catch) {

                    started
                        .then(() => logTiming("play started"))
                        .catch(error => logTiming("play rejected", error.name));

                }

            });

        });

    };

    let recovering = false;
    let recoveries = 0;
    let lastRecoveryAt = 0;

    /*
     * The best-quality URL this modal ever used. Recovery must come back
     * to *this*, not to `currentVideoUrl`: after a failure `tryNext()` may
     * have walked down the candidate list as far as the 30 s preview
     * clip, and "recovering" into that is how the player ended up showing
     * the preview instead of the film.
     */
    let primaryVideoUrl = null;

    video.addEventListener("error", () => {

        if (!hasStartedPlaying) {

            /*
             * Before playback: fall through to the next candidate URL.
             */
            tryNext();

            return;

        }

        const code =
            video.error?.code;

        logTiming(
            "media error",
            "code=" + (code ?? "?") +
            " t=" + video.currentTime.toFixed(1)
        );

        /*
         * MEDIA_ERR_DECODE mid-playback: the range the player is reading
         * is inconsistent. Reload the same source under a fresh URL and
         * resume from the same position -- behind the overlay, so the
         * restart is not visible. At most two attempts, twenty seconds
         * apart: if the data is bad the same way twice, another reload
         * would just loop.
         */
        if (
            (code !== 3 && code !== 4) ||
            recovering ||
            recoveries >= 2 ||
            Date.now() - lastRecoveryAt < 20000
        ) {

            return;

        }

        if (!primaryVideoUrl)
            return;

        recovering = true;
        recoveries++;
        lastRecoveryAt = Date.now();

        const at =
            video.currentTime;

        logTiming("recover", "t=" + at.toFixed(1) + " attempt=" + recoveries);

        /* Cover the reload with the frame that was on screen. */
        showLastFrame();
        showPoster(2, "buffer");

        try {

            const retry =
                new URL(primaryVideoUrl);

            retry.searchParams.set(
                "v",
                String(Date.now())
            );

            const nextUrl =
                retry.toString();

            video.addEventListener(
                "loadeddata",
                () => {

                    suppressNextSeek = true;

                    try {
                        video.currentTime = at;
                    } catch {}

                    const played =
                        video.play();

                    if (played && played.catch)
                        played.catch(() => {});

                },
                { once: true }
            );

            /* Keep the overlay up until the picture is actually back. */
            video.addEventListener(
                "playing",
                () => {

                    hidePoster();
                    video.style.opacity = "1";
                    video.muted = false;

                    setTimeout(() => {

                        recovering = false;

                    }, 1500);

                },
                { once: true }
            );

            currentVideoUrl = nextUrl;
            video.src = nextUrl;

        } catch {

            recovering = false;
            hidePoster();

        }

    });

    /*
     * A seek into a part of the file that is not buffered yet travels
     * to Telegram as its own range request. If that request fails,
     * Chrome abandons the seek and snaps the playhead back to whatever
     * was already buffered. Retry such a seek once, half a second
     * later, so a single hiccup costs a beat instead of the jump.
     */
    let requestedSeek = null;
    let seekRetryTimer = null;
    let lastSeekAt = 0;

    video.addEventListener("seeking", () => {

        requestedSeek = video.currentTime;
        lastSeekAt = Date.now();

    });

    video.addEventListener("seeked", () => {

        if (requestedSeek === null)
            return;

        const target = requestedSeek;
        requestedSeek = null;

        if (Math.abs(video.currentTime - target) < 0.75)
            return;

        clearTimeout(seekRetryTimer);
        seekRetryTimer = setTimeout(() => {

            if (video.isConnected)
                video.currentTime = target;

        }, 500);

    });

    /*
     * Wait for a little buffer before playing, both on the first start
     * and after every seek.
     *
     * The Worker hands over one ~1 MiB chunk per 300 ms, which is more
     * than the video consumes but not enough for a player that starts
     * drawing on the first frames: it eats its 0.6 s of buffer and then
     * stalls, re-requests, and stalls again (Firefox does this badly).
     * Pausing while the buffer fills costs the same seconds once, up
     * front, and then playback never stalls.
     */
    let primedInitialBuffer = false;

    function bufferedAheadAt(time) {

        const ranges =
            video.buffered;

        for (let i = 0; i < ranges.length; i++) {

            if (
                time >= ranges.start(i) - 0.25 &&
                time <= ranges.end(i)
            ) {

                return ranges.end(i) - time;

            }

        }

        return 0;

    }

    function bufferedAhead() {

        return bufferedAheadAt(
            video.currentTime
        );

    }

    /*
     * Only gate real seeks. The initial load also fires seeking/seeked,
     * and pausing there is what made the video look frozen before it had
     * ever played.
     */
    let hasStartedPlaying = false;

    let bufferHoldStartedAt = 0;
    let autoResumePending = false;
    let lastPauseAt = 0;

    /*
     * The element keeps playing (muted) under the overlay, because Firefox
     * stops downloading for a paused one -- but that means it also moves
     * on while the user is waiting. Rewinding to this position when the
     * overlay lifts is what makes the video start where it should.
     */
    let holdStartPosition = 0;
    let suppressNextSeek = false;
    let lastReleaseAt = 0;

    /*
     * Buffer growth while the overlay is up, used by the timeout: as long
     * as bytes keep arriving the overlay should keep waiting, even past
     * the nominal timeout. Only a stream that has stopped moving gives up.
     */
    let holdAhead = 0;
    let holdProgressAt = 0;

    /*
     * Last time the element actually entered the `playing` state. A stall
     * hold can only trust that event: `video.buffered` keeps claiming
     * seconds of data long after the element has stopped being able to
     * use them (a stuck seek pipeline, a decoder that has not caught up),
     * so releasing on buffer alone uncovered a frozen picture.
     */
    let holdPlayingAt = 0;

    /*
     * Decoded video frames, used to spot a picture that stopped while the
     * audio kept going. `readyState` and `buffered` both stay healthy in
     * that case, so no element event fires at all.
     */
    function videoFrameCount() {

        try {

            const quality =
                video.getVideoPlaybackQuality?.();

            if (
                quality &&
                typeof quality.totalVideoFrames === "number"
            ) {
                return quality.totalVideoFrames;
            }

        } catch {}

        return -1;

    }

    let holdFrameBase = 0;

    /*
     * Milliseconds left on Telegram's premium flood gate, as last reported
     * by the Worker. A hold waits this out instead of releasing into a
     * player that is about to stall again.
     */
    let floodMs = 0;
    let floodCheckedAt = 0;
    let holdTickBusy = false;

    async function refreshFloodState() {

        if (!timingOrigin)
            return;

        floodCheckedAt = Date.now();

        try {

            const response =
                await fetch(timingOrigin + "/api/flood-state" + workerAuthQuerySuffix(), {
                    mode: "cors",
                    cache: "no-store"
                });

            if (!response.ok)
                return;

            const data =
                await response.json();

            floodMs =
                Math.max(0, Number(data?.msRemaining) || 0);

            if (floodMs > 500)
                logTiming("flood active", "ms=" + Math.round(floodMs));

        } catch {}

    }

    /*
     * False between a seek starting and the browser reporting `seeked`
     * with decodable data: the seek overlay must not lift before the
     * frame it shows is actually there, or the native spinner appears
     * underneath.
     */
    let seekFrameReady = true;

    /* `seeked` fired; the frame may still not be drawable yet. */
    let seekCompleted = true;

    function stopBufferHold() {

        if (video._seekBufferTimer) {

            clearInterval(video._seekBufferTimer);
            video._seekBufferTimer = null;

        }

    }

    function startBufferHold(target, timeoutMs, minMs = 260, resume = true, waitForFrame = false, mute = false, requirePlaying = false, frameGate = false) {

        stopBufferHold();

        bufferHoldStartedAt =
            Date.now();

        showPoster(target, "buffer");

        /* Ask straight away whether a flood is already running. */
        floodCheckedAt = 0;
        refreshFloodState();

        /*
         * Where playback should resume when the overlay lifts. The
         * element plays on under the overlay (to keep the download
         * alive), so without this the video would start the hold's
         * duration into itself.
         */
        holdStartPosition =
            Number.isFinite(video.currentTime)
                ? video.currentTime
                : 0;

        /*
         * Progress tracking for the timeout: the overlay should keep
         * waiting while the buffer is still growing, and only give up
         * after the stream has stopped making progress.
         */
        holdAhead = 0;
        holdProgressAt = Date.now();
        holdFrameBase = videoFrameCount();

        /*
         * Do NOT pause. Firefox stops downloading for a paused element,
         * so waiting for a buffer while paused could never finish -- that
         * is what left the overlay stuck at 40%. The element keeps
         * playing (silently: it is muted while the overlay is up), which
         * both fills the buffer and means there is nothing left to wait
         * for when the overlay lifts.
         */
        if (mute)
            video.muted = true;

        video._seekBufferTimer = setInterval(async () => {

            /*
             * The tick now awaits the flood probe, so guard against
             * overlapping ticks (a probe can take longer than the 200 ms
             * interval).
             */
            if (holdTickBusy)
                return;

            holdTickBusy = true;

            try {

            if (!video.isConnected) {

                stopBufferHold();
                hidePoster();
                return;

            }

            /*
             * The frame can lag `seeked` by a tick or two (Firefox emits
             * it before the first frame is drawable), so retry here until
             * it lands instead of giving up on the first attempt.
             */
            if (
                waitForFrame &&
                seekCompleted &&
                !seekFrameReady &&
                captureFrame()
            ) {

                seekFrameReady = true;

            }

            const elapsed =
                Date.now() - bufferHoldStartedAt;

            /*
             * Do NOT seek the element back to the resume position while
             * the hold runs. It was done to stop the playhead drifting
             * ahead of the buffer, but a seek cancels Firefox's
             * read-ahead: the media cache stalled at ~4 s and no request
             * was issued beyond it, no matter how long the overlay
             * waited. Letting the playhead run on keeps the download
             * moving; the buffer is measured at `holdStartPosition`, and
             * a single rewind at release returns to the right frame.
             */

            /*
             * Ask the Worker whether Telegram is still throttling. Await
             * the answer: deciding with a stale "no flood" is exactly how
             * the overlay lifted into a stuttering player.
             */
            if (Date.now() - floodCheckedAt > 1500)
                await refreshFloodState();

            /*
             * Only the buffer matters here. Whether the element is
             * momentarily starved (readyState 1) while it plays under the
             * overlay is irrelevant: the overlay does not lift until the
             * `playing` event after the rewind, so a missing frame is
             * never exposed.
             *
             * Remember the best level seen, and when it last improved,
             * for the timeout below. A download that is still moving
             * must not be timed out just because it is slow -- a single
             * 1 MiB chunk has been measured taking 2.6 s, so six seconds
             * without any progress is the first point at which the
             * stream is really stuck.
             */
            const ahead =
                bufferedAheadAt(
                    holdStartPosition
                );

            if (ahead > holdAhead + 0.1) {

                holdAhead = ahead;
                holdProgressAt = Date.now();

            }

            const ready =
                ahead >= target &&
                (
                    !requirePlaying ||
                    holdPlayingAt > bufferHoldStartedAt
                ) &&
                (
                    !frameGate ||
                    holdFrameBase < 0 ||
                    videoFrameCount() > holdFrameBase
                );

            const timedOut =
                (
                    elapsed > timeoutMs + floodMs &&
                    Date.now() - holdProgressAt > 6000
                ) ||
                elapsed > 20000;

            /*
             * Hold for a minimum time as well: a seek that needs nothing
             * should still show the overlay for a beat rather than flash
             * it for a frame.
             */
            const settled =
                elapsed >= minMs;

            /* A long flood is waited out, up to a hard cap. */
            const stalledByFlood =
                !ready &&
                floodMs > 500 &&
                elapsed < 45000;

            if (waitForFrame && !seekFrameReady && !timedOut)
                return;

            if ((!ready && !timedOut) || !settled || stalledByFlood)
                return;

            stopBufferHold();

            lastReleaseAt =
                Date.now();

            /*
             * Rewind under the overlay: the element advanced while the
             * buffer was filling, and playback has to continue from the
             * position the user chose, not from wherever the delay left
             * it.
             */
            let rewound = false;

            if (
                Number.isFinite(holdStartPosition) &&
                Math.abs(
                    video.currentTime -
                    holdStartPosition
                ) > 1
            ) {

                suppressNextSeek = true;

                try {

                    video.currentTime =
                        holdStartPosition;

                    rewound = true;

                } catch {

                    suppressNextSeek = false;

                }

            }

            logTiming("hold release", "ready=" + ready + " ahead=" + bufferedAhead().toFixed(2));

            posterFill.style.width = "100%";

            /*
             * Reveal only once the picture is actually back. Hiding the
             * overlay and then calling play() left a window where the
             * element was visible but not yet playing, so the native
             * spinner showed through the fade.
             */
            video.style.opacity = "1";

            if (mute)
                video.muted = false;

            let revealed = false;
            let revealRetry = null;

            const revealDeadline =
                Date.now() + 4000;

            /*
             * Reveal only once the picture is actually back. `playing`
             * can arrive for the playback before the rewind landed, and
             * readyState can sit at 1 or 2 for a while after a seek;
             * hiding on either uncovered a frozen frame with neither the
             * overlay nor a spinner (the "just stops, nothing" report).
             * Re-check instead, and give up only after four seconds.
             */
            const reveal = () => {

                if (revealed)
                    return;

                /* A newer hold owns the overlay now. */
                if (video._seekBufferTimer)
                    return;

                if (
                    (
                        video.seeking ||
                        video.readyState < 3 ||
                        bufferedAhead() < 1
                    ) &&
                    !video.paused &&
                    !video.ended &&
                    Date.now() < revealDeadline
                ) {

                    clearTimeout(revealRetry);
                    revealRetry = setTimeout(reveal, 200);

                    return;

                }

                revealed = true;

                hidePoster();

            };

            let playbackStarted = false;

            /*
             * Start playback only once the rewind has landed. In Firefox
             * `seeking` is still false for a moment after `currentTime`
             * is assigned and the element can emit `playing` for the
             * position being left; revealing on that showed a frame, then
             * the seek ran and the picture froze -- the "plays a second,
             * another overlay stops it" report. `seeked` is the point at
             * which the destination is current.
             */
            const startPlayback = () => {

                if (playbackStarted)
                    return;

                playbackStarted = true;

                if (!resume) {

                    reveal();
                    return;

                }

                /*
                 * Remember this play() as ours: the "play" listener would
                 * otherwise read it as the user taking over and stop the
                 * hold we just finished.
                 */
                autoResumePending = true;

                const played =
                    video.play();

                if (played && played.catch)
                    played.catch(() => {});

                video.addEventListener(
                    "playing",
                    reveal,
                    { once: true }
                );

                setTimeout(reveal, 500);

            };

            if (rewound) {

                video.addEventListener(
                    "seeked",
                    startPlayback,
                    { once: true }
                );

                /* A cancelled rewind still has to end the overlay. */
                setTimeout(startPlayback, 1200);

            } else {

                startPlayback();

            }

            } finally {

                holdTickBusy = false;

            }

        }, 200);

    }

    /*
     * Warm the Worker's memory at the seek target.
     *
     * A seek lands where nothing is cached, so the player's first range
     * request is a cold Telegram round trip (twice over, in Firefox).
     * Asking the Worker to pull 8 MiB at that byte offset while the
     * player itself is still waiting means its next request - and its
     * re-requests - are answered from memory, without pausing playback
     * and without a second progress indicator.
     */
    function prefetchSeekTarget() {

        /* Nothing can be served from the cache right now. */
        if (!PREFETCH_ENABLED)
            return;

        if (!currentVideoUrl)
            return;

        if (
            !Number.isFinite(video.duration) ||
            video.duration <= 0
        ) {

            return;

        }

        try {

            const target =
                new URL(currentVideoUrl);

            target.searchParams.set(
                "prefetch",
                "1"
            );

            target.searchParams.set(
                "time",
                video.currentTime.toFixed(2)
            );

            target.searchParams.set(
                "duration",
                video.duration.toFixed(3)
            );

            fetch(target.toString(), {
                mode: "cors",
                cache: "no-store",
                keepalive: true
            }).catch(() => {});

        } catch {}

    }

    video.addEventListener("seeking", () => {

        /* Our own rewind when a hold releases. */
        if (suppressNextSeek) {

            suppressNextSeek = false;
            return;

        }

        if (!hasStartedPlaying || video.ended)
            return;

        /*
         * Firefox pauses the element while the user drags the scrubber,
         * so a pause that just happened is a scrub, not a decision to
         * stop. Only a real pause (older than a moment) means there is
         * nothing to smooth.
         */
        const scrubPause =
            video.paused &&
            Date.now() - lastPauseAt < 500;

        if (video.paused && !scrubPause)
            return;

        /*
         * A loop wrap reports a seek to zero. Nothing to smooth there (and
         * treating it as a seek started a hold, a rewind and another loop,
         * which is the "plays the first second on repeat" bug), so ignore
         * everything near the very start.
         */
        if (video.currentTime < 0.5)
            return;

        /*
         * A seek that lands inside what the browser already has can be
         * shown immediately -- the overlay would only be in the way.
         * `readyState` is deliberately not consulted: Firefox drops it as
         * soon as the seek begins, so requiring it made this check never
         * match. The half-second margin over the hold target is what
         * protects against "buffered but not decodable".
         */
        const alreadyBuffered =
            bufferedAhead();

        if (
            alreadyBuffered >= SEEK_BUFFER_SECONDS + 0.5
        ) {

            logTiming(
                "seek skip",
                "t=" + video.currentTime.toFixed(1) +
                " ahead=" + alreadyBuffered.toFixed(2) +
                " rs=" + video.readyState
            );

            return;

        }

        /*
         * Every seek goes through the overlay, and it stays until the
         * browser reports the seek finished with decodable data, so the
         * player never shows its own spinner underneath.
         */
        seekFrameReady = false;
        seekCompleted = false;

        /* A fresh position gets a fresh recovery budget. */
        recoveries = 0;

        logTiming(
            "seek hold",
            "t=" + video.currentTime.toFixed(1) +
            " ahead=" + bufferedAhead().toFixed(2) +
            " rs=" + video.readyState +
            (scrubPause ? " scrub" : "")
        );

        prefetchSeekTarget();

        startBufferHold(
            SEEK_BUFFER_SECONDS,
            SEEK_BUFFER_TIMEOUT_MS,
            3000,
            true,
            true,
            true
        );

        /*
         * The overlay comes up showing the frame that was on screen a
         * moment ago -- the position the user is leaving -- so it never
         * shows a stale frame from an earlier seek, and never a black one
         * (Firefox blanks the element's frame as the seek starts). The
         * destination frame blends in later, when `seeked` produces it.
         */
        showLastFrame();

    });

    video.addEventListener("timeupdate", () => {

        if (video.paused || !video.videoWidth)
            return;

        /* Rolling snapshot of what the player is showing. */
        try {
            drawFrameInto(posterFrameLast);
        } catch {}

    });

    video.addEventListener("seeked", () => {

        seekCompleted = true;

        if (posterVisible && captureFrame())
            seekFrameReady = true;

    });

    /*
     * A stall outside a seek (a flood, the buffer running dry, or a seek
     * pipeline that never finishes) used to leave the native spinner or a
     * frozen frame showing until Telegram caught up. Cover it with the
     * overlay until the element is really playing again: `playing` after
     * the hold started is the only trustworthy signal, because
     * `video.buffered` keeps claiming data the element cannot use.
     */
    function beginStallHold(reason) {

        if (!video.isConnected || !hasStartedPlaying || video.ended || video.paused)
            return;

        if (video._seekBufferTimer)
            return;

        logTiming(
            "stall hold",
            reason +
            " ahead=" + bufferedAhead().toFixed(2) +
            " rs=" + video.readyState
        );

        startBufferHold(4, 12000, 800, true, false, true, true);

    }

    video.addEventListener("waiting", () => {

        if (!hasStartedPlaying || video.ended || video.paused)
            return;

        if (video._seekBufferTimer)
            return;

        /*
         * Every release rewinds a little, and so does a seek that lands
         * inside the buffer; Firefox reports both as `waiting` for a
         * moment. Treating that as a new stall started a hold, whose
         * release rewound again -- an endless overlay loop. Ignore it
         * only while there is still something to play: the watchdog
         * below re-checks shortly after, so a real stall that fires
         * inside this window is not lost.
         */
        if (
            (
                Date.now() - lastReleaseAt < 1500 ||
                Date.now() - lastSeekAt < 1500
            ) &&
            bufferedAhead() > 0.5
        )
            return;

        beginStallHold("waiting");

    });

    /*
     * The video track can stop producing pictures while the audio track
     * keeps playing. The element stays `playing` with `readyState` 4 and
     * plenty of `buffered`, so neither `waiting` nor the readyState
     * watchdog sees anything; the user gets a frozen frame and running
     * sound. Count decoded frames instead and cover the freeze.
     */
    function beginFrameStallHold(reason) {

        if (!video.isConnected || !hasStartedPlaying || video.ended || video.paused)
            return;

        if (video._seekBufferTimer)
            return;

        logTiming(
            "frame stall",
            reason +
            " t=" + video.currentTime.toFixed(1) +
            " ahead=" + bufferedAhead().toFixed(2) +
            " rs=" + video.readyState
        );

        startBufferHold(2, 8000, 600, true, false, true, false, true);

    }

    /*
     * Watchdog for the way Firefox actually fails: a seek or a starved
     * pipeline can sit at readyState 2 with no `waiting` event at all, so
     * the element shows a frozen frame and nothing else. If it cannot
     * reach HAVE_FUTURE_DATA for a second while it is supposed to be
     * playing, treat it as a stall.
     */
    let stallSince = 0;
    let lastFrameCount = -1;
    let lastFrameAt = 0;
    let lastFrameTime = 0;
    let lastFrameHoldAt = 0;

    video._stallWatch = setInterval(() => {

        if (!video.isConnected || !hasStartedPlaying || video.paused || video.ended || document.hidden) {

            stallSince = 0;
            lastFrameCount = -1;
            return;

        }

        if (video._seekBufferTimer || posterVisible) {

            stallSince = 0;
            lastFrameCount = -1;
            return;

        }

        if (video.readyState < 3) {

            lastFrameCount = -1;

            if (!stallSince) {

                stallSince = Date.now();
                return;

            }

            if (Date.now() - stallSince < 900)
                return;

            stallSince = 0;

            beginStallHold("watch");
            return;

        }

        stallSince = 0;

        const frames =
            videoFrameCount();

        /*
         * A counter of 0 means "not reporting" (a cross-origin element
         * before the first frame, or a browser without the API). Do not
         * read that as a frozen picture.
         */
        if (frames <= 0) {

            lastFrameCount = -1;
            return;

        }

        if (frames !== lastFrameCount) {

            lastFrameCount = frames;
            lastFrameAt = Date.now();
            lastFrameTime = video.currentTime;
            return;

        }

        if (
            video.currentTime - lastFrameTime < 0.25 ||
            Date.now() - lastFrameAt < 1200 ||
            Date.now() - lastFrameHoldAt < 5000
        )
            return;

        lastFrameHoldAt = Date.now();

        beginFrameStallHold("watch");

    }, 500);

    /*
     * Fill a little buffer before the very first play. Without this the
     * player starts on the first frames it can decode and immediately
     * runs dry -- the "freezes for a while on initial load" report.
     */
    function primeInitialBuffer() {

        if (primedInitialBuffer)
            return;

        primedInitialBuffer = true;

        if (video.currentTime > 0.2) {

            logTiming("prime skip", "seeked");
            return;

        }

        if (bufferedAhead() >= START_BUFFER_SECONDS) {

            logTiming("prime skip", "ahead=" + bufferedAhead().toFixed(1));

            if (posterVisible) {

                hidePoster();
                video.muted = false;

            }

            return;

        }

        logTiming("prime hold", "ahead=" + bufferedAhead().toFixed(2));

        /*
         * The hold keeps the element playing (muted), because Firefox
         * stops downloading for a paused one. If autoplay has not started
         * yet, start it now -- muted playback needs no gesture.
         */
        if (video.paused) {

            const played =
                video.play();

            if (played && played.catch)
                played.catch(() => {});

        }

        startBufferHold(
            START_BUFFER_SECONDS,
            START_BUFFER_TIMEOUT_MS,
            5000,
            true,
            false,
            true
        );

    }

    video.addEventListener("canplay", primeInitialBuffer);


    for (const ev of [
        "loadedmetadata", "loadeddata", "canplay", "playing",
        "waiting", "stalled", "suspend", "error"
    ]) {

        video.addEventListener(ev, () => {

            if (ev === "error" && posterVisible && !recovering) {

                /*
                 * Unrecoverable: drop the overlay so the error message
                 * under it is visible. Recovery shows its own overlay and
                 * hides it on `playing`, so this must not tear that one
                 * down a moment after it went up.
                 */
                hidePoster();

                video.style.opacity = "1";

            }

            if (ev === "loadeddata")
                captureFrame();

            const seekable =
                video.seekable.length
                    ? video.seekable.end(video.seekable.length - 1)
                    : 0;

            logTiming(
                ev,
                "ahead=" + bufferedAhead().toFixed(2) +
                " seekable=" + seekable.toFixed(1) +
                " dur=" + (
                    Number.isFinite(video.duration)
                        ? video.duration.toFixed(1)
                        : "?"
                ) +
                (
                    ev === "error"
                        ? " code=" + (video.error?.code ?? "?") +
                          " msg=" + String(video.error?.message || "").slice(0, 60)
                        : ""
                )
            );

        });

    }

    video.addEventListener("playing", () => {

        hasStartedPlaying = true;
        holdPlayingAt = Date.now();

        /*
         * Only unmute when no overlay is up: during a hold the video is
         * deliberately silent until the first frame is ready.
         */
        if (video.muted && !posterVisible)
            video.muted = false;

        video.style.opacity = "1";

        /*
         * Safety net: if playback starts with no hold running and enough
         * buffered, the overlay has nothing left to wait for.
         */
        if (
            posterVisible &&
            !video._seekBufferTimer &&
            bufferedAhead() >= Math.max(1, posterTarget)
        ) {

            hidePoster();
            video.muted = false;

        }

    });

    video.addEventListener("pause", () => {

        lastPauseAt = Date.now();

    });

    video.addEventListener("play", () => {

        if (autoResumePending) {

            autoResumePending = false;
            return;

        }

        /*
         * Firefox resumes playback by itself after a seek. That is not
         * the user taking over, and treating it as such is what hid the
         * overlay a moment after a seek and exposed the native spinner.
         */
        if (video._seekBufferTimer)
            return;

        /*
         * The player autoplays muted under the overlay while it buffers.
         * That `play` is ours: hiding the poster for it exposed the
         * native spinner for the whole time before `canplay` armed the
         * first hold.
         */
        if (posterVisible)
            return;

        /* The user took over; do not fight them. */
        stopBufferHold();
        hidePoster();

    });


    container.appendChild(video);

    tryNext();

    const close =
        document.createElement("button");

    close.id = "modalVideoClose";
    close.type = "button";
    close.textContent = "✕";

    Object.assign(close.style, {
        position: "absolute",
        top: "15px",
        right: "15px",
        zIndex: "7",
        width: "36px",
        height: "36px",
        padding: "0",
        border: "none",
        borderRadius: "50%",
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        fontSize: "18px"
    });

    close.onclick =
        e => {

            e.stopPropagation();

            closeModal();

        };

    ["pointerdown", "pointerup", "touchstart", "touchend"].forEach(type => {

        close.addEventListener(type, e => e.stopPropagation(), { passive: true });

    });

    modal.appendChild(close);

    const played = video.play();

    if (played && played.catch)
        played.catch(() => {});

}


/* Escape closes the video viewer (the image viewer has no such key). */
document.addEventListener("keydown", e => {

    if (e.key === "Escape" && document.getElementById("modalVideo"))
        closeModal();

});


/* Clicking the dark area around the video closes it. */
document.getElementById("modal").addEventListener("click", e => {

    const modal = e.currentTarget;

    if (
        document.getElementById("modalVideo") &&
        (
            e.target === modal ||
            e.target === document.getElementById("modalImageContainer")
        )
    ) {

        closeModal();

    }

});
