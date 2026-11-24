/*
 * 29-album-manifest-tool.js
 *
 * The album-page manifest tool.
 *
 * An album is built normally: create an empty album, name it, add
 * images, and edit tags. Nothing scans or generates until the user
 * presses the manifest button, at which point missing image dimensions
 * are read and a gallery-manifest/v1 JSON is produced. The user uploads
 * that JSON and pastes its URL here; the URL is stored in the album
 * record (and therefore in the album.txt line).
 *
 * The schema and builders live in 02-gallery-manifest.js.
 */

const ALBUM_MANIFEST_SCAN_CONCURRENCY = 4;

const ALBUM_MANIFEST_IMAGE_TIMEOUT_MS = 6000;


function readManifestImageDimensions(url, timeoutMs = ALBUM_MANIFEST_IMAGE_TIMEOUT_MS) {

    return new Promise(resolve => {

        if (!url) {

            resolve(null);
            return;

        }

        const image =
            new Image();

        let settled =
            false;

        const finish = value => {

            if (settled)
                return;

            settled = true;

            clearTimeout(timer);

            image.onload = null;
            image.onerror = null;

            resolve(value);

        };

        const timer =
            setTimeout(
                () => finish(null),
                timeoutMs
            );

        image.onload =
            () => finish({
                width: image.naturalWidth,
                height: image.naturalHeight
            });

        image.onerror =
            () => finish(null);

        image.decoding =
            "async";

        image.src =
            url;

    });

}


async function hydrateAlbumManifestDimensions(album, onProgress) {

    const pending =
        [];

    const imageKeys =
        album?.images && typeof album.images === "object"
            ? Object.keys(album.images)
            : [];

    for (const key of imageKeys) {

        const image =
            album.images[key];

        if (!image)
            continue;

        if (
            Number(image.width) > 0 &&
            Number(image.height) > 0
        ) {
            continue;
        }

        const url =
            getBestGuessImageURL(album, image, "thumb") ||
            getBestGuessImageURL(album, image, "full");

        if (!url)
            continue;

        pending.push({ image, url });

    }

    onProgress(0, pending.length);

    let done = 0;

    for (
        let index = 0;
        index < pending.length;
        index += ALBUM_MANIFEST_SCAN_CONCURRENCY
    ) {

        const chunk =
            pending.slice(
                index,
                index + ALBUM_MANIFEST_SCAN_CONCURRENCY
            );

        await Promise.all(
            chunk.map(async ({ image, url }) => {

                const size =
                    await readManifestImageDimensions(url);

                if (size) {

                    image.width =
                        size.width;

                    image.height =
                        size.height;

                }

                done++;

                onProgress(done, pending.length);

            })
        );

    }

}


function openAlbumManifestDialog(album = currentAlbum) {

    const targetAlbum =
        album || currentAlbum;

    if (!targetAlbum) {

        alert("Open an album first.");
        return;

    }

    document.getElementById("albumManifestOverlay")?.remove();

    const overlay =
        document.createElement("div");

    overlay.id =
        "albumManifestOverlay";

    overlay.className =
        "app-dialog-overlay";

    const box =
        document.createElement("div");

    box.className =
        "app-dialog album-manifest-dialog";

    const title =
        document.createElement("div");

    title.className =
        "app-dialog-title";

    title.textContent =
        "Album Manifest";

    const closeButton =
        document.createElement("button");

    closeButton.type =
        "button";

    closeButton.className =
        "album-manifest-close";

    closeButton.textContent =
        "×";

    closeButton.title =
        "Close";

    closeButton.onclick =
        () => overlay.remove();

    const description =
        document.createElement("div");

    description.className =
        "app-dialog-description";

    description.textContent =
        "Generate a gallery-manifest/v1 file from this album. Upload the " +
        "JSON wherever you host it, then use the album's edit mode and " +
        "Generate album record to store its URL.";

    const status =
        document.createElement("div");

    status.className =
        "album-manifest-status";

    status.textContent =
        "Press Scan & generate to read this album.";

    const generate =
        document.createElement("button");

    generate.type =
        "button";

    generate.className =
        "app-button";

    generate.textContent =
        "Scan & generate";

    const output =
        document.createElement("textarea");

    output.className =
        "album-manifest-output";

    output.readOnly =
        true;

    output.spellcheck =
        false;

    output.rows =
        14;

    const actions =
        document.createElement("div");

    actions.className =
        "album-manifest-actions";

    const copy =
        document.createElement("button");

    copy.type =
        "button";

    copy.className =
        "app-button";

    copy.textContent =
        "Copy JSON";

    copy.onclick =
        () => {

            if (!output.value)
                return;

            navigator.clipboard
                ?.writeText(output.value)
                .then(() => {
                    copy.textContent = "Copied";
                    setTimeout(() => {
                        copy.textContent = "Copy JSON";
                    }, 1200);
                })
                .catch(() => {});

        };

    const download =
        document.createElement("button");

    download.type =
        "button";

    download.className =
        "app-button";

    download.textContent =
        "Download JSON";

    download.onclick =
        () => {

            if (!output.value)
                return;

            const name =
                String(targetAlbum.name || "album")
                    .replace(/[^\w -]+/g, "")
                    .replace(/\s+/g, "_") ||
                "album";

            const blob =
                new Blob(
                    [output.value],
                    { type: "application/json" }
                );

            const href =
                URL.createObjectURL(blob);

            const link =
                document.createElement("a");

            link.href = href;
            link.download = name + "-manifest.json";
            link.click();

            setTimeout(
                () => URL.revokeObjectURL(href),
                1000
            );

        };

    generate.onclick =
        async () => {

            generate.disabled =
                true;

            status.textContent =
                "Scanning metadata…";

            try {

                await hydrateAlbumManifestDimensions(
                    targetAlbum,
                    (done, total) => {

                        if (!overlay.isConnected)
                            return;

                        status.textContent =
                            total
                                ? `Scanning ${done}/${total}…`
                                : "Building manifest…";

                    }
                );

                if (!overlay.isConnected)
                    return;

                const manifest =
                    buildGalleryManifestFromAlbum(targetAlbum);

                if (!manifest) {

                    output.value = "";
                    status.textContent =
                        "Add at least one image to this album first.";

                    return;

                }

                output.value =
                    JSON.stringify(manifest, null, 2);

                status.textContent =
                    `${manifest.items.length} item(s) ready. Upload the ` +
                    "JSON, then use the album's edit mode and Generate " +
                    "album record to store its URL.";

            } catch {

                status.textContent =
                    "Could not generate the manifest.";

            } finally {

                generate.disabled =
                    false;

            }

        };

    actions.append(
        generate,
        copy,
        download
    );

    box.append(
        closeButton,
        title,
        description,
        status,
        actions,
        output
    );

    overlay.appendChild(box);

    overlay.onclick =
        event => {

            if (event.target === overlay)
                overlay.remove();

        };

    document.body.appendChild(overlay);

}


const albumManifestButton =
    document.getElementById("generateManifest");

if (albumManifestButton) {

    albumManifestButton.onclick =
        () => openAlbumManifestDialog();

}
