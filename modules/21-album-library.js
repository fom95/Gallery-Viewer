/*
 * 21-album-library.js
 *
 * Optional write integration for the album library (album.txt).
 *
 * Reads stay exactly as before: the album list is a normal public URL.
 * When the owner supplies a GitHub token in Site Settings, this module
 * can also commit a generated album entry back to the repository using
 * the standard GitHub Contents API. The token lives only in this
 * browser's localStorage; it is never written into siteConfig or into
 * shareable config URLs.
 */

const ALBUM_LIBRARY_TOKEN_STORAGE_KEY =
    "albumLibraryToken";


function getAlbumLibraryToken() {

    try {

        return (
            localStorage.getItem(
                ALBUM_LIBRARY_TOKEN_STORAGE_KEY
            ) || ""
        );

    } catch {

        return "";

    }

}


function setAlbumLibraryToken(token) {

    try {

        const value =
            String(token || "").trim();

        if (value) {

            localStorage.setItem(
                ALBUM_LIBRARY_TOKEN_STORAGE_KEY,
                value
            );

        } else {

            localStorage.removeItem(
                ALBUM_LIBRARY_TOKEN_STORAGE_KEY
            );

        }

    } catch {}

}


/*
 * Accepts the common GitHub URL forms people paste into Album List URL:
 *
 *   https://github.com/owner/repo/blob/branch/path/album.txt
 *   https://github.com/owner/repo/raw/refs/heads/branch/path/album.txt
 *   https://raw.githubusercontent.com/owner/repo/branch/path/album.txt
 */
function splitAlbumLibraryRepoPath(owner, repo, rest) {

    if (!owner || !repo || !rest.length)
        return null;

    let branch;
    let pathSegments;

    /*
     * Both GitHub's web UI and raw file URLs sometimes include the
     * full ref ("refs/heads/main"). The Contents API wants the branch
     * name on its own.
     */
    if (
        rest[0] === "refs" &&
        rest[1] === "heads"
    ) {

        branch =
            rest[2];

        pathSegments =
            rest.slice(3);

    } else {

        branch =
            rest[0];

        pathSegments =
            rest.slice(1);

    }

    if (!branch || !pathSegments.length)
        return null;

    const path =
        pathSegments.join("/");

    if (!path)
        return null;

    return {
        owner,
        repo,
        branch,
        path
    };

}


/*
 * Accepts the common GitHub URL forms people paste into Album List URL:
 *
 *   https://github.com/owner/repo/blob/branch/path/album.txt
 *   https://github.com/owner/repo/raw/refs/heads/branch/path/album.txt
 *   https://raw.githubusercontent.com/owner/repo/branch/path/album.txt
 *   https://raw.githubusercontent.com/owner/repo/refs/heads/branch/path/album.txt
 */
function parseAlbumLibraryGitHubUrl(rawUrl) {

    let url;

    try {

        url =
            new URL(rawUrl);

    } catch {

        return null;

    }

    let segments;

    try {

        segments =
            url.pathname
                .split("/")
                .filter(Boolean)
                .map(segment =>
                    decodeURIComponent(segment)
                );

    } catch {

        return null;

    }

    const host =
        url.hostname.toLowerCase();

    if (host === "github.com") {

        if (segments.length < 5)
            return null;

        const [
            owner,
            repo,
            mode
        ] = segments;

        if (
            mode !== "blob" &&
            mode !== "raw"
        ) {
            return null;
        }

        return splitAlbumLibraryRepoPath(
            owner,
            repo,
            segments.slice(3)
        );

    }

    if (host === "raw.githubusercontent.com") {

        if (segments.length < 4)
            return null;

        return splitAlbumLibraryRepoPath(
            segments[0],
            segments[1],
            segments.slice(2)
        );

    }

    return null;

}


function getAlbumLibraryGitHubConfig() {

    const token =
        getAlbumLibraryToken();

    const rawUrl =
        String(siteConfig?.album || "");

    if (!token || !rawUrl)
        return null;

    const parsed =
        parseAlbumLibraryGitHubUrl(rawUrl);

    if (!parsed)
        return null;

    return {
        token,
        ...parsed
    };

}


function isAlbumLibraryUploadAvailable() {

    return !!getAlbumLibraryGitHubConfig();

}


function albumLibraryApiUrl(config) {

    const path =
        config.path
            .split("/")
            .map(segment =>
                encodeURIComponent(segment)
            )
            .join("/");

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(config.owner) +
        "/" +
        encodeURIComponent(config.repo) +
        "/contents/" +
        path
    );

}


function albumLibraryLocation(config) {

    return (
        config.owner +
        "/" +
        config.repo +
        "/" +
        config.path +
        " (branch " +
        config.branch +
        ")"
    );

}


function albumLibraryErrorHint(config, status) {

    if (status === 404) {

        return (
            "GitHub returned 404 for " +
            albumLibraryLocation(config) +
            ". Check that the path and branch exist, and that the token " +
            "is allowed to read and write this repository's Contents."
        );

    }

    if (status === 403) {

        return (
            "GitHub refused the request for " +
            albumLibraryLocation(config) +
            ". The token is probably missing Contents: Read and write."
        );

    }

    return (
        "GitHub returned " +
        status +
        " for " +
        albumLibraryLocation(config) +
        "."
    );

}


function albumLibraryBase64Encode(text) {

    const bytes =
        new TextEncoder().encode(text);

    let binary = "";

    const chunkSize =
        0x8000;

    for (
        let index = 0;
        index < bytes.length;
        index += chunkSize
    ) {

        binary += String.fromCharCode(
            ...bytes.subarray(
                index,
                index + chunkSize
            )
        );

    }

    return btoa(binary);

}


function albumLibraryBase64Decode(value) {

    const binary =
        atob(
            String(value || "")
                .replace(/\s+/g, "")
        );

    const bytes =
        new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++)
        bytes[index] = binary.charCodeAt(index);

    return new TextDecoder().decode(bytes);

}


function albumLibraryHeaders(config) {

    return {

        Accept:
            "application/vnd.github+json",

        Authorization:
            "Bearer " + config.token,

        "X-GitHub-Api-Version":
            "2022-11-28"

    };

}


async function fetchAlbumLibraryGitHubFile(config) {

    const response =
        await fetch(
            albumLibraryApiUrl(config) +
                "?ref=" +
                encodeURIComponent(config.branch),
            {
                headers:
                    albumLibraryHeaders(config),
                cache:
                    "no-store"
            }
        );

    if (response.status === 404) {

        return {
            exists: false,
            text: "",
            sha: null
        };

    }

    if (!response.ok) {

        throw new Error(
            albumLibraryErrorHint(
                config,
                response.status
            )
        );

    }

    const data =
        await response.json();

    if (!data || data.type !== "file") {

        throw new Error(
            "The configured album library path is not a file."
        );

    }

    return {
        exists: true,
        text:
            albumLibraryBase64Decode(
                data.content
            ),
        sha:
            data.sha || null
    };

}


async function findAlbumLibraryEntry(text, album, previousIds = []) {

    const lines =
        String(text || "")
            .split(/\r?\n/);

    const ids =
        new Set(
            [
                album?.id,
                ...previousIds
            ]
                .filter(Boolean)
                .map(String)
        );

    const wantedName =
        album?.name || "";

    let nameMatch =
        null;

    for (
        let index = 0;
        index < lines.length;
        index++
    ) {

        const line =
            lines[index].trim();

        if (
            !line ||
            line.startsWith("//")
        ) {
            continue;
        }

        let parsed;

        try {

            parsed =
                await decompressAlbum(line);

        } catch {

            continue;

        }

        if (!parsed)
            continue;

        const entry = {

            album:
                parsed,

            lineIndex:
                index,

            commentIndex:
                index > 0 &&
                lines[index - 1]
                    .trim()
                    .startsWith("//")
                    ? index - 1
                    : null,

            match:
                "id"

        };

        if (
            parsed.id &&
            ids.has(String(parsed.id))
        ) {
            return entry;
        }

        if (
            !nameMatch &&
            wantedName &&
            parsed.name === wantedName
        ) {

            nameMatch = {
                ...entry,
                match: "name"
            };

        }

    }

    return nameMatch;

}


function replaceAlbumLibraryEntry(text, entry, newLine) {

    if (!entry) {

        const trimmed =
            String(text || "")
                .replace(/\s+$/, "");

        return (
            trimmed
                ? trimmed + "\n"
                : ""
        ) + newLine + "\n";

    }

    const lines =
        String(text || "")
            .split(/\r?\n/);

    const start =
        entry.commentIndex ??
        entry.lineIndex;

    const replacement =
        String(newLine)
            .split(/\r?\n/);

    lines.splice(
        start,
        entry.lineIndex - start + 1,
        ...replacement
    );

    return lines.join("\n");

}


async function writeAlbumRecordToGitHub(
    config,
    album,
    line,
    previousIds = [],
    localOrigin = null,
    options = {}
) {

    let existing =
        await fetchAlbumLibraryGitHubFile(
            config
        );

    let entry =
        await findAlbumLibraryEntry(
            existing.text,
            album,
            previousIds
        );

    const location =
        config.owner +
        "/" +
        config.repo +
        "/" +
        config.path;

    if (!options.skipConfirm) {

        if (entry) {

            const detail =
                localOrigin?.isLocal
                    ? "A hard copy of this album already exists in the library.\n\n" +
                      "Saving this local copy will overwrite the current library entry at:"
                    : (
                        entry.match === "name"
                            ? "An entry with the same album name already exists in the library."
                            : "This album already exists in the library."
                    ) +
                      "\n\nWriting this entry will replace the current library entry at:";

            if (
                !confirm(
                    detail +
                    "\n" +
                    location +
                    "\n\nContinue?"
                )
            ) {
                return { cancelled: true };
            }

        } else if (
            !confirm(
                "Upload this album entry to the library?\n\n" +
                location
            )
        ) {

            return { cancelled: true };

        }

    }

    /*
     * A concurrent edit can change the file SHA between read and write.
     * Retry once against the fresh copy instead of overwriting blindly.
     */
    for (let attempt = 0; attempt < 2; attempt++) {

        if (attempt > 0) {

            existing =
                await fetchAlbumLibraryGitHubFile(
                    config
                );

            entry =
                await findAlbumLibraryEntry(
                    existing.text,
                    album,
                    previousIds
                );

        }

        const nextText =
            replaceAlbumLibraryEntry(
                existing.text,
                entry,
                line
            );

        const body = {

            message:
                (
                    entry
                        ? "Update album: "
                        : "Add album: "
                ) +
                (album.name || album.id || "album"),

            content:
                albumLibraryBase64Encode(
                    nextText
                ),

            branch:
                config.branch

        };

        if (existing.sha)
            body.sha = existing.sha;

        const response =
            await fetch(
                albumLibraryApiUrl(config),
                {
                    method: "PUT",
                    headers: {
                        ...albumLibraryHeaders(config),
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify(body)
                }
            );

        if (response.ok) {

            const data =
                await response.json();

            return {
                ok: true,
                replaced: !!entry,
                commit:
                    data?.commit?.sha || null
            };

        }

        if (
            response.status !== 409 &&
            response.status !== 422
        ) {

            throw new Error(
                albumLibraryErrorHint(
                    config,
                    response.status
                )
            );

        }

        /*
         * 422 also covers "branch not found" and invalid content, so
         * only retry when GitHub is telling us the file SHA moved.
         */
        let conflictMessage = "";

        try {

            const data =
                await response.clone().json();

            conflictMessage =
                String(data?.message || "");

        } catch {}

        if (
            response.status === 422 &&
            !/sha/i.test(conflictMessage)
        ) {

            throw new Error(
                "GitHub rejected the album library write (" +
                response.status +
                (conflictMessage
                    ? ": " + conflictMessage
                    : "") +
                "). " +
                albumLibraryErrorHint(
                    config,
                    response.status
                )
            );

        }

    }

    throw new Error(
        "The album library changed while writing. Please try again."
    );

}


async function verifyAlbumLibraryEntry(
    config,
    album,
    previousIds = []
) {

    for (let attempt = 0; attempt < 4; attempt++) {

        const file =
            await fetchAlbumLibraryGitHubFile(
                config
            );

        const entry =
            await findAlbumLibraryEntry(
                file.text,
                album,
                previousIds
            );

        if (entry)
            return true;

        await new Promise(resolve =>
            setTimeout(resolve, 350)
        );

    }

    return false;

}


function isLocalAlbumCopy(album) {

    return !!(
        album &&
        (
            album.storage === true ||
            album.temporary === true ||
            album.localEdited === true ||
            album.savedEdited === true
        )
    );

}


async function removePublishedLocalAlbumCopy(localOrigin) {

    if (
        !localOrigin ||
        !localOrigin.id ||
        !localOrigin.isLocal
    ) {
        return false;
    }

    if (
        !confirm(
            "The album entry was written to the library and read back successfully.\n\n" +
            "Also remove the local copy from this browser?"
        )
    ) {
        return false;
    }

    if (localOrigin.storage) {

        const saved =
            await getSavedAlbums();

        await setSavedAlbums(
            saved.filter(
                album =>
                    album.id !==
                    localOrigin.id
            )
        );

    }

    if (localOrigin.temporary) {

        if (typeof deleteTemporaryAlbum === "function")
            deleteTemporaryAlbum(localOrigin.id);

        if (currentTemporaryAlbumID === localOrigin.id)
            currentTemporaryAlbumID = null;

    }

    if (
        localOrigin.localEdited &&
        typeof deleteAlbumLocalEdit === "function"
    ) {

        deleteAlbumLocalEdit(
            localOrigin.id
        );

    }

    if (
        typeof deleteSavedAlbumEditBase === "function"
    ) {

        deleteSavedAlbumEditBase(
            localOrigin.id
        );

    }

    await reloadAlbums();
    showAlbums();

    return true;

}


async function uploadAlbumRecordToLibrary(
    album,
    line,
    localOrigin = null,
    publishedBase = null,
    options = {}
) {

    const config =
        getAlbumLibraryGitHubConfig();

    if (!config) {

        throw new Error(
            "No GitHub album library token is configured."
        );

    }

    const previousIds =
        localOrigin?.id
            ? [localOrigin.id]
            : [];

    const result =
        await writeAlbumRecordToGitHub(
            config,
            album,
            line,
            previousIds,
            localOrigin,
            options
        );

    if (!result?.ok)
        return result;

    const verified =
        await verifyAlbumLibraryEntry(
            config,
            album,
            previousIds
        );

    if (!verified) {

        throw new Error(
            "The entry was written, but could not be read back from the library. " +
            "The local copy was left untouched."
        );

    }

    /*
     * Keep the pre-publish record as the edit base. The published
     * record is now the new source of truth, but edit mode should
     * still be able to mark what this publish changed.
     */
    if (
        publishedBase &&
        typeof savePublishedAlbumEditBase === "function"
    ) {

        try {

            await savePublishedAlbumEditBase(
                album.id,
                publishedBase
            );

        } catch (error) {

            console.error(
                "[ALBUM LIBRARY] Could not keep the published edit base:",
                error
            );

        }

    }

    try {

        if (localOrigin?.isLocal)
            result.localRemoved =
                await removePublishedLocalAlbumCopy(
                    localOrigin
                );

    } catch (error) {

        console.error(
            "[ALBUM LIBRARY] Could not remove local copy:",
            error
        );

        alert(
            "The library entry was saved, but the local copy could not be removed:\n\n" +
            (error?.message || String(error))
        );

    }

    return result;

}


function showAlbumRecordActionDialog(existingManifestUrl) {

    return new Promise(resolve => {

        const {
            overlay,
            box
        } = createInWindowDialog(
            "Generate Album Record"
        );

        addInWindowDialogMessage(
            box,
            "Optional: paste the URL where this album's manifest is hosted. " +
            "The site will only use it if it is present here."
        );

        addInWindowDialogMessage(
            box,
            "Upload to Library writes this record to the album library. " +
            "If the album is already there, its entry is replaced and the " +
            "current edits become the published record."
        );

        const field =
            document.createElement("input");

        field.type =
            "text";

        field.className =
            "app-field";

        field.value =
            existingManifestUrl || "";

        field.placeholder =
            "https://...";

        box.appendChild(field);

        const buttons =
            createInWindowDialogButtons(box);

        let finished =
            false;

        const finish = result => {

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

            resolve(result);

        };

        const onKeydown =
            event => {

                if (event.key === "Escape") {

                    event.preventDefault();
                    finish(null);

                } else if (event.key === "Enter") {

                    event.preventDefault();

                    finish({
                        manifestUrl:
                            field.value,
                        action: "copy"
                    });

                }

            };

        const cancelButton =
            createInWindowDialogButton(
                buttons,
                "Cancel",
                false
            );

        cancelButton.onclick =
            () => finish(null);

        const copyButton =
            createInWindowDialogButton(
                buttons,
                "Copy Entry",
                false
            );

        copyButton.onclick =
            () => finish({
                manifestUrl:
                    field.value,
                action: "copy"
            });

        const uploadButton =
            createInWindowDialogButton(
                buttons,
                "Upload to Library",
                true
            );

        uploadButton.onclick =
            () => finish({
                manifestUrl:
                    field.value,
                action: "upload"
            });

        document.addEventListener(
            "keydown",
            onKeydown,
            true
        );

        overlay.onclick =
            event => {

                if (event.target === overlay)
                    finish(null);

            };

        field.focus({
            preventScroll: true
        });

    });

}
