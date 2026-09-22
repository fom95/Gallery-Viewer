/*
 * 00b-config-and-providers.js
 *
 * The site config (where the album list lives, provider credentials,
 * and the per-provider URL blueprints) arrives once as a compressed
 * blob appended to the URL after "?@", gets decoded and stashed in
 * localStorage, and is read from there on every visit after that.
 *
 * This also carries the generic compress/decompress codec used for
 * both the site config and every album -- anything read from a .txt
 * source or localStorage is compressed, anything written back out is
 * compressed, and nothing in memory during normal operation is ever
 * still in that form.
 */

const SITE_CONFIG_STORAGE_KEY =
    "siteConfig";

let siteConfig = null;


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

    const blueprint =
        siteConfig?.providers?.[providerName];

    if (!blueprint)
        return null;

    try {

        return buildProviderUrl(blueprint, fields);

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
            fields
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
