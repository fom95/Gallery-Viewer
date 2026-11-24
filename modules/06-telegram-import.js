/*
 * 06-telegram-import.js
 *
 * Telegram is now only used directly for two things: connecting the
 * client, and browsing chats/messages to build a temp album's image
 * list. Actual image bytes (thumb/medium/full) are served by whatever
 * the "telegram" entry in config.providers points at -- your
 * Cloudflare Worker -- through the normal resolveImageAsset()
 * pipeline (08-image-sources.js), the same as every other
 * provider. There is no more raw MTProto downloading of media bytes
 * anywhere in this file.
 */

/*
 * Telegram's official service-account conversation (chat id 777000) is not
 * a usable album destination and cannot be archived. Skip it everywhere a
 * chat list is built or displayed.
 */
const TELEGRAM_OFFICIAL_CHAT_ID = 777000;

/*
 * mtcute has no getChats(); walk the dialogs and return the same
 * [{ chat: {id, title, username, firstName, type} }] shape the rest
 * of the app already uses for window.telegramChats.
 */
async function telegramListChats(limit = 500) {

    const client =
        window.telegramClient;

    const result =
        [];

    for await (const dialog of client.iterDialogs({ limit })) {

        const peer =
            dialog.peer;

        if (Number(peer.id) === TELEGRAM_OFFICIAL_CHAT_ID)
            continue;

        let type;

        if (peer.type === "user")
            type = peer.isBot ? "bot" : "private";
        else
            type = peer.chatType || "group";

        result.push({
            chat: {
                id: peer.id,
                title: peer.displayName,
                username: peer.username || undefined,
                firstName: peer.type === "user" ? peer.firstName : undefined,
                type
            }
        });

    }

    return result;

}


/*
 * True for the same messages the previous check accepted: photos,
 * videos, and documents that are images.
 */
function telegramMessageHasMedia(message) {

    const media =
        message?.media;

    if (!media)
        return false;

    if (media.type === "photo" || media.type === "video")
        return true;

    return (
        media.type === "document" &&
        /^image\//i.test(media.mimeType || "")
    );

}


/*
 * metadata.json support
 * --------------------
 * The folder uploader stores a metadata.json document as the LAST
 * (newest) message of an upload. It lists every message that belongs to
 * the album and what role it plays (quick preview, original document,
 * ...), so the site must read it instead of guessing from message media
 * types -- otherwise both the quick image and its original document
 * are shown, i.e. every image appears twice.
 *
 * Albums uploaded with the older manifest-first layout still load:
 * discovery scans downwards through the media when no &metadata= is
 * present in the URL.
 *
 * The format is documented at the top of 25-telegram-uploader.js. When
 * no metadata document exists, loadTelegramAlbum() keeps the old
 * message-enumeration behaviour.
 */

const TELEGRAM_METADATA_FILENAME =
    "metadata.json";

/* How far to walk the history looking for metadata.json when the URL
 * does not name it. A manifest is the newest message of its upload, so
 * the scan starts just above the highest selected media ID; this limit
 * only matters when neither layout can be resolved. 1000 messages is
 * ~500 images/videos. */
const TELEGRAM_METADATA_SCAN_LIMIT =
    1000;

/* Parsed metadata documents, keyed by "chatId:messageId". Cleared at
 * the start of each album load: a metadata message can be overwritten
 * in place by the uploader, and one load reads each document twice. */
const telegramMetadataDocumentCache =
    new Map();


function telegramMessageFileName(message) {

    const media =
        message?.media;

    if (!media)
        return "";

    if (typeof media.fileName === "string" && media.fileName)
        return media.fileName;

    const attributes =
        media.raw?.attributes ||
        media.document?.attributes ||
        [];

    for (const attribute of attributes) {

        if (attribute?._ !== "documentAttributeFilename")
            continue;

        return String(
            attribute.fileName ??
            attribute.file_name ??
            ""
        );

    }

    return "";

}


function isTelegramMetadataMessage(message) {

    if (message?.media?.type !== "document")
        return false;

    return (
        telegramMessageFileName(message).toLowerCase() ===
        TELEGRAM_METADATA_FILENAME
    );

}


async function readTelegramMetadataDocument(client, chatId, message) {

    const key =
        String(chatId) + ":" + String(message.id);

    if (telegramMetadataDocumentCache.has(key))
        return telegramMetadataDocumentCache.get(key);

    const bytes =
        await client.downloadAsBuffer(message.media);

    const text =
        new TextDecoder("utf-8").decode(bytes);

    const doc =
        JSON.parse(text);

    telegramMetadataDocumentCache.set(key, doc);

    return doc;

}


/* Every message ID a metadata document claims belongs to its upload. */
function telegramMetadataMediaIDs(doc) {

    const ids =
        [];

    for (const record of Array.isArray(doc?.media) ? doc.media : []) {

        const quick =
            record?.messages?.quick ??
            record?.messageId;

        if (quick != null)
            ids.push(String(quick));

        for (const part of record?.messages?.original || [])
            ids.push(String(part));

    }

    return ids;

}


/*
 * True when every message the metadata document describes is part of
 * the album URL's explicit ?messages= list. A channel can hold several
 * uploads, so this is what tells two metadata documents apart.
 */
function telegramMetadataMatchesMessages(doc, messageIDs) {

    const ids =
        telegramMetadataMediaIDs(doc);

    if (!ids.length)
        return false;

    const allowed =
        new Set(messageIDs.map(String));

    return ids.every(id => allowed.has(id));

}


async function findTelegramMetadataMessages(client, chat, parsed, messages) {

    const selection =
        parsed?.messages?.length
            ? parsed.messages
            : null;

    /*
     * Without an explicit message list (or with a pinned document) the
     * newest matching metadata document describes the whole album.
     * With a selection, every matching upload in that selection is
     * collected -- a channel can hold more than one upload, and the
     * album should still not show quick copies and originals twice.
     */
    const stopAfterFirst =
        !selection || !!parsed?.metadata;

    const found = [];
    const seen = new Set();

    async function consider(message) {

        if (!isTelegramMetadataMessage(message))
            return false;

        if (message.id == null)
            return false;

        const key =
            String(message.id);

        if (seen.has(key))
            return false;

        seen.add(key);

        if (selection && !parsed?.metadata) {

            try {

                const doc =
                    await readTelegramMetadataDocument(
                        client,
                        chat.id,
                        message
                    );

                if (!telegramMetadataMatchesMessages(doc, selection))
                    return false;

            } catch {

                return false;

            }

        }

        found.push(message);

        return stopAfterFirst;

    }

    /*
     * ?metadata=<message id> pins a specific document, for channels
     * that contain more than one upload.
     */
    if (parsed?.metadata) {

        try {

            const explicit =
                await client.getMessages(
                    chat.id,
                    [Number(parsed.metadata)]
                );

            const message =
                (explicit || []).find(
                    item => item && item.id != null
                );

            if (await consider(message)) {

                found.sort((a, b) => Number(b.id) - Number(a.id));

                return found;

            }

        } catch {}

    }

    for (const message of messages || []) {

        if (await consider(message)) {

            found.sort((a, b) => Number(b.id) - Number(a.id));

            return found;

        }

    }

    /*
     * iterHistory() yields newest first, and Telegram's max_id is
     * EXCLUSIVE. The manifest is now the newest message of an upload,
     * immediately after the media, so scanning from (highest media id
     * + 2) includes that manifest. Legacy albums whose manifest came
     * first are still reached: the scan walks past the media and finds
     * it further down.
     */
    const scanOptions = {
        chunkSize: 100
    };

    if (selection) {

        scanOptions.maxId =
            Math.max(...selection) + 2;

    }

    let scanned =
        0;

    for await (
        const message of
        client.iterHistory(chat.id, scanOptions)
    ) {

        if (!message || message.raw?._ !== "message")
            continue;

        scanned++;

        if (await consider(message))
            break;

        if (scanned >= TELEGRAM_METADATA_SCAN_LIMIT)
            break;

    }

    /*
     * Newest first: when a channel holds more than one manifest for the
     * same upload (an edit appends a new one), the newest describes the
     * current album and must win over the one it supersedes.
     */
    found.sort((a, b) => Number(b.id) - Number(a.id));

    return found;

}


function positiveTelegramMessageID(value) {

    const id =
        Number(value);

    return Number.isInteger(id) && id > 0
        ? id
        : null;

}


/* Fields for one size that is stored in its own Telegram message. */
function telegramMessageFields(chatId, messageId, toggle = false) {

    const fields = {
        key1: String(chatId),
        key2: String(messageId)
    };

    if (toggle)
        fields.toggle = true;

    return fields;

}


function telegramMetadataTagStrings(doc, record) {

    const tags =
        Array.isArray(doc?.tags)
            ? doc.tags
            : [];

    return (
        Array.isArray(record?.tags)
            ? record.tags
            : []
    )
        .map(index => tags[index])
        .filter(tag => typeof tag === "string" && tag);

}


/*
 * Adds tag strings to album.tags (case-insensitively) and returns the
 * indices they ended up at. Keeping the album's existing list means
 * tags edited on the site survive a reload.
 */
function mergeTelegramAlbumTags(album, tagStrings) {

    album.tags =
        Array.isArray(album.tags)
            ? album.tags
            : [];

    const indexByName =
        new Map(
            album.tags.map(
                (tag, index) => [tag.toLowerCase(), index]
            )
        );

    const result = [];

    for (const tag of tagStrings) {

        const key =
            tag.toLowerCase();

        let index =
            indexByName.get(key);

        if (index === undefined) {

            index =
                album.tags.length;

            album.tags.push(tag);
            indexByName.set(key, index);

        }

        if (!result.includes(index))
            result.push(index);

    }

    return result.sort((a, b) => a - b);

}


/*
 * Replaces album.images with one entry per metadata.media record.
 *
 * `docs` is one or more parsed metadata documents (a channel can hold
 * more than one upload); their media are appended in document order.
 *
 * Sizes map like this:
 *   thumb  -> the thumbnail attached to the original document
 *             (the Worker's ?thumb=1 on that message)
 *   medium -> the quick image/video message (Telegram's scaled copy)
 *   full   -> the original document message
 *
 * Nothing here downloads image bytes; it only builds message IDs.
 */
function buildAlbumFromTelegramMetadata(album, chat, docs, metadataMessageIDs) {

    const documents =
        (Array.isArray(docs) ? docs : [docs])
            .filter(doc => doc && typeof doc === "object");

    /*
     * Tags already on the album (edited on the site, or restored from a
     * previous load) win over the metadata's original XMP tags. Keyed by
     * both the full and medium message IDs so it works across formats.
     */
    const existingTagsByMessage =
        new Map();

    if (album.images && typeof album.images === "object") {

        for (const number of Object.keys(album.images)) {

            const entry =
                album.images[number];

            const tags =
                Array.isArray(entry?.tags) && entry.tags.length
                    ? entry.tags
                    : null;

            if (!tags)
                continue;

            for (const id of [
                entry?.[0]?.full?.key2,
                entry?.[0]?.medium?.key2,
                entry?.[0]?.thumb?.key2
            ]) {

                if (id != null)
                    existingTagsByMessage.set(String(id), tags);

            }

        }

    }

    const images = {};
    const messageIDs = [];
    const seenFullIDs = new Set();

    let nextNumber = 1;
    let coverMessageID = null;

    for (const doc of documents) {

        const media =
            Array.isArray(doc.media)
                ? doc.media
                : [];

        const byId =
            new Map(
                media.map(record => [String(record?.id), record])
            );

        const ordered =
            Array.isArray(doc.order) && doc.order.length
                ? doc.order
                    .map(id => byId.get(String(id)))
                    .filter(Boolean)
                : media;

        for (const record of ordered) {

            if (!record || record.hidden === true)
                continue;

            const quick =
                positiveTelegramMessageID(
                    record.messages?.quick ??
                    record.messageId
                );

            const originalParts =
                (
                    Array.isArray(record.messages?.original)
                        ? record.messages.original
                        : []
                )
                    .map(positiveTelegramMessageID)
                    .filter(id => id != null);

            const original =
                originalParts[0] ?? null;

            const full =
                original ?? quick;

            if (full == null)
                continue;

            /*
             * Two metadata documents (or a hand-edited order list) can
             * point at the same original document; keep only the first
             * so an image can never be shown twice.
             */
            const fullKey =
                String(full);

            if (seenFullIDs.has(fullKey))
                continue;

            seenFullIDs.add(fullKey);

            /*
             * The document carries the standardized small copy as its
             * Telegram thumbnail. If there is no original document
             * (older metadata), fall back to the quick message's own
             * thumbnail.
             */
            const thumb =
                original ?? quick;

            const entry = {
                0: {
                    thumb:
                        telegramMessageFields(chat.id, thumb, true),
                    full:
                        telegramMessageFields(chat.id, full)
                }
            };

            /*
             * No quick copy means no medium size at all -- the viewer
             * will go straight from thumbnail to full instead of
             * pretending the original document is a small image.
             */
            if (quick != null) {

                entry[0].medium =
                    telegramMessageFields(chat.id, quick);

            }

            const existingTags =
                existingTagsByMessage.get(String(full));

            entry.tags =
                existingTags
                    ? existingTags.slice()
                    : mergeTelegramAlbumTags(
                        album,
                        telegramMetadataTagStrings(doc, record)
                    );

            if (!album.people || typeof album.people !== "object")
                album.people = {};

            const appearances =
                typeof galleryManifestPeople === "function"
                    ? galleryManifestPeople(record, album.people)
                    : [];

            if (appearances.length)
                entry.people = appearances;

            if (record.kind === "video")
                entry.video = true;

            if (originalParts.length > 1)
                entry.parts = originalParts;

            if (Number.isFinite(record.width))
                entry.width = record.width;

            if (Number.isFinite(record.height))
                entry.height = record.height;

            if (Number.isFinite(record.duration))
                entry.duration = record.duration;

            if (Number.isFinite(record.size))
                entry.size = record.size;

            images[nextNumber] = entry;

            nextNumber++;

            messageIDs.push(full);

            if (coverMessageID == null)
                coverMessageID = quick ?? full;

        }

    }

    album.sources =
        ["telegram"];

    album.images =
        images;

    album._telegramMessageIDs =
        messageIDs;

    album._telegramCoverMessageID =
        coverMessageID;

    album._telegramMetadataMessages =
        (metadataMessageIDs || []).slice();

    album._telegramMetadataMessage =
        album._telegramMetadataMessages[0] ?? null;

    album._telegramTagsFromMetadata =
        true;

    album._telegramFromMetadata =
        true;

}


/*
 * STOPGAP: the version of this file this was edited from did not contain
 * the real usesLiveTelegram(). This matches the old behaviour (any
 * tg://chat/ album is loaded live from Telegram). Replace it with your
 * original if you have it.
 */
if (typeof usesLiveTelegram !== "function") {

    var usesLiveTelegram = function (album) {

        return (
            !!album &&
            typeof album.url === "string" &&
            album.url.startsWith("tg://chat/") &&
            !album._telegramFromMetadata &&
            !album.storage &&
            /*
             * A locally edited album is already fully materialised in
             * localStorage. Re-fetching from Telegram would rebuild
             * its image list and discard local URL/tag/order edits.
             * An edit with no images never blocks the live load.
             */
            !(
                album.localEdited &&
                album.images &&
                typeof album.images === "object" &&
                Object.keys(album.images).length
            )
        );

    };

}


/*
 * One in-flight start attempt, shared by every caller. The client is
 * only published on window.telegramClient after start() succeeds, so a
 * dialog opened while a connection is still being established waits
 * for it instead of using a half-started client.
 */
let telegramClientStartPromise = null;

/*
 * Whether the in-flight attempt (if any) is allowed to show the login
 * prompt. A silent background restore must not make a later
 * user-initiated connect fail instead of prompting.
 */
let telegramClientStartAllowLogin = null;

const TELEGRAM_SESSION_STORAGE_KEY =
    "telegramSession";


/*
 * esm.sh bundles a Node Buffer polyfill for @fuman/utils, and that
 * polyfill does not understand "base64url". mtcute's session
 * export/import uses base64url, so without this patch the browser
 * throws "Unknown encoding: base64url".
 *
 * Patching the shared polyfill module (the same URL @fuman/utils
 * imports) fixes both directions without touching any other encoding.
 */
let base64UrlSupportPromise = null;

function ensureBrowserBase64UrlSupport() {

    if (base64UrlSupportPromise)
        return base64UrlSupportPromise;

    base64UrlSupportPromise = (async () => {

        try {

            const module =
                await import("https://esm.sh/node/buffer.mjs");

            const BufferPolyfill =
                module.Buffer ||
                module.default?.Buffer ||
                module.default;

            if (!BufferPolyfill)
                return false;

            if (BufferPolyfill.__mtcuteBase64UrlPatched)
                return true;

            const originalToString =
                BufferPolyfill.prototype.toString;

            BufferPolyfill.prototype.toString =
                function (encoding, ...args) {

                    if (
                        typeof encoding === "string" &&
                        encoding.toLowerCase() === "base64url"
                    ) {

                        return originalToString
                            .call(this, "base64", ...args)
                            .replace(/\+/g, "-")
                            .replace(/\//g, "_")
                            .replace(/=+$/g, "");

                    }

                    return originalToString.call(
                        this,
                        encoding,
                        ...args
                    );

                };

            const originalFrom =
                BufferPolyfill.from;

            BufferPolyfill.from =
                function (value, encoding, ...args) {

                    if (
                        typeof encoding === "string" &&
                        encoding.toLowerCase() === "base64url" &&
                        typeof value === "string"
                    ) {

                        let normalized =
                            value
                                .replace(/-/g, "+")
                                .replace(/_/g, "/");

                        while (normalized.length % 4)
                            normalized += "=";

                        return originalFrom.call(
                            BufferPolyfill,
                            normalized,
                            "base64",
                            ...args
                        );

                    }

                    return originalFrom.call(
                        BufferPolyfill,
                        value,
                        encoding,
                        ...args
                    );

                };

            BufferPolyfill.__mtcuteBase64UrlPatched =
                true;

            return true;

        } catch (error) {

            console.debug(
                "[TELEGRAM] Could not enable base64url support",
                {
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

            return false;

        }

    })();

    return base64UrlSupportPromise;

}


/*
 * Session string used when the browser's IndexedDB has no authorization
 * yet. localStorage is written whenever a login, import or a config link
 * with a session succeeds, so a fresh profile can restore it without a
 * phone login.
 */
function getConfiguredTelegramSession() {

    try {

        const stored =
            localStorage.getItem(
                TELEGRAM_SESSION_STORAGE_KEY
            );

        if (stored && stored.trim())
            return stored.trim();

    } catch {}

    return "";

}


async function ensureTelegramLibraryLoaded() {

    if (window.TelegramClient)
        return true;

    /*
     * index.html starts the mtcute import in parallel with the local
     * modules so the home page can render first. Wait for it only when
     * a Telegram connection is actually needed.
     */
    if (window.telegramLibraryPromise) {

        try {

            await window.telegramLibraryPromise;

        } catch {}

    }

    return !!window.TelegramClient;

}


async function initializeTelegramClient({ forceSession = false, allowLogin = true } = {}) {

    if (window.telegramClient) {

        return window.telegramClient;

    }

    if (
        !window.telegramAppId ||
        !window.telegramAppHash
    ) {

        return null;

    }

    if (!(await ensureTelegramLibraryLoaded())) {

        throw new Error("mtcute has not been loaded.");

    }

    await ensureBrowserBase64UrlSupport();

    /*
     * A background restore started with allowLogin=false must not
     * swallow a user-initiated login. Wait for it; if it could not
     * restore a session, loop and start a fresh attempt that IS allowed
     * to prompt. The loop (instead of a single retry) also covers the
     * case where another caller started a second silent attempt while
     * this one was waiting.
     */
    for (
        let attempt = 0;
        telegramClientStartPromise && attempt < 5;
        attempt++
    ) {

        if (!allowLogin || telegramClientStartAllowLogin) {

            return telegramClientStartPromise;

        }

        try {

            await telegramClientStartPromise;

        } catch {}

        if (window.telegramClient)
            return window.telegramClient;

    }

    telegramClientStartAllowLogin =
        allowLogin;

    telegramClientStartPromise = (async () => {

        const client =
            new window.TelegramClient({

                apiId:
                    Number(window.telegramAppId),

                apiHash:
                    window.telegramAppHash,

                // IndexedDB database name. Must differ from the old MTKruto database
                // ("telegram-browser-gallery"), whose schema is incompatible.
                storage:
                    "mtcute-browser-gallery"

            });

        /*
         * A cancelled or failed login must not leave the half-started client
         * in place, or every later attempt would silently reuse it and never
         * ask for a phone number again. Clear it so Save & Apply can retry.
         */
        try {

            const sessionString =
                getConfiguredTelegramSession();

            await client.start({

                ...(sessionString
                    ? {
                        session: sessionString,
                        sessionForce: forceSession
                    }
                    : {}),

                phone: async () => {

                    if (!allowLogin) {

                        throw new Error(
                            "Telegram login required."
                        );

                    }

                    const value =
                        await showInWindowPrompt({
                            title: "Connect Telegram",
                            message:
                                "Enter your phone number in international format, " +
                                "e.g. +447700900123.",
                            placeholder: "+447700900123",
                            okLabel: "Continue"
                        });

                    if (value === null) {
                        throw new Error("Telegram login cancelled.");
                    }

                    return value;

                },

                code: async () => {

                    if (!allowLogin) {

                        throw new Error(
                            "Telegram login required."
                        );

                    }

                    const value =
                        await showInWindowPrompt({
                            title: "Telegram Login Code",
                            message:
                                "Enter the login code Telegram sent you. " +
                                "If your password manager saved a login, " +
                                "the code can arrive in that app instead.",
                            placeholder: "12345",
                            okLabel: "Sign In"
                        });

                    if (value === null) {
                        throw new Error("Telegram login cancelled.");
                    }

                    return value;

                },

                password: async () => {

                    if (!allowLogin) {

                        throw new Error(
                            "Telegram login required."
                        );

                    }

                    const value =
                        await showInWindowPrompt({
                            title: "Two-Step Verification",
                            message:
                                "Enter your Telegram 2FA password.",
                            password: true,
                            okLabel: "Sign In"
                        });

                    if (value === null) {

                        throw new Error("Telegram login cancelled.");

                    }

                    return value;

                }

            });

        } catch (error) {

            try {

                if (typeof client.destroy === "function")
                    await client.destroy();

            } catch {}

            window.telegramClient =
                null;

            throw error;

        }

        window.telegramClient =
            client;

        /*
         * Keep the newest session string around so a fresh browser
         * profile (or cleared IndexedDB) can restore it without a
         * phone/code login. Failure here is harmless.
         */
        try {

            const exported =
                await client.exportSession();

            if (exported) {

                localStorage.setItem(
                    TELEGRAM_SESSION_STORAGE_KEY,
                    exported
                );

            }

        } catch (error) {

            console.debug(
                "[TELEGRAM] Could not store the session string",
                {
                    errorName: error?.name,
                    errorMessage: error?.message
                }
            );

        }

        return client;

    })();

    try {

        return await telegramClientStartPromise;

    } finally {

        telegramClientStartPromise =
            null;

        telegramClientStartAllowLogin =
            null;

    }

}


/*
 * Validates a pasted mtcute session string in a throwaway storage first,
 * then replaces the active session. Validating before touching the main
 * client means a typo or an expired string cannot destroy a working
 * login.
 */
async function importTelegramSession(sessionString) {

    const trimmed =
        String(sessionString || "").trim();

    if (!trimmed) {

        throw new Error(
            "No session string was provided."
        );

    }

    if (!(await ensureTelegramLibraryLoaded())) {

        throw new Error("mtcute has not been loaded.");

    }

    if (
        !window.telegramAppId ||
        !window.telegramAppHash
    ) {

        throw new Error(
            "Telegram credentials are missing from the site configuration."
        );

    }

    await ensureBrowserBase64UrlSupport();

    const checkStorage =
        "mtcute-session-check-" + Date.now();

    const checkClient =
        new window.TelegramClient({

            apiId:
                Number(window.telegramAppId),

            apiHash:
                window.telegramAppHash,

            storage:
                checkStorage

        });

    let me;

    try {

        await checkClient.importSession(trimmed, true);
        await checkClient.connect();
        me = await checkClient.getMe();

    } catch (error) {

        throw new Error(
            "Telegram rejected that session string:\n\n" +
            (
                error && error.message
                    ? error.message
                    : String(error)
            )
        );

    } finally {

        try {
            await checkClient.destroy();
        } catch {}

        try {
            indexedDB.deleteDatabase(checkStorage);
        } catch {}

    }

    /*
     * The string works. Store it as the fallback and force it into the
     * real client, replacing whatever was authorized before.
     */
    localStorage.setItem(
        TELEGRAM_SESSION_STORAGE_KEY,
        trimmed
    );

    if (telegramClientStartPromise) {

        try {
            await telegramClientStartPromise;
        } catch {}

    }

    if (window.telegramClient) {

        try {
            await window.telegramClient.destroy();
        } catch {}

        window.telegramClient =
            null;

    }

    const client =
        await initializeTelegramClient({
            forceSession: true
        });

    if (!client) {

        throw new Error(
            "The Telegram client could not be created."
        );

    }

    return me;

}


/*
 * Settings entry for moving a login between browsers: copy the current
 * mtcute session string, or paste one exported elsewhere.
 */
async function openTelegramSessionDialog() {

    const existing =
        document.getElementById(
            "telegramSessionOverlay"
        );

    if (existing)
        existing.remove();

    const overlay =
        document.createElement("div");

    overlay.id =
        "telegramSessionOverlay";

    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "10000",
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    });

    const box =
        document.createElement("div");

    Object.assign(box.style, {
        background: "#222",
        padding: "20px",
        borderRadius: "8px",
        width: "min(460px, 92vw)",
        maxHeight: "85vh",
        overflowY: "auto",
        boxSizing: "border-box"
    });

    const title =
        document.createElement("div");

    title.textContent =
        "Telegram Session";

    title.style.fontSize =
        "20px";

    title.style.marginBottom =
        "12px";

    const status =
        document.createElement("div");

    status.style.fontSize =
        "13px";

    status.style.opacity =
        "0.85";

    status.style.marginBottom =
        "12px";

    status.textContent =
        "Checking...";

    const hint =
        document.createElement("div");

    hint.style.fontSize =
        "12px";

    hint.style.opacity =
        "0.7";

    hint.style.marginBottom =
        "14px";

    hint.style.whiteSpace =
        "pre-wrap";

    hint.textContent =
        "Copy the current mtcute session string to reuse it elsewhere, " +
        "or paste a session string exported by an mtcute client. " +
        "Importing replaces the session stored in this browser.";

    const buttons =
        document.createElement("div");

    buttons.style.display =
        "flex";

    buttons.style.flexWrap =
        "wrap";

    buttons.style.gap =
        "8px";

    const makeButton =
        (label, primary) => {

            const button =
                document.createElement("button");

            button.type =
                "button";

            button.textContent =
                label;

            if (primary)
                button.style.fontWeight = "bold";

            return button;

        };

    const connectButton =
        makeButton("Connect");

    const copyButton =
        makeButton("Copy Session");

    const importButton =
        makeButton("Import Session", true);

    const closeButton =
        makeButton("Close");

    buttons.append(
        connectButton,
        copyButton,
        importButton,
        closeButton
    );

    const refreshStatus =
        async () => {

            if (!window.telegramClient) {

                status.textContent =
                    "Not connected.";

                return;

            }

            try {

                const me =
                    await window.telegramClient.getMe();

                const name =
                    me.displayName ||
                    me.username ||
                    String(me.id);

                status.textContent =
                    "Session stored for " +
                    name +
                    (
                        me.username
                            ? " (@" + me.username + ")"
                            : ""
                    );

            } catch (error) {

                status.textContent =
                    "Not connected: " +
                    (
                        error && error.message
                            ? error.message
                            : String(error)
                    );

            }

        };

    connectButton.onclick =
        async () => {

            connectButton.disabled = true;
            status.textContent = "Connecting...";

            try {

                await initTelegramFromConfig();

            } catch (error) {

                status.textContent =
                    "Connection failed: " +
                    (
                        error && error.message
                            ? error.message
                            : String(error)
                    );

            } finally {

                connectButton.disabled = false;
                await refreshStatus();

            }

        };

    copyButton.onclick =
        async () => {

            copyButton.disabled = true;
            status.textContent = "Exporting session...";

            try {

                if (!window.telegramClient) {

                    throw new Error(
                        "Telegram is not connected. Use Connect first."
                    );

                }

                await ensureBrowserBase64UrlSupport();

                const session =
                    await window.telegramClient.exportSession();

                localStorage.setItem(
                    TELEGRAM_SESSION_STORAGE_KEY,
                    session
                );

                showInWindowCopy(
                    "Telegram Session",
                    session
                );

            } catch (error) {

                alert(
                    "Failed to export the Telegram session:\n\n" +
                    (
                        error && error.message
                            ? error.message
                            : String(error)
                    )
                );

            } finally {

                copyButton.disabled = false;
                await refreshStatus();

            }

        };

    importButton.onclick =
        async () => {

            const value =
                await showInWindowPrompt({
                    title: "Import Telegram Session",
                    message:
                        "Paste an mtcute session string (from " +
                        "TelegramClient.exportSession()). This replaces " +
                        "the session currently stored in this browser.",
                    placeholder: "AwEAAAA...",
                    okLabel: "Import",
                    multiline: true
                });

            if (value === null)
                return;

            importButton.disabled = true;
            status.textContent = "Validating session...";

            try {

                const me =
                    await importTelegramSession(value);

                await refreshStatus();

                alert(
                    "Telegram session imported as " +
                    (
                        me.displayName ||
                        me.username ||
                        String(me.id)
                    ) +
                    "."
                );

            } catch (error) {

                alert(
                    "Failed to import the Telegram session:\n\n" +
                    (
                        error && error.message
                            ? error.message
                            : String(error)
                    )
                );

                await refreshStatus();

            } finally {

                importButton.disabled = false;

            }

        };

    closeButton.onclick =
        () => overlay.remove();

    overlay.onclick =
        e => {

            if (e.target === overlay)
                overlay.remove();

        };

    box.append(
        title,
        status,
        hint,
        buttons
    );

    overlay.appendChild(box);

    document.body.appendChild(overlay);

    refreshStatus();

}


/*
 * Pulls chatId/cover/messages out of a "tg://chat/ID?cover=X&messages=
 * Y,Z" album URL.
 */
function parseTelegramAlbumUrl(url) {

    const match =
        url.match(
            /^tg:\/\/chat\/(-?\d+)(?:\?(.+))?$/
        );

    if (!match)
        return null;

    const options =
        new URLSearchParams(match[2] || "");

    const messages =
        (options.get("messages") || "")
            .split(",")
            .map(id => Number(id))
            .filter(id => Number.isInteger(id) && id > 0);

    return {
        chatId: Number(match[1]),
        cover: options.get("cover"),
        metadata: options.get("metadata"),
        messages
    };

}


/*
 * Finds a chat by ID, using window.telegramChats as a cache (shared
 * with the chat-picker dialog) before falling back to a fresh
 * fresh dialog listing.
 */
async function findTelegramChat(chatId) {

    if (!window.telegramClient) {

        throw new Error(
            "Telegram client is not initialized."
        );

    }

    if (Array.isArray(window.telegramChats)) {

        const found =
            window.telegramChats.find(
                item =>
                    item &&
                    item.chat &&
                    String(item.chat.id) === String(chatId)
            );

        if (found)
            return found.chat;

    }

    const chats =
        await telegramListChats(500);

    window.telegramChats =
        chats;

    const found =
        chats.find(
            item =>
                item &&
                item.chat &&
                String(item.chat.id) === String(chatId)
        );

    if (!found) {

        throw new Error(
            "Telegram chat was not found: " + chatId
        );

    }

    return found.chat;

}


/*
 * Builds the {thumb, medium, full} field set for one Telegram message,
 * keyed the same way regardless of size -- only "toggle" (thumbnail
 * vs original) differs. What key1/key2 actually mean is entirely up
 * to config.providers.telegram's blueprint; chat ID + message ID is
 * enough for a worker to look the message up and serve whichever
 * variant is asked for.
 */
function buildTelegramSourceFields(chatId, messageId) {

    const fields = {
        key1: String(chatId),
        key2: String(messageId)
    };

    return {
        thumb: { ...fields, toggle: true },
        medium: { ...fields },
        full: { ...fields }
    };

}


/*
 * The metadata.json document is itself a valid manifest and the Worker
 * can serve its bytes. Store a provider-backed locator instead of a
 * signed URL so the album record keeps working after the Worker auth
 * token expires: resolveAlbumManifestUrl() re-signs it on each load.
 */
function buildTelegramManifestLocator(album, chat, metadataMessageId) {

    const provider =
        Array.isArray(album?.sources)
            ? album.sources[0]
            : null;

    if (
        !provider ||
        provider === "direct" ||
        metadataMessageId == null
    ) {
        return null;
    }

    const fields =
        buildTelegramSourceFields(
            chat.id,
            metadataMessageId
        ).full;

    const url =
        typeof resolveProviderUrl === "function"
            ? resolveProviderUrl(
                provider,
                fields
            )
            : null;

    return {
        provider,
        fields,
        ...(url ? { url } : {})
    };

}


/*
 * Loads (or reloads) a Telegram album's image list. Only contacts
 * Telegram to enumerate which messages exist and carry media --
 * nothing here downloads any image bytes.
 */
async function loadTelegramAlbum(album) {

    const parsed =
        parseTelegramAlbumUrl(album.url);

    if (!parsed) {

        throw new Error(
            "Invalid Telegram album URL: " + album.url
        );

    }

    /*
     * Opt-in manifest path. If the album or its source provides a
     * manifest URL, this is one request and no Telegram connection or
     * message enumeration. No URL means this block is skipped entirely.
     */
    if (
        typeof loadAlbumFromManifestIfAvailable === "function" &&
        await loadAlbumFromManifestIfAvailable(album)
    ) {
        return;
    }

    /*
     * Startup deliberately leaves Telegram disconnected (see
     * configureTelegramFromConfig()). This is the point where an album
     * actually needs it, so connect now -- restoring the saved session
     * silently, or showing the login prompt if there is none.
     */
    if (!window.telegramClient) {

        await initTelegramFromConfig({ silent: true });

    }

    if (!window.telegramClient) {

        throw new Error(
            "Telegram is not connected. Use the settings button to connect, then try again."
        );

    }

    const client =
        window.telegramClient;

    const chat =
        await findTelegramChat(parsed.chatId);

    let messages =
        [];

    if (parsed.messages.length) {

        messages =
            await client.getMessages(chat.id, parsed.messages);

    } else if (!parsed.metadata) {

        /*
         * A pinned metadata id is fetched directly by
         * findTelegramMetadataMessages(); a 100-message history read
         * would only duplicate that request.
         */
        messages =
            await client.getHistory(chat.id, { limit: 100 });

    }

    if (parsed.messages.length) {

        const messageMap =
            new Map();

        for (const message of messages) {

            if (message && Number.isInteger(message.id))
                messageMap.set(message.id, message);

        }

        messages =
            parsed.messages
                .map(id => messageMap.get(id))
                .filter(message => !!message);

    }

    /*
     * Prefer metadata.json. It is the authoritative description of the
     * upload, so when it exists the site must not also enumerate the
     * quick images and original documents as separate album entries --
     * that is what made every image appear twice.
     */
    album._telegramFromMetadata =
        false;

    album._telegramTagsFromMetadata =
        false;

    telegramMetadataDocumentCache.clear();

    try {

        const metadataMessages =
            await findTelegramMetadataMessages(
                client,
                chat,
                parsed,
                messages
            );

        if (metadataMessages.length) {

            const metadataDocs = [];
            const metadataMessageIDs = [];

            for (const message of metadataMessages) {

                const doc =
                    await readTelegramMetadataDocument(
                        client,
                        chat.id,
                        message
                    );

                if (
                    !(Array.isArray(doc?.media) && doc.media.length) &&
                    !(isGalleryManifest(doc) && doc.items.length)
                ) {

                    continue;

                }

                metadataDocs.push(doc);
                metadataMessageIDs.push(message.id);

            }

            /*
             * findTelegramMetadataMessages() has already checked that
             * every document describes messages the album asked for,
             * so it is safe to build from them.
             */
            if (metadataDocs.length) {

                /*
                 * Prefer the provider-neutral manifest view when the
                 * document carries one. This is the uploader's default
                 * output; the legacy media/messages fields remain for
                 * older albums.
                 */
                const manifestDoc =
                    metadataDocs.find(
                        doc => isGalleryManifest(doc)
                    );

                if (
                    manifestDoc &&
                    typeof buildAlbumFromGalleryManifest === "function" &&
                    buildAlbumFromGalleryManifest(
                        album,
                        manifestDoc
                    )
                ) {

                    const manifestIndex =
                        metadataDocs.indexOf(
                            manifestDoc
                        );

                    const storedManifestMessage =
                        manifestDoc.storage?.manifestMessage;

                    const manifestMessageID =
                        storedManifestMessage != null &&
                        Number.isFinite(Number(storedManifestMessage))
                            ? Number(storedManifestMessage)
                            : (
                                metadataMessageIDs[manifestIndex] ??
                                metadataMessageIDs[0] ??
                                null
                            );

                    album._telegramMetadataMessages =
                        metadataMessageIDs.slice();

                    album._telegramMetadataMessage =
                        manifestMessageID;

                    const manifestLocator =
                        buildTelegramManifestLocator(
                            album,
                            chat,
                            manifestMessageID
                        );

                    if (manifestLocator) {

                        album.manifest = {

                            ...(album.manifest &&
                            typeof album.manifest === "object"
                                ? album.manifest
                                : {}),

                            ...manifestLocator

                        };

                    }

                    return;

                }

                const legacyPairs =
                    metadataDocs
                        .map((doc, index) => ({
                            doc,
                            id: metadataMessageIDs[index]
                        }))
                        .filter(pair =>
                            Array.isArray(pair.doc?.media) &&
                            pair.doc.media.length
                        );

                if (legacyPairs.length) {

                    buildAlbumFromTelegramMetadata(
                        album,
                        chat,
                        legacyPairs.map(pair => pair.doc),
                        legacyPairs.map(pair => pair.id)
                    );

                    return;

                }

                /* A manifest-only document that failed to build: fall
                 * through to message enumeration below. */

            }

        }

    } catch (error) {

        console.warn(
            "[TELEGRAM] Could not use metadata.json; falling back to message enumeration.",
            error
        );

    }

    /*
     * Preserve tags already assigned to existing entries (e.g. from a
     * previous XMP extraction pass) when a saved Telegram album is
     * reopened, keyed by message ID.
     */
    const existingTagIndicesByMessageID =
        new Map();

    if (album.images && typeof album.images === "object") {

        for (const number of Object.keys(album.images)) {

            const entry =
                album.images[number];

            const telegramSource =
                entry?.[0];

            const messageId =
                telegramSource?.full?.key2;

            if (messageId != null) {

                existingTagIndicesByMessageID.set(
                    String(messageId),
                    Array.isArray(entry.tags) ? entry.tags : []
                );

            }

        }

    }

    const images =
        {};

    let nextNumber =
        1;

    for (const message of messages) {

        if (!message)
            continue;

        if (isTelegramMetadataMessage(message))
            continue;

        const hasMedia =
            telegramMessageHasMedia(message);

        if (!hasMedia)
            continue;

        images[nextNumber] = {
            0: buildTelegramSourceFields(chat.id, message.id),
            tags:
                existingTagIndicesByMessageID.get(String(message.id)) || []
        };

        nextNumber++;

    }

    album.sources =
        ["telegram"];

    album.images =
        images;

    album._telegramMessageIDs =
        Object.values(images).map(
            entry => Number(entry[0].full.key2)
        );

}


/*
 * Picks a cover for the home page: an explicit cover=, otherwise a
 * random pick from the messages= list (no Telegram contact needed
 * either way), otherwise -- only if the album URL carries neither --
 * a small history request to pick from. Always resolves to a plain
 * URL through the provider blueprint; no raw thumbnail download.
 */
async function loadTelegramAlbumCover(album) {

    const parsed =
        parseTelegramAlbumUrl(album.url);

    if (!parsed) {

        throw new Error(
            "Invalid Telegram album URL: " + album.url
        );

    }

    let selectedMessageID =
        null;

    if (parsed.cover) {

        selectedMessageID =
            Number(parsed.cover);

    } else if (album._telegramCoverMessageID != null) {

        /*
         * Set by buildAlbumFromTelegramMetadata(): the quick copy of
         * the first image, never the metadata document itself.
         */
        selectedMessageID =
            Number(album._telegramCoverMessageID);

    } else if (parsed.messages.length) {

        selectedMessageID =
            parsed.messages[
                Math.floor(Math.random() * parsed.messages.length)
            ];

    } else {

        if (!window.telegramClient) {

            throw new Error(
                "Telegram client is not initialized."
            );

        }

        const chat =
            await findTelegramChat(parsed.chatId);

        const history =
            await window.telegramClient.getHistory(chat.id, { limit: 20 });

        const imageMessages =
            history.filter(
                candidate =>
                    candidate &&
                    !isTelegramMetadataMessage(candidate) &&
                    (
                        candidate.media?.type === "photo" ||
                        candidate.media?.type === "document"
                    )
            );

        if (!imageMessages.length) {

            throw new Error(
                "Telegram album contains no image messages."
            );

        }

        selectedMessageID =
            Number(
                imageMessages[
                    Math.floor(Math.random() * imageMessages.length)
                ].id
            );

    }

    const url =
        resolveProviderUrl(
            "telegram",
            { key1: String(parsed.chatId), key2: String(selectedMessageID), toggle: true }
        );

    if (!url) {

        throw new Error(
            "No \"telegram\" provider is configured."
        );

    }

    return {
        url,
        messageID: selectedMessageID
    };

}


async function populateTelegramAlbumChats(select) {

    if (!select)
        return;

    if (
        !window.telegramClient
    ) {

        select.innerHTML = `
            <option value="">
                Telegram is not initialized
            </option>
        `;

        return;

    }

    try {

        let chats =
            Array.isArray(window.telegramChats)
                ? window.telegramChats
                : null;

        if (!chats) {

            chats =
                await telegramListChats(500);

            window.telegramChats =
                chats;

        }

        const usedChatIDs =
            new Set();

        if (
            Array.isArray(albums)
        ) {

            albums.forEach(
                album => {

                    if (
                        !album ||
                        typeof album.url !== "string"
                    ) {
                        return;
                    }

                    const match =
                        album.url.match(
                            /^tg:\/\/chat\/(-?\d+)/
                        );

                    if (match) {

                        usedChatIDs.add(
                            String(match[1])
                        );

                    }

                }
            );

        }

        const availableChats =
            [];

        chats.forEach(
            item => {

                if (
                    !item ||
                    !item.chat
                ) {
                    return;
                }

                const chat =
                    item.chat;

                const chatID =
                    String(chat.id);

                if (
                    usedChatIDs.has(chatID)
                ) {

                    return;

                }

                const type =
                    String(
                        chat.type ||
                        ""
                    ).toLowerCase();

                if (
                    type === "private" ||
                    type === "user" ||
                    type === "bot"
                ) {

                    return;

                }

                availableChats.push(chat);

            }
        );

        availableChats.sort(
            (a, b) =>
                String(
                    a.title ||
                    a.username ||
                    a.id
                ).localeCompare(
                    String(
                        b.title ||
                        b.username ||
                        b.id
                    )
                )
        );

        select.innerHTML = `
            <option value="">
                Select Telegram chat
            </option>
        `;

        availableChats.forEach(
            chat => {

                const option =
                    document.createElement("option");

                option.value =
                    chat.id;

                option.textContent =
                    chat.title ||
                    chat.username ||
                    String(chat.id);

                select.appendChild(option);

            }
        );

        if (
            !availableChats.length
        ) {

            const option =
                document.createElement("option");

            option.value =
                "";

            option.textContent =
                "No unused Telegram chats";

            select.appendChild(option);

        }

    }
    catch (error) {

        select.innerHTML = `
            <option value="">
                Failed to load Telegram chats
            </option>
        `;

    }

}


/*
 * Fetches an image's "full" URL (via the normal provider-candidate
 * resolution) and extracts any XMP dc:subject tags embedded in the
 * bytes, adding newly-seen tags to album.tags and recording each
 * image's tags as indices into it -- same storage shape as any other
 * album. This is the one place that still needs the actual image
 * bytes in the browser (to read embedded metadata), but it's a plain
 * fetch() against the resolved provider URL now, not raw MTProto.
 */
async function extractTelegramXMPTags(album) {

    /*
     * metadata.json already carries the XMP tags that were read at
     * upload time, so re-downloading every original just to read the
     * same tags is wasted work (and would overwrite the metadata's tag
     * list with whatever happens to be embedded in the file).
     */
    if (album._telegramTagsFromMetadata)
        return;

    const images =
        buildImagesArray(album);

    const tagIndexByName =
        new Map(
            (album.tags || []).map((tag, index) => [tag.toLowerCase(), index])
        );

    function tagIndexFor(tagName) {

        const key =
            tagName.toLowerCase();

        if (tagIndexByName.has(key))
            return tagIndexByName.get(key);

        album.tags =
            album.tags || [];

        const index =
            album.tags.length;

        album.tags.push(tagName);

        tagIndexByName.set(key, index);

        return index;

    }

    const BATCH_SIZE =
        10;

    for (let i = 0; i < images.length; i += BATCH_SIZE) {

        const batch =
            images.slice(i, i + BATCH_SIZE);

        await Promise.all(
            batch.map(async image => {

                try {

                    const url =
                        getBestGuessImageURL(album, image, "full");

                    if (!url)
                        return;

                    const response =
                        await fetch(url);

                    if (!response.ok)
                        return;

                    const buffer =
                        await response.arrayBuffer();

                    const metadata =
                        await getTelegramXMPMetadata(buffer);

                    const subjects =
                        uniqueTags(metadata?.xmptags?.subject || []);

                    image.tags =
                        subjects.map(tag => tagIndexFor(tag));

                } catch (error) {

                    console.warn(
                        "Failed to extract XMP for a Telegram image",
                        error
                    );

                }

            })
        );

    }

}


function uniqueTags(tags) {

    const result = [];
    const seen = new Set();

    for (
        const tag of
        Array.isArray(tags)
            ? tags
            : []
    ) {

        if (
            typeof tag !==
            "string"
        ) {

            continue;

        }

        const clean =
            tag.trim();

        if (!clean) {
            continue;
        }

        const key =
            clean.toLowerCase();

        if (
            seen.has(key)
        ) {

            continue;

        }

        seen.add(key);

        result.push(
            clean
        );

    }

    return result;
}


async function openTemporaryTelegramAlbum(chatID) {

    if (!chatID) {
        return;
    }

    if (!window.telegramClient) {
        alert("Telegram client is not initialized.");
        return;
    }

    try {

        const client =
            window.telegramClient;

        const chat =
            await findTelegramChat(chatID);

        /*
         * Retrieve the ENTIRE chat history (mtcute pages it for us),
         * keep normal/user-created messages only, oldest -> newest.
         */

        const targetMessages =
            [];

        for await (
            const message of
            client.iterHistory(chat.id, { chunkSize: 100 })
        ) {

            if (message?.raw?._ === "message")
                targetMessages.push(message);

        }

        targetMessages.sort(
            (a, b) =>
                Number(a.id) - Number(b.id)
        );


        if (!targetMessages.length) {

            alert(
                "No user-created messages were found in this Telegram chat."
            );

            return;
        }

        /*
         * Leave metadata.json out of the explicit message list: it is
         * not album content, and picking it as the cover would point
         * the home page at a JSON document with no thumbnail.
         *
         * The manifest is now the newest message of an upload, so it is
         * referenced explicitly with &metadata=<id> rather than being
         * discovered by walking the history. That keeps discovery to one
         * getMessages call and avoids picking up an older revision from
         * another upload in the same channel.
         *
         * Every media message must be listed, including original
         * video documents: the metadata document references them, and
         * an incomplete list would make it look like a different
         * upload (forcing the old enumeration fallback).
         */
        const metadataMessages =
            targetMessages.filter(
                isTelegramMetadataMessage
            );

        const metadataMessageID =
            metadataMessages.length
                ? metadataMessages[
                    metadataMessages.length - 1
                ].id
                : null;
        const mediaMessages =
            targetMessages.filter(
                message => {

                    if (isTelegramMetadataMessage(message))
                        return false;

                    const type =
                        message?.media?.type;

                    return (
                        type === "photo" ||
                        type === "video" ||
                        type === "document"
                    );

                }
            );

        const messageIDs =
            mediaMessages.map(
                message =>
                    message.id
            );


        const coverMessageID =
            messageIDs[0] ??
            targetMessages[0].id;


        const telegramURL =
            "tg://chat/" +
            String(chat.id) +
            "?cover=" +
            encodeURIComponent(
                coverMessageID
            ) +
            "&messages=" +
            messageIDs
                .map(
                    id =>
                        encodeURIComponent(id)
                )
                .join(",") +
            (
                metadataMessageID != null
                    ? "&metadata=" +
                      encodeURIComponent(
                          metadataMessageID
                      )
                    : ""
            );


        const album = {

            id:
                generateAlbumID(
                    chat.title ||
                    chat.username ||
                    "Telegram Album"
                ),

            name:
                chat.title ||
                chat.username ||
                "Telegram Album",

            sourceName:
                chat.title ||
                chat.username ||
                "Telegram Album",

            url:
                telegramURL,

            tags:
                [],

            sources:
                ["telegram"],

            images:
                {},

            temporary:
                true,

            edited:
                false
        };

        currentTemporaryAlbumID =
            album.id;

		setTelegramImportSavingState(true);


        history.pushState(
            null,
            "",
            "?=" +
            encodeURIComponent(
                album.id
            )
        );


        /*
         * Build the image list (chat/message discovery only -- no
         * media bytes downloaded here).
         */

        await loadAlbum(
            album,
            false
        );

        /*
         * Now fetch each image's bytes exactly once, to read embedded
         * XMP tags -- via the normal provider URL (your Worker),
         * not raw MTProto.
         */
        await extractTelegramXMPTags(album);

        buildImagesArray(album);

		setTelegramImportSavingState(false);

		console.log(
			"[Telegram TEMP] XMP extraction complete; saving album",
			{
				images: album._imagesArray.length,
				imagesWithTags: album._imagesArray.filter(
					image =>
						Array.isArray(image.tags) &&
						image.tags.length
				).length
			}
		);

		buildTagList(album.tags || []);

		saveTemporaryAlbum(album);
		showAlbumButtons(true);

    }
    catch (error) {

        console.error(
            "openTemporaryTelegramAlbum failed:",
            error
        );

        alert(
            "Failed to open Telegram album:\n\n" +
            (
                error &&
                error.message
                    ? error.message
                    : String(error)
            )
        );
    }

}
