/*
 * 20-albums-persistence.js
 *
 * Loads albums from siteConfig.album (a .txt of newline-separated
 * compressed album blobs -- see 00-config-and-state.js) plus
 * anything saved locally, and saves edits back to storage. Every
 * album read from either source is decompressed on the way in; every
 * album written back out is compressed on the way out.
 */

const SAVED_ALBUMS_STORAGE_KEY =
    "savedAlbums";

const ALBUM_LOCAL_EDITS_STORAGE_KEY =
    "albumLocalEdits";

const SAVED_ALBUM_EDIT_BASES_STORAGE_KEY =
    "savedAlbumEditBases";

const PUBLISHED_ALBUM_EDIT_BASES_STORAGE_KEY =
    "publishedAlbumEditBases";


function getAlbumLocalEditsRaw() {

    try {

        const parsed =
            JSON.parse(
                localStorage.getItem(
                    ALBUM_LOCAL_EDITS_STORAGE_KEY
                ) || "{}"
            );

        return (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        )
            ? parsed
            : {};

    } catch {

        return {};

    }

}


async function getAlbumLocalEdits() {

    const raw =
        getAlbumLocalEditsRaw();

    const edits =
        {};

    for (const [id, compressed] of Object.entries(raw)) {

        try {

            edits[id] =
                await decompressAlbum(compressed);

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress a local album edit",
                {
                    id,
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    return edits;

}


async function saveAlbumLocalEdit(album) {

    if (!album?.id)
        return;

    const raw =
        getAlbumLocalEditsRaw();

    const snapshot = {
        ...album
    };

    /*
     * Runtime-only flags and the pristine base record must not be
     * persisted with the edit snapshot. Derived image arrays are
     * rebuilt on load.
     */
    for (const key of Object.keys(snapshot)) {

        if (key.startsWith("_"))
            delete snapshot[key];

    }

    delete snapshot.storage;
    delete snapshot.temporary;
    delete snapshot.localEdited;

    snapshot.edited =
        true;

    raw[album.id] =
        await compressAlbum(snapshot);

    localStorage.setItem(
        ALBUM_LOCAL_EDITS_STORAGE_KEY,
        JSON.stringify(raw)
    );

    album.localEdited =
        true;

}


/*
 * A serialisable copy of an album record with runtime-only fields
 * removed. Used to remember what a remote album looked like before
 * local edits so edit mode can keep marking deviations after a save
 * and a full reload.
 */
function cloneAlbumRecord(album) {

    if (!album)
        return null;

    const clone =
        JSON.parse(
            JSON.stringify(album)
        );

    for (const key of Object.keys(clone)) {

        if (key.startsWith("_"))
            delete clone[key];

    }

    delete clone.localEdited;
    delete clone.savedEdited;
    delete clone.storage;
    delete clone.temporary;

    return clone;

}


function deleteAlbumLocalEdit(id) {

    if (!id)
        return;

    const raw =
        getAlbumLocalEditsRaw();

    if (!(id in raw))
        return;

    delete raw[id];

    localStorage.setItem(
        ALBUM_LOCAL_EDITS_STORAGE_KEY,
        JSON.stringify(raw)
    );

}


/*
 * Saved albums overwrite their stored record when edited, so the
 * pre-edit version is kept separately. "Remove local edits" restores
 * this snapshot instead of deleting the saved album.
 */
function getSavedAlbumEditBasesRaw() {

    try {

        const parsed =
            JSON.parse(
                localStorage.getItem(
                    SAVED_ALBUM_EDIT_BASES_STORAGE_KEY
                ) || "{}"
            );

        return (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        )
            ? parsed
            : {};

    } catch {

        return {};

    }

}


async function getSavedAlbumEditBases() {

    const raw =
        getSavedAlbumEditBasesRaw();

    const bases =
        {};

    for (const [id, compressed] of Object.entries(raw)) {

        try {

            bases[id] =
                await decompressAlbum(compressed);

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress a saved-album edit base",
                {
                    id,
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    return bases;

}


async function getSavedAlbumEditBase(id) {

    if (!id)
        return null;

    const raw =
        getSavedAlbumEditBasesRaw();

    if (!raw[id])
        return null;

    try {

        return await decompressAlbum(raw[id]);

    } catch {

        return null;

    }

}


async function saveSavedAlbumEditBase(id, album) {

    if (
        !id ||
        !album ||
        typeof cloneAlbumRecord !== "function"
    ) {
        return;
    }

    const raw =
        getSavedAlbumEditBasesRaw();

    /*
     * Never replace an existing base: it must stay the version before
     * the first local edit so repeated saves remain revertible.
     */
    if (id in raw)
        return;

    raw[id] =
        await compressAlbum(
            cloneAlbumRecord(album)
        );

    localStorage.setItem(
        SAVED_ALBUM_EDIT_BASES_STORAGE_KEY,
        JSON.stringify(raw)
    );

}


function deleteSavedAlbumEditBase(id) {

    if (!id)
        return;

    const raw =
        getSavedAlbumEditBasesRaw();

    if (!(id in raw))
        return;

    delete raw[id];

    localStorage.setItem(
        SAVED_ALBUM_EDIT_BASES_STORAGE_KEY,
        JSON.stringify(raw)
    );

}


function hasSavedAlbumEditBase(id) {

    if (!id)
        return false;

    return id in getSavedAlbumEditBasesRaw();

}


/*
 * Published albums are records that were generated from an edit-mode
 * view and written back to the album library. Keep the record they
 * replaced so a later edit session can still show removed tags and
 * changed images relative to what was originally published.
 */
function getPublishedAlbumEditBasesRaw() {

    try {

        const parsed =
            JSON.parse(
                localStorage.getItem(
                    PUBLISHED_ALBUM_EDIT_BASES_STORAGE_KEY
                ) || "{}"
            );

        return (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        )
            ? parsed
            : {};

    } catch {

        return {};

    }

}


async function getPublishedAlbumEditBases() {

    const raw =
        getPublishedAlbumEditBasesRaw();

    const bases =
        {};

    for (const [id, compressed] of Object.entries(raw)) {

        try {

            bases[id] =
                await decompressAlbum(compressed);

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress a published edit base",
                {
                    id,
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    return bases;

}


async function getPublishedAlbumEditBase(id) {

    if (!id)
        return null;

    const raw =
        getPublishedAlbumEditBasesRaw();

    if (!raw[id])
        return null;

    try {

        return await decompressAlbum(raw[id]);

    } catch {

        return null;

    }

}


async function savePublishedAlbumEditBase(id, album) {

    if (
        !id ||
        !album ||
        typeof cloneAlbumRecord !== "function"
    ) {
        return;
    }

    const raw =
        getPublishedAlbumEditBasesRaw();

    const base =
        cloneAlbumRecord(album);

    base.id =
        id;

    raw[id] =
        await compressAlbum(base);

    localStorage.setItem(
        PUBLISHED_ALBUM_EDIT_BASES_STORAGE_KEY,
        JSON.stringify(raw)
    );

}


function deletePublishedAlbumEditBase(id) {

    if (!id)
        return;

    const raw =
        getPublishedAlbumEditBasesRaw();

    if (!(id in raw))
        return;

    delete raw[id];

    localStorage.setItem(
        PUBLISHED_ALBUM_EDIT_BASES_STORAGE_KEY,
        JSON.stringify(raw)
    );

}


function hasPublishedAlbumEditBase(id) {

    if (!id)
        return false;

    return id in getPublishedAlbumEditBasesRaw();

}


/*
 * Rebuild the pre-publish base for an album that was published before
 * published bases were tracked. The album's manifest is the original
 * record; the published album is the edited one.
 */
async function restorePublishedEditBaseFromManifest(album) {

    if (
        !album ||
        !album.id ||
        album._publishedEditBase ||
        typeof resolveAlbumManifestUrl !== "function" ||
        typeof fetchGalleryManifest !== "function" ||
        typeof buildAlbumFromGalleryManifest !== "function"
    ) {
        return false;
    }

    const url =
        resolveAlbumManifestUrl(album);

    if (!url)
        return false;

    const manifest =
        await fetchGalleryManifest(url);

    if (!manifest)
        return false;

    const base = {
        ...(cloneAlbumRecord(album) || {}),
        images: {},
        tags: [],
        order: [],
        sources: [],
        edited: false
    };

    if (!buildAlbumFromGalleryManifest(base, manifest))
        return false;

    base.id =
        album.id;

    base.name =
        album.name ||
        manifest.title ||
        base.name ||
        "";

    await savePublishedAlbumEditBase(
        album.id,
        base
    );

    album._publishedEditBase =
        base;

    return true;

}


/*
 * Rebuild an album record from its original Telegram/gallery manifest.
 * This is a true revert to the manifest: removed tags come back and
 * published-edit history is dropped. With publish=true it replaces the
 * album-library entry (GitHub write); without it, it just returns the
 * rebuilt album for inspection.
 */
async function restoreAlbumRecordFromManifest(album, { publish = false } = {}) {

    if (
        !album ||
        !album.id ||
        typeof resolveAlbumManifestUrl !== "function" ||
        typeof fetchGalleryManifest !== "function" ||
        typeof buildAlbumFromGalleryManifest !== "function"
    ) {
        return null;
    }

    const url =
        resolveAlbumManifestUrl(album);

    if (!url)
        return null;

    const manifest =
        await fetchGalleryManifest(url);

    if (!manifest)
        return null;

    const restored = {
        ...(cloneAlbumRecord(album) || {}),
        images: {},
        tags: [],
        order: [],
        sources: [],
        edited: false
    };

    if (!buildAlbumFromGalleryManifest(restored, manifest))
        return null;

    restored.id =
        album.id;

    restored.name =
        album.name ||
        manifest.title ||
        restored.name ||
        "";

    if (album.manifest && typeof album.manifest === "object") {

        restored.manifest = {
            ...album.manifest
        };

    }

    if (!publish)
        return restored;

    if (
        typeof buildAlbumTxtRecord !== "function" ||
        typeof uploadAlbumRecordToLibrary !== "function"
    ) {
        return null;
    }

    const line =
        await buildAlbumTxtRecord(restored);

    const localOrigin = {
        id: album.id,
        isLocal:
            album.storage === true ||
            album.temporary === true ||
            album.localEdited === true ||
            album.savedEdited === true ||
            !!album._publishedEditBase,
        storage:
            album.storage === true,
        temporary:
            album.temporary === true,
        localEdited:
            album.localEdited === true
    };

    const previousBase =
        typeof getPublishedAlbumEditBase === "function"
            ? await getPublishedAlbumEditBase(album.id)
            : null;

    /*
     * Delete the old comparison base before the upload. The upload
     * reloads the album; if the base were still present it would be
     * re-attached and the restore would keep showing edit history.
     */
    if (typeof deletePublishedAlbumEditBase === "function")
        deletePublishedAlbumEditBase(album.id);

    let result;

    try {

        result =
            await uploadAlbumRecordToLibrary(
                restored,
                line,
                localOrigin,
                null,
                { skipConfirm: true }
            );

    } catch (error) {

        if (
            previousBase &&
            typeof savePublishedAlbumEditBase === "function"
        ) {
            await savePublishedAlbumEditBase(
                album.id,
                previousBase
            );
        }

        throw error;

    }

    if (result?.ok) {

        if (typeof deleteAlbumLocalEdit === "function")
            deleteAlbumLocalEdit(album.id);

        if (typeof deleteSavedAlbumEditBase === "function")
            deleteSavedAlbumEditBase(album.id);

        if (typeof deletePublishedAlbumEditBase === "function")
            deletePublishedAlbumEditBase(album.id);

    } else if (
        previousBase &&
        typeof savePublishedAlbumEditBase === "function"
    ) {

        await savePublishedAlbumEditBase(
            album.id,
            previousBase
        );

    }

    return result;

}


/*
 * Reads the raw, still-compressed saved-album strings straight out of
 * localStorage, with no decompression -- used when only the count or
 * an unresolved copy is needed.
 */
function getSavedAlbumsRaw() {

    try {

        const parsed =
            JSON.parse(
                localStorage.getItem(SAVED_ALBUMS_STORAGE_KEY) || "[]"
            );

        const list =
            Array.isArray(parsed) ? parsed : [];

        /*
         * Saved albums are stored as compressed strings. A now-fixed
         * save path could insert a plain object into this array, which
         * can never be decompressed. Drop those entries once so the
         * corruption does not linger.
         */
        const valid =
            list.filter(
                entry =>
                    typeof entry === "string" &&
                    entry.length > 0
            );

        if (valid.length !== list.length) {

            localStorage.setItem(
                SAVED_ALBUMS_STORAGE_KEY,
                JSON.stringify(valid)
            );

        }

        return valid;

    } catch {

        return [];

    }

}


/*
 * Decompresses every saved album. Anything that fails to decompress
 * (corrupted entry, format change, etc) is skipped rather than
 * breaking the whole list.
 */
async function getSavedAlbums() {

    const raw =
        getSavedAlbumsRaw();

    const albums =
        [];

    for (const entry of raw) {

        try {

            const album =
                await decompressAlbum(entry);

            /*
             * Older save paths copied runtime local-edit state into
             * saved records. Strip it so a saved album can never show
             * both "remove local edits" and "remove saved album".
             */
            delete album.localEdited;
            delete album.savedEdited;

            for (const key of Object.keys(album)) {

                if (key.startsWith("_"))
                    delete album[key];

            }

            albums.push(album);

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress a saved album",
                {
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    /*
     * A saved record can exist twice after older save paths (or when
     * the same album is saved again with the same id). Keep the last
     * entry for each id so the home screen never renders duplicates.
     */
    const byId =
        new Map();

    const withoutId =
        [];

    for (const album of albums) {

        if (album?.id)
            byId.set(album.id, album);
        else
            withoutId.push(album);

    }

    return [
        ...byId.values(),
        ...withoutId
    ];

}


/*
 * Compresses and writes back the full saved-albums list in one go.
 */
async function setSavedAlbums(albumObjects) {

    const compressed =
        [];

    for (const album of albumObjects) {

        compressed.push(
            await compressAlbum(album)
        );

    }

    localStorage.setItem(
        SAVED_ALBUMS_STORAGE_KEY,
        JSON.stringify(compressed)
    );

}


/*
 * A ready-to-paste album.txt entry: a "// Album Name" comment line
 * followed by the compressed album. parseAlbumsText() ignores comment
 * lines when reading the file back.
 */
async function buildAlbumTxtRecord(album) {

    const snapshot = {
        ...album
    };

    /*
     * Exported records should contain only the album data, never
     * runtime markers or the pristine local-edit base.
     */
    delete snapshot._imagesArray;
    delete snapshot._localEditBase;
    delete snapshot.localEdited;
    delete snapshot.savedEdited;
    delete snapshot.storage;
    delete snapshot.temporary;

    for (const key of Object.keys(snapshot)) {

        if (key.startsWith("_"))
            delete snapshot[key];

    }

    const blob =
        await compressAlbum(snapshot);

    const title =
        String(album?.name || "")
            .replace(/[\r\n]+/g, " ")
            .trim();

    return title
        ? "// " + title + "\n" + blob
        : blob;

}


/*
 * Parses a .txt response body as newline-separated compressed album
 * blobs and decompresses each one.
 *
 * The file is hand-editable and supports "//" comment lines, including
 * whole albums commented out -- buildAlbumTxtRecord() writes a
 * "// Album Name" header before each blob, and prefixing a blob itself
 * with "//" disables it. Comment and blank lines are skipped rather
 * than decoded, otherwise atob()/gunzip throw on them.
 */
async function parseAlbumsText(text) {

    const lines =
        text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .filter(line => !line.startsWith("//"));

    const parsed =
        [];

    for (const line of lines) {

        /*
         * Base64url never contains whitespace or "/", so anything after
         * one is a trailing comment on an otherwise valid blob line.
         */
        const blob =
            line
                .split(/\s+/)[0]
                .split("/")[0];

        if (!blob)
            continue;

        try {

            parsed.push(
                await decompressAlbum(blob)
            );

        } catch (error) {

            console.debug(
                "[ALBUMS] Failed to decompress an album from the album list",
                {
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    return parsed;

}


function resolveAlbumListFetchURL(url) {

    const value =
        String(url || "");

    /*
     * Accept the URL a user naturally copies from GitHub's web UI and
     * turn it into the raw file the site can read.
     */
    let match =
        value.match(
            /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i
        );

    if (!match) {

        match =
            value.match(
                /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/refs\/heads\/([^/]+)\/(.+)$/i
            );

    }

    if (!match) {

        match =
            value.match(
                /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/i
            );

    }

    if (!match)
        return value;

    return (
        "https://raw.githubusercontent.com/" +
        match[1] +
        "/" +
        match[2] +
        "/" +
        match[3] +
        "/" +
        match[4]
    );

}


async function reloadAlbums() {

    const previousAlbums =
        albums.slice();

    let remoteLoadFailed =
        false;

    albums.length = 0;

    let remoteAlbums =
        [];

    if (siteConfig?.album) {

        try {

            let text = null;

            /*
             * Prefer the authenticated Contents API when the album list
             * is the album-library file. raw.githubusercontent.com can
             * keep serving a cached copy (max-age=300) for minutes after
             * a publish, which made removed tags reappear on reload.
             */
            let libraryConfig = null;

            try {

                libraryConfig =
                    typeof getAlbumLibraryGitHubConfig === "function"
                        ? getAlbumLibraryGitHubConfig()
                        : null;

            } catch {}

            if (
                libraryConfig &&
                typeof fetchAlbumLibraryGitHubFile === "function"
            ) {

                try {

                    const file =
                        await fetchAlbumLibraryGitHubFile(
                            libraryConfig
                        );

                    if (
                        file?.exists &&
                        typeof file.text === "string" &&
                        file.text
                    ) {
                        text = file.text;
                    }

                } catch (error) {

                    console.debug(
                        "[ALBUMS] Album-library API read failed; falling back to raw",
                        {
                            errorName: error?.name,
                            errorMessage: error?.message
                        }
                    );

                }

            }

            if (text == null) {

                const albumListUrl =
                    resolveAlbumListFetchURL(
                        siteConfig.album
                    );

                const freshAlbumListUrl =
                    albumListUrl +
                    (
                        albumListUrl.includes("?")
                            ? "&"
                            : "?"
                    ) +
                    "_=" +
                    Date.now();

                const response =
                    await fetch(
                        freshAlbumListUrl,
                        {
                            cache: "no-store"
                        }
                    );

                if (!response.ok) {

                    throw new Error(`HTTP ${response.status}`);

                }

                text =
                    await response.text();

            }

            remoteAlbums =
                await parseAlbumsText(text);

        } catch (error) {

            remoteLoadFailed =
                true;

            console.debug(
                "[ALBUMS] Failed to load siteConfig.album",
                {
                    url: siteConfig.album,
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

    }

    /*
     * A transient album-list fetch failure must not make every remote
     * album disappear (for example immediately after removing a local
     * copy). Keep the previous remote entries until a later refresh
     * succeeds.
     */
    if (remoteLoadFailed) {

        remoteAlbums =
            previousAlbums
                .filter(
                    album =>
                        album &&
                        !album.storage &&
                        !album.temporary
                )
                .map(album => {

                    const copy = {
                        ...album
                    };

                    delete copy.storage;
                    delete copy.temporary;
                    delete copy.localEdited;
                    delete copy.savedEdited;
                    delete copy._localEditBase;
                    delete copy._savedAlbumEditBase;
                    delete copy._imagesArray;

                    return copy;

                });

    }

    /*
     * MANUAL_ALBUMS, if a developer still defines it directly in a
     * loaded script, is treated as already-decompressed album objects
     * in the current data shape -- a manual escape hatch, not the
     * normal path.
     */
    if (typeof MANUAL_ALBUMS !== "undefined") {

        remoteAlbums =
            remoteAlbums.concat(MANUAL_ALBUMS);

    }

    if (typeof getVideoLibraryStub === "function") {

        const libraryStub =
            getVideoLibraryStub();

        if (libraryStub)
            remoteAlbums.push(libraryStub);

    }

    /*
     * Local album edits are snapshots of whole albums stored in
     * localStorage. They take priority over the original record read
     * from album.txt so a locally edited remote album survives a full
     * page reload.
     */
    const localEdits =
        await getAlbumLocalEdits();

    remoteAlbums.forEach(album => {

        if (!album)
            return;

        const edit =
            album.id
                ? localEdits[album.id]
                : null;

        if (edit) {

            const merged = {
                ...album,
                ...edit
            };

            /*
             * Runtime-only flags come from the original record.
             * "edited" and "localEdited" say this album's displayed
             * data comes from localStorage.
             */
            merged.storage =
                false;

            merged.edited =
                true;

            merged.localEdited =
                true;

            /*
             * Keep the untouched record for this session so edit mode
             * can compare against it. It is runtime-only and is
             * stripped again by saveAlbumLocalEdit().
             */
            merged._localEditBase =
                typeof cloneAlbumRecord === "function"
                    ? cloneAlbumRecord(album)
                    : null;

            delete merged.temporary;
            delete merged._imagesArray;

            albums.push(merged);

            return;

        }

        albums.push(album);

    });

    const saved =
        await getSavedAlbums();

    const savedBases =
        typeof getSavedAlbumEditBases === "function"
            ? await getSavedAlbumEditBases()
            : {};

    /*
     * Saved local albums are their own copy of an album and can share
     * an id with the remote record they came from. The saved record
     * wins, so drop the remote duplicate instead of rendering two
     * cards for the same album.
     */
    const savedIds =
        new Set(
            saved.map(album => album.id)
        );

    for (
        let i = albums.length - 1;
        i >= 0;
        i--
    ) {

        if (
            savedIds.has(
                albums[i]?.id
            )
        ) {
            albums.splice(i, 1);
        }

    }

    saved.forEach(
        album => {

            const savedAlbum = {

                ...album,

                tags:
                    album.tags ||
                    [],

                storage:
                    true

            };

            if (savedBases[album.id]) {

                savedAlbum.savedEdited = true;

                /*
                 * Runtime-only pristine copy for edit-mode comparison.
                 * Stripped again whenever the saved record is written.
                 */
                savedAlbum._savedAlbumEditBase =
                    savedBases[album.id];

            }

            albums.push(savedAlbum);

        }
    );

    const publishedBases =
        typeof getPublishedAlbumEditBases === "function"
            ? await getPublishedAlbumEditBases()
            : {};

    for (const album of albums) {

        if (!album || !album.id)
            continue;

        const base =
            publishedBases[album.id];

        if (base)
            album._publishedEditBase =
                base;

    }

    /*
     * Optional D1 index: non-blocking, debounced, and a no-op unless a
     * Worker URL and auth token are configured. It never delays the
     * gallery render.
     */
    if (typeof scheduleTagIndexSync === "function")
        scheduleTagIndexSync();

}


function showAlbumButtons(show) {

    document.getElementById("backButton").style.display =
        show ? "" : "none";

    document.getElementById("saveButton").style.display =
        (
            show &&
            (
                isQueryAlbum ||
                currentTemporaryAlbumID !== null
            )
        )
            ? "flex"
            : "none";

    document.getElementById("regenerateAlbum").style.display =
        "none";

    const manifestButton =
        document.getElementById("generateManifest");

    if (manifestButton)
        manifestButton.style.display = "none";

    document.getElementById("tagToggle").style.display =
        show ? "" : "none";
}

function setTelegramImportSavingState(importing) {
    const button = document.getElementById("saveButton");

    if (!button)
        return;

    button.disabled = importing;
    button.style.opacity = importing ? "0.5" : "";
    button.style.cursor = importing ? "default" : "";
}

async function saveCurrentAlbum() {

    if (!currentAlbum)
        return;

    const name =
		currentAlbum.name ||
		"Untitled Album";

    const isTelegram =
        typeof currentAlbum.url === "string" &&
        currentAlbum.url.startsWith(
            "tg://chat/"
        );

    /*
     * Preserve the Telegram album URL, but remove any
     * existing cover selection.
     *
     * Without "cover=", loadTelegramAlbumCover()
     * will choose a random image.
     */
    let savedURL =
        currentAlbum.url ||
        "";

    if (isTelegram) {

        const match =
            savedURL.match(
                /^tg:\/\/chat\/(-?\d+)(?:\?(.+))?$/
            );

        if (match) {

            const chatId =
                match[1];

            const optionString =
                match[2] ||
                "";

            const options =
                new URLSearchParams(
                    optionString
                );

            options.delete(
                "cover"
            );

            const query =
                options.toString();

            savedURL =
                "tg://chat/" +
                chatId +
                (
                    query
                        ? "?" + query
                        : ""
                );
        }
    }

    const savedAlbum = {

		id:
			crypto.randomUUID(),

		name:
			name,

		sourceName:
			name,

		edited:
			false,

		sources:
			currentAlbum.sources || [],

		images:
			currentAlbum.images,

		tags:
			currentAlbum.tags || [],

		people:
			currentAlbum.people || {},

		manifest:
			currentAlbum.manifest,

		url:
			savedURL

	};

    const saved =
        await getSavedAlbums();

	saved.push(
        savedAlbum
    );

    await setSavedAlbums(saved);

    /*
     * Telegram records are still copied to the clipboard for
     * convenience, now as a compressed, ready-to-paste-into-album.txt
     * line rather than a raw JS object literal.
     */
    if (isTelegram) {

        try {

            const record =
                await compressAlbum(savedAlbum);

            if (
                navigator.clipboard &&
                navigator.clipboard.writeText
            ) {

                navigator.clipboard
                    .writeText(record)
                    .catch(
                        () => {}
                    );
            }

        } catch {}

    }

    if (currentTemporaryAlbumID) {

        deleteTemporaryAlbum(
            currentTemporaryAlbumID
        );

        currentTemporaryAlbumID =
            null;
    }

    alert(
        "Album saved as " +
        name
    );
}
