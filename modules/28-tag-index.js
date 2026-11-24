/*
 * 28-tag-index.js
 *
 * Optional hosted tag index.
 *
 * Album data stays in album.txt and in localStorage exactly as before --
 * this module never replaces the local gallery. It mirrors the tags of
 * the remote albums into the configured index service so tag suggestions
 * and search can still be answered when the local album list is large
 * (or missing), and so the API is ready for paginated album loading
 * later.
 *
 * Everything here fails soft. With no configured URL/token, no service
 * or no network, the gallery keeps using getAllTags() and the local
 * album scan; nothing is hidden or disabled.
 *
 * The service is defined only by siteConfig.tagsIndex:
 *   { url, token }
 * There is no implicit Worker or Telegram URL in this module; the
 * default `tags-index` Worker is just one implementation of the routes
 * documented in ../../docs/worker/README.md.
 */

const TAG_INDEX_SYNC_STORAGE_KEY =
    "tagIndexSync";

/* If the album fingerprint has not changed, a page load at most does
 * one sync check every 15 minutes. A changed fingerprint syncs at once. */
const TAG_INDEX_SYNC_INTERVAL_MS =
    15 * 60 * 1000;

const TAG_INDEX_REQUEST_TIMEOUT_MS =
    5000;

const TAG_INDEX_TAG_CACHE_LIMIT =
    20000;

/* Kept in step with worker.js (INDEX_MAX_ALBUMS / tags per album). A
 * list beyond either limit is left to the local scan rather than
 * syncing a truncated index that would answer searches differently. */
const TAG_INDEX_MAX_ALBUMS =
    20000;

const TAG_INDEX_MAX_TAGS_PER_ALBUM =
    500;

let tagIndexOnline =
    false;

let tagIndexSyncedFingerprint =
    "";

let tagIndexSyncedAlbumCount =
    0;

let tagIndexRemoteTags =
    [];

let tagIndexStatus =
    null;

/* Last HTTP failure, so the settings dialog can say why a sync failed
 * instead of guessing. */
let tagIndexLastError =
    null;

let tagIndexSyncTimer =
    null;

let tagIndexSyncPromise =
    null;


function tagIndexBaseUrl() {

    const configured =
        siteConfig?.tagsIndex?.url;

    if (
        typeof configured !== "string" ||
        !configured.trim()
    ) {
        return "";
    }

    return configured
        .trim()
        .replace(/\/+$/, "");

}


function tagIndexToken() {

    const configured =
        siteConfig?.tagsIndex?.token;

    if (
        typeof configured !== "string" ||
        !configured.trim()
    ) {
        return "";
    }

    return configured.trim();

}


async function tagIndexRequest(path, options = {}) {

    tagIndexLastError =
        null;

    const base =
        tagIndexBaseUrl();

    if (!base) {

        tagIndexLastError = {
            status: 0,
            error: "No index URL configured."
        };

        return null;

    }

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            TAG_INDEX_REQUEST_TIMEOUT_MS
        );

    try {

        const headers =
            new Headers(options.headers || {});

        const token =
            tagIndexToken();

        if (token)
            headers.set("Authorization", "Bearer " + token);

        if (options.json !== undefined)
            headers.set("Content-Type", "application/json");

        const response =
            await fetch(base + path, {
                method: options.method || "GET",
                headers,
                body:
                    options.json !== undefined
                        ? JSON.stringify(options.json)
                        : undefined,
                signal: controller.signal,
                cache: "no-store"
            });

        if (!response.ok) {

            let error = "";

            try {

                const body =
                    await response.json();

                error =
                    typeof body?.error === "string"
                        ? body.error
                        : "";

            } catch {}

            tagIndexLastError = {
                status: response.status,
                error
            };

            return null;

        }

        return await response.json();

    } catch (error) {

        tagIndexLastError = {
            status: 0,
            error:
                error?.name === "AbortError"
                    ? "Timed out."
                    : "Network error."
        };

        return null;

    } finally {

        clearTimeout(timer);

    }

}


function normalizeTagIndexName(value) {

    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 120);

}


function normalizeTagIndexList(values) {

    const seen =
        new Set();

    const tags =
        [];

    for (const value of Array.isArray(values) ? values : []) {

        const tag =
            normalizeTagIndexName(value);

        if (!tag || seen.has(tag))
            continue;

        seen.add(tag);
        tags.push(tag);

    }

    return tags.sort();

}


/*
 * One album per Telegram chat (the uploader reuses a chat for one
 * album). This key is stable before the manifest is discovered, unlike
 * a key that depends on the metadata message id.
 */
function albumIndexKey(album) {

    if (!album)
        return "";

    if (typeof parseTelegramAlbumUrl === "function") {

        const parsed =
            parseTelegramAlbumUrl(String(album.url || ""));

        if (parsed)
            return "tg:" + parsed.chatId;

    }

    return String(album.id || "");

}


/* Only remote albums are mirrored; saved albums are local to this
 * browser and must not leak into a shared index. */
function buildTagIndexRecords() {

    const records =
        [];

    const seen =
        new Set();

    for (const album of albums) {

        if (!album || album.storage)
            continue;

        const key =
            albumIndexKey(album);

        if (!key || seen.has(key))
            continue;

        seen.add(key);

        records.push({
            key,
            title:
                String(
                    album.name ||
                    album.sourceName ||
                    ""
                ).slice(0, 200),
            tags:
                normalizeTagIndexList(album.tags)
        });

    }

    records.sort((a, b) =>
        a.key.localeCompare(b.key));

    return records;

}


function tagIndexFingerprint(records) {

    let hash =
        0x811c9dc5;

    for (const record of records) {

        const line =
            record.key +
            "\u0001" +
            record.title +
            "\u0003" +
            record.tags.join("\u0002");

        for (let i = 0; i < line.length; i++) {

            hash ^= line.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193) >>> 0;

        }

        hash ^= 10;
        hash = Math.imul(hash, 0x01000193) >>> 0;

    }

    return records.length + ":" + hash.toString(16);

}


function readTagIndexSyncState() {

    try {

        return JSON.parse(
            localStorage.getItem(
                TAG_INDEX_SYNC_STORAGE_KEY
            ) || "{}"
        ) || {};

    } catch {

        return {};

    }

}


function saveTagIndexSyncState(state) {

    try {

        localStorage.setItem(
            TAG_INDEX_SYNC_STORAGE_KEY,
            JSON.stringify(state)
        );

    } catch {}

}


/*
 * Mirrors the current remote albums into D1. The Worker diffs by
 * tags_hash, so an unchanged album costs one row read and no writes.
 */
async function syncTagIndex({ force = false } = {}) {

    if (tagIndexSyncPromise)
        return tagIndexSyncPromise;

    const base =
        tagIndexBaseUrl();

    if (!base || !tagIndexToken())
        return { skipped: "not-configured" };

    const records =
        buildTagIndexRecords();

    if (
        records.length > TAG_INDEX_MAX_ALBUMS ||
        records.some(record =>
            record.tags.length > TAG_INDEX_MAX_TAGS_PER_ALBUM
        )
    ) {
        tagIndexOnline = false;

        console.debug(
            "[TAG INDEX] Album set exceeds the index limits; " +
            "using the local tag scan."
        );

        return { skipped: "limits" };
    }

    const fingerprint =
        tagIndexFingerprint(records);

    const state =
        readTagIndexSyncState();

    tagIndexSyncedFingerprint =
        state.fingerprint || "";

    /*
     * Before the first sync in a browser, ask whether the Worker has a
     * D1 binding. This avoids posting (and logging 404s) against a
     * Worker that has not been upgraded yet.
     */
    if (!force && !Number(state.at)) {
        const status =
            await refreshTagIndexStatus();

        if (!status?.configured) {

            tagIndexOnline = false;

            return (
                tagIndexLastError
                    ? { error: tagIndexLastError }
                    : { skipped: "not-configured" }
            );

        }
    }

    if (
        !force &&
        records.length &&
        state.fingerprint === fingerprint &&
        Date.now() - (state.at || 0) <
            TAG_INDEX_SYNC_INTERVAL_MS
    ) {

        tagIndexOnline = true;
        tagIndexSyncedAlbumCount =
            Number(state.albums) || records.length;

        if (!tagIndexRemoteTags.length)
            await refreshTagIndexRemoteTags();

        return {
            success: true,
            unchanged: true,
            albums: tagIndexSyncedAlbumCount,
            tags: Number(state.tags) || 0
        };

    }

    tagIndexSyncPromise =
        (async () => {

            /* Pick up tags even when the album list itself failed to
             * load, so suggestions still have a source. */
            if (!records.length) {

                await refreshTagIndexRemoteTags();
                tagIndexOnline =
                    tagIndexRemoteTags.length > 0;

                return { skipped: "no-albums" };

            }

            const response =
                await tagIndexRequest(
                    "/api/index/sync",
                    {
                        method: "POST",
                        json: {
                            albums: records,
                            prune: true
                        }
                    }
                );

            if (!response?.success) {

                tagIndexOnline = false;

                return {
                    error: tagIndexLastError || {
                        status: 0,
                        error: "Sync failed."
                    }
                };

            }

            tagIndexOnline = true;
            tagIndexSyncedFingerprint = fingerprint;
            tagIndexSyncedAlbumCount =
                Number(response.albums) || records.length;

            saveTagIndexSyncState({
                fingerprint,
                at: Date.now(),
                albums: tagIndexSyncedAlbumCount,
                tags: Number(response.tags) || 0
            });

            await refreshTagIndexRemoteTags();

            return response;

        })();

    try {

        return await tagIndexSyncPromise;

    } finally {

        tagIndexSyncPromise = null;

    }

}


function scheduleTagIndexSync({ force = false } = {}) {

    clearTimeout(tagIndexSyncTimer);

    tagIndexSyncTimer =
        setTimeout(
            () => void syncTagIndex({ force }),
            1200
        );

}


async function refreshTagIndexRemoteTags() {

    const response =
        await tagIndexRequest(
            "/api/tags?limit=" + TAG_INDEX_TAG_CACHE_LIMIT
        );

    if (
        response?.success &&
        Array.isArray(response.tags)
    ) {
        tagIndexRemoteTags = response.tags;
    }

}


async function refreshTagIndexStatus() {

    const response =
        await tagIndexRequest("/api/index/status");

    if (response?.success) {

        tagIndexStatus = response;

        tagIndexOnline =
            response.configured === true;

        return response;

    }

    return null;

}


/*
 * Local tags come first, so an offline/stale index can never take a
 * tag away. Tags known only to the index are appended for suggestions
 * when the local album list is partial.
 */
function getAllSearchTags() {

    const tags =
        getAllTags();

    if (!tagIndexRemoteTags.length)
        return tags;

    const seen =
        new Set(
            tags.map(normalizeTagForMatch)
        );

    const merged =
        tags.slice();

    for (const tag of tagIndexRemoteTags) {

        const key =
            normalizeTagForMatch(tag);

        if (seen.has(key))
            continue;

        seen.add(key);
        merged.push(tag);

    }

    return merged;

}


function tagIndexCanAnswerSearch() {

    if (!tagIndexOnline)
        return false;

    if (navigator.onLine === false)
        return false;

    if (!tagIndexSyncedFingerprint)
        return false;

    const state =
        readTagIndexSyncState();

    if (state.fingerprint !== tagIndexSyncedFingerprint)
        return false;

    return (
        albums.filter(album => !album.storage).length ===
        tagIndexSyncedAlbumCount
    );

}


function albumMatchesSearchQuery(album, query, negative) {

    const albumTags =
        (album.tags || []).map(normalizeTagForMatch);

    return (
        query.every(tag => albumTags.includes(tag)) &&
        !negative.some(tag => albumTags.includes(tag))
    );

}


/*
 * Returns matching albums, or null when the index must not be used
 * (offline, stale, or a failed request). Null means "fall back to the
 * local scan".
 *
 * Saved albums are not in the index -- they only exist in this
 * browser -- so they are added by a local scan after the server
 * results. That keeps the index authoritative for the shared album
 * list without hiding browser-local albums.
 */
async function searchAlbumsThroughIndex(query, negative = []) {

    if (!tagIndexCanAnswerSearch())
        return null;

    const params =
        new URLSearchParams();

    if (query.length)
        params.set("tags", query.join(","));

    if (negative.length)
        params.set("exclude", negative.join(","));

    params.set("limit", "2000");

    const response =
        await tagIndexRequest(
            "/api/search?" + params.toString()
        );

    if (
        !response?.success ||
        !Array.isArray(response.albums)
    ) {
        return null;
    }

    const byKey =
        new Map(
            albums
                .filter(album => !album.storage)
                .map(album => [albumIndexKey(album), album])
        );

    const results =
        [];

    for (const row of response.albums) {

        const album =
            byKey.get(row.key);

        /*
         * An unknown key belongs to an album this browser does not
         * have (another device or a stale entry); it cannot be
         * rendered, so skip it instead of failing the whole search.
         */
        if (album)
            results.push(album);

    }

    for (const album of albums) {

        if (
            album.storage &&
            albumMatchesSearchQuery(album, query, negative)
        ) {
            results.push(album);
        }

    }

    return results;

}


/* Called by the uploader right after its manifest is sent. */
async function upsertTagIndexAlbum(record) {

    if (
        !record ||
        !tagIndexBaseUrl() ||
        !tagIndexToken()
    ) {
        return null;
    }

    const response =
        await tagIndexRequest(
            "/api/index/album",
            {
                method: "POST",
                json: {
                    albums: [{
                        key: record.key,
                        title: record.title || "",
                        tags: record.tags || []
                    }]
                }
            }
        );

    if (response?.success) {

        /* Force the next reload to refresh the local snapshot too. */
        saveTagIndexSyncState({
            ...readTagIndexSyncState(),
            fingerprint: ""
        });

    }

    return response;

}


function tagIndexStatusText(status) {

    if (!status)
        return "Worker unreachable.";

    if (!status.configured)
        return "The Worker is reachable but has no D1 binding.";

    return (
        `${Number(status.albums) || 0} albums, ` +
        `${Number(status.tags) || 0} tags` +
        (
            status.updatedAt
                ? " — updated " +
                  new Date(status.updatedAt).toLocaleString()
                : ""
        )
    );

}


function tagIndexErrorText(error = tagIndexLastError) {

    if (!error)
        return "the Worker could not be reached.";

    if (error.status === 401) {
        return (
            "the token was rejected (401). The Tags Index token in " +
            "Site Configuration must match the Worker's INDEX_TOKEN."
        );
    }

    if (error.status === 404) {
        return (
            "the URL does not expose the index API (404). Check the " +
            "Tags Index Worker URL."
        );
    }

    if (error.status === 503) {
        return "the Worker has no D1 binding (503).";
    }

    if (!error.status) {
        return error.error || "network error.";
    }

    return (
        `HTTP ${error.status}` +
        (error.error ? " — " + error.error : ".")
    );

}


function openTagIndexDialog() {

    document.getElementById("tagIndexDialog")?.remove();

    const overlay =
        document.createElement("div");

    overlay.id =
        "tagIndexDialog";

    overlay.className =
        "app-dialog-overlay";

    const box =
        document.createElement("div");

    box.className =
        "app-dialog";

    const title =
        document.createElement("div");

    title.className =
        "app-dialog-title";

    title.textContent =
        "Search Index";

    const description =
        document.createElement("div");

    description.className =
        "app-dialog-description";

    description.textContent =
        "The optional D1 tag index. The gallery keeps working " +
        "from local album data when this is unavailable.";

    const endpoint =
        document.createElement("div");

    endpoint.style.marginTop =
        "8px";

    endpoint.style.fontSize =
        "11px";

    endpoint.style.opacity =
        "0.72";

    endpoint.style.wordBreak =
        "break-all";

    endpoint.textContent =
        "Worker: " + (tagIndexBaseUrl() || "not configured");

    const status =
        document.createElement("div");

    status.style.margin =
        "12px 0";

    status.style.fontSize =
        "13px";

    status.textContent =
        "Checking the Worker…";

    const refresh =
        async () => {

            tagIndexLastError =
                null;

            status.textContent =
                "Checking the Worker…";

            if (!tagIndexBaseUrl()) {

                status.textContent =
                    "No index URL. Set one under Settings → Site " +
                    "Configuration → Tags Index Worker.";

                return;

            }

            if (!tagIndexToken()) {

                status.textContent =
                    "No index token. Add the Worker's INDEX_TOKEN in " +
                    "Settings → Site Configuration.";

                return;

            }

            const result =
                await refreshTagIndexStatus();

            if (!result) {

                status.textContent =
                    "Could not read the index: " +
                    tagIndexErrorText();

                return;

            }

            status.textContent =
                tagIndexStatusText(result);

            if (!result.configured)
                return;

            const sync =
                await syncTagIndex({ force: true });

            if (sync?.success) {

                status.textContent =
                    tagIndexStatusText({
                        configured: true,
                        albums:
                            Number(sync.albums) || 0,
                        tags:
                            Number(sync.tags) || 0,
                        updatedAt: sync.updatedAt
                    });

                return;

            }

            if (sync?.skipped === "no-albums") {

                status.textContent =
                    "Connected. Nothing to sync: every album is saved " +
                    "locally, or the album list is empty. Only albums " +
                    "from the shared album list are indexed.";

                return;

            }

            if (sync?.skipped === "limits") {

                status.textContent =
                    "Connected, but the album set is over the index " +
                    "limits (20,000 albums / 500 tags per album). " +
                    "Search stays local.";

                return;

            }

            if (sync?.error) {

                status.textContent =
                    "Connected, but the sync failed: " +
                    tagIndexErrorText(sync.error);

                return;

            }

            status.textContent =
                "Connected, but the sync did not complete.";

        };

    const syncButton =
        document.createElement("button");

    syncButton.type =
        "button";

    syncButton.className =
        "app-button";

    syncButton.textContent =
        "Sync now";

    syncButton.onclick =
        () => void refresh();

    const close =
        document.createElement("button");

    close.type =
        "button";

    close.className =
        "app-button app-dialog-close";

    close.textContent =
        "Close";

    close.onclick =
        () => overlay.remove();

    const buttons =
        document.createElement("div");

    buttons.className =
        "app-dialog-buttons";

    buttons.append(syncButton, close);

    box.append(
        title,
        description,
        endpoint,
        status,
        buttons
    );

    overlay.appendChild(box);

    overlay.onclick =
        e => {

            if (e.target === overlay)
                overlay.remove();

        };

    document.body.appendChild(overlay);

    void refresh();

}
