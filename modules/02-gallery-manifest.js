/*
 * 02-gallery-manifest.js
 *
 * The gallery-manifest/v1 contract, in one place.
 *
 * The Telegram uploader produces this view, the site consumes it, and
 * the settings generator writes it. Schema ids, variant names, locator
 * helpers, the producer translation and the site translation all live
 * here, so a field or variant rename is one edit.
 *
 * A manifest is used only when the album record contains
 * album.manifest.url. There is no probing or source-wide setting; the
 * Telegram metadata document's embedded v1 view is used when present.
 */

const GALLERY_MANIFEST_SCHEMA = "gallery-manifest/v1";

const GALLERY_MANIFEST_VARIANTS = Object.freeze({
    thumb: "thumb",
    medium: "medium",
    preview: "preview",
    full: "full"
});

/* Manifest variant name -> the site's image entry size key. */
const GALLERY_MANIFEST_SITE_SIZES = Object.freeze({
    thumb: "thumb",
    medium: "medium",
    preview: "medium",
    full: "full"
});

const GALLERY_MANIFEST_TTL_MS = 5 * 60 * 1000;
const GALLERY_MANIFEST_MAX_ENTRIES = 12;
const GALLERY_MANIFEST_MAX_BYTES = 5 * 1000 * 1000;

const galleryManifestCache = new Map();


function isGalleryManifest(value) {

    return (
        value?.schema === GALLERY_MANIFEST_SCHEMA &&
        Array.isArray(value.items)
    );

}


function galleryManifestSlug(value) {

    const base =
        String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_-]+/gu, "-")
            .replace(/^-+|-+$/g, "");

    if (base)
        return base;

    let hash = 0x811c9dc5;

    for (const character of String(value || "")) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return "person-" + hash.toString(16);

}


function galleryManifestTagKey(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ");

}


function galleryManifestTagIndex(tags, tag) {

    const value =
        String(tag || "").trim();

    if (!value)
        return -1;

    const key =
        galleryManifestTagKey(value);

    const existing =
        tags.findIndex(
            candidate => galleryManifestTagKey(candidate) === key
        );

    if (existing >= 0)
        return existing;

    tags.push(value);

    return tags.length - 1;

}


function galleryManifestTelegramLocator(
    chatId,
    messageId,
    thumb = false
) {

    const message =
        Number(messageId);

    if (!Number.isFinite(message) || message <= 0)
        return null;

    const locator = {
        type: "telegram",
        chat: Number(chatId),
        message
    };

    if (thumb)
        locator.thumb = true;

    return locator;

}


function galleryManifestDirectLocator(url) {

    return typeof url === "string" && url.trim()
        ? { type: "url", url: url.trim() }
        : null;

}


function createGalleryManifestItem({
    id,
    kind = "image",
    variants = {},
    tags = [],
    people = [],
    parts = [],
    mime,
    size,
    width,
    height,
    duration,
    hidden = false
} = {}) {

    const item = {
        id: String(id),
        kind: kind === "video" ? "video" : "image",
        variants: {}
    };

    for (const [key, value] of Object.entries(variants)) {
        if (value !== undefined && value !== null)
            item.variants[key] = value;
    }

    if (Array.isArray(tags) && tags.length)
        item.tags = tags.slice();

    if (Array.isArray(people) && people.length)
        item.people = people;

    if (Array.isArray(parts) && parts.length)
        item.parts = parts;

    if (mime)
        item.mime = mime;

    for (
        const [key, value] of [
            ["size", size],
            ["width", width],
            ["height", height],
            ["duration", duration]
        ]
    ) {

        const number = Number(value);

        if (Number.isFinite(number) && number > 0)
            item[key] = number;

    }

    if (hidden === true)
        item.hidden = true;

    return item;

}


function createGalleryManifest({
    id,
    revision,
    title,
    tags = [],
    people,
    storage,
    generator,
    items = [],
    order
} = {}) {

    const manifest = {
        schema: GALLERY_MANIFEST_SCHEMA,
        title: title ?? null,
        tags: Array.isArray(tags) ? tags.slice() : [],
        items,
        order:
            Array.isArray(order)
                ? order.map(String)
                : items.map(item => item.id)
    };

    if (id)
        manifest.id = id;

    if (revision)
        manifest.revision = revision;

    if (storage)
        manifest.storage = storage;

    if (generator)
        manifest.generator = generator;

    if (
        people &&
        typeof people === "object" &&
        Object.keys(people).length
    ) {
        manifest.people = people;
    }

    return manifest;

}


function galleryManifestPeople(record, registry) {

    const faces =
        Array.isArray(record?.faces)
            ? record.faces
            : [];

    if (!faces.length)
        return [];

    const dimensions =
        record.regionDimensions || {};

    const width =
        Number(dimensions.W ?? dimensions.width) || 0;

    const height =
        Number(dimensions.H ?? dimensions.height) || 0;

    const normalized =
        width > 0 && height > 0;

    const appearances =
        [];

    const round = value =>
        Math.round(value * 1e6) / 1e6;

    for (const face of faces) {

        if (!face || typeof face !== "object")
            continue;

        const area = face.area || {};

        let x = Number(area.X ?? area.x);
        let y = Number(area.Y ?? area.y);
        let w = Number(area.W ?? area.w);
        let h = Number(area.H ?? area.h);

        if (![x, y, w, h].every(Number.isFinite))
            continue;

        if (normalized) {
            x /= width;
            y /= height;
            w /= width;
            h /= height;
        }

        const region = {
            type: String(face.type || "face").toLowerCase(),
            x: round(Math.max(0, x)),
            y: round(Math.max(0, y)),
            w: round(Math.max(0, w)),
            h: round(Math.max(0, h))
        };

        if (!normalized)
            region.space = "px";

        const name =
            typeof face.name === "string"
                ? face.name.trim()
                : "";

        if (!name) {

            appearances.push({
                person: null,
                regions: [region]
            });

            continue;

        }

        const id =
            galleryManifestSlug(name) || "person";

        if (!registry[id]) {

            registry[id] = {
                name
            };

        }

        let appearance =
            appearances.find(entry => entry.person === id);

        if (!appearance) {

            appearance = {
                person: id,
                regions: []
            };

            appearances.push(appearance);

        }

        appearance.regions.push(region);

    }

    return appearances;

}


function buildGalleryManifestFromTelegramDoc(
    doc,
    chat,
    generatorVersion = 3
) {

    const albumTags =
        Array.isArray(doc.tags)
            ? doc.tags
            : [];

    const people =
        {};

    const items =
        (Array.isArray(doc.media) ? doc.media : [])
            .map(record => {

                const quick =
                    record.messages?.quick ??
                    record.messageId ??
                    null;

                const originals =
                    Array.isArray(record.messages?.original)
                        ? record.messages.original
                        : [];

                const original =
                    originals[0] ??
                    quick;

                const variants = {};

                const thumb =
                    galleryManifestTelegramLocator(
                        chat.id,
                        original ?? quick,
                        true
                    );

                const full =
                    galleryManifestTelegramLocator(
                        chat.id,
                        original ?? quick
                    );

                if (thumb)
                    variants[GALLERY_MANIFEST_VARIANTS.thumb] = thumb;

                if (full)
                    variants[GALLERY_MANIFEST_VARIANTS.full] = full;

                if (quick != null) {

                    const preview =
                        galleryManifestTelegramLocator(chat.id, quick);

                    if (preview) {

                        if (record.kind === "video") {
                            variants[GALLERY_MANIFEST_VARIANTS.preview] =
                                preview;
                        } else {
                            variants[GALLERY_MANIFEST_VARIANTS.medium] =
                                preview;
                        }

                    }

                }

                if (!Object.keys(variants).length)
                    return null;

                const tags =
                    (Array.isArray(record.tags) ? record.tags : [])
                        .map(index => albumTags[index])
                        .filter(Boolean);

                const appearances =
                    galleryManifestPeople(record, people);

                const splitParts =
                    Array.isArray(record.split?.items)
                        ? record.split.items
                        : [];

                let parts = [];

                if (splitParts.length) {

                    parts =
                        splitParts
                            .map(part => {

                                const locator =
                                    galleryManifestTelegramLocator(
                                        chat.id,
                                        part.message
                                    );

                                if (!locator)
                                    return null;

                                if (Number.isFinite(part.offset))
                                    locator.offset = part.offset;

                                if (Number.isFinite(part.size))
                                    locator.size = part.size;

                                return locator;

                            })
                            .filter(Boolean);

                } else if (originals.length > 1) {

                    parts =
                        originals
                            .map(id =>
                                galleryManifestTelegramLocator(chat.id, id)
                            )
                            .filter(Boolean);

                }

                return createGalleryManifestItem({
                    id: record.id,
                    kind: record.kind,
                    variants,
                    tags,
                    people: appearances,
                    parts,
                    mime: record.mime,
                    size: record.size,
                    width: record.width,
                    height: record.height,
                    duration: record.duration,
                    hidden: record.hidden
                });

            })
            .filter(Boolean);

    return createGalleryManifest({
        id: "tg:" + chat.id,
        revision: doc.generated || null,
        title:
            doc.chat?.title ??
            chat.title ??
            null,
        tags: albumTags,
        storage: {
            type: "telegram",
            chat: Number(chat.id),
            manifestMessage:
                doc.metadataMessage ?? null
        },
        generator: {
            name: "telegram-folder-uploader",
            version: generatorVersion
        },
        items,
        order:
            (Array.isArray(doc.order) ? doc.order : [])
                .slice()
    });

}


function galleryManifestAlbumFieldLocator(
    provider,
    fields,
    sizeKey
) {

    if (!fields || typeof fields !== "object")
        return null;

    if (provider === "direct") {

        return (
            typeof fields.url === "string" &&
            fields.url.trim()
                ? fields.url.trim()
                : null
        );

    }

    /*
     * Do not hardcode "telegram" here. The album's selected source is
     * the locator type, so a renamed/other provider stays exact.
     */
    return {
        type: provider,
        fields: { ...fields }
    };

}


/*
 * Producer for an album built by the site (empty album, imported URLs,
 * or a loaded Telegram album). Only called when the user explicitly
 * generates a manifest.
 */
function buildGalleryManifestFromAlbum(album) {

    if (!album)
        return null;

    const albumTags =
        Array.isArray(album.tags) ? album.tags : [];

    const sources =
        Array.isArray(album.sources) ? album.sources : [];

    const imageKeys =
        album.images && typeof album.images === "object"
            ? Object.keys(album.images).sort((a, b) => Number(a) - Number(b))
            : [];

    const items =
        [];

    for (const imageKey of imageKeys) {

        const image =
            album.images[imageKey];

        if (!image)
            continue;

        const variants =
            {};

        for (
            const sizeKey of [
                GALLERY_MANIFEST_VARIANTS.thumb,
                GALLERY_MANIFEST_VARIANTS.medium,
                GALLERY_MANIFEST_VARIANTS.full
            ]
        ) {

            let locator = null;

            const override =
                image.urlOverrides?.[sizeKey];

            if (
                typeof override === "string" &&
                override.trim()
            ) {

                locator =
                    override.trim();

            }

            const sourceKeys =
                Object.keys(image)
                    .filter(key => /^\d+$/.test(key))
                    .sort((a, b) => Number(a) - Number(b));

            if (!locator) {

                for (const sourceKey of sourceKeys) {

                    const provider =
                        sources[Number(sourceKey)];

                    const fields =
                        image[sourceKey]?.[sizeKey];

                    if (!provider || !fields)
                        continue;

                    locator =
                        galleryManifestAlbumFieldLocator(
                            provider,
                            fields,
                            sizeKey
                        );

                    if (locator)
                        break;

                }

            }

            if (!locator)
                continue;

            const manifestSize =
                image.video &&
                sizeKey === GALLERY_MANIFEST_VARIANTS.medium
                    ? GALLERY_MANIFEST_VARIANTS.preview
                    : GALLERY_MANIFEST_VARIANTS[sizeKey];

            if (manifestSize)
                variants[manifestSize] = locator;

        }

        if (!Object.keys(variants).length)
            continue;

        const tags =
            (Array.isArray(image.tags) ? image.tags : [])
                .map(index => albumTags[index])
                .filter(Boolean);

        const parts =
            [];

        if (Array.isArray(image.manifestParts)) {

            parts.push(...image.manifestParts);

        } else if (Array.isArray(image.parts) && image.parts.length) {

            const telegramSourceKey =
                Object.keys(image).find(
                    key =>
                        /^\d+$/.test(key) &&
                        sources[Number(key)] === "telegram"
                );

            const chat =
                image[telegramSourceKey]?.full?.key1 ??
                image[telegramSourceKey]?.medium?.key1;

            const partProvider =
                sources[0] || "telegram";

            for (const messageID of image.parts) {

                let locator = null;

                if (partProvider === "telegram") {

                    locator =
                        galleryManifestTelegramLocator(
                            chat,
                            messageID
                        );

                } else if (partProvider !== "direct") {

                    locator = {
                        type: partProvider,
                        fields: {
                            key1: String(chat),
                            key2: String(messageID)
                        }
                    };

                }

                if (locator)
                    parts.push(locator);

            }

        }

        items.push(
            createGalleryManifestItem({
                id: image._manifestId || String(imageKey),
                kind: image.video ? "video" : "image",
                variants,
                tags,
                people: image.people || [],
                parts,
                mime: image.mime,
                size: image.size,
                width: image.width,
                height: image.height,
                duration: image.duration,
                hidden: image.hidden
            })
        );

    }

    if (!items.length)
        return null;

    return createGalleryManifest({
        id: album.id,
        revision: new Date().toISOString(),
        title: album.name,
        tags: albumTags,
        people: album.people,
        generator: {
            name: "gallery-site",
            version: 1
        },
        items
    });

}


function galleryManifestVariantCandidate(value) {

    if (
        typeof value === "string" &&
        value.trim()
    ) {
        return {
            provider: "direct",
            fields: { url: value.trim() }
        };
    }

    if (!value || typeof value !== "object")
        return null;

    if (
        typeof value.url === "string" &&
        value.url.trim()
    ) {
        return {
            provider: "direct",
            fields: { url: value.url.trim() }
        };
    }

    if (
        value.chat != null &&
        value.message != null
    ) {

        const chat =
            Number(value.chat);

        const message =
            Number(value.message);

        if (
            !Number.isFinite(chat) ||
            !Number.isFinite(message) ||
            message <= 0
        ) {
            return null;
        }

        const fields = {
            key1: String(chat),
            key2: String(message)
        };

        if (value.thumb === true)
            fields.toggle = true;

        return {
            provider: "telegram",
            fields
        };

    }

    if (
        typeof value.type === "string" &&
        value.fields &&
        typeof value.fields === "object"
    ) {
        return {
            provider: value.type,
            fields: value.fields
        };
    }

    return null;

}


function buildAlbumFromGalleryManifest(album, manifest) {

    if (
        !album ||
        !isGalleryManifest(manifest)
    ) {
        return false;
    }

    const byId =
        new Map(
            manifest.items.map(item => [String(item?.id), item])
        );

    const ordered =
        Array.isArray(manifest.order) &&
        manifest.order.length
            ? manifest.order
                .map(id => byId.get(String(id)))
                .filter(Boolean)
            : manifest.items;

    const sources =
        [];

    const images =
        {};

    const tags =
        [];

    for (const tag of Array.isArray(manifest.tags) ? manifest.tags : [])
        galleryManifestTagIndex(tags, tag);

    const sourceIndex = name => {

        let index =
            sources.indexOf(name);

        if (index < 0) {

            index =
                sources.length;

            sources.push(name);

        }

        return index;

    };

    let number = 1;
    let coverMessage = null;

    for (const item of ordered) {

        if (!item || item.hidden === true)
            continue;

        const kind =
            item.kind === "video" ? "video" : "image";

        const variants = {
            ...(item.variants || {})
        };

        if (kind === "image") {

            if (!variants[GALLERY_MANIFEST_VARIANTS.thumb]) {
                variants[GALLERY_MANIFEST_VARIANTS.thumb] =
                    variants[GALLERY_MANIFEST_VARIANTS.medium] ??
                    variants[GALLERY_MANIFEST_VARIANTS.preview] ??
                    variants[GALLERY_MANIFEST_VARIANTS.full];
            }

            if (
                !variants[GALLERY_MANIFEST_VARIANTS.medium] &&
                !variants[GALLERY_MANIFEST_VARIANTS.preview]
            ) {
                variants[GALLERY_MANIFEST_VARIANTS.medium] =
                    variants[GALLERY_MANIFEST_VARIANTS.full];
            }

            if (!variants[GALLERY_MANIFEST_VARIANTS.full]) {
                variants[GALLERY_MANIFEST_VARIANTS.full] =
                    variants[GALLERY_MANIFEST_VARIANTS.medium] ??
                    variants[GALLERY_MANIFEST_VARIANTS.preview];
            }

        } else if (!variants[GALLERY_MANIFEST_VARIANTS.full]) {

            variants[GALLERY_MANIFEST_VARIANTS.full] =
                variants[GALLERY_MANIFEST_VARIANTS.preview] ??
                variants[GALLERY_MANIFEST_VARIANTS.medium];

        }

        const entry =
            {};

        const addSize = (sizeKey, value) => {

            const candidate =
                galleryManifestVariantCandidate(value);

            if (!candidate)
                return;

            const index =
                sourceIndex(candidate.provider);

            entry[index] =
                entry[index] || {};

            entry[index][sizeKey] =
                candidate.fields;

            if (
                coverMessage == null &&
                candidate.provider === "telegram" &&
                Number(candidate.fields.key2) > 0
            ) {
                coverMessage =
                    Number(candidate.fields.key2);
            }

        };

        for (
            const manifestSize of [
                GALLERY_MANIFEST_VARIANTS.thumb,
                GALLERY_MANIFEST_VARIANTS.medium,
                GALLERY_MANIFEST_VARIANTS.preview,
                GALLERY_MANIFEST_VARIANTS.full
            ]
        ) {

            const siteSize =
                GALLERY_MANIFEST_SITE_SIZES[manifestSize];

            if (!siteSize)
                continue;

            addSize(siteSize, variants[manifestSize]);

        }

        if (!Object.keys(entry).length)
            continue;

        entry.tags =
            (Array.isArray(item.tags) ? item.tags : [])
                .map(tag => galleryManifestTagIndex(tags, tag))
                .filter(index => index >= 0);

        if (item.id != null)
            entry._manifestId = String(item.id);

        if (kind === "video")
            entry.video = true;

        if (Number.isFinite(Number(item.width)))
            entry.width = Number(item.width);

        if (Number.isFinite(Number(item.height)))
            entry.height = Number(item.height);

        if (Number.isFinite(Number(item.duration)))
            entry.duration = Number(item.duration);

        if (Number.isFinite(Number(item.size)))
            entry.size = Number(item.size);

        if (Array.isArray(item.people) && item.people.length)
            entry.people = item.people;

        const parts =
            Array.isArray(item.parts) ? item.parts : [];

        if (parts.length) {

            entry.manifestParts = parts;

            const telegramParts =
                parts
                    .map(part =>
                        part?.type === "telegram"
                            ? Number(part.message)
                            : null
                    )
                    .filter(Number.isFinite);

            if (telegramParts.length > 1)
                entry.parts = telegramParts;

        }

        images[number++] = entry;

    }

    if (number === 1)
        return false;

    album.sources =
        sources;

    album.images =
        images;

    album.tags =
        tags;

    album._telegramFromMetadata =
        true;

    album._telegramTagsFromMetadata =
        true;

    album._manifest =
        true;

    if (
        manifest.people &&
        typeof manifest.people === "object"
    ) {
        album.people = manifest.people;
    }

    if (coverMessage != null)
        album._telegramCoverMessageID = coverMessage;

    if (
        manifest.storage?.manifestMessage != null &&
        Number.isFinite(Number(manifest.storage.manifestMessage))
    ) {
        album._telegramMetadataMessage =
            Number(manifest.storage.manifestMessage);
    }

    if (
        typeof manifest.title === "string" &&
        manifest.title.trim() &&
        !album.name
    ) {
        album.name = manifest.title.trim();
    }

    return true;

}


function resolveAlbumManifestUrl(album) {

    const explicit =
        album?.manifest;

    /*
     * Provider-backed manifest locators stay signed and reusable.
     * The URL is rebuilt from the current provider auth token each
     * time, so a saved album record never has to carry an expired
     * signed Worker URL.
     */
    if (
        explicit &&
        typeof explicit === "object" &&
        typeof explicit.provider === "string" &&
        explicit.fields &&
        typeof explicit.fields === "object" &&
        typeof resolveProviderUrl === "function"
    ) {

        const resolved =
            resolveProviderUrl(
                explicit.provider,
                explicit.fields
            );

        if (resolved)
            return resolved;

    }

    const url =
        typeof explicit === "string"
            ? explicit
            : explicit?.url;

    return (
        typeof url === "string" &&
        url.trim()
            ? url.trim()
            : ""
    );

}


async function fetchGalleryManifest(url) {

    const now =
        Date.now();

    const rememberFailure = () => {

        galleryManifestCache.set(url, {
            manifest: null,
            at: now
        });

        while (
            galleryManifestCache.size >
            GALLERY_MANIFEST_MAX_ENTRIES
        ) {

            galleryManifestCache.delete(
                galleryManifestCache.keys().next().value
            );

        }

    };

    const cached =
        galleryManifestCache.get(url);

    if (
        cached &&
        now - cached.at < GALLERY_MANIFEST_TTL_MS
    ) {
        return cached.manifest;
    }

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            10000
        );

    try {

        const response =
            await fetch(url, {
                signal: controller.signal,
                cache: "default"
            });

        if (!response.ok) {

            rememberFailure();
            return null;

        }

        const declared =
            Number(response.headers.get("content-length")) || 0;

        if (
            declared > 0 &&
            declared > GALLERY_MANIFEST_MAX_BYTES
        ) {

            rememberFailure();
            return null;

        }

        const text =
            await response.text();

        if (text.length > GALLERY_MANIFEST_MAX_BYTES) {

            rememberFailure();
            return null;

        }

        const manifest =
            JSON.parse(text);

        if (!isGalleryManifest(manifest)) {

            rememberFailure();
            return null;

        }

        while (
            galleryManifestCache.size >=
            GALLERY_MANIFEST_MAX_ENTRIES
        ) {

            galleryManifestCache.delete(
                galleryManifestCache.keys().next().value
            );

        }

        galleryManifestCache.set(url, {
            manifest,
            at: now
        });

        return manifest;

    } catch {

        rememberFailure();
        return null;

    } finally {

        clearTimeout(timer);

    }

}


async function loadAlbumFromManifestIfAvailable(album) {

    /*
     * Local edits win. Re-fetching a manifest would rebuild
     * album.images in the manifest's order and silently discard a
     * reorder, rename, source change, or added images made in the
     * album editor.
     */
    if (
        album?.edited === true &&
        album.images &&
        typeof album.images === "object" &&
        Object.keys(album.images).length
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

    if (!buildAlbumFromGalleryManifest(album, manifest))
        return false;

    album.manifest = {
        ...(album.manifest && typeof album.manifest === "object"
            ? album.manifest
            : {}),
        url,
        revision: manifest.revision || null
    };

    album._manifestUrl =
        url;

    return true;

}
