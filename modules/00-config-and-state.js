/*
 * 00-config-and-state.js
 *
 * Core globals (current album/image, tag filters, gallery sizing) and
 * the site-config codec: the compressed ?@ config blob, localStorage
 * persistence, provider blueprints and URL building.
 */

const albums = [];

let currentAlbum = null;

let isQueryAlbum = false;

let currentImageIndex = 0;

let modalLoadID = 0;

let activeImageLoaders = [];

let loadingTimer = null;

const selectedTags = new Set();

const excludedTags = new Set();

let filterMode = "all";


const galleryGap = 1;

const minColumns = 2;

const maxColumns = 5;

const minThumbWidth = 180;

/*
 * Album-view thumbnail size offsets, in percent of the base size
 * (-50..50). Set by the bottom-bar sliders.
 */
let albumImageWidthPercent = 0;

let albumImageHeightPercent = 0;

const homeMinColumns = 2;

const homeMaxColumns = 5;

const homeMinThumbWidth = 180;

const homeHeightMultiplier = 1.12;

let currentTemporaryAlbumID = null;

/* ----- Site config, providers and URL building ----- */

const SITE_CONFIG_STORAGE_KEY =
    "siteConfig";

let siteConfig = null;


/*
 * Endpoint auth. A provider's `auth` block defines how its URLs are
 * authorised:
 *   signed-query -> append ?param=expiry.hmac, keyed with the secret
 *   token-query  -> append ?param=secret
 * The raw secret never appears in a URL in signed-query mode.
 *
 * Expiry is rounded to a bucket so the token (and thus every image URL)
 * stays identical for the whole bucket, keeping the browser HTTP cache
 * effective. A token is valid for between 1 and 2 buckets.
 */
const AUTH_TOKEN_BUCKET_SECONDS =
    24 * 3600;

const providerAuthTokens =
    {};

let providerAuthTimer =
    null;


async function signAuthToken(password) {

    const nowSeconds =
        Math.floor(Date.now() / 1000);

    const expiry =
        (
            Math.floor(nowSeconds / AUTH_TOKEN_BUCKET_SECONDS) + 2
        ) * AUTH_TOKEN_BUCKET_SECONDS;

    const encoder =
        new TextEncoder();

    const key =
        await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

    const signature =
        await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode("auth:" + expiry)
        );

    const hex =
        [...new Uint8Array(signature)]
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("");

    return expiry + "." + hex;

}


/*
 * Endpoint authentication is part of the endpoint/map, not of the
 * import credentials:
 *
 *   providers: {
 *     telegram: {
 *       url: [ ...blueprint... ],
 *       auth: {
 *         mode: "signed-query" | "token-query",
 *         param: "auth",
 *         secret: "..."
 *       }
 *     }
 *   }
 *
 * Older configs stored the blueprint as a bare array and the signing
 * password under credentials.<name>.auth_password. They are converted
 * once, in memory, when the config is loaded; the new shape is written
 * when the editor next saves.
 */
function migrateSiteConfigProviders(config) {

    if (!config || !config.providers)
        return config;

    for (const [providerName, value] of Object.entries(config.providers)) {

        if (Array.isArray(value)) {

            config.providers[providerName] = {
                url: value
            };

        }

        /*
         * The manifest is per album now; a stale per-source setting from
         * an earlier build is not used.
         */
        const provider =
            config.providers[providerName];

        if (
            provider &&
            typeof provider === "object" &&
            provider.manifest !== undefined
        ) {
            delete provider.manifest;
        }

    }

    const credentials =
        config.credentials || {};

    for (const [providerName, creds] of Object.entries(credentials)) {

        if (
            !creds ||
            typeof creds.auth_password !== "string" ||
            !creds.auth_password
        ) {
            continue;
        }

        const provider =
            config.providers[providerName];

        if (provider && !provider.auth) {

            provider.auth = {
                mode: "signed-query",
                param: "auth",
                secret: creds.auth_password
            };

        }

        delete creds.auth_password;

        if (!Object.keys(creds).length)
            delete credentials[providerName];

    }

    if (!Object.keys(credentials).length)
        delete config.credentials;

    return config;

}


function normalizeProviderAuth(auth) {

    if (!auth || typeof auth !== "object")
        return null;

    if (
        auth.mode !== "signed-query" &&
        auth.mode !== "token-query"
    ) {
        return null;
    }

    const secret =
        typeof auth.secret === "string"
            ? auth.secret.trim()
            : "";

    if (!secret)
        return null;

    const param =
        typeof auth.param === "string" &&
        auth.param.trim()
            ? auth.param.trim()
            : "auth";

    return {
        mode: auth.mode,
        param,
        secret
    };

}


function getProviderDefinition(providerName) {

    const value =
        siteConfig?.providers?.[providerName];

    if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray(value.url)
    ) {
        return null;
    }

    return {
        blueprint: value.url,
        auth: normalizeProviderAuth(value.auth)
    };

}


const DEFAULT_PROVIDER_DELIVERY = {
    images: "auto",
    videos: "auto",
    range: true,
    maxDownloadMB: 50
};


function getProviderDelivery(providerName) {

    const value =
        siteConfig?.providers?.[providerName]?.delivery;

    const delivery = {
        ...DEFAULT_PROVIDER_DELIVERY
    };

    if (!value || typeof value !== "object")
        return delivery;

    if (
        value.images === "direct" ||
        value.images === "download"
    ) {
        delivery.images = value.images;
    }

    if (
        value.videos === "stream" ||
        value.videos === "download" ||
        value.videos === "external"
    ) {
        delivery.videos = value.videos;
    }

    if (typeof value.range === "boolean")
        delivery.range = value.range;

    const max =
        Number(value.maxDownloadMB);

    if (Number.isFinite(max) && max > 0) {
        delivery.maxDownloadMB =
            Math.min(max, 4096);
    }

    return delivery;

}


function chooseImageDelivery(providerName) {

    return getProviderDelivery(providerName).images === "download"
        ? "download"
        : "direct";

}


function chooseVideoDelivery(providerName, image) {

    const delivery =
        getProviderDelivery(providerName);

    if (delivery.videos !== "auto")
        return delivery.videos;

    /* Auto: stream when the endpoint supports ranges; otherwise keep
     * small files in memory and send large ones to the browser. */
    if (delivery.range)
        return "stream";

    const bytes = Number(image?.size) || 0;
    const cap =
        delivery.maxDownloadMB * 1024 * 1024;

    if (bytes > 0 && bytes <= cap)
        return "download";

    return "external";

}


async function refreshProviderAuthTokens() {

    const next =
        {};

    for (
        const providerName of
        Object.keys(siteConfig?.providers || {})
    ) {

        const auth =
            getProviderDefinition(providerName)?.auth;

        if (auth?.mode !== "signed-query")
            continue;

        try {

            next[providerName] =
                await signAuthToken(auth.secret);

        } catch (error) {

            console.debug(
                "[AUTH] Failed to sign a token",
                { provider: providerName, errorMessage: error?.message }
            );

        }

    }

    /* Replace in one step so a periodic refresh never leaves a gap. */
    for (const name of Object.keys(providerAuthTokens))
        delete providerAuthTokens[name];

    Object.assign(providerAuthTokens, next);

}


async function initProviderAuth() {

    await refreshProviderAuthTokens();

    if (!Object.keys(providerAuthTokens).length)
        return;

    /*
     * Re-sign when the bucket rolls over, for pages left open for days.
     * Old tokens are still valid for another full bucket by then, so
     * images already on screen keep working.
     */
    clearTimeout(providerAuthTimer);

    const nowSeconds =
        Math.floor(Date.now() / 1000);

    const nextBoundary =
        (
            Math.floor(nowSeconds / AUTH_TOKEN_BUCKET_SECONDS) + 1
        ) * AUTH_TOKEN_BUCKET_SECONDS;

    providerAuthTimer =
        setTimeout(
            initProviderAuth,
            (nextBoundary - nowSeconds + 1) * 1000
        );

}


/*
 * Generic JSON -> gzip -> base64url codec. Despite the name (kept as
 * given), this works on any JSON-serializable value -- it's used for
 * both individual albums and the site config object.
 */
async function compressAlbum(value) {

    const json =
        JSON.stringify(value);

    const stream =
        new Blob([json])
            .stream()
            .pipeThrough(new CompressionStream("gzip"));

    const buffer =
        await new Response(stream).arrayBuffer();

    const bytes =
        new Uint8Array(buffer);

    let binary =
        "";

    for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

}


async function decompressAlbum(encoded) {

    const base64 =
        encoded
            .replace(/-/g, "+")
            .replace(/_/g, "/");

    const padded =
        base64 + "=".repeat(
            (4 - base64.length % 4) % 4
        );

    const binary =
        atob(padded);

    const bytes =
        new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);

    const stream =
        new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"));

    const value =
        JSON.parse(
            await new Response(stream).text()
        );

    /*
     * Album objects specifically have a numerically-keyed "images"
     * map; guarantee ascending order on the way out of storage rather
     * than trusting that it survived JSON/gzip round-tripping as-is.
     * Harmless (a no-op) for anything else decompressed with this
     * same function, like the site config, which has no such field.
     */
    if (value && value.images && typeof value.images === "object") {

        const orderedImages =
            {};

        for (
            const number of
            Object.keys(value.images)
                .sort((a, b) => Number(a) - Number(b))
        ) {

            orderedImages[number] =
                value.images[number];

        }

        value.images =
            orderedImages;

    }

    return value;

}


/*
 * Builds a URL from a provider blueprint and a field set for one
 * image/size-variant. Blueprint parts are either:
 *   - a plain string: a literal, appended as-is
 *   - a one-element array, e.g. ["key1"]: a field reference -- the
 *     value of fields[fieldName] is appended; missing/undefined is an
 *     error (this candidate can't be built, caller should skip it)
 *   - a two-element array, e.g. ["?thumb=1", "toggle"]: a conditional
 *     literal -- appended only if fields[conditionField] is truthy
 */
function buildProviderUrl(blueprint, fields) {

    if (!Array.isArray(blueprint))
        throw new Error("No blueprint provided.");

    let url =
        "";

    for (const part of blueprint) {

        if (typeof part === "string") {

            url +=
                part;

            continue;

        }

        if (!Array.isArray(part))
            continue;

        if (part.length >= 2) {

            const [literalValue, conditionField] =
                part;

            if (fields && fields[conditionField])
                url +=
                    literalValue;

            continue;

        }

        const fieldName =
            part[0];

        const value =
            fields ? fields[fieldName] : undefined;

        if (value === undefined || value === null) {

            throw new Error(
                `Missing field "${fieldName}" for blueprint part.`
            );

        }

        url +=
            value;

    }

    return url;

}


/*
 * Every image's per-source field set (e.g. {key1, key2, toggle}) is
 * resolved into an actual URL through this -- the one place that
 * knows how to turn "provider name + fields" into "URL", using
 * whichever blueprint the user's config declared for that provider.
 * Returns null (not a throw) for anything that can't be resolved, so
 * callers can just skip a candidate rather than handle exceptions.
 */
function resolveProviderUrl(providerName, fields) {

    /*
     * "direct" is a built-in pseudo-provider (not something the user
     * configures) used by the add-image editor for one-off images
     * added by pasting a raw URL rather than going through a real
     * provider blueprint -- its "blueprint" is just "use the url
     * field as-is".
     */
    if (providerName === "direct")
        return fields?.url || null;

    const definition =
        getProviderDefinition(providerName);

    if (!definition)
        return null;

    try {

        let url =
            buildProviderUrl(definition.blueprint, fields);

        const auth =
            definition.auth;

        if (auth) {

            const separator =
                url.includes("?") ? "&" : "?";

            if (auth.mode === "signed-query") {

                const token =
                    providerAuthTokens[providerName];

                /* A signed endpoint without a token cannot be used;
                 * returning an unsigned URL would only earn a 401. */
                if (!token)
                    return null;

                url +=
                    separator +
                    encodeURIComponent(auth.param) +
                    "=" +
                    encodeURIComponent(token);

            } else if (auth.mode === "token-query") {

                url +=
                    separator +
                    encodeURIComponent(auth.param) +
                    "=" +
                    encodeURIComponent(auth.secret);

            }

        }

        return url;

    } catch {

        return null;

    }

}


/*
 * Given one image's raw per-source data (album.images[n], keyed by
 * index into album.sources) and a size ("thumb"/"medium"/"full"),
 * returns an ordered list of candidate URLs to try, each tagged with
 * which provider it came from. Order follows the image's own
 * ascending numeric keys, which line up with album.sources' order.
 */
function getImageProviderCandidates(album, imageEntry, sizeKey) {

    if (!album || !imageEntry)
        return [];

    const sources =
        Array.isArray(album.sources)
            ? album.sources
            : [];

    const candidates =
        [];

    /*
     * A manually edited size wins over the provider blueprint. This
     * lets the image editor change one URL without destroying the
     * original Telegram/provider fields for the other sizes.
     */
    const override =
        imageEntry.urlOverrides?.[sizeKey];

    if (
        typeof override === "string" &&
        override.trim()
    ) {

        candidates.push({
            url:
                override.trim(),
            providerName:
                "direct",
            delivery:
                "direct"
        });

    }

    for (
        const key of
        Object.keys(imageEntry)
            .filter(key => /^\d+$/.test(key))
            .sort((a, b) => Number(a) - Number(b))
    ) {

        const providerName =
            sources[Number(key)];

        if (!providerName)
            continue;

        const fields =
            imageEntry[key]?.[sizeKey];

        if (!fields)
            continue;

        const url =
            resolveProviderUrl(providerName, fields);

        if (!url)
            continue;

        candidates.push({
            url,
            providerName,
            fields,
            delivery:
                chooseImageDelivery(providerName)
        });

    }

    return candidates;

}


function saveSiteConfigToStorage(compressedConfig) {

    try {

        localStorage.setItem(
            SITE_CONFIG_STORAGE_KEY,
            compressedConfig
        );

    } catch (error) {

        console.debug(
            "[CONFIG] Failed to save site config to localStorage",
            {
                errorName: error?.name,
                errorMessage: error?.message
            }
        );

    }

}


/*
 * A generated link can opt into carrying the GitHub album library token
 * and/or an mtcute session string. Both live in their own browser keys
 * rather than in siteConfig. They only fill an empty slot, so opening
 * someone else's link never silently replaces a session or token that
 * this browser already has.
 */
function applySharedSecretsFromSiteConfig(config) {

    if (!config || typeof config !== "object")
        return;

    if (typeof config.albumLibraryToken === "string") {

        const token =
            config.albumLibraryToken.trim();

        if (
            token &&
            typeof setAlbumLibraryToken === "function" &&
            typeof getAlbumLibraryToken === "function" &&
            !getAlbumLibraryToken()
        ) {

            setAlbumLibraryToken(token);

        }

    }

    if (typeof config.telegramSession === "string") {

        const session =
            config.telegramSession.trim();

        if (session) {

            try {

                if (!localStorage.getItem("telegramSession"))
                    localStorage.setItem("telegramSession", session);

            } catch {}

        }

    }

    delete config.albumLibraryToken;
    delete config.telegramSession;

}


/*
 * Checks the URL for a "?@<compressed config>" payload on this load;
 * if present, decodes it, stores the still-compressed form directly
 * in localStorage (no need to re-compress what's already compressed),
 * and strips it from the URL. Otherwise loads whatever's already in
 * localStorage. Either way, siteConfig ends up populated (or null, if
 * there's genuinely nothing configured yet).
 */
async function initSiteConfig() {

    const query =
        location.search.substring(1);

    if (query.startsWith("@")) {

        const encoded =
            query.substring(1);

        try {

            siteConfig =
                await decompressAlbum(encoded);

            migrateSiteConfigProviders(siteConfig);

            applySharedSecretsFromSiteConfig(siteConfig);

            saveSiteConfigToStorage(encoded);

        } catch (error) {

            alert(
                "Failed to load site configuration from the URL:\n\n" +
                (
                    error && error.message
                        ? error.message
                        : String(error)
                )
            );

        }

        /*
         * base64url never contains "?" or "&", so the entire query
         * string is the config blob -- nothing else to preserve.
         */
        history.replaceState(
            null,
            "",
            location.pathname + location.hash
        );

        return;

    }

    const stored =
        localStorage.getItem(SITE_CONFIG_STORAGE_KEY);

    if (!stored)
        return;

    try {

        siteConfig =
            await decompressAlbum(stored);

        migrateSiteConfigProviders(siteConfig);

        applySharedSecretsFromSiteConfig(siteConfig);

    } catch (error) {

        console.debug(
            "[CONFIG] Failed to load stored site config",
            {
                errorName: error?.name,
                errorMessage: error?.message
            }
        );

    }

}
