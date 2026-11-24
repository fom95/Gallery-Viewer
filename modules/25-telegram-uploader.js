/*
 * 25-telegram-uploader.js
 *
 * The Telegram folder uploader, opened from the settings menu
 * (24-settings.js). Everything lives inside openTelegramUploader()
 * so its helpers (md5, findXMP, parseXMP, ...) never collide with the
 * site's own globals of the same name (see 16-xmp-metadata.js).
 *
 * Uploads, in order:
 *   quick videos -> quick images -> video documents -> image documents
 *   -> metadata.json
 *
 * metadata.json is deliberately the LAST message of the upload. It can
 * then reference real, already-created message IDs instead of reserved
 * placeholders, and an edit is simply "append the new media, then send
 * a new manifest": the newest manifest describes the current album.
 *
 * Placeholders are paced rather than sent in one burst, and media
 * uploads begin as soon as each placeholder exists. If a run stops on
 * an error or a long flood wait, its progress is kept and the UI can
 * continue from the failed item without recreating earlier messages.
 *
 * The manifest (version 3) is built so the site never has to read XMP
 * out of image bytes again:
 *
 *   {
 *     version: 3,
 *     generated: ISO date,
 *     chat: { id, title },
 *     metadataMessage: <message id of this json>,
 *     messageIndex: [ { id, role, media, part?, of? } ],
 *                                       // every message in the upload:
 *                                       // role is "metadata", "quick" or
 *                                       // "original"; media is the media
 *                                       // id it belongs to; part/of mark
 *                                       // the pieces of a split original.
 *     tags: ["Beach", "Dog", ...],      // album-level tag list, sorted,
 *                                       // original casing, unique
 *                                       // case-insensitively. Same role
 *                                       // as album.tags on the site.
 *     media: [ {
 *       id, kind, file, path, mime, size, modified,
 *       width, height, duration?,
 *       tags: [0, 3],                   // INDICES into the tags array
 *                                       // above -- same shape as
 *                                       // album.images[n].tags
 *       faces, regionDimensions,
 *       hidden: false,                  // editable
 *       messageId,                      // the message the site should
 *                                       // use as key2 (quick message,
 *                                       // else first original)
 *       messages: { quick, original: [] } // original = every part's
 *                                       // message id, in part order
 *       split: null | {                 // set when the original was split
 *         parts, partSize,              // into pieces under 2 GB
 *         items: [ { message, part, of, name, size, offset } ]
 *       }
 *     } ],
 *     order: [ids in display order]     // editable
 *   }
 */

async function openTelegramUploader() {

    if (!window.telegramClient) {

        try {

            await initTelegramFromConfig();

        } catch {}

    }

    if (!window.telegramClient)
        return void alert(
            "Telegram is not connected. Add Telegram credentials " +
            "(app_id / app_hash) in Site Configuration first."
        );

    const e = window.telegramClient;
    const NEW_CHANNEL_OPTION_VALUE = "__tgu_new_channel__";
    const CHUNK_SIZE = 524288;
    // Anything bigger than this is split into consecutive documents, each
    // just under Telegram's 2 GB file limit (and under its 4000-part cap
    // at 512 KB per part).
    const MAX_PART_SIZE = 2e9;

    // Source files at least this big are handed to FFmpeg through a
    // lazily-read WORKERFS mount instead of being copied into memory.
    const WORKERFS_THRESHOLD = 192 * 1024 * 1024;

    // If the mount fails, files up to this size are retried in memory.
    const MEMFS_FALLBACK_MAX = 1024 * 1024 * 1024;

    // Telegram's photo interface is intended for photos up to 10 MB.
    // Keep quick photos at or below that size and cap their longest
    // dimension at 1000 px.
    const QUICK_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
    const QUICK_PHOTO_MAX_DIMENSION = 1000;

    // A 30-second quick-video clip must have at least 30 seconds of
    // source video before it and 30 seconds after it. Therefore videos
    // shorter than 90 seconds are uploaded unchanged.
    const QUICK_VIDEO_DURATION = 30;
    const QUICK_VIDEO_EDGE_MARGIN = 30;

    const FFMPEG_WORKER_SOURCE_URL =
        "https://cdn.jsdelivr.net/npm/ffmpeg.js@4.2.9003/ffmpeg-worker-mp4.js";

    const IMAGE_EXT_RE =
        /\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|avif|heic|heif)$/i;
    const VIDEO_EXT_RE =
        /\.(mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpeg|mpg|3gp|ts|m2ts)$/i;

    const MIME_BY_EXT = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
        tif: "image/tiff", tiff: "image/tiff", avif: "image/avif",
        heic: "image/heic", heif: "image/heif",
        mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
        mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo",
        wmv: "video/x-ms-wmv", flv: "video/x-flv", mpeg: "video/mpeg",
        mpg: "video/mpeg", "3gp": "video/3gpp", ts: "video/mp2t",
        m2ts: "video/mp2t"
    };

    /*
     * Channel settings panel state. The fields themselves are built below
     * (after the uploader DOM exists); the draft keeps unsaved new-channel
     * values when switching to an existing chat and back.
     */
    const CHANNEL_SETTINGS_DEFAULT = {
        type: "channel",
        title: "",
        description: "",
        privacy: "private",
        username: "",
        approve: true,
        protect: false,
        signatures: false,
        slowMode: 0,
        topics: false
    };

    let settingsMode = "none";
    let loadedChatSettings = null;
    let settingsLoadToken = 0;
    let newChannelDraft = { ...CHANNEL_SETTINGS_DEFAULT };
    let autoChannelTitle = "";
    let settingsFields = null;

    /* ------------------------------------------------------------------ */
    /* Cancellation state (declared early so every helper can use it)      */
    /* ------------------------------------------------------------------ */

    let uploadCancelRequested = false;
    let uploadFailed = false;
    let uploadSessionActive = false;

    /*
     * Telegram's per-chat guidance is roughly one message per second.
     * Start there (scheduling start-to-start, so the request time is
     * included), and only slow down if Telegram actually reports a
     * flood wait. A long clean streak retries a 100 ms reduction.
     */
    const PLACEHOLDER_CREATE_DELAY_MS = 1000;
    const PLACEHOLDER_MAX_DELAY_MS = 3000;
    const PLACEHOLDER_ADAPT_AFTER_CLEAN = 50;
    const PLACEHOLDER_MAX_FLOOD_RETRIES = 3;
    const UPLOAD_MAX_FLOOD_RETRIES = 2;
    const MAX_AUTO_FLOOD_WAIT_SECONDS = 120;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForFloodSeconds(seconds) {

        const end =
            Date.now() +
            Math.max(0, seconds) * 1000 +
            500;

        while (Date.now() < end) {

            throwIfUploadCancelled();

            await sleep(
                Math.min(
                    1000,
                    end - Date.now()
                )
            );

        }

    }

    function parseFloodWaitSeconds(error) {

        if (!error)
            return 0;

        for (const value of [
            error.seconds,
            error.secondsWait,
            error.wait,
            error.value
        ]) {

            const seconds = Number(value);

            if (
                Number.isFinite(seconds) &&
                seconds > 0 &&
                seconds < 24 * 60 * 60
            ) {
                return seconds;
            }

        }

        const text =
            String(
                error.message ||
                error.errorMessage ||
                error
            );

        let match =
            text.match(
                /FLOOD[_\s-]*WAIT[^\d]*(\d+)/i
            );

        if (!match) {
            match = text.match(
                /wait (?:of )?(\d+) seconds?/i
            );
        }

        if (!match) {
            match = text.match(
                /(?:retry|try) (?:again )?in (\d+)/i
            );
        }

        const seconds =
            Number(match?.[1]);

        return (
            Number.isFinite(seconds) &&
            seconds > 0 &&
            seconds < 24 * 60 * 60
        )
            ? seconds
            : 0;

    }
    const activeQuickVideoCancels = new Set();

    class UploadCancelledError extends Error {
        constructor(message = "Upload cancelled by user.") {
            super(message);
            this.name = "UploadCancelledError";
            this.cancelled = true;
        }
    }

    function throwIfUploadCancelled() {
        // Also stops sibling uploads as soon as one item has failed.
        if (uploadCancelRequested || uploadFailed)
            throw new UploadCancelledError();
    }

    /* ------------------------------------------------------------------ */
    /* Utilities                                                           */
    /* ------------------------------------------------------------------ */

    function md5(bytes) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const len = data.length;
        const total = 64 * (((len + 8) >>> 6) + 1);
        const buffer = new Uint8Array(total);

        buffer.set(data);
        buffer[len] = 128;

        const view = new DataView(buffer.buffer);
        view.setUint32(total - 8, 8 * len, true);

        let a = 1732584193;
        let b = 4023233417;
        let c = 2562383102;
        let d = 271733878;

        const k = Array.from(
            { length: 64 },
            (_, i) => Math.floor(4294967296 * Math.abs(Math.sin(i + 1))) >>> 0
        );

        const shifts = [
            7, 12, 17, 22,
            5, 9, 14, 20,
            4, 11, 16, 23,
            6, 10, 15, 21
        ];

        for (let offset = 0; offset < total; offset += 64) {
            let aa = a;
            let bb = b;
            let cc = c;
            let dd = d;

            const m = new Array(16);

            for (let i = 0; i < 16; i++)
                m[i] = view.getUint32(offset + 4 * i, true);

            for (let i = 0; i < 64; i++) {
                let f, g, shift;

                if (i < 16) {
                    f = bb & cc | ~bb & dd;
                    g = i;
                    shift = shifts[3 & i];
                } else if (i < 32) {
                    f = dd & bb | ~dd & cc;
                    g = (5 * i + 1) & 15;
                    shift = shifts[4 + (3 & i)];
                } else if (i < 48) {
                    f = bb ^ cc ^ dd;
                    g = (3 * i + 5) & 15;
                    shift = shifts[8 + (3 & i)];
                } else {
                    f = cc ^ (bb | ~dd);
                    g = (7 * i) & 15;
                    shift = shifts[12 + (3 & i)];
                }

                const value = (aa + f + k[i] + m[g]) >>> 0;

                aa = dd;
                dd = cc;
                cc = bb;
                bb = (bb + ((value << shift) | (value >>> (32 - shift)))) >>> 0;
            }

            a = (a + aa) >>> 0;
            b = (b + bb) >>> 0;
            c = (c + cc) >>> 0;
            d = (d + dd) >>> 0;
        }

        let result = "";

        for (const value of [a, b, c, d])
            for (let i = 0; i < 4; i++)
                result += ((value >>> (8 * i)) & 255).toString(16).padStart(2, "0");

        return result;
    }

    /*
     * mtcute serialises 64-bit integers by reading `.low` and `.high`
     * (see TlBinaryWriter#long), so a plain BigInt is written as zero.
     * That is what made Telegram answer RANDOM_ID_EMPTY for the
     * placeholder messages and would also have sent file id 0 for
     * every upload part. Return a Long-shaped object instead.
     */
    function randomId() {
        const values = new Uint32Array(2);
        crypto.getRandomValues(values);

        return {
            low: values[1] | 0,
            high: (values[0] & 0x7fffffff) | 0
        };
    }

    function isImageFile(file) {
        return /^image\//i.test(file.type) || IMAGE_EXT_RE.test(file.name);
    }

    function isVideoFile(file) {
        return /^video\//i.test(file.type) || VIDEO_EXT_RE.test(file.name);
    }

    function isSupportedMedia(file) {
        return isImageFile(file) || isVideoFile(file);
    }

    function guessMime(file) {
        if (file.type)
            return file.type;

        const ext = (file.name.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
        return MIME_BY_EXT[ext] || "application/octet-stream";
    }

    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0)
            return "";

        if (bytes < 1024)
            return `${bytes} B`;

        const units = ["KB", "MB", "GB", "TB"];
        let value = bytes / 1024;
        let unit = 0;

        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }

        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
    }

    /* ------------------------------------------------------------------ */
    /* Progress bar helpers                                                */
    /* ------------------------------------------------------------------ */

    const RENDER_COLOR = "#a855f7";
    const UPLOAD_COLOR = "#3b82f6";

    function ensureProgressElements(progress) {
        if (!progress || typeof progress !== "object")
            return false;

        if (!progress.row || !progress.row.isConnected)
            return false;

        return !!(progress.bar && progress.bar.style && progress.text);
    }

    // percent === null shows a label only (used when the clip length is
    // unknown, so a real percentage cannot be calculated).
    function setRenderingProgress(progress, percent, label = "Rendering preview…") {
        if (!ensureProgressElements(progress))
            return;

        progress.mode = "render";
        progress.bar.style.background = RENDER_COLOR;

        if (percent == null || !Number.isFinite(percent)) {
            progress.text.textContent = label;
            return;
        }

        const clamped = Math.max(0, Math.min(100, percent));

        progress.bar.style.width = `${clamped}%`;
        progress.text.textContent = `${label} ${clamped.toFixed(1)}%`;
    }

    // Switch the same bar back to the normal upload state.
    function setUploadProgressMode(progress) {
        if (!ensureProgressElements(progress))
            return;

        progress.mode = "upload";
        progress.bar.style.background = UPLOAD_COLOR;
        progress.bar.style.width = "0%";
        progress.text.textContent = "Uploading… 0.0%";
    }

    function updateProgress(progress, uploaded, total) {
        if (!ensureProgressElements(progress))
            return;

        const percent = total
            ? Math.min(100, uploaded / total * 100)
            : 0;

        if (progress.mode !== "upload") {
            progress.mode = "upload";
            progress.bar.style.background = UPLOAD_COLOR;
        }

        progress.bar.style.width = `${percent}%`;
        progress.text.textContent = `Uploading… ${percent.toFixed(1)}%`;
    }

    /* ------------------------------------------------------------------ */
    /* Telegram upload primitives                                          */
    /* ------------------------------------------------------------------ */

    async function uploadFile(file, onProgress) {
        throwIfUploadCancelled();

        const id = randomId();
        const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
        const isBig = file.size > 10485760;
        const smallChunks = [];

        for (let part = 0; part < totalParts; part++) {
            throwIfUploadCancelled();

            const start = part * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);

            const bytes = new Uint8Array(
                await file.slice(start, end).arrayBuffer()
            );

            if (isBig) {
                await e.call({
                    _: "upload.saveBigFilePart",
                    fileId: id,
                    filePart: part,
                    fileTotalParts: totalParts,
                    bytes
                });
            } else {
                smallChunks.push(bytes);

                await e.call({
                    _: "upload.saveFilePart",
                    fileId: id,
                    filePart: part,
                    bytes
                });
            }

            // A request already in flight can't be cancelled, but stop
            // before sending the next part.
            throwIfUploadCancelled();

            onProgress?.(end, file.size);
        }

        throwIfUploadCancelled();

        if (isBig) {
            return {
                _: "inputFileBig",
                id,
                parts: totalParts,
                name: file.name
            };
        }

        // Build the md5 from the chunks already read instead of reading
        // the whole file a second time.
        const whole = new Uint8Array(file.size);
        let position = 0;

        for (const chunk of smallChunks) {
            whole.set(chunk, position);
            position += chunk.length;
        }

        return {
            _: "inputFile",
            id,
            parts: totalParts,
            name: file.name,
            md5Checksum: md5(whole)
        };
    }

    async function createThumbnail(file) {
        const bitmap = await createImageBitmap(file);

        try {
            const max = 320;
            const scale = Math.min(
                1,
                max / Math.max(bitmap.width, bitmap.height)
            );

            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");

            if (!ctx)
                throw new Error("Could not create thumbnail canvas.");

            // JPEG has no alpha channel; avoid black backgrounds.
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(bitmap, 0, 0, width, height);

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    value => value
                        ? resolve(value)
                        : reject(new Error("Could not encode thumbnail.")),
                    "image/jpeg",
                    .85
                );
            });

            return new File(
                [blob],
                `${file.name}.thumb.jpg`,
                {
                    type: "image/jpeg",
                    lastModified: Date.now()
                }
            );
        } finally {
            bitmap.close();
        }
    }

    async function getImageInfo(file) {
        const bitmap = await createImageBitmap(file);

        return {
            bitmap,
            width: bitmap.width,
            height: bitmap.height
        };
    }

    async function createQuickImage(file) {
        throwIfUploadCancelled();

        const { bitmap, width, height } = await getImageInfo(file);

        try {
            const needsResize =
                Math.max(width, height) > QUICK_PHOTO_MAX_DIMENSION;

            const isJpeg =
                /^image\/jpe?g$/i.test(file.type) ||
                /\.jpe?g$/i.test(file.name);

            // Keep the original only if it is already a JPEG that meets
            // both limits. PNG/WebP/GIF/etc. are re-encoded because
            // Telegram's photo pipeline expects JPEG input.
            if (isJpeg && !needsResize && file.size <= QUICK_PHOTO_MAX_BYTES)
                return file;

            const scale = Math.min(
                1,
                QUICK_PHOTO_MAX_DIMENSION / Math.max(width, height)
            );

            const outputWidth = Math.max(1, Math.round(width * scale));
            const outputHeight = Math.max(1, Math.round(height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = outputWidth;
            canvas.height = outputHeight;

            const ctx = canvas.getContext("2d");

            if (!ctx)
                throw new Error("Could not create quick-image canvas.");

            // Transparent PNG/WebP would otherwise turn black in JPEG.
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, outputWidth, outputHeight);
            ctx.drawImage(bitmap, 0, 0, outputWidth, outputHeight);

            let quality = 0.88;
            let blob = null;

            while (quality >= 0.45) {
                blob = await new Promise((resolve, reject) => {
                    canvas.toBlob(
                        value => value
                            ? resolve(value)
                            : reject(new Error(
                                "Could not encode quick image."
                            )),
                        "image/jpeg",
                        quality
                    );
                });

                if (blob.size <= QUICK_PHOTO_MAX_BYTES)
                    break;

                quality -= 0.07;
            }

            if (!blob || blob.size > QUICK_PHOTO_MAX_BYTES) {
                throw new Error(
                    "Could not make the quick image small enough for Telegram."
                );
            }

            const baseName =
                file.name.replace(/\.[^.]+$/, "") || "image";

            return new File(
                [blob],
                `${baseName}.jpg`,
                {
                    type: "image/jpeg",
                    lastModified: Date.now()
                }
            );
        } finally {
            bitmap.close();
        }
    }

    /*
     * Decoding a video's metadata is slow, and every video is inspected
     * more than once (quick clip, poster frame, metadata.json). Cache by
     * the original File so the decode only happens once.
     */
    const videoMetadataCache = new Map();

    /* Poster frames generated for a video, keyed by the original File.
     * The quick clip and the original document both reuse the same one. */
    const videoPosterCache = new Map();

    async function getVideoMetadata(file) {
        throwIfUploadCancelled();

        const cached = videoMetadataCache.get(file);

        if (cached)
            return cached;

        const url = URL.createObjectURL(file);
        const video = document.createElement("video");

        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        try {
            await new Promise((resolve, reject) => {
                video.onloadedmetadata = resolve;
                video.onerror = () =>
                    reject(new Error(
                        `Could not read video metadata for "${file.name}".`
                    ));
            });

            const info = {
                duration: video.duration,
                width: video.videoWidth,
                height: video.videoHeight
            };

            videoMetadataCache.set(file, info);

            return info;
        } finally {
            URL.revokeObjectURL(url);
            video.remove();
        }
    }

    /*
     * Captures a still frame from a video so the original document can
     * carry a real Telegram thumbnail. Without one, the site's
     * ?thumb=1 request on a video document has nothing to return and
     * the gallery shows an empty slot until the clip is opened.
     *
     * Everything here is best-effort: an undecodable container (MKV,
     * HEVC, ...) must never abort the upload.
     */
    async function createVideoPoster(file, duration) {
        throwIfUploadCancelled();

        const url = URL.createObjectURL(file);
        const video = document.createElement("video");

        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        try {
            await new Promise((resolve, reject) => {
                if (video.readyState >= 2) {
                    resolve();
                    return;
                }

                video.onloadeddata = resolve;
                video.onerror = () =>
                    reject(new Error(
                        `Could not decode video "${file.name}" for a thumbnail.`
                    ));
            });

            throwIfUploadCancelled();

            const total =
                Number.isFinite(video.duration) && video.duration > 0
                    ? video.duration
                    : (Number.isFinite(duration) ? duration : 0);

            // A frame a little into the clip avoids the black fade-in
            // many videos start with.
            const target = total > 0
                ? Math.min(Math.max(total * 0.1, 0.1), 2)
                : 0.1;

            if (target > 0.01) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error(
                            `Timed out seeking "${file.name}".`
                        )),
                        10000
                    );

                    video.onseeked = () => {
                        clearTimeout(timer);
                        resolve();
                    };

                    video.onerror = () => {
                        clearTimeout(timer);
                        reject(new Error(
                            `Could not seek "${file.name}".`
                        ));
                    };

                    video.currentTime =
                        total > 0
                            ? Math.min(target, Math.max(0, total - 0.05))
                            : target;
                });
            }

            const sourceWidth = video.videoWidth || 0;
            const sourceHeight = video.videoHeight || 0;

            if (!sourceWidth || !sourceHeight)
                throw new Error(
                    `No video frame available for "${file.name}".`
                );

            const max = 320;
            const scale = Math.min(
                1,
                max / Math.max(sourceWidth, sourceHeight)
            );

            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");

            if (!ctx)
                throw new Error("Could not create video thumbnail canvas.");

            ctx.drawImage(video, 0, 0, width, height);

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    value => value
                        ? resolve(value)
                        : reject(new Error(
                            "Could not encode video thumbnail."
                        )),
                    "image/jpeg",
                    .85
                );
            });

            const baseName =
                file.name.replace(/\.[^.]+$/, "") || "video";

            return new File(
                [blob],
                `${baseName}.thumb.jpg`,
                {
                    type: "image/jpeg",
                    lastModified: Date.now()
                }
            );
        } finally {
            URL.revokeObjectURL(url);
            video.remove();
        }
    }

    function chooseQuickVideoStart(duration) {
        // Mirrors the preview's 85-95% selection, then clamps it so a
        // 30-second clip still has 30 seconds of source on both sides.
        const preferredStart =
            duration * (0.85 + Math.random() * 0.10);

        const minimumStart = QUICK_VIDEO_EDGE_MARGIN;
        const maximumStart =
            duration -
            QUICK_VIDEO_EDGE_MARGIN -
            QUICK_VIDEO_DURATION;

        return Math.min(
            maximumStart,
            Math.max(minimumStart, preferredStart)
        );
    }

    /* ------------------------------------------------------------------ */
    /* FFmpeg quick-video rendering                                        */
    /* ------------------------------------------------------------------ */

    // The renderer script is downloaded once and cached as a blob URL.
    // A fresh Worker is created for every render: ffmpeg.js workers are
    // not reliably re-runnable after a run finishes, and a fresh worker
    // also makes cancelling trivial (just terminate it).
    let ffmpegWorkerURLPromise = null;

    function getFFmpegWorkerURL() {
        if (!ffmpegWorkerURLPromise) {
            ffmpegWorkerURLPromise = (async () => {
                const response = await fetch(FFMPEG_WORKER_SOURCE_URL);

                if (!response.ok)
                    throw new Error(
                        `Could not load the MP4 video renderer (${response.status}).`
                    );

                return URL.createObjectURL(await response.blob());
            })().catch(error => {
                ffmpegWorkerURLPromise = null;
                throw error;
            });
        }

        return ffmpegWorkerURLPromise;
    }

    async function createFFmpegWorker() {
        const url = await getFFmpegWorkerURL();
        const worker = new Worker(url);

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(
                        "Timed out while starting the MP4 video renderer."
                    ));
                }, 60000);

                const onMessage = event => {
                    if (event.data?.type === "ready") {
                        cleanup();
                        resolve();
                    }
                };

                const onError = error => {
                    cleanup();
                    reject(
                        error.error ||
                        new Error(
                            error.message ||
                            "The MP4 video renderer failed to start."
                        )
                    );
                };

                function cleanup() {
                    clearTimeout(timeout);
                    worker.removeEventListener("message", onMessage);
                    worker.removeEventListener("error", onError);
                }

                worker.addEventListener("message", onMessage);
                worker.addEventListener("error", onError);
            });
        } catch (error) {
            worker.terminate();
            throw error;
        }

        return worker;
    }

    // Only one render at a time: each render loads the whole source file
    // into the worker's memory, and several in parallel would exhaust it.
    let renderLock = Promise.resolve();

    function withRenderLock(task) {
        const run = renderLock.then(task);
        renderLock = run.catch(() => { });
        return run;
    }

    // Matches both FFmpeg's "-progress" lines (out_time=00:00:01.234)
    // and its stderr stats (time=00:00:01.23).
    const FFMPEG_TIME_RE =
        /time=(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)/g;

    function parseFFmpegTime(text) {
        const matches = [...String(text || "").matchAll(FFMPEG_TIME_RE)];

        if (!matches.length)
            return null;

        const match = matches[matches.length - 1];

        return (
            Number(match[1]) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3])
        );
    }

    // ------------------------------------------------------------------
    // Browser-native preview rendering (WebCodecs + mp4-muxer)
    //
    // FFmpeg.js is a 32-bit build and runs out of memory on sources over
    // 2 GB (the file's own offsets no longer fit). The browser itself
    // can play such a file from a blob, so for those sources the preview
    // is captured straight from a <video> element: frames are drawn to a
    // canvas (max 720p, max 30 fps), encoded to H.264 by the browser,
    // and written into an MP4. The preview has no audio. Keep this tab
    // visible while it runs; browsers throttle video in hidden tabs.
    // ------------------------------------------------------------------

    const MP4_MUXER_URL =
        "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js";

    let mp4MuxerPromise = null;

    function loadMp4Muxer() {
        if (window.Mp4Muxer)
            return Promise.resolve(window.Mp4Muxer);

        if (!mp4MuxerPromise) {
            mp4MuxerPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");

                script.src = MP4_MUXER_URL;

                script.onload = () =>
                    window.Mp4Muxer
                        ? resolve(window.Mp4Muxer)
                        : reject(new Error("The mp4-muxer library did not initialise."));

                script.onerror = () => {
                    mp4MuxerPromise = null;
                    reject(new Error("Could not load the mp4-muxer library."));
                };

                document.head.appendChild(script);
            });
        }

        return mp4MuxerPromise;
    }

    async function renderQuickVideoWebCodecs(file, start, duration, progress) {
        if (
            typeof VideoEncoder === "undefined" ||
            typeof VideoFrame === "undefined" ||
            typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function"
        ) {
            throw new Error("This browser does not support WebCodecs video encoding.");
        }

        return withRenderLock(async () => {
            throwIfUploadCancelled();

            const clipLength =
                Number.isFinite(duration) && duration > 0
                    ? duration
                    : QUICK_VIDEO_DURATION;

            setRenderingProgress(progress, 0, "Rendering preview (browser)…");

            const Mp4Muxer = await loadMp4Muxer();

            const url = URL.createObjectURL(file);
            const video = document.createElement("video");

            video.muted = true;
            video.playsInline = true;
            video.preload = "auto";
            video.src = url;

            let encoder = null;
            let cancelNow = null;
            let watchdog = null;

            try {
                await new Promise((resolve, reject) => {
                    video.onloadedmetadata = resolve;
                    video.onerror = () =>
                        reject(new Error("The browser could not open this video."));
                });

                const scaleDown =
                    video.videoHeight > 720 ? 720 / video.videoHeight : 1;

                const width =
                    Math.max(2, Math.round(video.videoWidth * scaleDown) & ~1);

                const height =
                    Math.max(2, Math.round(video.videoHeight * scaleDown) & ~1);

                let config = null;

                for (const codec of ["avc1.42001f", "avc1.4d001f", "avc1.64001f"]) {
                    const candidate = {
                        codec,
                        width,
                        height,
                        bitrate: 1_500_000,
                        framerate: 30,
                        avc: { format: "avc" }
                    };

                    try {
                        const support = await VideoEncoder.isConfigSupported(candidate);

                        if (support?.supported) {
                            config = candidate;
                            break;
                        }
                    } catch {}
                }

                if (!config)
                    throw new Error("This browser cannot encode H.264 video.");

                const target = new Mp4Muxer.ArrayBufferTarget();

                const muxer = new Mp4Muxer.Muxer({
                    target,
                    video: { codec: "avc", width, height },
                    fastStart: "in-memory"
                });

                let encodeError = null;

                encoder = new VideoEncoder({
                    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                    error: error => { encodeError = error; }
                });

                encoder.configure(config);

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");

                if (!ctx)
                    throw new Error("Could not create the preview canvas.");

                // Jump to the clip start.
                await new Promise((resolve, reject) => {
                    video.onseeked = resolve;
                    video.onerror = () =>
                        reject(new Error("The browser could not seek in this video."));
                    video.currentTime = start;
                });

                let frames = 0;

                await new Promise((resolve, reject) => {
                    let finished = false;
                    let firstMedia = null;
                    let lastMedia = -Infinity;
                    let lastFrameAt = Date.now();

                    const stop = (error) => {
                        if (finished)
                            return;

                        finished = true;
                        video.pause();

                        if (error)
                            reject(error);
                        else
                            resolve();
                    };

                    cancelNow = () =>
                        stop(new UploadCancelledError(
                            "Upload cancelled while generating the quick video."
                        ));

                    activeQuickVideoCancels.add(cancelNow);

                    // Reading the first frames of a huge blob can take a
                    // while, but nothing for 90 s means it is stuck.
                    watchdog = setInterval(() => {
                        if (Date.now() - lastFrameAt > 90000) {
                            stop(new Error(
                                "The browser stopped producing video frames."
                            ));
                        }
                    }, 2000);

                    const onFrame = (now, metadata) => {
                        if (finished)
                            return;

                        try {
                            throwIfUploadCancelled();

                            if (encodeError)
                                throw encodeError;

                            lastFrameAt = Date.now();

                            const mediaTime = metadata.mediaTime;

                            if (firstMedia === null)
                                firstMedia = mediaTime;

                            const elapsed = mediaTime - firstMedia;

                            setRenderingProgress(
                                progress,
                                Math.min(99, elapsed / clipLength * 100),
                                "Rendering preview (browser)…"
                            );

                            if (elapsed >= clipLength)
                                return void stop();

                            if (
                                mediaTime - lastMedia >= 1 / 30 - 0.002 &&
                                encoder.encodeQueueSize <= 8
                            ) {
                                lastMedia = mediaTime;

                                ctx.drawImage(video, 0, 0, width, height);

                                const frame = new VideoFrame(canvas, {
                                    timestamp: Math.round(elapsed * 1e6)
                                });

                                encoder.encode(frame, { keyFrame: frames % 60 === 0 });
                                frame.close();

                                frames++;
                            }

                            video.requestVideoFrameCallback(onFrame);
                        } catch (error) {
                            stop(error);
                        }
                    };

                    video.onended = () => stop();

                    video.onerror = () =>
                        stop(new Error("The browser could not play this video."));

                    video.requestVideoFrameCallback(onFrame);

                    video.playbackRate = 2;

                    video.play().catch(stop);
                });

                if (encodeError)
                    throw encodeError;

                if (!frames)
                    throw new Error("No video frames were captured.");

                await encoder.flush();
                encoder.close();
                encoder = null;

                muxer.finalize();

                setRenderingProgress(progress, 100, "Rendering preview (browser)…");

                return new File(
                    [new Blob([target.buffer], { type: "video/mp4" })],
                    `${file.name.replace(/\.[^.]+$/, "") || "video"}.quick.mp4`,
                    {
                        type: "video/mp4",
                        lastModified: Date.now()
                    }
                );
            } finally {
                clearInterval(watchdog);

                if (cancelNow)
                    activeQuickVideoCancels.delete(cancelNow);

                try {
                    if (encoder && encoder.state !== "closed")
                        encoder.close();
                } catch {}

                video.pause();
                video.removeAttribute("src");
                video.load();
                URL.revokeObjectURL(url);
            }
        });
    }

    // Large sources are read lazily through a WORKERFS mount, so the whole
    // file is never copied into memory (a single ArrayBuffer can't even
    // hold a 2 GB+ file). Only one preview is ever made per source file,
    // however many parts the original is split into.
    //
    // Big sources often carry things this FFmpeg build can't cope with
    // (unsupported audio such as AC3/DTS, bitmap subtitles, 4K frames
    // that exhaust its memory), so a failed render is retried with
    // safer settings: first as-is (downscaled only if taller than 720p),
    // then without audio and downscaled, then (for files small enough)
    // fully in memory.
    async function renderQuickVideoMP4(file, start, duration, progress, sourceHeight) {
        const mount = file.size >= WORKERFS_THRESHOLD;
        const tall = sourceHeight > 720;

        const attempts = [
            { useMount: mount, audio: true, scale: tall, label: "" },
            { useMount: mount, audio: false, scale: true, label: " (retry: no audio, 720p)" }
        ];

        if (mount && file.size <= MEMFS_FALLBACK_MAX) {
            attempts.push({
                useMount: false, audio: false, scale: true,
                label: " (retry: in memory)"
            });
        }

        const errors = [];

        // Sources over 2 GB are beyond what FFmpeg.js can address, so
        // they are rendered by the browser itself first.
        if (file.size > MAX_PART_SIZE) {
            try {
                return await renderQuickVideoWebCodecs(
                    file, start, duration, progress
                );
            } catch (error) {
                if (error?.cancelled || uploadCancelRequested || uploadFailed)
                    throw error;

                console.warn(
                    "[Telegram Folder Uploader] Browser preview render failed:",
                    error
                );

                errors.push(
                    "Browser render: " + (error?.message || String(error))
                );
            }
        }

        for (let i = 0; i < attempts.length; i++) {
            throwIfUploadCancelled();

            const attempt = attempts[i];

            if (i > 0) {
                setRenderingProgress(
                    progress,
                    0,
                    `Rendering preview${attempt.label}…`
                );
            }

            try {
                return await renderQuickVideoMP4Once(
                    file, start, duration, progress, attempt
                );
            } catch (error) {
                if (error?.cancelled || uploadCancelRequested || uploadFailed)
                    throw error;

                console.warn(
                    "[Telegram Folder Uploader] Preview render attempt failed:",
                    attempt,
                    error
                );

                errors.push(
                    `Attempt ${i + 1}${attempt.label}: ` +
                    (error?.message || String(error))
                );
            }
        }

        throw new Error(
            `Could not render the preview video for "${file.name}".\n\n` +
            errors.join("\n\n")
        );
    }

    async function renderQuickVideoMP4Once(file, start, duration, progress, opts) {
        const { useMount, audio, scale } = opts;
        return withRenderLock(async () => {
            throwIfUploadCancelled();

            const durationKnown =
                Number.isFinite(duration) && duration > 0;

            setRenderingProgress(
                progress,
                durationKnown ? 0 : null,
                "Rendering preview… starting"
            );

            const worker = await createFFmpegWorker();
            let data;

            try {
                throwIfUploadCancelled();
                data = useMount ? null : new Uint8Array(await file.arrayBuffer());
                throwIfUploadCancelled();
            } catch (error) {
                worker.terminate();
                throw error;
            }

            const inputName =
                "input" + (file.name.match(/\.[^.]+$/)?.[0] || ".bin");

            const outputName = "quick.mp4";

            const inputPath = useMount ? "/data/" + inputName : inputName;

            return await new Promise((resolve, reject) => {
                let finished = false;
                let stderr = "";
                let gotRealProgress = false;
                let ticker = null;
                const startedAt = Date.now();

                const cleanup = () => {
                    clearInterval(ticker);
                    activeQuickVideoCancels.delete(cancelRender);
                    worker.removeEventListener("message", onMessage);
                    worker.removeEventListener("error", onError);

                    try {
                        worker.terminate();
                    } catch (error) {
                        console.error(
                            "[Telegram Folder Uploader] FFmpeg worker termination failed:",
                            error
                        );
                    }
                };

                const succeed = value => {
                    if (finished)
                        return;

                    finished = true;
                    cleanup();
                    resolve(value);
                };

                const fail = error => {
                    if (finished)
                        return;

                    finished = true;
                    cleanup();

                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    reject(
                        error?.cancelled
                            ? error
                            : new Error(
                                stderr.trim()
                                    ? `${message}\n\nFFmpeg output:\n${stderr.trim().slice(-1500)}`
                                    : message
                            )
                    );
                };

                function cancelRender() {
                    fail(new UploadCancelledError(
                        "Upload cancelled while generating the quick video."
                    ));
                }

                const reportTime = text => {
                    if (!durationKnown)
                        return;

                    const seconds = parseFFmpegTime(text);

                    if (seconds == null)
                        return;

                    gotRealProgress = true;

                    setRenderingProgress(
                        progress,
                        seconds / duration * 100
                    );
                };

                function onError(event) {
                    fail(new Error(
                        event.message || "The MP4 video renderer crashed."
                    ));
                }

                function onMessage(event) {
                    const message = event.data;

                    if (!message || finished)
                        return;

                    switch (message.type) {
                        case "stdout":
                            reportTime(message.data);
                            break;

                        case "stderr": {
                            const line = String(message.data || "");

                            stderr += line + "\n";

                            if (stderr.length > 20000)
                                stderr = stderr.slice(-10000);

                            reportTime(line);
                            break;
                        }

                        case "done": {
                            const output = message.data?.MEMFS?.find(
                                entry => entry.name === outputName
                            );

                            if (!output?.data) {
                                fail(new Error(
                                    "FFmpeg finished without producing an MP4."
                                ));
                                break;
                            }

                            setRenderingProgress(progress, 100);

                            succeed(new File(
                                [new Blob([output.data], { type: "video/mp4" })],
                                `${file.name.replace(/\.[^.]+$/, "") || "video"}.quick.mp4`,
                                {
                                    type: "video/mp4",
                                    lastModified: Date.now()
                                }
                            ));
                            break;
                        }

                        case "error":
                            fail(new Error(
                                message.data ||
                                "FFmpeg failed while rendering the quick video."
                            ));
                            break;

                        case "abort":
                            fail(new Error(
                                `FFmpeg aborted: ${message.data || "unknown reason"}`
                            ));
                            break;

                        case "exit":
                            if (Number(message.data) !== 0)
                                fail(new Error(
                                    `FFmpeg exited with code ${Number(message.data)}.`
                                ));
                            break;
                    }
                }

                activeQuickVideoCancels.add(cancelRender);
                worker.addEventListener("message", onMessage);
                worker.addEventListener("error", onError);

                // If FFmpeg's stats don't reach us live, at least show that
                // the render is running and for how long.
                ticker = setInterval(() => {
                    if (gotRealProgress)
                        return;

                    const elapsed = Math.round((Date.now() - startedAt) / 1000);

                    setRenderingProgress(
                        progress,
                        null,
                        `Rendering preview… ${elapsed}s elapsed`
                    );
                }, 500);

                try {
                    throwIfUploadCancelled();

                    setRenderingProgress(
                        progress,
                        durationKnown ? 0 : null
                    );

                    worker.postMessage({
                        type: "run",
                        arguments: [
                            // -ss before -i uses fast input seeking (still
                            // frame-accurate when re-encoding).
                            "-ss", String(start),
                            "-i", inputPath,
                            ...(durationKnown ? ["-t", String(duration)] : []),

                            // Progress comes from the stderr "time=" stats.
                            "-loglevel", "info",
                            "-stats",

                            // First video + (optionally) first audio only; no subtitle or
                            // data streams (bitmap subtitles can't go into an MP4).
                            "-map", "0:v:0",
                            "-sn", "-dn",
                            ...(scale ? ["-vf", "scale=-2:720"] : []),

                            "-c:v", "libx264",
                            "-preset", "ultrafast",
                            "-threads", "1",
                            "-crf", "28",
                            "-pix_fmt", "yuv420p",

                            ...(audio
                                ? ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k"]
                                : ["-an"]),

                            "-movflags", "+faststart",
                            "-y",
                            "-f", "mp4",
                            outputName
                        ],
                        ...(useMount
                            ? {
                                mounts: [{
                                    type: "WORKERFS",
                                    opts: { blobs: [{ name: inputName, data: file }] },
                                    mountpoint: "/data"
                                }]
                            }
                            : { MEMFS: [{ name: inputName, data }] })
                    });
                } catch (error) {
                    fail(error);
                }
            });
        });
    }

    async function createQuickVideo(file, progress) {
        throwIfUploadCancelled();

        const metadata = await getVideoMetadata(file);

        const minimumClipSourceLength =
            QUICK_VIDEO_EDGE_MARGIN * 2 +
            QUICK_VIDEO_DURATION;

        const needsClip =
            Number.isFinite(metadata.duration) &&
            metadata.duration >= minimumClipSourceLength;

        // Telegram's in-chat video path expects MPEG-4/H.264. A short
        // WebM/MKV/etc. is therefore not clipped, but is normalized to
        // MP4 so it can still be an actual video message.
        const isAlreadyMP4 =
            /^video\/mp4$/i.test(file.type) ||
            /\.mp4$/i.test(file.name);

        if (!needsClip && isAlreadyMP4 && file.size < MAX_PART_SIZE) {
            return {
                file,
                duration: metadata.duration,
                width: metadata.width,
                height: metadata.height,
                sourceStart: 0
            };
        }

        const start = needsClip
            ? chooseQuickVideoStart(metadata.duration)
            : 0;

        const outputDuration = needsClip
            ? QUICK_VIDEO_DURATION
            : metadata.duration;

        // Big sources: pull out just the bytes for the wanted section
        // (27-mp4-clip.js) so nothing else has to be read or held in
        // memory, then render the preview from that small MP4. This keeps
        // the audio and works no matter how large the source is.
        let source = file;
        let sourceStart = start;

        if (
            needsClip &&
            file.size >= WORKERFS_THRESHOLD &&
            typeof extractMp4Clip === "function"
        ) {
            try {
                setRenderingProgress(
                    progress,
                    null,
                    "Extracting preview section…"
                );

                const clip = await extractMp4Clip(file, start, outputDuration);

                source = clip.file;
                sourceStart = clip.relativeStart;
            } catch (error) {
                if (error?.cancelled)
                    throw error;

                console.warn(
                    "[Telegram Folder Uploader] Section extraction failed; " +
                    "rendering from the whole file:",
                    error
                );
            }
        }

        throwIfUploadCancelled();

        let rendered;

        try {
            rendered = await renderQuickVideoMP4(
                source,
                sourceStart,
                outputDuration,
                progress,
                metadata.height
            );
        } catch (error) {
            // The small section couldn't be re-encoded (e.g. a codec
            // FFmpeg.js lacks): let the browser capture it instead.
            if (
                error?.cancelled ||
                uploadCancelRequested ||
                uploadFailed ||
                source === file
            )
                throw error;

            console.warn(
                "[Telegram Folder Uploader] Preview render failed; trying the browser renderer:",
                error
            );

            rendered = await renderQuickVideoWebCodecs(
                source,
                sourceStart,
                outputDuration,
                progress
            );
        }

        // Name it after the original file, not the temporary section.
        rendered = new File(
            [rendered],
            `${file.name.replace(/\.[^.]+$/, "") || "video"}.quick.mp4`,
            {
                type: "video/mp4",
                lastModified: Date.now()
            }
        );

        return {
            file: rendered,
            duration: outputDuration,
            width: metadata.width,
            height: metadata.height,
            sourceStart: start
        };
    }

    async function uploadQuickPhoto(peer, file, onProgress) {
        throwIfUploadCancelled();

        const quickFile = await createQuickImage(file);
        const inputFile = await uploadFile(quickFile, onProgress);

        const result = await e.call({
            _: "messages.uploadMedia",
            peer,
            media: {
                _: "inputMediaUploadedPhoto",
                file: inputFile
            }
        });

        if (!result?.photo)
            throw new Error("Telegram did not return an uploaded photo.");

        return result;
    }

    // `progress` is the progress-row object (not a callback), so the same
    // bar can show render progress first and upload progress afterwards.
    async function uploadQuickVideo(peer, file, progress) {
        throwIfUploadCancelled();

        const quick = await createQuickVideo(file, progress);

        throwIfUploadCancelled();

        /*
         * Capture one poster frame from the quick clip and reuse it for
         * the original document. The home cover asks ?thumb=1 on the
         * quick message, so it needs a thumbnail even if Telegram did
         * not generate one itself.
         */
        let poster = null;

        try {
            poster = await createVideoPoster(
                quick.file,
                quick.duration
            );

            if (poster)
                videoPosterCache.set(file, poster);
        } catch (error) {
            if (error?.cancelled)
                throw error;

            console.warn(
                "[Telegram Folder Uploader] Skipping quick-video thumbnail for",
                file.name,
                error
            );
        }

        // Rendering is done: switch the same bar back to upload mode
        // before Telegram receives any bytes.
        setUploadProgressMode(progress);

        const inputFile = await uploadFile(
            quick.file,
            (uploaded, total) => updateProgress(progress, uploaded, total)
        );

        const attributes = [
            {
                _: "documentAttributeFilename",
                fileName: quick.file.name
            },
            {
                _: "documentAttributeVideo",
                duration: Math.max(
                    1,
                    Math.round(Number.isFinite(quick.duration) ? quick.duration : 1)
                ),
                w: Math.max(1, Math.round(quick.width || 1)),
                h: Math.max(1, Math.round(quick.height || 1)),
                supportsStreaming: true
            }
        ];

        const media = {
            _: "inputMediaUploadedDocument",
            file: inputFile,
            mimeType: quick.file.type || "video/mp4",
            attributes
        };

        if (poster) {
            try {
                media.thumb = await uploadFile(poster);
            } catch (error) {
                if (error?.cancelled)
                    throw error;

                // A missing poster must not fail the video upload.
                console.warn(
                    "[Telegram Folder Uploader] Could not upload quick-video thumbnail for",
                    file.name,
                    error
                );
            }
        }

        const result = await e.call({
            _: "messages.uploadMedia",
            peer,
            media
        });

        if (!result?.document)
            throw new Error("Telegram did not return an uploaded video.");

        return result;
    }

    async function replaceMessageWithUploadedMedia(peer, messageId, uploadedMedia) {
        throwIfUploadCancelled();

        if (uploadedMedia?.photo) {
            await e.call({
                _: "messages.editMessage",
                peer,
                id: messageId,
                message: "",
                media: {
                    _: "inputMediaPhoto",
                    id: {
                        _: "inputPhoto",
                        id: uploadedMedia.photo.id,
                        accessHash: uploadedMedia.photo.accessHash,
                        fileReference: uploadedMedia.photo.fileReference
                    }
                }
            });

            return;
        }

        if (uploadedMedia?.document) {
            await e.call({
                _: "messages.editMessage",
                peer,
                id: messageId,
                message: "",
                media: {
                    _: "inputMediaDocument",
                    id: {
                        _: "inputDocument",
                        id: uploadedMedia.document.id,
                        accessHash: uploadedMedia.document.accessHash,
                        fileReference: uploadedMedia.document.fileReference
                    }
                }
            });

            return;
        }

        throw new Error(
            "Telegram returned media without a photo or document."
        );
    }

    // Uploads the original file as a document (no recompression).
    async function uploadMedia(peer, file, onProgress, options = {}) {
        throwIfUploadCancelled();

        const inputFile = await uploadFile(file, onProgress);

        throwIfUploadCancelled();

        const mime = guessMime(file);

        const attributes = [{
            _: "documentAttributeFilename",
            fileName: file.name
        }];

        let thumb = null;

        const isVideo =
            /^video\//i.test(mime) || isVideoFile(file);

        if (isVideo) {
            /*
             * Generate the poster from the complete original file, not
             * from a split part: a chunk of an MP4 usually cannot be
             * decoded, and the site asks ?thumb=1 on the first part's
             * document. Only that first part needs the poster.
             */
            const source =
                options.source || file;

            const part =
                options.part ?? 1;

            try {
                const info = await getVideoMetadata(source);

                if (part === 1) {
                    let poster =
                        videoPosterCache.get(source) || null;

                    if (!poster) {
                        poster = await createVideoPoster(
                            source,
                            info.duration
                        );

                        if (poster)
                            videoPosterCache.set(source, poster);
                    }

                    if (poster)
                        thumb = await uploadFile(poster);
                }
            } catch (error) {
                if (error?.cancelled)
                    throw error;

                console.warn(
                    "[Telegram Folder Uploader] Skipping video thumbnail for",
                    file.name,
                    error
                );
            }
        }
        // Image dimensions/thumbnail are nice-to-have. Formats the
        // browser can't decode (e.g. HEIC) must not abort the upload.
        else if (/^image\//i.test(mime) && typeof file.arrayBuffer === "function") {
            try {
                const { bitmap, width, height } = await getImageInfo(file);
                bitmap.close();

                attributes.push({
                    _: "documentAttributeImageSize",
                    w: width,
                    h: height
                });

                const thumbnail = await createThumbnail(file);
                thumb = await uploadFile(thumbnail);
            } catch (error) {
                if (error?.cancelled)
                    throw error;

                console.warn(
                    "[Telegram Folder Uploader] Skipping image metadata/thumbnail for",
                    file.name,
                    error
                );
            }
        }

        const media = {
            _: "inputMediaUploadedDocument",
            file: inputFile,
            mimeType: mime,
            attributes,
            forceFile: true
        };

        if (thumb)
            media.thumb = thumb;

        const result = await e.call({
            _: "messages.uploadMedia",
            peer,
            media
        });

        if (!result?.document)
            throw new Error("Telegram did not return an uploaded document.");

        return result.document;
    }

    async function createPlaceholder(peer) {
        throwIfUploadCancelled();

        const result = await e.call({
            _: "messages.sendMessage",
            peer,
            message: "Uploading…",
            randomId: randomId()
        }, {
            /*
             * Surface flood waits to the uploader instead of letting
             * the library sleep silently. That lets the pacer learn
             * the current per-chat limit and adapt immediately.
             */
            floodSleepThreshold: 0
        });

        let messageId = null;

        for (const update of result?.updates || []) {
            if (
                (
                    update?._ === "updateNewMessage" ||
                    update?._ === "updateNewChannelMessage"
                ) &&
                update.message?.id != null
            ) {
                messageId = update.message.id;
                break;
            }
        }

        if (messageId == null)
            throw new Error("Could not determine newly-created placeholder message ID.");

        return messageId;
    }

    function createVideoPart(original, start, end, name) {
        return {
            size: end - start,
            type: original.type || "application/octet-stream",
            name,
            lastModified: original.lastModified,

            slice(relativeStart, relativeEnd, type) {
                return original.slice(
                    start + relativeStart,
                    start + relativeEnd,
                    type
                );
            }
        };
    }

    function splitFile(file) {
        const total = Math.ceil(file.size / MAX_PART_SIZE);
        const parts = [];

        for (let part = 0; part < total; part++) {
            const start = part * MAX_PART_SIZE;
            const end = Math.min(start + MAX_PART_SIZE, file.size);

            const name =
                `${file.name}.part` +
                String(part + 1).padStart(3, "0") +
                `of${String(total).padStart(3, "0")}`;

            parts.push({
                file: createVideoPart(file, start, end, name),
                part: part + 1,
                total,
                originalName: file.name,
                source: file
            });
        }

        return parts;
    }

    /* ------------------------------------------------------------------ */
    /* XMP + metadata.json                                                 */
    /* ------------------------------------------------------------------ */

    const METADATA_FILENAME = "metadata.json";
    const METADATA_VERSION = 3;

    // Set to true to also embed the full parsed XMP tree for every file.
    // It makes the document much larger and harder to edit by hand.
    const METADATA_INCLUDE_FULL_XMP = false;

    // Files up to this size are scanned in full for XMP. Larger files
    // (typically videos) only have their first and last chunk scanned.
    const XMP_FULL_SCAN_LIMIT = 32 * 1024 * 1024;
    const XMP_EDGE_SCAN_BYTES = 4 * 1024 * 1024;

    function findXMP(buffer) {
        const text = new TextDecoder("utf-8")
            .decode(new Uint8Array(buffer));

        const start = text.indexOf("<x:xmpmeta");

        if (start === -1)
            return null;

        const end = text.indexOf("</x:xmpmeta>", start);

        if (end === -1)
            return null;

        return text.substring(start, end + "</x:xmpmeta>".length);
    }

    function parseXMP(xmpString) {
        const xml = new DOMParser()
            .parseFromString(xmpString, "application/xml");

        if (xml.querySelector("parsererror"))
            throw new Error("XMP packet is not valid XML.");

        function cleanName(name) {
            return name.includes(":") ? name.split(":")[1] : name;
        }

        function addChild(obj, key, value) {
            if (obj[key] === undefined)
                obj[key] = value;
            else if (Array.isArray(obj[key]))
                obj[key].push(value);
            else
                obj[key] = [obj[key], value];
        }

        function parseNode(node) {
            const obj = {};

            for (const attr of node.attributes || [])
                obj[cleanName(attr.name)] = attr.value;

            if (node.children.length === 0) {
                const text = node.textContent.trim();
                return text || obj;
            }

            for (const child of node.children)
                addChild(obj, cleanName(child.nodeName), parseNode(child));

            return obj;
        }

        return parseNode(xml.documentElement);
    }

    // XMP area values are strings; turn numeric ones into numbers so the
    // JSON is easier to work with ("unit" stays a string).
    function normalizeNumbers(value) {
        if (!value || typeof value !== "object")
            return null;

        const out = {};

        for (const [key, v] of Object.entries(value)) {
            const n = Number(v);

            out[key] =
                key !== "unit" &&
                    typeof v === "string" &&
                    v.trim() !== "" &&
                    Number.isFinite(n)
                    ? n
                    : v;
        }

        return out;
    }

    function createXMPShortcuts(xmp) {
        const rawDescriptions = xmp.RDF?.Description || {};

        const descriptions = Array.isArray(rawDescriptions)
            ? rawDescriptions
            : [rawDescriptions];

        const subject = [];
        const faces = [];
        let dimensions = null;

        for (const desc of descriptions) {
            if (!desc || typeof desc !== "object")
                continue;

            // dc:subject (tags)
            const rawSubject = desc.subject?.Bag?.li;

            if (rawSubject !== undefined) {
                const values = Array.isArray(rawSubject)
                    ? rawSubject
                    : [rawSubject];

                for (const value of values) {
                    if (typeof value !== "string")
                        continue;

                    const clean = value.trim();

                    if (clean && !subject.includes(clean))
                        subject.push(clean);
                }
            }

            // Region dimensions
            if (desc.Regions?.AppliedToDimensions && !dimensions)
                dimensions = normalizeNumbers(desc.Regions.AppliedToDimensions);

            // Regions / faces
            const rawFaces = desc.Regions?.RegionList?.Bag?.li;

            if (rawFaces !== undefined) {
                const list = Array.isArray(rawFaces) ? rawFaces : [rawFaces];

                for (const f of list) {
                    const d = f?.Description || f;

                    if (!d || typeof d !== "object")
                        continue;

                    faces.push({
                        name: d.Name ?? null,
                        type: d.Type ?? null,
                        area: normalizeNumbers(d.Area)
                    });
                }
            }
        }

        return { subject, dimensions, faces };
    }

    async function readXMPString(file) {
        if (file.size <= XMP_FULL_SCAN_LIMIT)
            return findXMP(await file.arrayBuffer());

        const head = findXMP(
            await file.slice(0, XMP_EDGE_SCAN_BYTES).arrayBuffer()
        );

        if (head)
            return head;

        return findXMP(
            await file.slice(file.size - XMP_EDGE_SCAN_BYTES).arrayBuffer()
        );
    }

    async function readFileXMP(file) {
        const empty = {
            xmp: null,
            subject: [],
            dimensions: null,
            faces: [],
            error: null
        };

        try {
            const xmpString = await readXMPString(file);

            if (!xmpString)
                return empty;

            const xmp = parseXMP(xmpString);

            return { ...empty, xmp, ...createXMPShortcuts(xmp) };
        } catch (error) {
            console.warn(
                "[Telegram Folder Uploader] Could not read XMP from",
                file.name,
                error
            );

            return { ...empty, error: error?.message || String(error) };
        }
    }

    // `files` must already be in final upload order. `queue` supplies the
    // Telegram message IDs so each record can point at its messages.
    // See the header comment of this file for the output shape.
    async function buildMetadataDocument(files, queue, chat, onProgress) {
        const mediaIdByFile = new Map(files.map((file, i) => [file, i + 1]));

        const quickMessages = new Map();
        const originalParts = new Map();
        const messageIndex = [];
        let metadataMessage = null;

        for (const item of queue) {
            if (item.kind === "metadata") {
                metadataMessage = item.messageID;

                messageIndex.push({
                    id: item.messageID,
                    role: "metadata",
                    media: null
                });
            } else if (item.kind === "quick-video" || item.kind === "quick-image") {
                quickMessages.set(item.sourceFile, item.messageID);

                messageIndex.push({
                    id: item.messageID,
                    role: "quick",
                    media: mediaIdByFile.get(item.sourceFile) ?? null
                });
            } else if (item.kind === "original-document") {
                const list = originalParts.get(item.source) || [];

                list.push({
                    message: item.messageID,
                    part: item.part,
                    of: item.total,
                    name: item.sourceFile.name,
                    size: item.sourceFile.size,
                    offset: (item.part - 1) * MAX_PART_SIZE
                });

                originalParts.set(item.source, list);

                messageIndex.push({
                    id: item.messageID,
                    role: "original",
                    media: mediaIdByFile.get(item.source) ?? null,
                    part: item.part,
                    of: item.total
                });
            }
        }

        const media = [];
        const rawTags = [];

        for (let i = 0; i < files.length; i++) {
            throwIfUploadCancelled();
            onProgress?.(i + 1, files.length);

            const file = files[i];
            const kind = isVideoFile(file) ? "video" : "image";

            let width = null;
            let height = null;
            let duration = null;

            try {
                if (kind === "video") {
                    const meta = await getVideoMetadata(file);

                    width = meta.width || null;
                    height = meta.height || null;

                    duration = Number.isFinite(meta.duration)
                        ? Math.round(meta.duration * 100) / 100
                        : null;
                } else {
                    const info = await getImageInfo(file);

                    width = info.width;
                    height = info.height;
                    info.bitmap.close();
                }
            } catch (error) {
                if (error?.cancelled)
                    throw error;

                console.warn(
                    "[Telegram Folder Uploader] No dimensions for",
                    file.name,
                    error
                );
            }

            const xmp = await readFileXMP(file);

            const quick = quickMessages.get(file) ?? null;

            const parts = (originalParts.get(file) || [])
                .slice()
                .sort((a, b) => a.part - b.part);

            const original = parts.map(p => p.message);

            const record = {
                id: i + 1,
                kind,
                file: file.name,
                path: file.webkitRelativePath || file.name,
                mime: guessMime(file),
                size: file.size,
                modified: file.lastModified
                    ? new Date(file.lastModified).toISOString()
                    : null,
                width,
                height
            };

            if (kind === "video")
                record.duration = duration;

            // Tag strings for now; converted to indices below once the
            // final sorted album-level list is known.
            record.tags = xmp.subject;
            record.faces = xmp.faces;
            record.regionDimensions = xmp.dimensions;
            record.hidden = false;

            // The one message ID the site should use for this item
            // (any part of a split original also serves the whole file
            // through the worker).
            record.messageId = quick ?? original[0] ?? null;

            record.messages = { quick, original };

            // null for whole files. For a split original, one entry per
            // part, in order: which message holds it, its name, size and
            // byte offset within the source file.
            record.split = parts.length > 1
                ? {
                    parts: parts.length,
                    partSize: MAX_PART_SIZE,
                    items: parts
                }
                : null;

            if (xmp.error)
                record.xmpError = xmp.error;

            if (METADATA_INCLUDE_FULL_XMP)
                record.xmp = xmp.xmp;

            rawTags.push(...xmp.subject);
            media.push(record);
        }

        // Album-level tag list: unique case-insensitively, first-seen
        // casing wins, sorted. Per-media tags become indices into it.
        const canonical = new Map();

        for (const tag of rawTags) {
            const key = tag.toLowerCase();

            if (!canonical.has(key))
                canonical.set(key, tag);
        }

        const tags = [...canonical.values()].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );

        const indexByKey = new Map(
            tags.map((tag, index) => [tag.toLowerCase(), index])
        );

        for (const record of media) {
            record.tags = [
                ...new Set(
                    record.tags.map(tag => indexByKey.get(tag.toLowerCase()))
                )
            ].sort((a, b) => a - b);
        }

        const doc = {
            version: METADATA_VERSION,
            generated: new Date().toISOString(),
            chat: {
                id: String(chat.id),
                title: chat.title || chat.firstName || null
            },
            metadataMessage,
            tags,
            messageIndex,
            media,
            order: media.map(m => m.id)
        };

        /* The same document carries the provider-neutral manifest view. */
        Object.assign(
            doc,
            buildGalleryManifestFromTelegramDoc(
                doc,
                chat,
                METADATA_VERSION
            )
        );

        const json = JSON.stringify(
            doc,
            (key, value) =>
                typeof value === "bigint" ? Number(value) : value,
            2
        );

        return { doc, json };
    }

    /* ------------------------------------------------------------------ */
    /* UI                                                                  */
    /* ------------------------------------------------------------------ */

    document.getElementById("__telegram_folder_uploader")?.remove();

    const container = document.createElement("div");

    container.id = "__telegram_folder_uploader";

    Object.assign(container.style, {
        position: "fixed",
        top: "5vh",
        left: "5vw",
        width: "90vw",
        height: "90vh",
        boxSizing: "border-box",
        overflow: "hidden",
        zIndex: "2147483647",
        background: "#1d1d22",
        color: "#eee",
        padding: "20px",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: "14px",
        boxShadow: "0 24px 70px rgba(0,0,0,.6)",
        fontFamily: "inherit",
        fontSize: "13px",
        textAlign: "left",
        display: "flex",
        flexDirection: "column"
    });

    container.innerHTML = `
        <div style="
            font-size:17px;
            font-weight:bold;
            margin-bottom:12px;
        ">
            Telegram Folder Uploader
        </div>

        <div style="
            display:flex;
            align-items:center;
            gap:8px;
            margin-bottom:8px;
        ">
            <div style="
                flex:0 0 auto;
                font-weight:bold;
            ">Destination chat:</div>

            <select id="__tgu_chat" style="
                flex:1;
                min-width:0;
                box-sizing:border-box;
                padding:6px;
                background:#282828;
                color:#fff;
                border:1px solid #555;
                border-radius:5px;
            "></select>
        </div>

        <details id="__tgu_settings" style="
            margin-bottom:8px;
            border:1px solid #444;
            border-radius:6px;
            background:#222;
            overflow:hidden;
        ">
            <summary id="__tgu_settings_summary" style="
                padding:7px 10px;
                cursor:pointer;
                font-weight:bold;
                user-select:none;
                background:#282828;
            ">Channel settings</summary>

            <div id="__tgu_settings_body" style="
                padding:10px;
                max-height:44vh;
                overflow:auto;
                border-top:1px solid #444;
            ">
                <div style="color:#aaa;">
                    Select a destination to see its settings.
                </div>
            </div>
        </details>

        <div style="
            display:flex;
            gap:8px;
            align-items:center;
            margin-bottom:8px;
        ">
            <button id="__tgu_add_files" type="button" style="
                padding:8px 14px;
                border:0;
                border-radius:5px;
                background:#555;
                color:white;
                cursor:pointer;
            ">Add Files</button>

            <button id="__tgu_add_folder" type="button" style="
                padding:8px 14px;
                border:0;
                border-radius:5px;
                background:#555;
                color:white;
                cursor:pointer;
            ">Add Folder</button>

            <div id="__tgu_selection" style="
                flex:1;
                min-width:0;
                padding:7px 8px;
                background:#222;
                border:1px solid #444;
                border-radius:5px;
                color:#aaa;
                white-space:nowrap;
                overflow:hidden;
                text-overflow:ellipsis;
            ">No files selected.</div>
        </div>

        <input
            id="__tgu_files"
            type="file"
            multiple
            style="display:none;"
        >

        <input
            id="__tgu_folder"
            type="file"
            webkitdirectory
            multiple
            style="display:none;"
        >

        <div style="
            display:flex;
            gap:8px;
            align-items:center;
            margin-bottom:8px;
        ">
            <button id="__tgu_clear" type="button" style="
                flex:0 0 auto;
                padding:8px 14px;
                border:0;
                border-radius:5px;
                background:#333;
                color:#ddd;
                cursor:pointer;
            ">Clear Selection</button>

            <button id="__tgu_start" style="
                flex:1;
                padding:8px;
                border:0;
                border-radius:5px;
                background:#3b82f6;
                color:white;
                cursor:pointer;
            ">
                Start upload
            </button>

            <button id="__tgu_resume" type="button" style="
                flex:0 0 auto;
                padding:8px 14px;
                border:0;
                border-radius:5px;
                background:#16a34a;
                color:white;
                cursor:pointer;
                display:none;
            ">
                Continue upload
            </button>

            <button id="__tgu_cancel" type="button" style="
                flex:0 0 auto;
                padding:8px 14px;
                border:0;
                border-radius:5px;
                background:#555;
                color:white;
                cursor:pointer;
                display:none;
            ">
                Cancel
            </button>

            <button id="__tgu_close" style="
                flex:0 0 auto;
                padding:8px 14px;
                border:0;
                border-radius:5px;
                background:#444;
                color:white;
                cursor:pointer;
            ">
                Close
            </button>
        </div>

        <div id="__tgu_status" style="
            margin-top:4px;
            margin-bottom:8px;
            white-space:pre-wrap;
            line-height:1.35;
            color:#bbb;
            max-height:70px;
            overflow:auto;
        ">
            Loading chats...
        </div>

        <div style="
            display:flex;
            align-items:center;
            gap:8px;
            margin:2px 0 8px;
            flex-wrap:wrap;
        ">
            <div style="
                font-size:15px;
                font-weight:bold;
                flex:0 0 auto;
            ">Upload Order Preview</div>

            <div id="__tgu_preview_count" style="
                color:#aaa;
                font-size:11px;
                flex:1 1 120px;
                min-width:90px;
                white-space:nowrap;
            ">No files selected.</div>

            <div style="
                display:flex;
                gap:6px;
                flex:0 0 auto;
            ">
                <button id="__tgu_remove_all" type="button" style="
                    padding:4px 10px;
                    border:1px solid #5a2a2a;
                    border-radius:4px;
                    background:#3a2020;
                    color:#ffb4b4;
                    cursor:pointer;
                ">Remove All</button>

                <button id="__tgu_grid_view" type="button" style="
                    padding:4px 10px;
                    border:1px solid #666;
                    border-radius:4px;
                    background:#333;
                    color:#fff;
                    cursor:pointer;
                ">Grid</button>

                <button id="__tgu_detail_view" type="button" style="
                    padding:4px 10px;
                    border:1px solid #444;
                    border-radius:4px;
                    background:#222;
                    color:#aaa;
                    cursor:pointer;
                ">Details</button>
            </div>
        </div>

        <div id="__tgu_preview" style="
            flex:1;
            min-height:0;
            display:grid;
            grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));
            grid-auto-rows:max-content;
            align-content:start;
            align-items:start;
            gap:10px;
            overflow:auto;
            padding:2px;
            border:1px solid #333;
            border-radius:6px;
            background:#111;
        "></div>

        <div id="__tgu_progress" style="
            margin-top:8px;
            display:flex;
            flex-direction:column;
            gap:10px;
            max-height:110px;
            overflow:auto;
        "></div>
    `;

    document.body.appendChild(container);

    const chatSelect = container.querySelector("#__tgu_chat");
    const settingsDetails = container.querySelector("#__tgu_settings");
    const settingsSummary = container.querySelector("#__tgu_settings_summary");
    const settingsBody = container.querySelector("#__tgu_settings_body");
    const fileInput = container.querySelector("#__tgu_files");
    const folderInput = container.querySelector("#__tgu_folder");
    const addFilesButton = container.querySelector("#__tgu_add_files");
    const addFolderButton = container.querySelector("#__tgu_add_folder");
    const clearButton = container.querySelector("#__tgu_clear");
    const selectionStatus = container.querySelector("#__tgu_selection");
    const previewContainer = container.querySelector("#__tgu_preview");
    const previewCount = container.querySelector("#__tgu_preview_count");
    const removeAllButton = container.querySelector("#__tgu_remove_all");
    const gridViewButton = container.querySelector("#__tgu_grid_view");
    const detailViewButton = container.querySelector("#__tgu_detail_view");
    const startButton = container.querySelector("#__tgu_start");
    const resumeButton = container.querySelector("#__tgu_resume");
    const cancelButton = container.querySelector("#__tgu_cancel");
    const closeButton = container.querySelector("#__tgu_close");
    const status = container.querySelector("#__tgu_status");
    const progressContainer = container.querySelector("#__tgu_progress");

    /*
     * Set when a run stops part-way through. The queue keeps its
     * placeholder message IDs and per-item upload state so the user can
     * continue from exactly where it stopped.
     */
    let resumableUpload = null;
    let uploadRunning = false;

    function updateResumeButton() {

        const show =
            !!resumableUpload &&
            !uploadRunning;

        resumeButton.style.display =
            show ? "block" : "none";

        resumeButton.disabled =
            !show;

    }

    /*
     * The browser's FileList is replaced whenever an <input type=file>
     * changes. Keep our own list so files from multiple selections and
     * multiple folder selections can be combined.
     */
    const selectedFiles = new Map();

    function setCancelButtonActive(active) {
        uploadSessionActive = active;

        cancelButton.style.display = active ? "block" : "none";
        cancelButton.disabled = !active;

        if (active) {
            cancelButton.style.background = "#555";
            cancelButton.style.color = "#fff";
        }
    }

    function cancelQuickVideoRenders() {
        for (const cancel of Array.from(activeQuickVideoCancels)) {
            try {
                cancel();
            } catch (error) {
                console.error(
                    "[Telegram Folder Uploader] Error cancelling FFmpeg render:",
                    error
                );
            }
        }

        activeQuickVideoCancels.clear();
    }

    function getFileKey(file) {
        // A folder selection supplies webkitRelativePath. Individual
        // files generally do not, so use the file metadata for them.
        return [
            file.webkitRelativePath || file.name,
            file.size,
            file.lastModified,
            file.type
        ].join("|");
    }

    function addSelectedFiles(files) {
        for (const file of files || [])
            selectedFiles.set(getFileKey(file), file);

        updateSelectionStatus();
        updateAutoChannelTitle();
    }

    function updateSelectionStatus() {
        const files = Array.from(selectedFiles.values());

        if (!files.length) {
            selectionStatus.textContent = "No files selected.";
            renderPreviews([]);
            return;
        }

        const folderCount = files.filter(
            file => !!file.webkitRelativePath
        ).length;

        const individualCount = files.length - folderCount;
        const mediaFiles = files.filter(isSupportedMedia);
        const ignoredCount = files.length - mediaFiles.length;

        const parts = [`${files.length} file(s) selected`];

        if (individualCount)
            parts.push(`${individualCount} individual`);

        if (folderCount)
            parts.push(`${folderCount} from folder(s)`);

        if (ignoredCount)
            parts.push(`${ignoredCount} unsupported`);

        selectionStatus.textContent = parts.join(" • ");
        renderPreviews(mediaFiles);
    }

    function refreshSelectionAfterRemoval() {
        updateSelectionStatus();
        updateAutoChannelTitle();
    }

    function removeSelectedFile(file) {

        if (
            uploadSessionActive ||
            uploadRunning ||
            startButton.disabled
        ) {
            return;
        }

        selectedFiles.delete(getFileKey(file));
        refreshSelectionAfterRemoval();

    }

    function clearSelection() {

        if (
            uploadSessionActive ||
            uploadRunning ||
            startButton.disabled
        ) {
            return;
        }

        selectedFiles.clear();
        fileInput.value = "";
        folderInput.value = "";
        refreshSelectionAfterRemoval();

    }

    /*
     * Success path only: the queue is already on Telegram, so drop the
     * local selection without the in-flight guards used above.
     */
    function clearSelectionAfterUpload() {

        selectedFiles.clear();
        fileInput.value = "";
        folderInput.value = "";
        refreshSelectionAfterRemoval();

    }

    function getPreviewName(file) {
        return file.webkitRelativePath || file.name;
    }

    function makePreviewTile(file, uploadPosition = null, viewMode = "grid") {
        const tile = document.createElement("div");
        const isDetail = viewMode === "details";
        const isImage = isImageFile(file);
        const isVideo = isVideoFile(file);

        Object.assign(tile.style, isDetail ? {
            position: "relative",
            width: "100%",
            minWidth: "0",
            height: "30px",
            boxSizing: "border-box",
            background: "#111",
            border: "1px solid #444",
            borderRadius: "4px",
            overflow: "hidden",
            display: "flex",
            alignItems: "center"
        } : {
            position: "relative",
            width: "100%",
            height: "auto",
            minWidth: "0",
            minHeight: "0",
            aspectRatio: "1 / 1",
            background: "#111",
            border: "1px solid #444",
            borderRadius: "4px",
            overflow: "hidden"
        });

        const label = document.createElement("div");

        Object.assign(label.style, isDetail ? {
            flex: "1",
            minWidth: "0",
            padding: "0 10px",
            color: "#fff",
            fontSize: "12px",
            lineHeight: "30px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
        } : {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "0",
            zIndex: "2",
            padding: "3px 4px",
            background: "rgba(0,0,0,.75)",
            color: "#fff",
            fontSize: "9px",
            lineHeight: "1.15",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
        });

        label.textContent = getPreviewName(file);

        if (uploadPosition != null) {
            const order = document.createElement("div");

            Object.assign(order.style, isDetail ? {
                width: "48px",
                flex: "0 0 48px",
                color: "#aaa",
                fontSize: "12px",
                textAlign: "center"
            } : {
                position: "absolute",
                left: "3px",
                top: "3px",
                zIndex: "3",
                minWidth: "18px",
                padding: "2px 4px",
                background: "rgba(0,0,0,.8)",
                color: "#fff",
                borderRadius: "3px",
                fontSize: "10px",
                fontWeight: "bold",
                textAlign: "center",
                boxSizing: "border-box"
            });

            order.textContent = String(uploadPosition);
            tile.appendChild(order);
        }

        function addPreviewMedia(element) {
            Object.assign(element.style, {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block"
            });

            tile.appendChild(element);
        }

        if (!isDetail && isImage) {
            const img = document.createElement("img");
            const url = URL.createObjectURL(file);

            img.alt = file.name;
            img.onload = () => URL.revokeObjectURL(url);
            img.onerror = () => {
                URL.revokeObjectURL(url);
                img.remove();
            };

            img.src = url;
            addPreviewMedia(img);
        } else if (!isDetail && isVideo) {
            const video = document.createElement("video");
            const canvas = document.createElement("canvas");
            const url = URL.createObjectURL(file);

            const finish = () => {
                URL.revokeObjectURL(url);
                video.remove();
            };

            const drawVideoPreview = () => {
                const width = video.videoWidth;
                const height = video.videoHeight;

                if (width && height) {
                    const max = 320;
                    const scale = Math.min(1, max / Math.max(width, height));

                    canvas.width = Math.max(1, Math.round(width * scale));
                    canvas.height = Math.max(1, Math.round(height * scale));

                    const ctx = canvas.getContext("2d");

                    if (ctx) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        addPreviewMedia(canvas);
                    }
                }

                finish();
            };

            video.preload = "metadata";
            video.muted = true;
            video.playsInline = true;

            video.addEventListener("loadedmetadata", () => {
                const duration = video.duration;

                if (Number.isFinite(duration) && duration > 0)
                    video.currentTime = duration * (0.85 + Math.random() * 0.10);
                else
                    drawVideoPreview();
            }, { once: true });

            video.addEventListener("seeked", drawVideoPreview, { once: true });
            video.addEventListener("error", finish, { once: true });

            video.src = url;
        } else if (!isDetail) {
            const text = document.createElement("div");

            Object.assign(text.style, {
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#777",
                fontSize: "10px",
                textAlign: "center",
                padding: "4px",
                boxSizing: "border-box"
            });

            text.textContent = "No preview";
            tile.appendChild(text);
        }

        if (isDetail) {
            const type = document.createElement("div");
            const size = document.createElement("div");

            Object.assign(type.style, {
                width: "90px",
                flex: "0 0 90px",
                color: "#aaa",
                fontSize: "11px",
                lineHeight: "30px",
                textAlign: "left"
            });

            Object.assign(size.style, {
                width: "90px",
                flex: "0 0 90px",
                color: "#aaa",
                fontSize: "11px",
                lineHeight: "30px",
                textAlign: "right",
                paddingRight: "10px",
                boxSizing: "border-box"
            });

            type.textContent = isVideo ? "Video" : isImage ? "Image" : "File";
            size.textContent = formatFileSize(file.size);

            tile.appendChild(type);
            tile.appendChild(size);
        }

        tile.appendChild(label);

        if (isDetail) {

            const removeButton =
                document.createElement("button");

            removeButton.type = "button";
            removeButton.textContent = "Remove";
            removeButton.title = "Remove from selection";

            Object.assign(removeButton.style, {
                width: "70px",
                flex: "0 0 70px",
                marginRight: "6px",
                padding: "3px 6px",
                border: "1px solid #5a2a2a",
                borderRadius: "4px",
                background: "#3a2020",
                color: "#ffb4b4",
                fontSize: "11px",
                cursor: "pointer"
            });

            removeButton.onclick = event => {

                event.preventDefault();
                event.stopPropagation();

                removeSelectedFile(file);

            };

            tile.appendChild(removeButton);

        } else {

            const removeButton =
                document.createElement("button");

            removeButton.type = "button";
            removeButton.textContent = "×";
            removeButton.title = "Remove from selection";

            Object.assign(removeButton.style, {
                position: "absolute",
                top: "3px",
                right: "3px",
                zIndex: "4",
                width: "20px",
                height: "20px",
                padding: "0",
                border: "0",
                borderRadius: "50%",
                background: "rgba(0,0,0,.75)",
                color: "#fff",
                fontSize: "14px",
                lineHeight: "18px",
                cursor: "pointer"
            });

            removeButton.onmouseenter = () => {
                removeButton.style.background =
                    "rgba(190,40,40,.95)";
            };

            removeButton.onmouseleave = () => {
                removeButton.style.background =
                    "rgba(0,0,0,.75)";
            };

            removeButton.onclick = event => {

                event.preventDefault();
                event.stopPropagation();

                removeSelectedFile(file);

            };

            tile.appendChild(removeButton);

        }

        return tile;
    }

    function sortUploadFiles(files) {
        return [...files].sort((a, b) => {
            const av = isVideoFile(a);
            const bv = isVideoFile(b);

            if (av !== bv)
                return av ? -1 : 1;

            return (
                a.webkitRelativePath || a.name
            ).localeCompare(
                b.webkitRelativePath || b.name,
                undefined,
                {
                    numeric: true,
                    sensitivity: "base"
                }
            );
        });
    }

    let previewViewMode = "grid";

    function updatePreviewViewButtons() {
        const active = {
            background: "#333",
            borderColor: "#666",
            color: "#fff"
        };

        const inactive = {
            background: "#222",
            borderColor: "#444",
            color: "#aaa"
        };

        Object.assign(gridViewButton.style, previewViewMode === "grid" ? active : inactive);
        Object.assign(detailViewButton.style, previewViewMode === "details" ? active : inactive);
    }

    function renderPreviews(files) {
        previewContainer.innerHTML = "";

        const orderedFiles = sortUploadFiles(files);

        previewCount.textContent =
            `${orderedFiles.length} file(s)`;

        const maxPreviewCount = 100;
        const visible = orderedFiles.slice(0, maxPreviewCount);

        previewContainer.style.display = "grid";

        if (previewViewMode === "grid") {
            previewContainer.style.gridTemplateColumns =
                "repeat(auto-fill, minmax(130px, 1fr))";
            previewContainer.style.gridAutoRows = "max-content";
            previewContainer.style.gap = "10px";
        } else {
            previewContainer.style.gridTemplateColumns = "minmax(0, 1fr)";
            previewContainer.style.gridAutoRows = "30px";
            previewContainer.style.gap = "6px";
        }

        visible.forEach((file, index) => {
            previewContainer.appendChild(
                makePreviewTile(file, index + 1, previewViewMode)
            );
        });

        if (orderedFiles.length > maxPreviewCount) {
            const more = document.createElement("div");

            Object.assign(more.style, {
                gridColumn: "1 / -1",
                color: "#888",
                fontSize: "11px",
                padding: "4px",
                textAlign: "center"
            });

            more.textContent =
                `Showing first ${maxPreviewCount} of ${orderedFiles.length} upload positions.`;

            previewContainer.appendChild(more);
        }

        updatePreviewViewButtons();
    }

    gridViewButton.onclick = () => {
        if (previewViewMode !== "grid") {
            previewViewMode = "grid";
            updateSelectionStatus();
        }
    };

    detailViewButton.onclick = () => {
        if (previewViewMode !== "details") {
            previewViewMode = "details";
            updateSelectionStatus();
        }
    };

    addFilesButton.onclick = () => fileInput.click();
    addFolderButton.onclick = () => folderInput.click();

    fileInput.onchange = () => {
        addSelectedFiles(fileInput.files);
        // Allow selecting the same file again after clearing/reselecting.
        fileInput.value = "";
    };

    folderInput.onchange = () => {
        addSelectedFiles(folderInput.files);
        folderInput.value = "";
    };

    clearButton.onclick = clearSelection;
    removeAllButton.onclick = clearSelection;

    closeButton.onclick = () => {
        if (uploadSessionActive && !confirm(
            "An upload is still running. Close anyway? " +
            "(Use Cancel to stop it first.)"
        ))
            return;

        if (!uploadSessionActive && resumableUpload && !confirm(
            "An unfinished upload can still be continued. " +
            "Close and discard its progress?"
        ))
            return;

        container.remove();
    };

    function createProgressRow(name) {
        const row = document.createElement("div");

        const nameEl = document.createElement("div");
        nameEl.style.marginBottom = "4px";
        nameEl.style.whiteSpace = "nowrap";
        nameEl.style.overflow = "hidden";
        nameEl.style.textOverflow = "ellipsis";
        nameEl.textContent = name;

        const track = document.createElement("div");
        track.style.width = "100%";
        track.style.height = "8px";
        track.style.background = "#333";
        track.style.borderRadius = "4px";
        track.style.overflow = "hidden";

        const bar = document.createElement("div");
        bar.style.width = "0%";
        bar.style.height = "100%";
        bar.style.background = UPLOAD_COLOR;
        bar.style.transition = "width .1s";

        track.appendChild(bar);

        const text = document.createElement("div");
        text.style.marginTop = "3px";
        text.style.fontSize = "11px";
        text.style.color = "#aaa";
        text.textContent = "Waiting…";

        row.appendChild(nameEl);
        row.appendChild(track);
        row.appendChild(text);

        progressContainer.appendChild(row);

        return {
            row,
            bar,
            text,
            mode: "upload"
        };
    }

    /* ------------------------------------------------------------------ */
    /* Channel settings panel                                              */
    /* ------------------------------------------------------------------ */

    function normalizeChannelUsername(value) {

        return String(value || "")
            .trim()
            .replace(/^https?:\/\/t\.me\//i, "")
            .replace(/^t\.me\//i, "")
            .replace(/^@/, "")
            .toLowerCase();

    }

    function isValidChannelUsername(value) {

        return /^[a-z0-9_]{5,32}$/.test(value);

    }

    /*
     * Telegram creates a bare channel/supergroup first; a public username,
     * content protection, slow mode and join requests are separate API
     * calls. The panel collects the full set up front and applies the
     * extra calls immediately after creation, before the upload starts.
     */

    function setSettingsStatus(message, isError = false) {

        if (!settingsFields)
            return;

        settingsFields.status.textContent =
            message || "";

        settingsFields.status.style.color =
            isError ? "#ff8b8b" : "#9a9aa3";

    }

    function collectSettingsFromForm() {

        const values = {
            type: settingsFields.typeSelect.value,
            title: settingsFields.title.value.trim(),
            description: settingsFields.description.value.trim(),
            privacy: settingsFields.privacy.value,
            username: normalizeChannelUsername(
                settingsFields.username.value
            ),
            approve: settingsFields.approve.checked,
            protect: settingsFields.protect.checked,
            signatures: settingsFields.signatures.checked,
            slowMode: Number(settingsFields.slow.value) || 0,
            topics: settingsFields.topics.checked,
            photoFile:
                settingsFields.photo.files &&
                settingsFields.photo.files[0]
                    ? settingsFields.photo.files[0]
                    : null
        };

        return values;

    }

    function saveNewChannelDraft() {

        if (
            settingsMode !== "new" ||
            !settingsFields
        ) {
            return;
        }

        newChannelDraft = collectSettingsFromForm();

    }

    function cleanChannelTitle(value) {

        return String(value || "")
            .replace(/_+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 128);

    }

    /*
     * Filenames usually start with a sequence number ("01 - Mona",
     * "02 - Mona"). Strip that prefix before falling back to the first
     * name so the suggested title is readable.
     */
    function cleanFileStem(value) {

        return cleanChannelTitle(
            String(value || "")
                .replace(
                    /^\s*\d{1,4}\s*[-_. ]+\s*/,
                    ""
                )
        );

    }

    /*
     * Suggest a channel title from the queued upload:
     *   1. the shared top-level folder name (folder picker),
     *   2. the longest common prefix of the file names,
     *   3. the first file name.
     */
    function suggestChannelTitle(files) {

        if (!files.length)
            return "";

        const folderNames =
            files.map(file => {

                const path =
                    String(file.webkitRelativePath || "");

                return path
                    ? path.split("/")[0]
                    : "";

            });

        if (
            folderNames.every(Boolean) &&
            new Set(folderNames).size === 1
        ) {
            return cleanChannelTitle(folderNames[0]);
        }

        const names =
            files.map(file =>
                String(file.name || "")
                    .replace(/\.[^.]+$/, "")
            ).filter(Boolean);

        if (!names.length)
            return "";

        let common =
            names[0];

        for (const name of names.slice(1)) {

            const lower =
                name.toLowerCase();

            while (
                common &&
                !lower.startsWith(
                    common.toLowerCase()
                )
            ) {
                common = common.slice(0, -1);
            }

            if (!common)
                break;

        }

        common = cleanChannelTitle(
            common
                .replace(/[\s._-]+\d+$/, "")
                .replace(/[\s._-]+$/, "")
        );

        if (common.length >= 4)
            return common;

        return cleanFileStem(names[0]);

    }

    function updateAutoChannelTitle() {

        if (
            settingsMode !== "new" ||
            !settingsFields
        ) {
            return;
        }

        const suggestion =
            suggestChannelTitle(
                Array.from(selectedFiles.values())
            );

        const current =
            settingsFields.title.value.trim();

        if (
            !current ||
            current === autoChannelTitle
        ) {

            settingsFields.title.value =
                suggestion;

            autoChannelTitle =
                suggestion;

            newChannelDraft.title =
                suggestion;

        }

    }

    function updateSettingsVisibility() {

        if (!settingsFields)
            return;

        const isNew =
            settingsMode === "new";

        const kind =
            loadedChatSettings?.kind || "channel";

        const type =
            isNew
                ? settingsFields.typeSelect.value
                : (
                    kind === "channel" &&
                    loadedChatSettings?.megagroup
                        ? "supergroup"
                        : "channel"
                );

        const isGroup =
            type === "supergroup";

        const isChannel =
            !isGroup;

        const isSupported =
            isNew ||
            kind === "channel" ||
            kind === "basic-group";

        const fullSettings =
            isNew || kind === "channel";

        settingsFields.typeSelect.style.display =
            isNew ? "" : "none";

        settingsFields.typeText.style.display =
            isNew ? "none" : "";

        settingsFields.typeText.textContent =
            kind === "user"
                ? "Private chat"
                : kind === "basic-group"
                    ? "Basic group"
                    : isGroup
                        ? (
                            loadedChatSettings?.forum
                                ? "Supergroup (topics enabled)"
                                : "Supergroup"
                        )
                        : "Channel";

        settingsFields.title.disabled =
            !isSupported;

        settingsFields.description.disabled =
            !isSupported;

        settingsFields.photo.disabled =
            !isSupported;

        settingsFields.privacy.disabled =
            !fullSettings;

        settingsFields.username.disabled =
            !fullSettings;

        settingsFields.approve.disabled =
            !fullSettings;

        settingsFields.protect.disabled =
            !fullSettings;

        settingsFields.signatures.disabled =
            !fullSettings || !isChannel;

        settingsFields.slow.disabled =
            !fullSettings || !isGroup;

        settingsFields.topics.disabled =
            !isNew || !isGroup;

        settingsFields.privacyWrap.style.display =
            fullSettings ? "" : "none";

        settingsFields.usernameWrap.style.display =
            fullSettings &&
            settingsFields.privacy.value === "public"
                ? ""
                : "none";

        settingsFields.approveWrap.style.display =
            fullSettings ? "" : "none";

        settingsFields.protectWrap.style.display =
            fullSettings ? "" : "none";

        settingsFields.signaturesWrap.style.display =
            fullSettings && isChannel
                ? ""
                : "none";

        settingsFields.slowWrap.style.display =
            fullSettings && isGroup
                ? ""
                : "none";

        settingsFields.topicsContainer.style.display =
            isGroup ? "" : "none";

        settingsFields.topicsCheckWrap.style.display =
            isNew ? "" : "none";

        settingsFields.topicsText.style.display =
            isNew ? "none" : "";

        settingsFields.approveText.textContent =
            isGroup
                ? "Approve new members (join requests)"
                : "Approve new subscribers";

        settingsFields.saveButton.style.display =
            !isNew && isSupported ? "" : "none";

        settingsFields.createButton.style.display =
            isNew ? "" : "none";

        settingsFields.note.textContent =
            !isSupported
                ? "Settings are only available for channels and groups."
                : isNew
                    ? "The channel is created when you click Create channel or Start upload."
                    : "Changes are applied when you click Save settings or Start upload.";

    }

    function setSettingsBusy(value) {

        if (!settingsFields)
            return;

        for (
            const control of
            settingsBody.querySelectorAll(
                "input, select, textarea, button"
            )
        ) {
            control.disabled = value;
        }

        settingsFields.createButton.textContent =
            value ? "Creating…" : "Create channel";

        settingsFields.saveButton.textContent =
            value ? "Saving…" : "Save settings";

        if (!value)
            updateSettingsVisibility();

    }

    function setSettingsValues(values, mode, { resetPhoto = true } = {}) {

        const previousMode =
            settingsMode;

        settingsMode =
            mode;

        if (!settingsFields)
            return;

        settingsFields.typeSelect.value =
            values.type || "channel";

        settingsFields.title.value =
            values.title || "";

        settingsFields.description.value =
            values.description || "";

        if (resetPhoto)
            settingsFields.photo.value = "";

        settingsFields.privacy.value =
            values.privacy || "private";

        settingsFields.username.value =
            values.username || "";

        settingsFields.approve.checked =
            !!values.approve;

        settingsFields.protect.checked =
            !!values.protect;

        settingsFields.signatures.checked =
            !!values.signatures;

        settingsFields.slow.value =
            String(values.slowMode || 0);

        settingsFields.topics.checked =
            !!values.topics;

        updateSettingsVisibility();

        if (previousMode !== mode)
            setSettingsStatus("");

    }

    function buildChannelSettingsPanel() {

        settingsBody.innerHTML = "";

        function addField(labelText, control, hint) {

            const wrap =
                document.createElement("div");

            wrap.style.margin = "10px 0";

            const label =
                document.createElement("label");

            label.style.display = "block";
            label.style.fontSize = "12px";
            label.style.fontWeight = "600";
            label.style.marginBottom = "4px";
            label.textContent = labelText;

            wrap.appendChild(label);
            wrap.appendChild(control);

            if (hint) {

                const hintEl =
                    document.createElement("div");

                hintEl.style.marginTop = "3px";
                hintEl.style.fontSize = "11px";
                hintEl.style.opacity = "0.6";
                hintEl.textContent = hint;

                wrap.appendChild(hintEl);

            }

            settingsBody.appendChild(wrap);

            return wrap;

        }

        function addCheckbox(labelText, checked) {

            const wrap =
                document.createElement("label");

            wrap.style.display = "flex";
            wrap.style.alignItems = "center";
            wrap.style.gap = "8px";
            wrap.style.margin = "8px 0";
            wrap.style.fontSize = "13px";
            wrap.style.cursor = "pointer";

            const input =
                document.createElement("input");

            input.type = "checkbox";
            input.checked = !!checked;

            const text =
                document.createElement("span");

            text.textContent = labelText;

            wrap.appendChild(input);
            wrap.appendChild(text);

            settingsBody.appendChild(wrap);

            return {
                wrap,
                input,
                text
            };

        }

        const fields = {};

        /* Type ------------------------------------------------------------ */

        const typeWrap =
            document.createElement("div");

        typeWrap.style.margin = "10px 0";

        const typeLabel =
            document.createElement("div");

        typeLabel.style.fontSize = "12px";
        typeLabel.style.fontWeight = "600";
        typeLabel.style.marginBottom = "4px";
        typeLabel.textContent = "Type";

        const typeSelect =
            document.createElement("select");

        typeSelect.className = "app-field";
        typeSelect.innerHTML =
            '<option value="channel">Channel (broadcast, one-way)</option>' +
            '<option value="supergroup">Supergroup (group, members can post)</option>';

        const typeText =
            document.createElement("div");

        typeText.style.padding = "6px 0";
        typeText.style.fontSize = "13px";
        typeText.style.color = "#ddd";

        typeWrap.appendChild(typeLabel);
        typeWrap.appendChild(typeSelect);
        typeWrap.appendChild(typeText);

        settingsBody.appendChild(typeWrap);

        fields.typeSelect = typeSelect;
        fields.typeText = typeText;

        /* Title ----------------------------------------------------------- */

        const title =
            document.createElement("input");

        title.className = "app-field";
        title.type = "text";
        title.maxLength = 128;
        title.placeholder = "Channel title";

        addField("Title", title, "Auto-filled from the folder when creating a new channel.");

        fields.title = title;

        /* Description ----------------------------------------------------- */

        const description =
            document.createElement("textarea");

        description.className = "app-field";
        description.rows = 3;
        description.maxLength = 255;
        description.placeholder = "Optional description shown at the top of the channel";

        addField("Description", description);

        fields.description = description;

        /* Photo ----------------------------------------------------------- */

        const photo =
            document.createElement("input");

        photo.type = "file";
        photo.accept = "image/*";
        photo.className = "app-field channel-settings-file";

        addField(
            "Channel photo",
            photo,
            "Optional. Leave empty to keep the current photo."
        );

        fields.photo = photo;

        /* Privacy --------------------------------------------------------- */

        const privacy =
            document.createElement("select");

        privacy.className = "app-field";
        privacy.innerHTML =
            '<option value="private">Private (invite only)</option>' +
            '<option value="public">Public (username / t.me link)</option>';

        const privacyWrap =
            addField(
                "Privacy",
                privacy,
                "Private channels get a permanent invite link; public ones use t.me/username."
            );

        fields.privacy = privacy;
        fields.privacyWrap = privacyWrap;

        /* Username -------------------------------------------------------- */

        const username =
            document.createElement("input");

        username.className = "app-field";
        username.type = "text";
        username.maxLength = 32;
        username.placeholder = "my_channel";

        const usernameWrap =
            addField(
                "Username",
                username,
                "5–32 characters: letters, numbers and underscores."
            );

        fields.username = username;
        fields.usernameWrap = usernameWrap;

        /* Approval -------------------------------------------------------- */

        const approve =
            addCheckbox(
                "Approve new subscribers",
                true
            );

        fields.approve = approve.input;
        fields.approveWrap = approve.wrap;
        fields.approveText = approve.text;

        /* Content protection ---------------------------------------------- */

        const protect =
            addCheckbox(
                "Restrict saving content (disable forwarding)",
                false
            );

        fields.protect = protect.input;
        fields.protectWrap = protect.wrap;

        /* Signatures ------------------------------------------------------ */

        const signatures =
            addCheckbox(
                "Show admin names on posts (channel signatures)",
                false
            );

        fields.signatures = signatures.input;
        fields.signaturesWrap = signatures.wrap;

        /* Slow mode ------------------------------------------------------- */

        const slow =
            document.createElement("select");

        slow.className = "app-field";
        slow.innerHTML =
            '<option value="0">Off</option>' +
            '<option value="10">10 seconds</option>' +
            '<option value="30">30 seconds</option>' +
            '<option value="60">1 minute</option>' +
            '<option value="300">5 minutes</option>' +
            '<option value="900">15 minutes</option>' +
            '<option value="3600">1 hour</option>';

        const slowWrap =
            addField(
                "Slow mode",
                slow,
                "Members can post once per interval."
            );

        fields.slow = slow;
        fields.slowWrap = slowWrap;

        /* Topics ---------------------------------------------------------- */

        const topicsContainer =
            document.createElement("div");

        const topicsCheckWrap =
            document.createElement("label");

        topicsCheckWrap.style.display = "flex";
        topicsCheckWrap.style.alignItems = "center";
        topicsCheckWrap.style.gap = "8px";
        topicsCheckWrap.style.margin = "8px 0";
        topicsCheckWrap.style.fontSize = "13px";
        topicsCheckWrap.style.cursor = "pointer";

        const topics =
            document.createElement("input");

        topics.type = "checkbox";

        topicsCheckWrap.appendChild(topics);
        topicsCheckWrap.appendChild(
            document.createTextNode(
                "Enable topics (forum layout)"
            )
        );

        const topicsText =
            document.createElement("div");

        topicsText.style.margin = "8px 0";
        topicsText.style.fontSize = "12px";
        topicsText.style.color = "#aaa";

        topicsContainer.appendChild(topicsCheckWrap);
        topicsContainer.appendChild(topicsText);
        settingsBody.appendChild(topicsContainer);

        fields.topics = topics;
        fields.topicsContainer = topicsContainer;
        fields.topicsCheckWrap = topicsCheckWrap;
        fields.topicsText = topicsText;

        /* Note / status / actions ----------------------------------------- */

        const note =
            document.createElement("div");

        note.style.marginTop = "10px";
        note.style.fontSize = "11px";
        note.style.color = "#8a8a93";
        note.style.lineHeight = "1.4";

        settingsBody.appendChild(note);

        const statusLine =
            document.createElement("div");

        statusLine.style.marginTop = "6px";
        statusLine.style.fontSize = "12px";
        statusLine.style.minHeight = "16px";
        statusLine.style.whiteSpace = "pre-wrap";
        statusLine.style.lineHeight = "1.4";

        settingsBody.appendChild(statusLine);

        const actionRow =
            document.createElement("div");

        actionRow.style.display = "flex";
        actionRow.style.gap = "8px";
        actionRow.style.marginTop = "10px";

        const saveButton =
            document.createElement("button");

        saveButton.type = "button";
        saveButton.className = "app-button app-button-primary";
        saveButton.textContent = "Save settings";

        const createButton =
            document.createElement("button");

        createButton.type = "button";
        createButton.className = "app-button app-button-primary";
        createButton.textContent = "Create channel";

        actionRow.appendChild(saveButton);
        actionRow.appendChild(createButton);

        settingsBody.appendChild(actionRow);

        fields.note = note;
        fields.status = statusLine;
        fields.saveButton = saveButton;
        fields.createButton = createButton;

        /* Behaviour ------------------------------------------------------- */

        let populating = false;

        for (
            const control of
            settingsBody.querySelectorAll(
                "input, select, textarea"
            )
        ) {

            const update = () => {

                if (populating)
                    return;

                if (settingsMode === "new")
                    saveNewChannelDraft();

                if (
                    control === typeSelect ||
                    control === privacy
                ) {
                    updateSettingsVisibility();
                }

                if (settingsMode === "existing")
                    setSettingsStatus("Unsaved changes.");

            };

            control.addEventListener("input", update);
            control.addEventListener("change", update);

        }

        const originalSetValues = setSettingsValues;

        fields.setValues = (...args) => {

            populating = true;

            try {

                originalSetValues(...args);

            } finally {

                populating = false;

            }

        };

        saveButton.onclick = async () => {

            const chat =
                availableChats.find(
                    item =>
                        String(item.id) ===
                        chatSelect.value
                );

            if (!chat)
                return;

            await applyExistingChannelSettings(chat);

        };

        createButton.onclick = async () => {

            await createChannelFromPanel();

        };

        settingsFields = fields;

        setSettingsValues(
            newChannelDraft,
            "new",
            { resetPhoto: false }
        );

    }

    async function loadSettingsForChat(chat) {

        if (!settingsFields)
            return;

        settingsMode = "existing";
        loadedChatSettings = null;

        const token =
            ++settingsLoadToken;

        settingsBody.style.pointerEvents = "none";
        settingsBody.style.opacity = "0.6";
        setSettingsStatus("Loading settings…");
        settingsFields.saveButton.disabled = true;

        let data;

        try {

            const peer =
                await e.resolvePeer(chat.id);

            if (peer._ === "inputPeerChannel") {

                const res =
                    await e.call({
                        _: "channels.getFullChannel",
                        channel: await e.resolveChannel(chat.id)
                    });

                const channel =
                    res.chats?.[0] || null;

                const full =
                    res.fullChat || null;

                data = {
                    kind: "channel",
                    broadcast: !!channel?.broadcast,
                    megagroup: !!channel?.megagroup,
                    forum: !!channel?.forum,
                    title:
                        channel?.title ||
                        chat.title ||
                        "",
                    about: full?.about || "",
                    username: channel?.username || "",
                    approve: !!channel?.joinRequest,
                    protect: !!channel?.noforwards,
                    signatures: !!channel?.signatures,
                    slowMode:
                        Number(full?.slowmodeSeconds) || 0
                };

            } else if (peer._ === "inputPeerChat") {

                const res =
                    await e.call({
                        _: "messages.getFullChat",
                        chatId: peer.chatId
                    });

                const group =
                    res.chats?.[0] || null;

                const full =
                    res.fullChat || null;

                data = {
                    kind: "basic-group",
                    broadcast: false,
                    megagroup: false,
                    forum: false,
                    title:
                        group?.title ||
                        chat.title ||
                        "",
                    about: full?.about || "",
                    username: "",
                    approve: false,
                    protect: false,
                    signatures: false,
                    slowMode: 0
                };

            } else {

                data = {
                    kind: "user",
                    broadcast: false,
                    megagroup: false,
                    forum: false,
                    title:
                        chat.title ||
                        chat.firstName ||
                        "",
                    about: "",
                    username: "",
                    approve: false,
                    protect: false,
                    signatures: false,
                    slowMode: 0
                };

            }

        } catch (error) {

            if (token !== settingsLoadToken)
                return;

            settingsBody.style.pointerEvents = "";
            settingsBody.style.opacity = "";

            setSettingsStatus(
                "Could not load settings: " +
                (error?.message || String(error)),
                true
            );

            return;

        }

        if (token !== settingsLoadToken)
            return;

        loadedChatSettings = data;

        settingsFields.setValues(
            {
                type:
                    data.megagroup
                        ? "supergroup"
                        : "channel",
                title: data.title,
                description: data.about,
                privacy:
                    data.username
                        ? "public"
                        : "private",
                username: data.username,
                approve: data.approve,
                protect: data.protect,
                signatures: data.signatures,
                slowMode: data.slowMode,
                topics: data.forum
            },
            "existing"
        );

        settingsFields.topicsText.textContent =
            data.forum
                ? "Topics are enabled (cannot be changed here)."
                : "Topics are disabled (cannot be changed here).";

        settingsBody.style.pointerEvents = "";
        settingsBody.style.opacity = "";

        settingsFields.saveButton.disabled = false;
        setSettingsStatus("");

        settingsSummary.textContent =
            "Channel settings — " +
            (data.title || chat.title || chat.id);

    }

    function enterNewChannelMode() {

        settingsMode = "new";
        loadedChatSettings = null;

        settingsSummary.textContent =
            "Channel settings — new channel";

        settingsFields.setValues(
            newChannelDraft,
            "new",
            { resetPhoto: false }
        );

        settingsDetails.open = true;
        setSettingsStatus("");
        updateAutoChannelTitle();
        settingsFields.title.focus();

    }

    async function handleDestinationChange() {

        if (
            chatSelect.value ===
            NEW_CHANNEL_OPTION_VALUE
        ) {
            enterNewChannelMode();
            return;
        }

        saveNewChannelDraft();

        const chat =
            availableChats.find(
                item =>
                    String(item.id) ===
                    chatSelect.value
            );

        if (!chat)
            return;

        settingsMode = "existing";

        settingsSummary.textContent =
            "Channel settings — " +
            (chat.title || chat.firstName || chat.id);

        await loadSettingsForChat(chat);

    }

    function validateSettings(values) {

        if (!values.title) {
            setSettingsStatus("Enter a channel title.", true);
            settingsFields.title.focus();
            return false;
        }

        if (values.title.length > 128) {
            setSettingsStatus(
                "Titles are limited to 128 characters.",
                true
            );
            return false;
        }

        if (values.description.length > 255) {
            setSettingsStatus(
                "Descriptions are limited to 255 characters.",
                true
            );
            return false;
        }

        if (
            values.privacy === "public" &&
            !isValidChannelUsername(values.username)
        ) {
            setSettingsStatus(
                "Usernames must be 5–32 characters and use " +
                "only letters, numbers and underscores.",
                true
            );
            settingsFields.username.focus();
            return false;
        }

        return true;

    }

    async function createChannelFromPanel() {

        if (!settingsFields)
            return null;

        saveNewChannelDraft();

        const values = {
            ...newChannelDraft
        };

        setSettingsStatus("");

        if (!validateSettings(values))
            return null;

        setSettingsBusy(true);
        setSettingsStatus("Creating channel…");

        try {

            if (values.privacy === "public") {

                try {

                    await e.resolvePeer(
                        "@" + values.username
                    );

                    setSettingsBusy(false);
                    setSettingsStatus(
                        `@${values.username} is already taken. ` +
                        "Choose another username.",
                        true
                    );

                    settingsFields.username.focus();

                    return null;

                } catch {}

            }

            const created =
                values.type === "supergroup"
                    ? await e.createSupergroup({
                        title: values.title,
                        description: values.description,
                        forum: values.topics
                    })
                    : await e.createChannel({
                        title: values.title,
                        description: values.description
                    });

            const warnings = [];

            if (values.photoFile) {

                try {

                    await e.setChatPhoto({
                        chatId: created.id,
                        type: "photo",
                        media: values.photoFile
                    });

                } catch (error) {

                    warnings.push(
                        "Channel photo could not be set: " +
                        (error?.message || String(error))
                    );

                }

            }

            let usernameApplied = false;

            if (values.privacy === "public") {

                try {

                    await e.setChatUsername(
                        created.id,
                        values.username
                    );

                    usernameApplied = true;

                } catch (error) {

                    warnings.push(
                        `Public username @${values.username} could not be set: ` +
                        (error?.message || String(error))
                    );

                }

            }

            if (
                values.type === "channel" &&
                values.signatures
            ) {

                try {

                    const inputChannel =
                        await e.resolveChannel(
                            created.id
                        );

                    await e.call({
                        _: "channels.toggleSignatures",
                        channel: inputChannel,
                        signaturesEnabled: true
                    });

                } catch (error) {

                    warnings.push(
                        "Admin signatures could not be enabled: " +
                        (error?.message || String(error))
                    );

                }

            }

            if (values.protect) {

                try {

                    await e.toggleContentProtection(
                        created.id,
                        true
                    );

                } catch (error) {

                    warnings.push(
                        "Content protection could not be enabled: " +
                        (error?.message || String(error))
                    );

                }

            }

            if (
                values.type === "supergroup" &&
                values.slowMode > 0
            ) {

                try {

                    await e.setSlowMode(
                        created.id,
                        values.slowMode
                    );

                } catch (error) {

                    warnings.push(
                        "Slow mode could not be set: " +
                        (error?.message || String(error))
                    );

                }

            }

            if (values.approve) {

                try {

                    await e.toggleJoinRequests(
                        created.id,
                        true
                    );

                } catch (error) {

                    warnings.push(
                        "Join requests could not be enabled: " +
                        (error?.message || String(error))
                    );

                }

            }

            const chat = {
                id: created.id,
                title:
                    created.title || values.title,
                username:
                    usernameApplied
                        ? values.username
                        : (created.username || undefined),
                firstName: undefined,
                type:
                    values.type === "supergroup"
                        ? "group"
                        : "channel"
            };

            availableChats.push(chat);

            const option =
                addChatOption(chat);

            chatSelect.value =
                option.value;

            chatSelect.disabled = false;

            if (Array.isArray(window.telegramChats)) {

                window.telegramChats.push({
                    chat
                });

            }

            setSettingsBusy(false);

            settingsMode = "existing";
            settingsSummary.textContent =
                "Channel settings — " +
                (chat.title || chat.id);

            await loadSettingsForChat(chat);

            if (warnings.length) {

                setSettingsStatus(
                    warnings.join("\n"),
                    true
                );

                alert(
                    "Channel created, but some settings could not be applied:\n\n" +
                    warnings.join("\n")
                );

            } else {

                status.textContent =
                    `Created "${chat.title}". ` +
                    "Add files and start the upload.";

            }

            return {
                chat,
                warnings
            };

        } catch (error) {

            setSettingsBusy(false);
            setSettingsStatus(
                error?.message || String(error),
                true
            );

            return null;

        }

    }

    async function applyExistingChannelSettings(chat) {

        if (
            !settingsFields ||
            !chat ||
            !loadedChatSettings
        ) {
            return true;
        }

        const values =
            collectSettingsFromForm();

        setSettingsStatus("");

        if (!validateSettings(values))
            return false;

        const previous =
            loadedChatSettings;

        const changes = {};

        if (values.title !== previous.title)
            changes.title = values.title;

        if (values.description !== previous.about)
            changes.description = values.description;

        if (values.photoFile)
            changes.photo = values.photoFile;

        if (previous.kind === "user")
            return true;

        if (previous.kind === "channel") {

            if (
                values.privacy === "public" &&
                values.username !== previous.username
            ) {
                changes.username = values.username;
            }

            if (
                values.privacy === "private" &&
                previous.username
            ) {
                changes.removeUsername = true;
            }

            if (values.approve !== previous.approve)
                changes.approve = values.approve;

            if (values.protect !== previous.protect)
                changes.protect = values.protect;

            if (
                !previous.megagroup &&
                values.signatures !== previous.signatures
            ) {
                changes.signatures = values.signatures;
            }

            if (
                previous.megagroup &&
                values.slowMode !== previous.slowMode
            ) {
                changes.slowMode = values.slowMode;
            }

        }

        if (!Object.keys(changes).length) {
            setSettingsStatus("No changes to save.");
            return true;
        }

        if (
            changes.removeUsername &&
            !confirm(
                `Remove the public username @${previous.username}?`
            )
        ) {
            return false;
        }

        setSettingsBusy(true);
        setSettingsStatus("Saving settings…");

        try {

            if (changes.removeUsername)
                await e.setChatUsername(chat.id, null);

            if (changes.username)
                await e.setChatUsername(
                    chat.id,
                    changes.username
                );

            if (changes.title !== undefined)
                await e.setChatTitle(
                    chat.id,
                    changes.title
                );

            if (changes.description !== undefined)
                await e.setChatDescription(
                    chat.id,
                    changes.description
                );

            if (changes.photo)
                await e.setChatPhoto({
                    chatId: chat.id,
                    type: "photo",
                    media: changes.photo
                });

            if (changes.approve !== undefined)
                await e.toggleJoinRequests(
                    chat.id,
                    changes.approve
                );

            if (changes.protect !== undefined)
                await e.toggleContentProtection(
                    chat.id,
                    changes.protect
                );

            if (changes.signatures !== undefined) {

                const inputChannel =
                    await e.resolveChannel(chat.id);

                await e.call({
                    _: "channels.toggleSignatures",
                    channel: inputChannel,
                    signaturesEnabled: changes.signatures
                });

            }

            if (changes.slowMode !== undefined)
                await e.setSlowMode(
                    chat.id,
                    changes.slowMode
                );

            loadedChatSettings = {
                ...previous,
                title: changes.title ?? previous.title,
                about:
                    changes.description ??
                    previous.about,
                username:
                    changes.removeUsername
                        ? ""
                        : (changes.username ??
                            previous.username),
                approve:
                    changes.approve ??
                    previous.approve,
                protect:
                    changes.protect ??
                    previous.protect,
                signatures:
                    changes.signatures ??
                    previous.signatures,
                slowMode:
                    changes.slowMode ??
                    previous.slowMode
            };

            settingsFields.photo.value = "";
            settingsFields.setValues(
                {
                    type:
                        loadedChatSettings.megagroup
                            ? "supergroup"
                            : "channel",
                    title: loadedChatSettings.title,
                    description:
                        loadedChatSettings.about,
                    privacy:
                        loadedChatSettings.username
                            ? "public"
                            : "private",
                    username:
                        loadedChatSettings.username,
                    approve:
                        loadedChatSettings.approve,
                    protect:
                        loadedChatSettings.protect,
                    signatures:
                        loadedChatSettings.signatures,
                    slowMode:
                        loadedChatSettings.slowMode,
                    topics:
                        loadedChatSettings.forum
                },
                "existing"
            );

            setSettingsBusy(false);
            setSettingsStatus("Settings saved.");

            return true;

        } catch (error) {

            setSettingsBusy(false);
            setSettingsStatus(
                "Could not save settings: " +
                (error?.message || String(error)),
                true
            );

            return false;

        }

    }


    /* ------------------------------------------------------------------ */
    /* Chat list                                                           */
    /* ------------------------------------------------------------------ */

    let chats = window.telegramChats;

    if (!Array.isArray(chats)) {
        chats = await telegramListChats(500);
        window.telegramChats = chats;
    }

    const availableChats = chats
        .filter(x => x?.chat)
        .map(x => x.chat)
        .filter(
            chat =>
                Number(chat.id) !==
                TELEGRAM_OFFICIAL_CHAT_ID
        )
        .sort((a, b) =>
            String(a.title || a.firstName || a.id)
                .localeCompare(
                    String(b.title || b.firstName || b.id),
                    undefined,
                    {
                        numeric: true,
                        sensitivity: "base"
                    }
                )
        );

    chatSelect.innerHTML = "";

    for (const chat of availableChats) {
        const option = document.createElement("option");

        option.value = String(chat.id);
        option.textContent =
            `${chat.title || chat.firstName || "(untitled)"} [${chat.id}]`;

        chatSelect.appendChild(option);
    }

    const newChannelOption =
        document.createElement("option");

    newChannelOption.value =
        NEW_CHANNEL_OPTION_VALUE;

    newChannelOption.textContent =
        "➕ New channel…";

    chatSelect.appendChild(newChannelOption);

    function addChatOption(chat) {

        const option =
            document.createElement("option");

        option.value =
            String(chat.id);

        option.textContent =
            `${chat.title || chat.firstName || "(untitled)"} [${chat.id}]`;

        chatSelect.insertBefore(
            option,
            newChannelOption
        );

        return option;

    }

    buildChannelSettingsPanel();

    settingsDetails.addEventListener(
        "toggle",
        () => {

            if (
                !settingsDetails.open ||
                settingsMode !== "existing" ||
                loadedChatSettings
            ) {
                return;
            }

            const chat =
                availableChats.find(
                    item =>
                        String(item.id) ===
                        chatSelect.value
                );

            if (chat)
                loadSettingsForChat(chat);

        }
    );

    chatSelect.onchange =
        handleDestinationChange;

    if (availableChats.length)
        handleDestinationChange();
    else
        enterNewChannelMode();

    status.textContent =
        "Select individual files, add a folder, or combine both.";

    /* ------------------------------------------------------------------ */
    /* Cancel / start                                                      */
    /* ------------------------------------------------------------------ */

    cancelButton.onclick = () => {
        if (!uploadSessionActive || cancelButton.disabled)
            return;

        if (!confirm(
            "Cancel the current upload?\n\n" +
            "This will stop the current upload and any video preview generation. " +
            "Anything already sent to Telegram will remain there, but queued " +
            "files will not be uploaded.\n\n" +
            "Are you sure?"
        ))
            return;

        uploadCancelRequested = true;

        cancelQuickVideoRenders();

        cancelButton.disabled = true;
        cancelButton.style.background = "#555";

        status.textContent =
            "CANCELLING UPLOAD...\n\n" +
            "Stopping the current video render/upload and queued items.";
    };

    cancelButton.onmouseenter = () => {
        if (uploadSessionActive && !cancelButton.disabled)
            cancelButton.style.background = "#dc2626";
    };

    cancelButton.onmouseleave = () => {
        if (uploadSessionActive && !cancelButton.disabled)
            cancelButton.style.background = "#555";
    };

    function confirmChatOverwrite(chat, messageCount) {

        return new Promise(resolve => {

            /*
             * The uploader card uses the maximum CSS z-index, so the
             * shared dialog would otherwise open behind it.
             */
            const uploader =
                document.getElementById(
                    "__telegram_folder_uploader"
                );

            const uploaderZIndex =
                uploader?.style.zIndex || "";

            if (uploader)
                uploader.style.zIndex = "19000";

            const {
                overlay,
                box
            } = createInWindowDialog(
                "Overwrite chat contents?"
            );

            addInWindowDialogMessage(
                box,
                `"${chat.title || chat.firstName || chat.id}" already ` +
                `contains ${messageCount} message${messageCount === 1 ? "" : "s"}. ` +
                "Uploading the new album will permanently delete all of " +
                "them first."
            );

            addInWindowDialogMessage(
                box,
                "This cannot be undone."
            );

            const buttons =
                createInWindowDialogButtons(box);

            let finished =
                false;

            const finish = value => {

                if (finished)
                    return;

                finished =
                    true;

                document.removeEventListener(
                    "keydown",
                    onKeydown,
                    true
                );

                overlay.remove();

                if (uploader)
                    uploader.style.zIndex = uploaderZIndex;

                resolve(value);

            };

            const onKeydown = event => {

                if (event.key === "Escape") {

                    event.preventDefault();
                    event.stopPropagation();

                    finish(false);

                }

            };

            const cancel =
                createInWindowDialogButton(
                    buttons,
                    "Keep chat",
                    false
                );

            cancel.onclick =
                () => finish(false);

            const overwrite =
                createInWindowDialogButton(
                    buttons,
                    "Delete and upload",
                    true
                );

            overwrite.onclick =
                () => finish(true);

            document.addEventListener(
                "keydown",
                onKeydown,
                true
            );

            overlay.onclick =
                event => {

                    if (event.target === overlay)
                        finish(false);

                };

            cancel.focus();

        });

    }


    async function deleteChatMessages(chat, messages, onProgress) {

        const byId =
            new Map(
                messages.map(message => [
                    message.id,
                    message
                ])
            );

        const supportsById =
            typeof e.deleteMessagesById === "function";

        const supportsMessages =
            typeof e.deleteMessages === "function";

        if (!supportsById && !supportsMessages) {

            throw new Error(
                "This Telegram client does not support message deletion."
            );

        }

        const ids =
            messages
                .map(message => message.id)
                .filter(Number.isFinite);

        const batchSize =
            100;

        let done =
            0;

        for (
            let index = 0;
            index < ids.length;
            index += batchSize
        ) {

            throwIfUploadCancelled();

            const batch =
                ids.slice(
                    index,
                    index + batchSize
                );

            if (supportsById) {

                await e.deleteMessagesById(
                    chat.id,
                    batch
                );

            } else {

                await e.deleteMessages(
                    batch
                        .map(id => byId.get(id))
                        .filter(Boolean)
                );

            }

            done +=
                batch.length;

            onProgress?.(
                done,
                ids.length
            );

        }

    }


    function uploadItemDisplayName(item) {

        const isQuick =
            item.kind === "quick-video" ||
            item.kind === "quick-image";

        return isQuick
            ? `Quick — ${item.originalName}`
            : item.total > 1
                ? `${item.originalName} — Part ${item.part}/${item.total}`
                : item.originalName;
    }


    function notifyUploadWorkers(context) {

        const waiters =
            Array.from(context.waiters);

        context.waiters.clear();

        for (const resolve of waiters)
            resolve();
    }


    function waitForUploadWork(context) {

        return new Promise(resolve => {

            context.waiters.add(resolve);

        });
    }


    async function withFloodRetry(label, task) {

        for (let attempt = 0; ; attempt++) {

            try {

                return await task();

            } catch (error) {

                if (
                    error?.cancelled ||
                    uploadCancelRequested
                ) {
                    throw error;
                }

                const wait =
                    parseFloodWaitSeconds(error);

                if (
                    !wait ||
                    wait >
                        MAX_AUTO_FLOOD_WAIT_SECONDS ||
                    attempt >= UPLOAD_MAX_FLOOD_RETRIES
                ) {
                    throw error;
                }

                status.textContent =
                    `Telegram rate limit reached while uploading:\n` +
                    `${label}\n\n` +
                    `Waiting ${wait}s before retrying…`;

                await waitForFloodSeconds(
                    wait
                );

                throwIfUploadCancelled();

            }

        }
    }


    async function createPlaceholderPaced(context, index) {

        const planItem =
            context.uploadPlan[index];

        const label =
            planItem.kind === "metadata"
                ? METADATA_FILENAME
                : planItem.originalName;

        for (
            let attempt = 0;
            ;
            attempt++
        ) {

            try {

                return await createPlaceholder(
                    context.peer
                );

            } catch (error) {

                if (
                    error?.cancelled ||
                    uploadCancelRequested
                ) {
                    throw error;
                }

                const wait =
                    parseFloodWaitSeconds(error);

                if (
                    !wait ||
                    wait >
                        MAX_AUTO_FLOOD_WAIT_SECONDS ||
                    attempt >=
                        PLACEHOLDER_MAX_FLOOD_RETRIES
                ) {
                    throw error;
                }

                /*
                 * A surfaced flood wait means the current interval is
                 * still too fast for this account/chat. Increase it for
                 * the remaining placeholders as well as waiting out
                 * this one. It is gradually reduced again after a long
                 * clean streak below.
                 */
                context.placeholderDelayMs =
                    Math.min(
                        PLACEHOLDER_MAX_DELAY_MS,
                        Math.max(
                            PLACEHOLDER_CREATE_DELAY_MS,
                            Math.round(
                                context.placeholderDelayMs *
                                1.25
                            ) + 100
                        )
                    );

                context.placeholderCleanStreak =
                    0;

                status.textContent =
                    `Telegram rate limit reached while creating placeholders.\n\n` +
                    `Waiting ${wait}s before retrying "${label}"…`;

                await waitForFloodSeconds(
                    wait
                );

                throwIfUploadCancelled();

            }

        }
    }


    async function uploadQueueItem(context, item, index) {

        const total =
            context.uploadPlan.length;

        const displayName =
            uploadItemDisplayName(item);

        const progress =
            createProgressRow(displayName);

        try {

            status.textContent =
                `Uploading...\n\n` +
                `[${index + 1}/${total}] ${displayName}\n` +
                `Message ID: ${item.messageID}\n` +
                `Uploaded: ${context.completed}/${total}`;

            let uploadedMedia;

            if (item.kind === "quick-image") {

                uploadedMedia =
                    await withFloodRetry(
                        displayName,
                        () => uploadQuickPhoto(
                            context.peer,
                            item.sourceFile,
                            (uploaded, size) =>
                                updateProgress(
                                    progress,
                                    uploaded,
                                    size
                                )
                        )
                    );

            } else if (item.kind === "quick-video") {

                // Pass the progress row itself (NOT a callback) so
                // rendering progress can be drawn on the same bar
                // before it reverts to upload progress.
                uploadedMedia =
                    await withFloodRetry(
                        displayName,
                        () => uploadQuickVideo(
                            context.peer,
                            item.sourceFile,
                            progress
                        )
                    );

            } else {

                const uploadedDocument =
                    await withFloodRetry(
                        displayName,
                        () => uploadMedia(
                            context.peer,
                            item.sourceFile,
                            (uploaded, size) =>
                                updateProgress(
                                    progress,
                                    uploaded,
                                    size
                                ),
                            {
                                source:
                                    item.source ||
                                    item.sourceFile,
                                part:
                                    item.part ?? 1
                            }
                        )
                    );

                uploadedMedia = {
                    document: uploadedDocument
                };

            }

            await withFloodRetry(
                displayName,
                () => replaceMessageWithUploadedMedia(
                    context.peer,
                    item.messageID,
                    uploadedMedia
                )
            );

            item.uploaded =
                true;

            item.error =
                null;

            context.completed++;

            if (ensureProgressElements(progress)) {

                progress.bar.style.background =
                    UPLOAD_COLOR;

                progress.bar.style.width =
                    "100%";

                progress.text.textContent =
                    "Complete";

            }

            setTimeout(
                () => progress.row.remove(),
                1500
            );

        } catch (error) {

            item.error =
                error;

            if (!context.failure) {

                context.failure =
                    error;

                context.failedItem =
                    item;

                context.failedIndex =
                    index;

            }

            context.stopped =
                true;

            if (ensureProgressElements(progress)) {

                progress.text.textContent =
                    (
                        error?.cancelled ||
                        uploadCancelRequested
                    )
                        ? "Cancelled"
                        : "Failed";

            }

            if (
                !error?.cancelled &&
                !uploadCancelRequested
            ) {

                uploadFailed =
                    true;

                cancelQuickVideoRenders();

                const failureMessage =
                    `Upload failed for "${item.originalName}"` +
                    (
                        item.total > 1
                            ? ` part ${item.part}/${item.total}`
                            : ""
                    ) +
                    ` (message ${item.messageID}): ` +
                    (error?.message || String(error));

                status.textContent =
                    `UPLOAD PAUSED\n\n${failureMessage}\n\n` +
                    `Placeholders created: ` +
                    `${context.creationIndex}/${total}\n` +
                    `Messages uploaded: ` +
                    `${context.completed}/${total}\n\n` +
                    `Use "Continue upload" to resume.`;

                console.error(
                    "[Telegram Folder Uploader]",
                    failureMessage,
                    error
                );

            }

            throw error;

        }
    }


    async function runUploadQueue(context) {

        const total =
            context.uploadPlan.length;

        context.stopped =
            false;

        context.failure =
            null;

        context.failedItem =
            null;

        context.uploadCursor =
            0;

        context.creationDone =
            context.creationIndex >= total;

        context.metadataDone =
            context.metadataBuilt === true;

        context.completed =
            context.queue.filter(
                item => item?.uploaded
            ).length;

        uploadRunning =
            true;

        updateResumeButton();
        setCancelButtonActive(true);

        progressContainer.innerHTML =
            "";

        const worker =
            async () => {

                for (;;) {

                    if (
                        context.stopped ||
                        uploadCancelRequested
                    ) {
                        return;
                    }

                    if (
                        context.uploadCursor >=
                        total
                    ) {
                        return;
                    }

                    const index =
                        context.uploadCursor;

                    const item =
                        context.queue[index];

                    /*
                     * Placeholders are created in plan order, and the
                     * metadata message only becomes ready after the
                     * metadata document is built. Wait for that work
                     * instead of spinning.
                     */
                    if (!item || !item.ready) {

                        if (
                            context.creationDone &&
                            context.metadataDone
                        ) {
                            context.uploadCursor++;
                            continue;
                        }

                        await waitForUploadWork(
                            context
                        );

                        continue;

                    }

                    context.uploadCursor++;

                    if (item.uploaded)
                        continue;

                    await uploadQueueItem(
                        context,
                        item,
                        index
                    );

                }

            };

        /*
         * Start the workers first. They wait for each placeholder as it
         * appears, so media uploads overlap with the deliberate delay
         * between placeholder creations.
         */
        const workers =
            Array.from(
                {
                    length:
                        Math.max(
                            1,
                            Math.min(3, total)
                        )
                },
                () => worker()
            );

        let creationError =
            null;

        try {

            for (
                let i = context.creationIndex;
                i < total;
                i++
            ) {

                if (
                    context.stopped ||
                    uploadCancelRequested
                ) {
                    break;
                }

                throwIfUploadCancelled();

                const planItem =
                    context.uploadPlan[i];

                const attemptStartedAt =
                    Date.now();

                status.textContent =
                    `[${i + 1}/${total}] ` +
                    `Creating placeholder:\n` +
                    planItem.originalName;

                const messageID =
                    await createPlaceholderPaced(
                        context,
                        i
                    );

                context.queue[i] = {

                    ...planItem,
                    index: i,
                    messageID,
                    isNewPlaceholder: true,
                    uploaded: false,
                    error: null,

                    ready:
                        planItem.kind !== "metadata"

                };

                context.creationIndex =
                    i + 1;

                notifyUploadWorkers(context);

                context.placeholderCleanStreak =
                    (context.placeholderCleanStreak || 0) + 1;

                if (
                    context.placeholderCleanStreak >=
                    PLACEHOLDER_ADAPT_AFTER_CLEAN
                ) {

                    context.placeholderCleanStreak =
                        0;

                    context.placeholderDelayMs =
                        Math.max(
                            PLACEHOLDER_CREATE_DELAY_MS,
                            context.placeholderDelayMs - 100
                        );

                }

                /*
                 * Schedule start-to-start, so the request time counts
                 * toward the one-second interval instead of being added
                 * on top of a fixed sleep.
                 */
                if (i + 1 < total) {

                    const elapsed =
                        Date.now() - attemptStartedAt;

                    const wait =
                        Math.max(
                            0,
                            context.placeholderDelayMs - elapsed
                        );

                    if (wait > 0) {

                        status.textContent =
                            `Pacing next placeholder ` +
                            `(${i + 2}/${total})…\n\n` +
                            `Messages uploaded: ` +
                            `${context.completed}/${total}`;

                        await sleep(wait);

                        if (
                            context.stopped ||
                            uploadCancelRequested
                        ) {
                            break;
                        }

                        throwIfUploadCancelled();

                    }

                }

            }

        } catch (error) {

            creationError =
                error;

            context.failure =
                context.failure ||
                error;

            context.stopped =
                true;

        }

        context.creationDone =
            true;

        notifyUploadWorkers(context);

        if (
            !creationError &&
            !context.stopped &&
            !uploadCancelRequested &&
            !context.metadataBuilt
        ) {

            try {

                status.textContent =
                    "Reading metadata (tags, faces, dimensions)…";

                const metadataEntry =
                    context.queue.find(
                        item =>
                            item?.kind === "metadata"
                    );

                const metadata =
                    await buildMetadataDocument(
                        context.files,
                        context.queue,
                        context.chat,
                        (done, count) => {

                            status.textContent =
                                `Reading metadata (${done}/${count})…\n\n` +
                                `Tags, faces and dimensions are read while uploads continue.`;

                        }
                    );

                if (metadataEntry) {

                    metadataEntry.sourceFile =
                        new File(
                            [metadata.json],
                            METADATA_FILENAME,
                            {
                                type:
                                    "application/json",
                                lastModified:
                                    Date.now()
                            }
                        );

                    metadataEntry.ready =
                        true;

                }

                context.metadata =
                    metadata;

                context.metadataBuilt =
                    true;

            } catch (error) {

                context.failure =
                    context.failure ||
                    error;

                context.stopped =
                    true;

            }

        }

        context.metadataDone =
            true;

        notifyUploadWorkers(context);

        const results =
            await Promise.allSettled(
                workers
            );

        uploadRunning =
            false;

        updateResumeButton();

        if (uploadCancelRequested)
            return { cancelled: true };

        const workerFailure =
            results.find(
                result =>
                    result.status === "rejected"
            )?.reason;

        const failure =
            context.failure ||
            (
                workerFailure &&
                !workerFailure.cancelled
                    ? workerFailure
                    : null
            ) ||
            (
                creationError &&
                !creationError.cancelled
                    ? creationError
                    : null
            );

        if (failure)
            return { error: failure };

        const incomplete =
            context.queue.find(
                item => item && !item.uploaded
            );

        if (incomplete) {

            return {
                error: new Error(
                    `Upload incomplete: "${incomplete.originalName}" was not uploaded.`
                )
            };

        }

        return { ok: true };

    }


    function handleUploadOutcome(context, outcome) {

        if (
            outcome.cancelled ||
            uploadCancelRequested
        ) {

            resumableUpload =
                null;

            updateResumeButton();

            status.textContent =
                "UPLOAD CANCELLED\n\n" +
                "The current upload/render was stopped. " +
                "Messages already created or uploaded were left in the chat.";

            return;

        }

        if (outcome.error) {

            resumableUpload =
                context;

            updateResumeButton();

            const total =
                context.uploadPlan.length;

            const failureNote =
                context.failedItem
                    ? `Stopped at [${context.failedIndex + 1}/${total}] ` +
                      `${uploadItemDisplayName(context.failedItem)}\n\n`
                    : "";

            status.textContent =
                `UPLOAD PAUSED\n\n` +
                failureNote +
                `${outcome.error?.message || String(outcome.error)}\n\n` +
                `Placeholders created: ${context.creationIndex}/${total}\n` +
                `Messages uploaded: ${context.completed}/${total}\n\n` +
                `Use "Continue upload" to resume from this point.`;

            console.error(
                "[Telegram Folder Uploader]",
                outcome.error
            );

            return;

        }

        resumableUpload =
            null;

        updateResumeButton();

        const {
            files,
            quickItems,
            originalItems,
            metadata
        } = context;

        status.textContent =
            `Upload complete.\n\n` +
            `${files.length} source file(s) uploaded.\n` +
            `1 metadata message (${METADATA_FILENAME}).\n` +
            `${quickItems.length} quick-media message(s).\n` +
            `${originalItems.length} original-document message(s).\n\n` +
            `Order: metadata → quick videos → quick images → video documents → image documents.`;

        if (
            typeof upsertTagIndexAlbum ===
            "function"
        ) {

            void upsertTagIndexAlbum({
                key: "tg:" + Number(context.chat.id),
                title: context.chat.title || "",
                tags:
                    metadata?.doc?.tags || []
            });

        }

        clearSelectionAfterUpload();

    }


    startButton.onclick = async () => {
        if (startButton.disabled)
            return;

        // Validate first so an early return can't leave the Cancel
        // button showing with nothing running.
        const chosenFiles = Array.from(selectedFiles.values());

        if (!chosenFiles.length)
            return void alert("Select one or more files, or add a folder.");

        startButton.disabled = true;

        try {

            if (
                settingsMode === "new" ||
                chatSelect.value ===
                    NEW_CHANNEL_OPTION_VALUE
            ) {

                const created =
                    await createChannelFromPanel();

                if (!created) {
                    startButton.disabled = false;
                    return;
                }

            } else if (settingsMode === "existing") {

                const selectedChat =
                    availableChats.find(
                        item =>
                            String(item.id) ===
                            chatSelect.value
                    );

                if (selectedChat) {

                    const saved =
                        await applyExistingChannelSettings(
                            selectedChat
                        );

                    if (!saved) {
                        startButton.disabled = false;
                        return;
                    }

                }

            }

        } catch (error) {

            startButton.disabled = false;

            alert(
                "Could not apply channel settings:\n\n" +
                (error?.message || String(error))
            );

            return;

        }

        const chatId = Number(chatSelect.value);

        if (!Number.isFinite(chatId)) {
            startButton.disabled = false;
            return void alert("Select a destination chat.");
        }

        const chat = availableChats.find(
            x => String(x.id) === String(chatId)
        );

        if (!chat) {
            startButton.disabled = false;
            return void alert("Destination chat was not found.");
        }

        if (resumableUpload) {

            const restart =
                confirm(
                    "An unfinished upload is available.\n\n" +
                    "Start from scratch instead? The existing partial " +
                    "messages in the destination chat may be deleted and " +
                    "the upload will begin again."
                );

            if (!restart) {
                startButton.disabled = false;
                return;
            }

            resumableUpload =
                null;

            updateResumeButton();

        }

        uploadCancelRequested = false;
        uploadFailed = false;
        setCancelButtonActive(true);

        startButton.disabled = true;
        addFilesButton.disabled = true;
        addFolderButton.disabled = true;
        clearButton.disabled = true;
        removeAllButton.disabled = true;
        chatSelect.disabled = true;

        try {
            const files = sortUploadFiles(
                chosenFiles.filter(isSupportedMedia)
            );

            if (!files.length)
                throw new Error(
                    "No supported image or video files were found."
                );

            const videos = files.filter(isVideoFile);
            const images = files.filter(f => !isVideoFile(f) && isImageFile(f));

            // Final message order:
            //   1. quick videos
            //   2. quick images
            //   3. original video documents
            //   4. original image documents
            //   5. metadata.json
            //
            // Large original videos are split into multiple document
            // messages, but their parts stay together and in source order.
            const quickItems = [
                ...videos.map(file => ({
                    kind: "quick-video",
                    sourceFile: file,
                    originalName: file.name
                })),
                ...images.map(file => ({
                    kind: "quick-image",
                    sourceFile: file,
                    originalName: file.name
                }))
            ];

            const originalItems = [];

            // Every original (video or image) larger than MAX_PART_SIZE is
            // split into consecutive parts that stay together, in order.
            for (const file of [...videos, ...images]) {
                if (file.size > MAX_PART_SIZE) {
                    originalItems.push(...splitFile(file));
                } else {
                    originalItems.push({
                        file,
                        part: 1,
                        total: 1,
                        originalName: file.name,
                        source: file
                    });
                }
            }

            // The metadata document is the very last message: it is
            // created after all media so its contents can reference the
            // real message IDs (newest manifest wins on the site).
            const uploadPlan = [
                ...quickItems,
                ...originalItems.map(item => ({
                    kind: "original-document",
                    source: item.source,
                    sourceFile: item.file,
                    originalName: item.originalName,
                    part: item.part,
                    total: item.total
                })),
                {
                    kind: "metadata",
                    sourceFile: null,
                    originalName: METADATA_FILENAME
                }
            ];

            const peer = await e.resolvePeer(chat.id);

            status.textContent =
                `Selected files: ${files.length}\n` +
                `Videos: ${videos.length}\n` +
                `Images: ${images.length}\n\n` +
                `Messages required: ${uploadPlan.length}\n\n` +
                `Checking existing messages...`;

            let existingMessages = [];

            for await (
                const message of
                e.iterHistory(chat.id, { chunkSize: 100 })
            ) {
                throwIfUploadCancelled();

                if (message?.raw?._ === "message")
                    existingMessages.push(message);
            }

            existingMessages.sort((a, b) => Number(a.id) - Number(b.id));

            if (existingMessages.length) {

                status.textContent =
                    `Existing messages: ${existingMessages.length}\n\n` +
                    `Waiting for confirmation to overwrite the chat…`;

                const overwrite =
                    await confirmChatOverwrite(
                        chat,
                        existingMessages.length
                    );

                if (!overwrite) {

                    status.textContent =
                        "UPLOAD CANCELLED\n\n" +
                        "The selected chat was left unchanged.";

                    return;

                }

                status.textContent =
                    `Deleting ${existingMessages.length} existing message(s)…`;

                try {

                    await deleteChatMessages(
                        chat,
                        existingMessages,
                        (done, total) => {

                            status.textContent =
                                `Deleting existing messages ` +
                                `(${done}/${total})…`;

                        }
                    );

                } catch (error) {

                    if (error?.cancelled)
                        throw error;

                    throw new Error(
                        "Could not delete the existing chat messages: " +
                        (error?.message || String(error))
                    );

                }

                existingMessages = [];

            }

            const existingCount = Math.min(
                uploadPlan.length,
                existingMessages.length
            );

            const context = {

                files,
                videos,
                images,
                quickItems,
                originalItems,
                uploadPlan,

                peer,
                chat,
                chatId,

                queue:
                    new Array(uploadPlan.length),

                creationIndex:
                    existingCount,

                uploadCursor:
                    0,

                creationDone:
                    false,

                metadataDone:
                    false,

                metadataBuilt:
                    false,

                metadata:
                    null,

                completed:
                    0,

                stopped:
                    false,

                failure:
                    null,

                failedItem:
                    null,

                waiters:
                    new Set(),

                placeholderDelayMs:
                    PLACEHOLDER_CREATE_DELAY_MS,

                placeholderCleanStreak:
                    0

            };

            for (let i = 0; i < existingCount; i++) {

                const item =
                    uploadPlan[i];

                context.queue[i] = {

                    ...item,
                    index: i,
                    messageID:
                        existingMessages[i].id,
                    isNewPlaceholder:
                        false,
                    uploaded:
                        false,
                    error:
                        null,
                    ready:
                        item.kind !== "metadata"

                };

            }

            let outcome;

            try {

                outcome =
                    await runUploadQueue(
                        context
                    );

            } catch (error) {

                outcome = { error };

            }

            handleUploadOutcome(
                context,
                outcome
            );

        } catch (error) {
            if (uploadCancelRequested || error?.cancelled) {
                status.textContent =
                    "UPLOAD CANCELLED\n\n" +
                    "The current upload/render was stopped. " +
                    "Messages already created or uploaded were left in the chat.";
            } else {
                status.textContent =
                    `UPLOAD FAILED\n\n${error?.message || String(error)}`;

                console.error("[Telegram Folder Uploader]", error);

                alert(
                    "Telegram folder upload failed:\n\n" +
                    (error?.message || String(error))
                );
            }
        } finally {
            cancelQuickVideoRenders();
            setCancelButtonActive(false);
            updateResumeButton();

            startButton.disabled = false;
            addFilesButton.disabled = false;
            addFolderButton.disabled = false;
            clearButton.disabled = false;
            removeAllButton.disabled = false;
            chatSelect.disabled = false;
        }
    };


    resumeButton.onclick = async () => {

        const context =
            resumableUpload;

        if (
            !context ||
            uploadRunning
        ) {
            return;
        }

        resumableUpload =
            null;

        updateResumeButton();

        uploadCancelRequested =
            false;

        uploadFailed =
            false;

        startButton.disabled =
            true;

        addFilesButton.disabled =
            true;

        addFolderButton.disabled =
            true;

        clearButton.disabled =
            true;

        removeAllButton.disabled =
            true;

        chatSelect.disabled =
            true;

        setCancelButtonActive(true);

        try {

            let outcome;

            try {

                outcome =
                    await runUploadQueue(
                        context
                    );

            } catch (error) {

                outcome = { error };

            }

            handleUploadOutcome(
                context,
                outcome
            );

        } finally {

            cancelQuickVideoRenders();
            setCancelButtonActive(false);
            updateResumeButton();

            startButton.disabled =
                false;

            addFilesButton.disabled =
                false;

            addFolderButton.disabled =
                false;

            clearButton.disabled =
                false;

            removeAllButton.disabled =
                false;

            chatSelect.disabled =
                false;

        }

    };

}
