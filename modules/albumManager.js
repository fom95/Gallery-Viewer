/**
 * Album Manager Module
 * Handles album loading, saving, temporary storage, and state management
 */

const AlbumManager = (() => {
    let albums = [];
    let currentAlbum = null;
    let isQueryAlbum = false;
    let currentTemporaryAlbumID = null;

    const TEMP_ALBUM_STORAGE_KEY = "temporaryAlbums";
    const GITHUB_STORAGE_KEY = "githubID";
    const SAVED_ALBUMS_KEY = "savedAlbums";

    /**
     * Generate unique album ID from name
     */
    function generateAlbumID(name, currentID) {
        const usedIDs = new Set();

        albums.forEach(album => {
            if (album.id && album.id !== currentID) {
                usedIDs.add(album.id);
            }
        });

        if (typeof MANUAL_ALBUMS !== "undefined") {
            MANUAL_ALBUMS.forEach(album => {
                if (album.id && album.id !== currentID) {
                    usedIDs.add(album.id);
                }
            });
        }

        const base = name
            .trim()
            .replace(/[^\w -]/g, "")
            .replace(/\s+/g, "_");

        if (!usedIDs.has(base)) {
            return base;
        }

        let number = 1;
        while (usedIDs.has(base + number)) {
            number++;
        }

        return base + number;
    }

    /**
     * Get album query from URL
     */
    function getAlbumQuery(url) {
        if (!url) return "";

        if (url.includes("?$")) {
            return url.split("?$")[1];
        }

        if (url.includes("?")) {
            return url.split("?")[1];
        }

        return url;
    }

    /**
     * Create album from query string
     */
    function createQueryAlbum(query) {
        return {
            name: "Shared Album",
            images: parseQuery(query),
            tags: []
        };
    }

    /**
     * Parse query string into images
     */
    function parseQuery(query) {
        return query.split("|").map(entry => {
            try {
                const data = JSON.parse(decodeURIComponent(entry));

                if (data.source === "telegram") {
                    return {
                        source: "telegram",
                        messageID: data.messageID || data.messageId || null,
                        telegramFileID: data.telegramFileID || data.fileID || data.fileId || null,
                        telegramThumbnailFileID:
                            data.telegramThumbnailFileID ||
                            data.thumbnailFileID ||
                            data.thumbnailFileId ||
                            null,
                        mimeType: data.mimeType || "",
                        fileName: data.n || data.fileName || "",
                        width: data.width,
                        height: data.height,
                        tags: (data.d?.tags || data.tags || []).map(tag =>
                            decodeURIComponent(tag)
                        )
                    };
                }

                const fileName = data.n || "";
                const thumbURL = data.t
                    ? `https://i.ibb.co/${data.t}/${fileName}`
                    : null;
                const mediumURL = data.m
                    ? `https://i.ibb.co/${data.m}/${fileName}`
                    : null;
                const fullURL = data.f
                    ? `https://i.ibb.co/${data.f}/${fileName}`
                    : null;

                return {
                    thumb: thumbURL ? { url: thumbURL } : null,
                    medium: mediumURL ? { url: mediumURL } : null,
                    image: fullURL ? { url: fullURL } : null,
                    tags: (data.d?.tags || []).map(tag => decodeURIComponent(tag))
                };
            } catch (e) {
                const [thumbId, mediumId, imageId, fileName] = entry.split(",");

                return {
                    thumb: thumbId ? { url: `https://i.ibb.co/${thumbId}/${fileName}` } : null,
                    medium: mediumId ? { url: `https://i.ibb.co/${mediumId}/${fileName}` } : null,
                    image: imageId ? { url: `https://i.ibb.co/${imageId}/${fileName}` } : null,
                    tags: []
                };
            }
        });
    }

    /**
     * Create album query from album object
     */
    function createAlbumQuery(album) {
        function getId(url) {
            if (!url) return "";
            const match = url.match(/\/([A-Za-z0-9]+)\//);
            return match ? match[1] : "";
        }

        function getFile(url) {
            if (!url) return "";
            return url.split("/").pop();
        }

        return album.images
            .map(img => {
                const file = getFile(img.image?.url || img.thumb?.url);

                return encodeURIComponent(
                    JSON.stringify({
                        t: getId(img.thumb?.url),
                        m: getId(img.medium?.url),
                        f: getId(img.image?.url),
                        n: file,
                        d: {
                            tags: img.tags || []
                        }
                    })
                );
            })
            .join("|");
    }

    /**
     * Get temporary albums from storage
     */
    function getTemporaryAlbums() {
        return JSON.parse(
            localStorage.getItem(TEMP_ALBUM_STORAGE_KEY) || "{}"
        );
    }

    /**
     * Save temporary album to storage
     */
    function saveTemporaryAlbum(album) {
        const temporaryAlbums = getTemporaryAlbums();
        temporaryAlbums[album.id] = album;
        localStorage.setItem(TEMP_ALBUM_STORAGE_KEY, JSON.stringify(temporaryAlbums));
    }

    /**
     * Get temporary album by ID
     */
    function getTemporaryAlbum(id) {
        const temporaryAlbums = getTemporaryAlbums();
        return temporaryAlbums[id] || null;
    }

    /**
     * Delete temporary album
     */
    function deleteTemporaryAlbum(id) {
        if (!id) return;

        const temporaryAlbums = getTemporaryAlbums();
        if (!temporaryAlbums[id]) return;

        delete temporaryAlbums[id];
        localStorage.setItem(TEMP_ALBUM_STORAGE_KEY, JSON.stringify(temporaryAlbums));
    }

    /**
     * Get saved albums from localStorage
     */
    function getSavedAlbums() {
        return JSON.parse(localStorage.getItem(SAVED_ALBUMS_KEY) || "[]");
    }

    /**
     * Save album to localStorage
     */
    function saveAlbum(album) {
        let saved = getSavedAlbums();
        const savedAlbum = JSON.parse(JSON.stringify(album));
        savedAlbum.storage = true;
        savedAlbum.edited = true;

        saved = saved.filter(a => a.id !== savedAlbum.id);
        saved.push(savedAlbum);

        localStorage.setItem(SAVED_ALBUMS_KEY, JSON.stringify(saved));
        return savedAlbum;
    }

    /**
     * Delete saved album
     */
    function deleteSavedAlbum(albumId) {
        let saved = getSavedAlbums();
        saved = saved.filter(album => album.id !== albumId);
        localStorage.setItem(SAVED_ALBUMS_KEY, JSON.stringify(saved));
    }

    /**
     * Refresh saved albums in main albums array
     */
    function refreshSavedAlbums() {
        for (let i = albums.length - 1; i >= 0; i--) {
            if (albums[i].storage) {
                albums.splice(i, 1);
            }
        }

        getSavedAlbums().forEach(album => {
            albums.push({
                ...album,
                tags: album.tags || [],
                storage: true
            });
        });
    }

    /**
     * Reload all albums from MANUAL_ALBUMS and saved storage
     */
    async function reloadAlbums() {
        albums.length = 0;

        const query = window.location.search.substring(1);

        let pasteID = null;

        if (query.startsWith("@")) {
            pasteID = decodeBase64URL(query.substring(1));
            if (pasteID) {
                localStorage.setItem(GITHUB_STORAGE_KEY, pasteID);
            }
        } else {
            pasteID = localStorage.getItem(GITHUB_STORAGE_KEY);
        }

        let manualAlbums = [];

        if (pasteID) {
            try {
                const response = await fetch(pasteID);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const text = await response.text();
                const start = text.indexOf("MANUAL_ALBUMS");

                if (start === -1) {
                    throw new Error("MANUAL_ALBUMS was not found in GitHub file.");
                }

                const arrayStart = text.indexOf("[", start);

                if (arrayStart === -1) {
                    throw new Error("MANUAL_ALBUMS array start was not found.");
                }

                let depth = 0;
                let arrayEnd = -1;
                let inString = false;
                let stringChar = null;
                let escaped = false;

                for (let i = arrayStart; i < text.length; i++) {
                    const char = text[i];

                    if (escaped) {
                        escaped = false;
                        continue;
                    }

                    if (inString) {
                        if (char === "\\") {
                            escaped = true;
                        } else if (char === stringChar) {
                            inString = false;
                            stringChar = null;
                        }
                        continue;
                    }

                    if (char === '"' || char === "'" || char === "`") {
                        inString = true;
                        stringChar = char;
                        continue;
                    }

                    if (char === "[") {
                        depth++;
                    } else if (char === "]") {
                        depth--;

                        if (depth === 0) {
                            arrayEnd = i;
                            break;
                        }
                    }
                }

                if (arrayEnd === -1) {
                    throw new Error("Could not find end of MANUAL_ALBUMS.");
                }

                const arrayText = text.substring(arrayStart, arrayEnd + 1);
                manualAlbums = Function(`"use strict"; return (${arrayText});`)();

                if (!Array.isArray(manualAlbums)) {
                    throw new Error("Extracted MANUAL_ALBUMS is not an array.");
                }
            } catch (error) {
                console.error("Failed to load albums from GitHub:", error);
                manualAlbums = [];
            }
        } else if (typeof MANUAL_ALBUMS !== "undefined") {
            manualAlbums = MANUAL_ALBUMS;
        }

        manualAlbums.forEach(album => {
            const isTelegram =
                typeof album.url === "string" && album.url.startsWith("tg://chat/");

            albums.push({
                id: album.id,
                name: album.name,
                images: isTelegram ? [] : parseQuery(getAlbumQuery(album.url)),
                url: album.url,
                tags: album.tags || []
            });
        });

        refreshSavedAlbums();
    }

    /**
     * Open temporary album from URL
     */
    function openTemporaryAlbumFromURL(url) {
        if (!url) return;

        const query = getAlbumQuery(url.trim());

        if (!query) {
            alert("No album query was found in that URL.");
            return;
        }

        const album = createQueryAlbum(query);
        const id = generateAlbumID(album.name);

        album.id = id;
        album.temporary = true;

        currentTemporaryAlbumID = id;
        saveTemporaryAlbum(album);

        history.pushState(null, "", "?=" + encodeURIComponent(id));

        if (typeof window.loadAlbum === 'function') {
            window.loadAlbum(album, false);
        }

        if (typeof window.showAlbumButtons === 'function') {
            window.showAlbumButtons(true);
        }
    }

    /**
     * Build album tags from images
     */
    async function buildAlbumTags(album) {
        const tagSet = new Set();

        album.images.forEach(img => {
            (img.tags || []).forEach(tag => {
                tagSet.add(tag);
            });
        });

        album.tags = [...tagSet];

        if (typeof window.buildTagList === 'function') {
            window.buildTagList(album.tags);
        }
    }

    /**
     * Return to albums view from current album
     */
    function returnToAlbums() {
        if (currentTemporaryAlbumID) {
            deleteTemporaryAlbum(currentTemporaryAlbumID);
            currentTemporaryAlbumID = null;
        }

        if (typeof window.showAlbums === 'function') {
            window.showAlbums();
        }
    }

    // Public API
    return {
        // Album array management
        getAlbums: () => albums,
        setAlbums: (newAlbums) => { albums = newAlbums; },
        addAlbum: (album) => { albums.push(album); },

        // Current album state
        getCurrentAlbum: () => currentAlbum,
        setCurrentAlbum: (album) => { currentAlbum = album; },
        getIsQueryAlbum: () => isQueryAlbum,
        setIsQueryAlbum: (value) => { isQueryAlbum = value; },

        // Album ID generation
        generateAlbumID,
        getAlbumQuery,

        // Query album operations
        createQueryAlbum,
        parseQuery,
        createAlbumQuery,
        openTemporaryAlbumFromURL,

        // Temporary album management
        getTemporaryAlbum,
        saveTemporaryAlbum,
        deleteTemporaryAlbum,
        getCurrentTemporaryAlbumID: () => currentTemporaryAlbumID,
        setCurrentTemporaryAlbumID: (id) => { currentTemporaryAlbumID = id; },

        // Saved album management
        getSavedAlbums,
        saveAlbum,
        deleteSavedAlbum,
        refreshSavedAlbums,

        // Album loading
        reloadAlbums,
        buildAlbumTags,
        returnToAlbums,

        // Constants
        TEMP_ALBUM_STORAGE_KEY,
        GITHUB_STORAGE_KEY,
        SAVED_ALBUMS_KEY
    };
})();

// Helper function for base64 URL encoding/decoding
function encodeBase64URL(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function decodeBase64URL(encoded) {
    try {
        encoded = encoded
            .replace(/-/g, "+")
            .replace(/_/g, "/");

        while (encoded.length % 4)
            encoded += "=";

        const binary = atob(encoded);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch (error) {
        return null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlbumManager;
}
