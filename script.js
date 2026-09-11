const albums = [];
let currentAlbum = null;
let isQueryAlbum = false;
let currentImageIndex = 0;
let modalLoadID = 0;
let activeImageLoaders = [];
let loadingTimer = null;
const selectedTags = new Set();
const excludedTags = new Set();
let filterMode = "any";

const galleryGap = 1;
const minColumns = 2;
const maxColumns = 5;
const minThumbWidth = 180;
const homeMinColumns = 2;
const homeMaxColumns = 5;
const homeMinThumbWidth = 180;
const homeHeightMultiplier = 1.12;
let currentTemporaryAlbumID = null;

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

function getAlbumQuery(url) {

    if (!url)
        return "";

    if (url.includes("?$")) {

        return url.split("?$")[1];

    }

    if (url.includes("?")) {

        return url.split("?")[1];

    }

    return url;

}

async function initAlbums() {

    const query =
        location.search.substring(1);

    if (
        !window.telegramAppId ||
        !window.telegramAppHash
    ) {

        const savedTelegramAppID =
            localStorage.getItem("telegram_app_id");

        const savedTelegramAppHash =
            localStorage.getItem("telegram_app_hash");

        if (
            savedTelegramAppID &&
            savedTelegramAppHash
        ) {

            const appID =
                Number(savedTelegramAppID);

            if (
                Number.isInteger(appID) &&
                appID > 0
            ) {

                window.telegramAppId =
                    appID;

                window.telegramAppHash =
                    savedTelegramAppHash;

            }

        }

    }

    if (
        window.telegramAppId &&
        window.telegramAppHash &&
        !window.telegramClient
    ) {

        try {

            await initializeTelegramClient();

        }
        catch (error) {

            alert(
                "Telegram initialization failed:\n\n" +
                (
                    error &&
                    error.message
                        ? error.message
                        : String(error)
                )
            );

        }

    }

    if (!query) {

        await reloadAlbums();

        await showAlbums();

        return;

    }

    if (
        query.includes("gh=") ||
        query.includes("tg=")
    ) {

        const params =
            new URLSearchParams(query);

        const githubEncoded =
            params.get("gh");

        if (githubEncoded) {

            const githubURL =
                decodeBase64URL(githubEncoded);

            if (githubURL) {

                currentGithubID =
                    githubURL;

            }
            else {

            }

        }

        const telegramEncoded =
            params.get("tg");

        if (telegramEncoded) {

            try {

                const telegramJSON =
                    decodeBase64URL(telegramEncoded);

                if (!telegramJSON) {

                    throw new Error("Invalid Base64 Telegram data.");

                }

                const telegramInfo =
                    JSON.parse(telegramJSON);

                if (
                    telegramInfo.app_id === undefined ||
                    telegramInfo.app_hash === undefined
                ) {

                    throw new Error("Telegram data must contain app_id and app_hash.");

                }

                const appID =
                    Number(telegramInfo.app_id);

                if (
                    !Number.isInteger(appID) ||
                    appID <= 0
                ) {

                    throw new Error("Invalid Telegram app_id.");

                }

                if (
                    typeof telegramInfo.app_hash !==
                    "string" ||
                    !telegramInfo.app_hash
                ) {

                    throw new Error("Invalid Telegram app_hash.");

                }

                localStorage.setItem(
                    "telegram_app_id",
                    String(appID)
                );

                localStorage.setItem(
                    "telegram_app_hash",
                    telegramInfo.app_hash
                );

                window.telegramAppId =
                    appID;

                window.telegramAppHash =
                    telegramInfo.app_hash;

                if (
                    window.telegramAppId &&
                    window.telegramAppHash &&
                    !window.telegramClient
                ) {

                    await initializeTelegramClient();

                }

            }
            catch (error) {

                alert(
                    "Telegram initialization failed:\n\n" +
                    (
                        error &&
                        error.message
                            ? error.message
                            : String(error)
                    )
                );

            }

        }

        params.delete("gh");
        params.delete("tg");

        const remainingQuery =
            params.toString();

        const cleanURL =
            location.pathname +
            (
                remainingQuery
                    ? "?" + remainingQuery
                    : ""
            ) +
            location.hash;

        history.replaceState(
            null,
            "",
            cleanURL
        );

        if (currentGithubID) {

            await reloadAlbums();

            await showAlbums(false);

            return;

        }

        await reloadAlbums();

        await showAlbums();

        return;

    }

    if (
        query.startsWith("@")
    ) {

        const pasteID =
            decodeBase64URL(
                query.substring(1)
            );

        if (!pasteID) {

            await showAlbums();

            return;

        }

        currentGithubID =
            pasteID;

        await reloadAlbums();

        await showAlbums(false);

        return;

    }

    if (
        query.startsWith("$")
    ) {

        const albumID =
            decodeURIComponent(
                query.substring(1)
            );

        await reloadAlbums();

        const album =
            albums.find(
                a =>
                    a.id === albumID
            );

        if (album) {

            currentAlbum =
                album;

            isQueryAlbum =
                false;

            loadAlbum(album, false);

            showAlbumButtons(true);

            return;

        }

        await showAlbums();

        return;

    }

    if (
        query.startsWith("=")
    ) {

        const albumID =
            decodeURIComponent(
                query.substring(1)
            );

        const album =
            getTemporaryAlbum(albumID);

        if (
            album
        ) {

            currentTemporaryAlbumID =
                albumID;

            currentAlbum =
                album;

            isQueryAlbum =
                false;

            loadAlbum(album, false);

            showAlbumButtons(true);

            return;

        }

        await showAlbums();

        return;

    }

    const albumQuery =
        createQueryAlbum(query);

    currentAlbum =
        albumQuery;

    isQueryAlbum =
        true;

    loadAlbum(albumQuery, false);

    showAlbumButtons(true);

}

function createQueryAlbum(query) {

    return {
        name: "Shared Album",
        images: parseQuery(query),
        tags: []
    };

}

function parseQuery(query) {

    return query.split("|").map(entry => {

        try {

            const data =
                JSON.parse(
                    decodeURIComponent(entry)
                );

            if (
                data.source ===
                "telegram"
            ) {

                return {

                    source:
                        "telegram",

                    messageID:
                        data.messageID ||
                        data.messageId ||
                        null,

                    telegramFileID:
                        data.telegramFileID ||
                        data.fileID ||
                        data.fileId ||
                        null,

                    telegramThumbnailFileID:
                        data.telegramThumbnailFileID ||
                        data.thumbnailFileID ||
                        data.thumbnailFileId ||
                        null,

                    mimeType:
                        data.mimeType ||
                        "",

                    fileName:
                        data.n ||
                        data.fileName ||
                        "",

                    width:
                        data.width,

                    height:
                        data.height,

                    tags:
                        (data.d?.tags || data.tags || [])
                        .map(
                            tag =>
                                decodeURIComponent(tag)
                        )

                };

            }

            const fileName =
                data.n || "";

            const thumbURL =
                data.t
                    ? `https://i.ibb.co/${data.t}/${fileName}`
                    : null;

            const mediumURL =
                data.m
                    ? `https://i.ibb.co/${data.m}/${fileName}`
                    : null;

            const fullURL =
                data.f
                    ? `https://i.ibb.co/${data.f}/${fileName}`
                    : null;

            return {

                thumb:
                    thumbURL
                        ? {
                            url:
                                thumbURL
                        }
                        : null,

                medium:
                    mediumURL
                        ? {
                            url:
                                mediumURL
                        }
                        : null,

                image:
                    fullURL
                        ? {
                            url:
                                fullURL
                        }
                        : null,

                tags:
                    (data.d?.tags || [])
                    .map(
                        tag =>
                            decodeURIComponent(tag)
                    )

            };

        }

        catch (e) {

            const [
                thumbId,
                mediumId,
                imageId,
                fileName
            ] =
                entry.split(",");

            return {

                thumb:
                    thumbId
                        ? {
                            url:
                                `https://i.ibb.co/${thumbId}/${fileName}`
                        }
                        : null,

                medium:
                    mediumId
                        ? {
                            url:
                                `https://i.ibb.co/${mediumId}/${fileName}`
                        }
                        : null,

                image:
                    imageId
                        ? {
                            url:
                                `https://i.ibb.co/${imageId}/${fileName}`
                        }
                        : null,

                tags:
                    []

            };

        }

    });

}

function createAlbumQuery(album) {

    function getId(url) {
        if (!url)
            return "";

        const match = url.match(/\/([A-Za-z0-9]+)\//);
        return match ? match[1] : "";
    }

    function getFile(url) {
        if (!url)
            return "";

        return url.split("/").pop();
    }

    return album.images.map(img => {

        const file =
            getFile(
                img.image?.url ||
                img.thumb?.url);

        return encodeURIComponent(JSON.stringify({
                t: getId(img.thumb?.url),
                m: getId(img.medium?.url),
                f: getId(img.image?.url),
                n: file,
                d: {
                    tags: img.tags || []
                }
            }));

    }).join("|");
}

async function showAlbums() {

    document.getElementById("regenerateAlbum").style.display =
        "none";

    document.getElementById("tagBar").style.display =
        "none";

    document.getElementById("tagToggle").style.display =
        "none";

    document.getElementById("pageName").textContent =
        "ImgBB Galleries";

    document.title =
        "Gallery Viewer";

    const currentQuery =
        window.location.search;

    if (
        !currentQuery.startsWith("?@")
    ) {

        history.replaceState(
            null,
            "",
            window.location.pathname
        );

    }

    isQueryAlbum =
        false;

    currentAlbum =
        null;

    stopThumbnailLoading();

    thumbnailItems =
        [];

    thumbnailQueue =
        [];

    if (!albums.length) {

        await reloadAlbums();

    }
    else {

        refreshSavedAlbums();

    }

    document.getElementById("backButton").style.display =
        "none";

    document.getElementById("saveButton").style.display =
        "none";

    const gallery =
        document.getElementById("gallery");

    gallery.innerHTML =
        "";

    if (!albums.length) {

        gallery.textContent =
            "No data loaded.";

        return;

    }

    albums.forEach(
        album => {

            const isTelegram =
                typeof album.url === "string" &&
                album.url.startsWith("tg://chat/");

            let cover =
                null;

            if (
                !isTelegram &&
                album.images &&
                album.images.length
            ) {

                cover =
                    album.images[
                        Math.floor(
                            Math.random() *
                            album.images.length
                        )
                    ];

            }

            const card =
                document.createElement("div");

            card.className =
                "album";

            const img =
                document.createElement("img");

            if (
                !isTelegram &&
                cover &&
                cover.thumb &&
                cover.thumb.url
            ) {

                img.src =
                    cover.thumb.url;

            }

            if (
                isTelegram
            ) {

                img.style.visibility =
                    "hidden";

            }

            const title =
                document.createElement("div");

            title.textContent =
                album.name;

            card.appendChild(img);

            card.appendChild(title);

            card.onclick =
                () => loadAlbum(album);

            if (
                isTelegram
            ) {

                const exportBtn =
                    document.createElement("button");

                exportBtn.className =
                    "album-export";

                exportBtn.textContent =
                    "↗";

                exportBtn.title =
                    "Copy Telegram album record";

                exportBtn.onclick =
                    async (e) => {

                        e.stopPropagation();

                        try {

                            if (
                                album._telegramLoadPromise
                            ) {

                                await album._telegramLoadPromise;

                            }
                            else {

                                await loadTelegramAlbum(album);

                            }

                            if (
                                !album._telegramMessageIDs ||
                                !album._telegramMessageIDs.length
                            ) {

                                alert("No Telegram image messages were found.");

                                return;

                            }

                            const match =
                                album.url.match(
                                    /^tg:\/\/chat\/(-?\d+)/
                                );

                            if (!match) {

                                alert("Invalid Telegram album URL.");

                                return;

                            }

                            const chatId =
                                match[1];

                            const coverID =
                                album._telegramCoverMessageID ||
                                album._telegramMessageIDs[0];

                            const messageIDs =
                                album._telegramMessageIDs.join(",");

                            const id =
                                generateAlbumID(album.name);

                            const js =
                                `,
	{
		id: "${id.replace(
							/"/g,
							'\\"'
						)}",
		name: "${album.name.replace(
							/"/g,
							'\\"'
						)}",
		url: \`
		tg://chat/${chatId}?cover=${coverID}&messages=${messageIDs}
		\`.trim(),
		tags: ${JSON.stringify(album.tags || [])}
	}`;

                            navigator.clipboard
                                .writeText(js)
                                .then(
                                    () => {

                                        alert("Copied Telegram album entry!");

                                    }
                                )
                                .catch(
                                    () => {

                                        prompt(
                                            "Copy this:",
                                            js
                                        );

                                    }
                                );

                        }
                        catch (error) {

							alert(
								"Failed to load Telegram album data:\n\n" +
								(
									error &&
									error.message
										? error.message
										: String(error)
								)
							);

						}

                    };

                card.appendChild(exportBtn);

            }

            if (
                album.storage
            ) {

                const deleteBtn =
                    document.createElement("button");

                deleteBtn.className =
                    "album-delete";

                deleteBtn.textContent =
                    "×";

                deleteBtn.title =
                    album.edited
                        ? "Delete local edits"
                        : "Remove saved album";

                if (
                    album.edited
                ) {

                    deleteBtn.classList.add("album-delete-edited");

                }

                deleteBtn.onclick =
                    (e) => {

                        e.stopPropagation();

                        let saved =
                            JSON.parse(
                                localStorage.getItem("savedAlbums") || "[]"
                            );

                        saved =
                            saved.filter(
                                savedAlbum =>
                                    savedAlbum.id !==
                                    album.id
                            );

                        localStorage.setItem(
                            "savedAlbums",
                            JSON.stringify(saved)
                        );

                        showAlbums();

                    };

                card.appendChild(deleteBtn);

                if (
                    album.edited
                ) {

                    const exportBtn =
                        document.createElement("button");

                    exportBtn.className =
                        "album-export";

                    exportBtn.textContent =
                        "↗";

                    exportBtn.title =
                        "Copy to albums.js";

                    exportBtn.onclick =
                        (e) => {

                            e.stopPropagation();

                            const query =
                                createAlbumQuery(album);

                            const id =
                                generateAlbumID(album.name);

                            const js =
                                `,
	{
		id: "${id.replace(
							/"/g,
							'\\"'
						)}",
		name: "${album.name.replace(
							/"/g,
							'\\"'
						)}",
		url: \`
		?${query}
		\`.trim(),
		tags: ${JSON.stringify(album.tags || [])}
	}`;

                            navigator.clipboard
                                .writeText(js)
                                .then(
                                    () => {

                                        alert("Copied album.js entry!");

                                    }
                                )
                                .catch(
                                    () => {

                                        prompt(
                                            "Copy this:",
                                            js
                                        );

                                    }
                                );

                        };

                    card.appendChild(exportBtn);

                }

            }

            gallery.appendChild(card);

            if (
                isTelegram &&
                window.telegramClient
            ) {

                album._telegramCoverPromise =
					loadTelegramAlbumCover(album);

				album._telegramCoverPromise
					.then(
						result => {

							img.src =
								result.url;

							img.style.visibility =
								"visible";

						}
					)
					.catch(
						error => {

						}
					);

            }

        }
    );

    const addCard =
        document.createElement("div");

    addCard.className =
        "album album-add";

    const addImage =
        document.createElement("div");

    addImage.className =
        "album-add-image";

    addImage.textContent =
        "+";

    const addTitle =
        document.createElement("div");

    addTitle.textContent =
        "Add New";

    addCard.appendChild(addImage);

    addCard.appendChild(addTitle);

    addCard.onclick =
        () => {

            openAlbumInput();

        };

    gallery.appendChild(addCard);

    applyGalleryLayout(false);

    document.documentElement.classList.remove("pageLoading");

    showAddImageButton();
}

function refreshSavedAlbums() {

    for (
        let i = albums.length - 1;
        i >= 0;
        i--
    ) {

        if (
            albums[i].storage
        ) {

            albums.splice(
                i,
                1
            );

        }

    }

    const saved =
        JSON.parse(
            localStorage.getItem("savedAlbums") || "[]"
        );

    saved.forEach(
        album => {

            albums.push({

                ...album,

                tags:
                    album.tags ||
                    [],

                storage:
                    true

            });

        }
    );

}

function returnToAlbums() {

    if (
        currentTemporaryAlbumID
    ) {

        deleteTemporaryAlbum(currentTemporaryAlbumID);

        currentTemporaryAlbumID =
            null;

    }

    showAlbums();

}

async function buildAlbumTags(album) {

    const tagSet = new Set();

    album.images.forEach(img => {

        (img.tags || []).forEach(tag => {
            tagSet.add(tag);
        });

    });

    album.tags = [...tagSet];

    buildTagList(album.tags);
}

const TEMP_ALBUM_STORAGE_KEY =
    "temporaryAlbums";

function getTemporaryAlbums() {

    return JSON.parse(
        localStorage.getItem(TEMP_ALBUM_STORAGE_KEY) || "{}"
    );

}

function saveTemporaryAlbum(album) {

    const temporaryAlbums =
        getTemporaryAlbums();

    temporaryAlbums[album.id] =
        album;

    localStorage.setItem(
        TEMP_ALBUM_STORAGE_KEY,
        JSON.stringify(temporaryAlbums)
    );

}

function getTemporaryAlbum(id) {

    const temporaryAlbums =
        getTemporaryAlbums();

    return temporaryAlbums[id] ||
        null;

}

function deleteTemporaryAlbum(id) {

    if (!id)
        return;

    const temporaryAlbums =
        getTemporaryAlbums();

    if (
        !temporaryAlbums[id]
    ) {

        return;

    }

    delete temporaryAlbums[id];

    localStorage.setItem(
        TEMP_ALBUM_STORAGE_KEY,
        JSON.stringify(temporaryAlbums)
    );

}

function openAlbumInput() {

    let overlay =
        document.getElementById("albumInputOverlay");

    if (overlay) {

        overlay.style.display =
            "flex";

        return;

    }

    overlay =
        document.createElement("div");

    overlay.id =
        "albumInputOverlay";

    overlay.innerHTML = `
        <div class="album-input-box">

            <div class="album-input-title">
                Open Album
            </div>

            <input
                id="albumInput"
                type="text"
                placeholder="Paste album URL"
                autocomplete="off"
            >

            <div
                style="
                    margin: 12px 0;
                    text-align: center;
                    opacity: 0.7;
                "
            >
                OR
            </div>

            <select
                id="telegramAlbumChat"
                style="width: 100%;"
            >
                <option value="">
                    Select Telegram chat
                </option>
            </select>

            <div class="album-input-buttons">

                <button id="albumInputCancel">
                    Cancel
                </button>

                <button id="albumInputOpen">
                    Open
                </button>

            </div>

        </div>
    `;

    document.body.appendChild(overlay);

    const input =
        document.getElementById("albumInput");

    const telegramSelect =
        document.getElementById("telegramAlbumChat");

    const openButton =
        document.getElementById("albumInputOpen");

    const cancelButton =
        document.getElementById("albumInputCancel");

    populateTelegramAlbumChats(telegramSelect);

    openButton.onclick =
        async () => {

            const telegramChatID =
                telegramSelect.value;

            const value =
                input.value.trim();

            if (
                telegramChatID
            ) {

                overlay.remove();

                await openTemporaryTelegramAlbum(
                    Number(telegramChatID)
                );

                return;

            }

            if (!value)
                return;

            overlay.remove();

            openTemporaryAlbumFromURL(value);

        };

    cancelButton.onclick =
        () => {

            overlay.remove();

        };

    overlay.onclick =
        (e) => {

            if (
                e.target === overlay
            ) {

                overlay.remove();

            }

        };

    input.addEventListener(
        "keydown",
        e => {

            if (
                e.key === "Enter"
            ) {

                openButton.click();

            }

            if (
                e.key === "Escape"
            ) {

                cancelButton.click();

            }

        }
    );

    input.focus();

}

async function loadTelegramAlbum(album) {

    if (
        !window.telegramClient
    ) {

        throw new Error("Telegram client is not initialized.");

    }

    const client =
        window.telegramClient;

    const match =
        album.url.match(
            /^tg:\/\/chat\/(-?\d+)(?:\?(.+))?$/
        );

    if (!match) {

        throw new Error(
            "Invalid Telegram album URL: " +
            album.url
        );

    }

    const chatId =
        Number(match[1]);

    const optionString =
        match[2] ||
        "";

    const options =
        new URLSearchParams(optionString);

    const coverMessageID =
        options.get("cover");

    const messageString =
        options.get("messages");

    let requestedMessageIDs =
        [];

    if (
        messageString
    ) {

        requestedMessageIDs =
            messageString
                .split(",")
                .map(
                    id =>
                        Number(id)
                )
                .filter(
                    id =>
                        Number.isInteger(id) &&
                        id > 0
                );

    }

    let chat =
        null;

    if (
        Array.isArray(window.telegramChats)
    ) {

        const found =
            window.telegramChats.find(
                item =>
                    item &&
                    item.chat &&
                    String(item.chat.id) ===
                    String(chatId)
            );

        if (found) {

            chat =
                found.chat;

        }

    }

    if (!chat) {

        const chats =
            await client.getChats();

        window.telegramChats =
            chats;

        const found =
            chats.find(
                item =>
                    item &&
                    item.chat &&
                    String(item.chat.id) ===
                    String(chatId)
            );

        if (found) {

            chat =
                found.chat;

        }

    }

    if (!chat) {

        throw new Error(
            "Telegram chat was not found: " +
            chatId
        );

    }

    let messages =
        [];

    if (
        requestedMessageIDs.length
    ) {

        try {

            const retrievedMessages =
                await client.getMessages(
                    chat.id,
                    requestedMessageIDs
                );

            const messageMap =
                new Map();

            for (
                const message of
                retrievedMessages
            ) {

                if (
                    message &&
                    Number.isInteger(message.id)
                ) {

                    messageMap.set(
                        message.id,
                        message
                    );

                }

            }

            messages =
                requestedMessageIDs
                    .map(
                        messageID =>
                            messageMap.get(messageID)
                    )
                    .filter(
                        message =>
                            !!message
                    );

        }
        catch (error) {

            throw error;

        }

    }
    else {

        messages =
            await client.getHistory(
                chat.id,
                {
                    limit:
                        100
                }
            );

    }

    const images =
        [];

    for (
        const message of
        messages
    ) {

        if (
            !message ||
            !message.document
        ) {

            continue;

        }

        const fileDocument =
            message.document;

        const mimeType =
            fileDocument.mimeType ||
            "";

        if (
            !mimeType.startsWith("image/")
        ) {

            continue;

        }

        let thumbnail =
            null;

        if (
            Array.isArray(fileDocument.thumbnails) &&
            fileDocument.thumbnails.length
        ) {

            thumbnail =
                fileDocument.thumbnails
                    .slice()
                    .sort(
                        (a, b) =>
                            (
                                (b.width || 0) *
                                (b.height || 0)
                            ) -
                            (
                                (a.width || 0) *
                                (a.height || 0)
                            )
                    )[0];

        }

        images.push({

            source:
                "telegram",

            messageID:
                message.id,

            telegramFileID:
                fileDocument.fileId,

            telegramThumbnailFileID:
                thumbnail
                    ? thumbnail.fileId
                    : null,

            mimeType:
                mimeType,

            fileName:
                fileDocument.fileName ||
                "",

            width:
                fileDocument.width,

            height:
                fileDocument.height,

            tags:
                []

        });

    }

    album.images =
        images;

    let coverImage =
        null;

    if (
        coverMessageID
    ) {

        coverImage =
            images.find(
                image =>
                    String(image.messageID) ===
                    String(coverMessageID)
            );

    }

    if (
        !coverImage &&
        images.length
    ) {

        coverImage =
            images[
                Math.floor(
                    Math.random() *
                    images.length
                )
            ];

    }

    album._telegramMessageIDs =
        images.map(
            image =>
                image.messageID
        );

    album._telegramCoverMessageID =
        coverImage
            ? coverImage.messageID
            : null;

    album._telegramLoaded =
        true;

}

async function loadAlbum(album, pushHistory = true) {
    selectedTags.clear();
    document.getElementById("tagBar").style.display = "";
    document.getElementById("tagList").innerHTML = "";
    document.getElementById("pageName").textContent = album.name;
    document.title = album.name;
    currentAlbum = album;

    if (pushHistory) {
        history.pushState(null, "", "?$" + encodeURIComponent(album.id));
        showAlbumButtons(true);
    }

    if (album.url?.startsWith("tg://chat/")) {
        try {
            await loadTelegramAlbum(album);
        } catch (error) {
            alert("Failed to load Telegram album:\n\n" + (error?.message || String(error)));
            return;
        }
    }

    const gallery = document.getElementById("gallery");
    gallery.innerHTML = "";
    stopThumbnailLoading();
    thumbnailItems = [];
    thumbnailQueue = [];
    thumbnailLoading = false;
    stopMediumLoading();
    mediumItems = [];
    mediumQueue = [];
    mediumLoading = false;

    album.images.forEach((image, index) => createAlbumImageItems(album, image, index, gallery));

    if (album.tags?.length)
        buildTagList(album.tags);
    else
        buildAlbumTags(album);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        loadTagBarState();
        applyGalleryLayout(false);
        startThumbnailLoading();
    }));

    document.documentElement.classList.remove("pageLoading");
    showAddImageButton();
}

function createAlbumImageItems(album, image, index, gallery) {
    const source = image.source || "url";
    const urls = getImageURLs(image);
    if (!urls.thumb && source === "url")
        return;

    const slot = document.createElement("div");
    slot.className = "thumbnail-slot";
    slot.dataset.index = index;
    slot.dataset.thumbnailIndex = index;
    slot.dataset.src = urls.thumb || "";
    slot.dataset.loaded = "false";
    slot.dataset.loading = "false";
    slot.style.visibility = "hidden";
    slot._thumbnailItem = null;

    const thumbImg = document.createElement("img");
    thumbImg.className = "thumb thumbnail-image";

    const mediumImg = document.createElement("img");
    mediumImg.className = "thumb medium-image";
    mediumImg.style.visibility = "hidden";
    mediumImg.style.opacity = "0";

    slot.append(thumbImg, mediumImg);
    gallery.appendChild(slot);

    if (album.edited && image.added) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "image-remove";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove added image";
        removeBtn.onclick = e => {
            e.stopPropagation();
            if (!confirm("Remove this added image?"))
                return;
            album.images.splice(index, 1);
            album.edited = true;
            showEditedAlbumSaveButton();
            loadAlbum(album, false);
        };
        slot.appendChild(removeBtn);
    }

    const thumbnailItem = {
        index,
        slotIndex: gallery.children.length - 1,
        image,
        src: urls.thumb,
        mediumSrc: urls.medium,
        fullSrc: urls.full,
        source,
        telegramFileID: image.telegramFileID || null,
        telegramThumbnailFileID: image.telegramThumbnailFileID || null,
        mimeType: image.mimeType || "",
        fileName: image.fileName || "",
        messageID: image.messageID || null,
        slot,
        img: thumbImg,
        mediumImg,
        loaded: false,
        loading: false,
        assigned: false,
        mediumLoaded: false,
        mediumLoading: false,
        mediumFailed: false,
        mediumImage: null
    };
    slot._thumbnailItem = thumbnailItem;
    slot.onclick = () => {
        if (!slot._thumbnailItem)
            return;
        const current = slot._thumbnailItem;
        currentImageIndex = current.index;
        openModal(current.src, current.mediumSrc, current.fullSrc, slot);
    };
    thumbnailItems.push(thumbnailItem);

    mediumItems.push({
        index,
        image,
        src: urls.medium,
        source,
        telegramFileID: image.telegramFileID || null,
        mimeType: image.mimeType || "",
        fileName: image.fileName || "",
        messageID: image.messageID || null,
        mediumLoaded: false,
        mediumLoading: false,
        mediumFailed: false,
        mediumImage: mediumImg,
        mediumBlobURL: null
    });
}

function getImageURLs(image) {
    const thumb = image.thumb?.url || image.image?.url || image.medium?.url || "";
    const medium = image.medium?.url || image.image?.url || thumb;
    const full = image.image?.url || image.medium?.url || thumb;
    return { thumb, medium, full };
}

const imageAssetCache = new WeakMap();
const imageResponseCacheName = "gallery-image-assets-v1";

async function blobURLFromResponse(response, assets, key) {
    if (!response || !response.ok)
        return null;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    assets[key] = url;
    return url;
}

async function resolveCachedURL(url, image, resolution, isActive) {
    if (!url)
        return null;

    let assets = imageAssetCache.get(image);
    if (!assets) {
        assets = {};
        imageAssetCache.set(image, assets);
    }
    if (assets[resolution])
        return assets[resolution];

    const cacheKey = `https://gallery-image.invalid/url/${resolution}/${encodeURIComponent(url)}`;
    let cache = null;

    try {
        if (window.caches) {
            cache = await caches.open(imageResponseCacheName);
            const cached = await cache.match(cacheKey);
            if (cached)
                return blobURLFromResponse(cached, assets, resolution);
        }
    } catch (error) {
        console.debug("[IMAGE CACHE] Cache lookup failed", {
            resolution,
            url,
            error
        });
    }

    let response;
    try {
        response = await fetch(url, {cache: "force-cache"});
    } catch (error) {
        console.debug("[IMAGE FETCH] Fetch failed", {
            resolution,
            url,
            errorName: error?.name,
            errorMessage: error?.message
        });
        return null;
    }

    if (isActive && !isActive())
        return null;

    if (!response.ok) {
        console.debug("[IMAGE FETCH] Server returned an error", {
            resolution,
            url,
            status: response.status,
            statusText: response.statusText
        });
        return null;
    }

    try {
        if (cache)
            await cache.put(cacheKey, response.clone());
    } catch (error) {
        console.debug("[IMAGE CACHE] Cache store failed", {
            resolution,
            url,
            error
        });
    }

    try {
        return await blobURLFromResponse(response, assets, resolution);
    } catch (error) {
        console.debug("[IMAGE FETCH] Response-to-Blob failed", {
            resolution,
            url,
            errorName: error?.name,
            errorMessage: error?.message
        });
        return null;
    }
}

const imageSources = {
    url: {
        resolve: async (image, resolution, isActive) =>
            resolveCachedURL(getImageURLs(image)[resolution], image, resolution, isActive)
    },
    telegram: {
        resolve: async (image, resolution, isActive) => {
            const key = resolution === "thumb" ? "thumb" : "full";
            let assets = imageAssetCache.get(image);
            if (!assets) {
                assets = {};
                imageAssetCache.set(image, assets);
            }
            if (assets[key])
                return assets[key];

            const fileID = resolution === "thumb"
                ? image.telegramThumbnailFileID
                : image.telegramFileID;
            if (!fileID || !window.telegramClient)
                return null;

            const cacheKey = `https://gallery-image.invalid/telegram/${encodeURIComponent(fileID)}/${key}`;
            try {
                if (window.caches) {
                    const cache = await caches.open(imageResponseCacheName);
                    const cached = await cache.match(cacheKey);
                    if (cached)
                        return blobURLFromResponse(cached, assets, key);
                }
            } catch {}

            const chunks = [];
            for await (const chunk of window.telegramClient.download(fileID, {
                chunkSize: key === "thumb" ? 64 * 1024 : 256 * 1024
            })) {
                if (isActive && !isActive())
                    return null;
                chunks.push(chunk);
            }
            if (isActive && !isActive())
                return null;

            const blob = new Blob(chunks, {type: image.mimeType || "image/jpeg"});
            const url = URL.createObjectURL(blob);
            assets[key] = url;

            try {
                if (window.caches) {
                    const cache = await caches.open(imageResponseCacheName);
                    await cache.put(cacheKey, new Response(blob, {
                        headers: {"Content-Type": blob.type || "image/jpeg"}
                    }));
                }
            } catch {}

            return url;
        }
    }
};

async function resolveImageAsset(item, resolution, isActive) {
    if (!item?.image)
        return null;
    const source = imageSources[item.source] || imageSources.url;
    return source.resolve(item.image, resolution, isActive);
}

function openTemporaryAlbumFromURL(url) {

    if (!url)
        return;

    const query =
        getAlbumQuery(
            url.trim()
        );

    if (!query) {

        alert("No album query was found in that URL.");

        return;

    }

    const album =
        createQueryAlbum(query);

    const id =
        generateAlbumID(album.name);

    album.id =
        id;

    album.temporary =
        true;

    currentTemporaryAlbumID =
        id;

    saveTemporaryAlbum(album);

    history.pushState(
        null,
        "",
        "?=" +
        encodeURIComponent(id)
    );

    loadAlbum(album, false);

    showAlbumButtons(true);

}

let thumbnailItems = [];
let thumbnailQueue = [];
let thumbnailLoading = false;
let thumbnailObserver = null;
let thumbnailScrollTimer = null;
const THUMBNAIL_SETTLE_DELAY = 1000;
const IMAGE_RETRY_DELAY = 3000;
let thumbnailLoadSession = 0;
let thumbnailPriorityMode = false;
let thumbnailPriorityPaused = false;
let imageRetryTimer = null;
let lastImageFailureTime = 0;
let imageRetryPending = false;
let modalRetry = null;

function noteImageFailure() {
    lastImageFailureTime = Date.now();
    imageRetryPending = true;
    if (imageRetryTimer) {
        clearTimeout(imageRetryTimer);
        imageRetryTimer = null;
    }
    scheduleImageRetry();
}

function scheduleImageRetry() {
    if (imageRetryTimer)
        return;

    const remaining = Math.max(0, IMAGE_RETRY_DELAY - (Date.now() - lastImageFailureTime));
    imageRetryTimer = setTimeout(() => {
        imageRetryTimer = null;
        if (!imageRetryPending)
            return;
        imageRetryPending = false;
        retryFailedImages();
    }, remaining);
}

function retryFailedImages() {
    if (modalRetry && isModalLoadActive(modalRetry.loadID)) {
        const retry = modalRetry;
        modalRetry = null;
        if (retry.name === "open") {
            openModal(retry.thumbSrc, retry.mediumSrc, retry.fullSrc, retry.slot);
            return;
        }
        load(retry.url, retry.name, retry.loadID);
        return;
    }

    if (thumbnailPriorityPaused)
        return;

    if (thumbnailItems.some(item => item && !item.loaded && item.thumbnailFailed)) {
        thumbnailItems.forEach(item => {
            if (item && item.thumbnailFailed)
                item.thumbnailFailed = false;
        });
        rebuildThumbnailQueue(false, true);
        processThumbnailQueue(thumbnailLoadSession);
        return;
    }

    if (mediumItems.some(item => item && !item.mediumLoaded && item.mediumFailed)) {
        mediumItems.forEach(item => {
            if (item && item.mediumFailed)
                item.mediumFailed = false;
        });
        rebuildMediumQueue(false, true);
        processMediumQueue(mediumLoadSession);
    }
}

function pauseThumbnailLoading() {
    thumbnailPriorityPaused = true;
    clearTimeout(thumbnailScrollTimer);
    thumbnailScrollTimer = null;
}

function resumeThumbnailLoading() {
    thumbnailPriorityPaused = false;
    prioritizeVisibleThumbnails();
    if (!thumbnailLoading)
        processThumbnailQueue(thumbnailLoadSession);
}

function stopThumbnailLoading() {
    thumbnailLoadSession++;
    clearTimeout(thumbnailScrollTimer);
    thumbnailScrollTimer = null;
    if (thumbnailObserver) {
        thumbnailObserver.disconnect();
        thumbnailObserver = null;
    }
    thumbnailPriorityMode = false;
}

function getThumbnailSlots() {
    const gallery = document.getElementById("gallery");
    if (!gallery)
        return [];
    return Array.from(gallery.querySelectorAll(".thumbnail-slot"));
}

function getVisibleThumbnailSlots() {
    return getThumbnailSlots()
        .map((slot, position) => ({slot, position, rect: slot.getBoundingClientRect()}))
        .filter(item =>
            item.rect.bottom > 0 &&
            item.rect.top < window.innerHeight &&
            item.rect.right > 0 &&
            item.rect.left < window.innerWidth
        )
        .sort((a, b) => {
            if (Math.abs(a.rect.top - b.rect.top) > 1)
                return a.rect.top - b.rect.top;
            return a.rect.left - b.rect.left;
        })
        .map(item => item.slot);
}

function getNextAvailableVisibleSlot() {
    for (const slot of getVisibleThumbnailSlots()) {
        if (slot.dataset.loaded !== "true" && slot.dataset.loading !== "true")
            return slot;
    }
    return null;
}

function rebuildThumbnailQueue(prioritizeVisible = false, restoreFailed = false) {
    const eligible = thumbnailItems.filter(item =>
        item &&
        !item.loaded &&
        !item.loading
    );

    if (!prioritizeVisible) {
        const normal = eligible.filter(item => !item.thumbnailFailed)
            .sort((a, b) => a.index - b.index);
        const failed = eligible.filter(item => item.thumbnailFailed)
            .sort((a, b) => a.index - b.index);
        thumbnailQueue = normal.concat(failed);
        return;
    }

    const visible = new Set(getVisibleThumbnailSlots()
        .map(slot => Number(slot.dataset.index)));

    const ordered = eligible.sort((a, b) => a.index - b.index);
    const visibleItems = ordered.filter(item => visible.has(item.index));
    const remaining = ordered.filter(item => !visible.has(item.index));

    if (restoreFailed) {
        eligible.forEach(item => {
            if (item.thumbnailFailed)
                item.thumbnailFailed = false;
        });
        thumbnailQueue = visibleItems.concat(remaining);
    } else {
        const normal = visibleItems.concat(remaining).filter(item => !item.thumbnailFailed);
        const failed = visibleItems.concat(remaining).filter(item => item.thumbnailFailed);
        thumbnailQueue = normal.concat(failed);
    }
}

async function forceLoadThumbnail(item) {
    if (!item || item.loaded)
        return item?.src || null;

    const url = await resolveImageAsset(item, "thumb", () => isModalLoadActive(modalLoadID));
    if (!url || !isModalLoadActive(modalLoadID))
        return null;

    const slot = item.slot;
    const img = slot?.querySelector(".thumbnail-image") || item.img;
    if (!img)
        return null;

    img.src = url;
    item.src = url;
    item.loaded = true;
    item.loading = false;
    item.assigned = true;
    item.thumbnailFailed = false;

    if (slot) {
        slot._thumbnailItem = item;
        slot.dataset.index = item.index;
        slot.dataset.src = url;
        slot.dataset.loaded = "true";
        slot.dataset.loading = "false";
        slot.style.visibility = "visible";
        img.style.visibility = "visible";
    }

    thumbnailQueue = thumbnailQueue.filter(queueItem => queueItem !== item);
    return url;
}

function assignThumbnailToSlot(item,
    slot) {

    if (
        !item ||
        !slot
    ) {

        return;

    }

    if (
        slot._thumbnailItem ===
        item
    ) {

        return;

    }

    const thumbnailImg =
        slot.querySelector(
            ".thumbnail-image");

    const mediumImg =
        slot.querySelector(
            ".medium-image");

    if (
        !thumbnailImg ||
        !mediumImg
    ) {

        return;

    }

    slot.style.visibility =
        "hidden";

    slot._thumbnailItem =
        item;

    item.slot = slot;
    item.img = thumbnailImg;
    item.mediumImg = mediumImg;

    slot.dataset.index =
        item.index;

    slot.dataset.src =
        item.src;

    slot.dataset.loaded =
        "false";

    slot.dataset.loading =
        "false";

    mediumImg.style.visibility =
        "hidden";

    mediumImg.style.opacity =
        "0";

    mediumImg.removeAttribute(
        "src");

    slot.alt =
        (item.tags || []).join(",");

    slot.onclick =
        () => {

        if (
            !slot._thumbnailItem
        ) {

            return;

        }

        const current =
            slot._thumbnailItem;

        currentImageIndex =
            current.index;

        openModal(
            current.src,
            current.mediumSrc,
            current.fullSrc,
            slot
        );

    };

    if (
        item.loaded
    ) {

        thumbnailImg.src =
            item.src;

        thumbnailImg.style.visibility =
            "visible";

        slot.dataset.loaded =
            "true";

        slot.dataset.loading =
            "false";

        slot.style.visibility =
            "visible";

    }

    if (
        item.mediumLoaded &&
        item.mediumImage
    ) {

        mediumImg.src =
            item.mediumImage.src;

        mediumImg.style.visibility =
            "visible";

        mediumImg.style.opacity =
            "1";

    }

}

function getNextAvailableVisibleSlot() {

	const visibleSlots =
		getVisibleThumbnailSlots();

	for (
		const slot of visibleSlots
	) {

		if (
			slot.dataset.loaded ===
			"true"
		) {

			continue;

		}

		if (
			slot.dataset.loading ===
			"true"
		) {

			continue;

		}

		return slot;

	}

	return null;

}

function loadThumbnail(item, session) {
    return new Promise(resolve => {
        if (!item || item.loaded || item.loading || session !== thumbnailLoadSession) {
            resolve();
            return;
        }

        let targetSlot = thumbnailPriorityMode ? getNextAvailableVisibleSlot() : null;
        if (!targetSlot)
            targetSlot = getThumbnailSlots().find(slot =>
                slot.dataset.loading !== "true" && slot.dataset.loaded !== "true"
            );
        if (!targetSlot) {
            resolve();
            return;
        }

        const img = targetSlot.querySelector(".thumbnail-image");
        if (!img) {
            resolve();
            return;
        }

        item.loading = true;
        item.thumbnailFailed = false;
        assignThumbnailToSlot(item, targetSlot);
        targetSlot.dataset.loading = "true";

        const finish = success => {
            img.onload = null;
            img.onerror = null;
            item.loading = false;
            targetSlot.dataset.loading = "false";

            if (session !== thumbnailLoadSession) {
                resolve();
                return;
            }

            if (success) {
                item.loaded = true;
                item.assigned = true;
                item.thumbnailFailed = false;
                targetSlot.dataset.loaded = "true";
                targetSlot.style.visibility = "visible";
                img.style.visibility = "visible";
            } else {
                item.loaded = false;
                item.assigned = false;
                item.thumbnailFailed = true;
                targetSlot.dataset.loaded = "false";
                noteImageFailure();
                console.debug("[THUMBNAIL] Failed; deferred for retry", {
                    index: item.index,
                    source: item.source,
                    url: item.src || item.mediumSrc || item.fullSrc || null
                });
            }
            resolve();
        };

        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        resolveImageAsset(item, "thumb", () => session === thumbnailLoadSession)
            .then(url => {
                if (!url || session !== thumbnailLoadSession) {
                    finish(false);
                    return;
                }
                item.src = url;
                targetSlot.dataset.src = url;
                img.src = url;
            })
            .catch(error => {
                console.debug("[THUMBNAIL] Asset resolution failed", {
                    index: item.index,
                    source: item.source,
                    errorName: error?.name,
                    errorMessage: error?.message
                });
                finish(false);
            });
    });
}

async function processThumbnailQueue(session) {
    if (thumbnailLoading || thumbnailPriorityPaused || session !== thumbnailLoadSession)
        return;

    thumbnailLoading = true;

    while (thumbnailQueue.length && session === thumbnailLoadSession && !thumbnailPriorityPaused) {
        if (thumbnailPriorityMode) {
            const visibleSlots = getVisibleThumbnailSlots();
            if (!visibleSlots.length)
                break;
            prioritizeVisibleQueue();
        }

        const item = thumbnailQueue.shift();
        if (!item || item.loaded || item.loading)
            continue;

        if (item.thumbnailFailed) {
            thumbnailQueue.push(item);
            if (!thumbnailQueue.some(entry => entry && !entry.loaded && !entry.loading && !entry.thumbnailFailed))
                break;
            continue;
        }

        await loadThumbnail(item, session);
    }

    thumbnailLoading = false;

    if (thumbnailPriorityPaused || thumbnailPriorityMode || session !== thumbnailLoadSession)
        return;

    const remainingNormal = thumbnailItems.some(item =>
        item && !item.loaded && !item.loading && !item.thumbnailFailed
    );

    if (remainingNormal) {
        rebuildThumbnailQueue(false, true);
        processThumbnailQueue(session);
        return;
    }

    const failed = thumbnailItems.some(item => item && !item.loaded && item.thumbnailFailed);
    if (failed) {
        imageRetryPending = true;
        scheduleImageRetry();
    }

    if (!remainingNormal)
        startMediumLoading();
}

function prioritizeVisibleQueue() {
    rebuildThumbnailQueue(true, true);
}

function prioritizeVisibleThumbnails() {
    if (thumbnailPriorityPaused)
        return;
    thumbnailPriorityMode = true;
    rebuildThumbnailQueue(true, true);
    processThumbnailQueue(thumbnailLoadSession);

    const finishPriorityCheck = () => {
        if (!thumbnailPriorityMode)
            return;

        const visibleSlots = getVisibleThumbnailSlots();
        const pendingVisible = visibleSlots.some(slot => {
            const item = thumbnailItems.find(entry => entry.index === Number(slot.dataset.index));
            return item && !item.loaded;
        });

        if (pendingVisible) {
            setTimeout(finishPriorityCheck, 50);
            return;
        }

        thumbnailPriorityMode = false;
        rebuildThumbnailQueue(false, true);
        processThumbnailQueue(thumbnailLoadSession);
        if (mediumItems.length)
            prioritizeVisibleMediums();
    };

    setTimeout(finishPriorityCheck, 0);
}

function scheduleThumbnailVisibilityCheck() {
    if (thumbnailPriorityPaused)
        return;
    clearTimeout(thumbnailScrollTimer);
    thumbnailPriorityMode = true;
    thumbnailScrollTimer = setTimeout(() => {
        thumbnailScrollTimer = null;
        prioritizeVisibleThumbnails();
    }, THUMBNAIL_SETTLE_DELAY);
}

function startThumbnailLoading() {
    stopThumbnailLoading();
    const gallery = document.getElementById("gallery");
    if (!gallery)
        return;

    const session = thumbnailLoadSession;
    const slots = getThumbnailSlots();
    if (!slots.length)
        return;

    rebuildThumbnailQueue(false, true);
    thumbnailPriorityMode = false;
    processThumbnailQueue(session);

    thumbnailObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting))
            scheduleThumbnailVisibilityCheck();
    }, {root: null, rootMargin: "0px", threshold: 0});

    slots.forEach(slot => thumbnailObserver.observe(slot));
    window.addEventListener("scroll", scheduleThumbnailVisibilityCheck, {passive: true});
    window.addEventListener("resize", scheduleThumbnailVisibilityCheck);
}

let mediumItems = [];
let mediumQueue = [];
let mediumLoading = false;
let mediumLoadSession = 0;

function stopMediumLoading() {
    mediumLoadSession++;
    mediumQueue = [];
    mediumLoading = false;
}

function rebuildMediumQueue(prioritizeVisible = false, includeFailed = true) {
    const eligible = mediumItems.filter(item => {
        if (!item || item.mediumLoaded || item.mediumLoading)
            return false;
        const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
        if (!thumbnail || !thumbnail.loaded)
            return false;
        return !!item.src || item.source === "telegram";
    });

    const failed = eligible.filter(item => item.mediumFailed);
    const normal = eligible.filter(item => !item.mediumFailed);

    if (!prioritizeVisible) {
        mediumQueue = normal.sort((a, b) => a.index - b.index);
        if (includeFailed)
            mediumQueue.push(...failed.sort((a, b) => a.index - b.index));
        return;
    }

    const visible = new Set(getVisibleThumbnailSlots()
        .map(slot => Number(slot.dataset.index)));
    const visibleItems = normal.filter(item => visible.has(item.index));
    const remaining = normal.filter(item => !visible.has(item.index));
    mediumQueue = visibleItems.sort((a, b) => a.index - b.index)
        .concat(remaining.sort((a, b) => a.index - b.index));
    if (includeFailed)
        mediumQueue.push(...failed.sort((a, b) => a.index - b.index));
}

function loadMedium(item, session) {
    return new Promise(resolve => {
        if (!item || item.mediumLoaded || item.mediumLoading || session !== mediumLoadSession) {
            resolve();
            return;
        }

        const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
        if (!thumbnail || !thumbnail.loaded) {
            resolve();
            return;
        }

        const img = item.mediumImage;
        if (!img) {
            resolve();
            return;
        }

        item.mediumLoading = true;
        item.mediumFailed = false;

        const finish = success => {
            img.onload = null;
            img.onerror = null;
            item.mediumLoading = false;
            if (session !== mediumLoadSession) {
                resolve();
                return;
            }

            if (success) {
                item.mediumLoaded = true;
                item.mediumFailed = false;
                img.style.visibility = "visible";
                img.style.opacity = "1";

                thumbnail.mediumSrc = item.src;
                thumbnail.fullSrc = getImageURLs(item.image).full;
                thumbnail.mediumLoaded = true;
                thumbnail.mediumImage = img;
                thumbnail.mediumBlobURL = item.mediumBlobURL || item.src;

                if (thumbnail.slot) {
                    const thumbImg = thumbnail.img;
                    if (thumbImg && img.src) {
                        thumbImg.style.visibility = "hidden";
                        thumbImg.style.opacity = "0";
                    }
                }
            } else {
                item.mediumLoaded = false;
                item.mediumFailed = true;
                img.removeAttribute("src");
                noteImageFailure();
                console.debug("[MEDIUM] Failed; deferred for retry", {
                    index: item.index,
                    source: item.source,
                    url: item.src || null
                });
            }
            resolve();
        };

        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        resolveImageAsset(item, "medium", () => session === mediumLoadSession)
            .then(url => {
                if (!url || session !== mediumLoadSession) {
                    finish(false);
                    return;
                }
                item.src = url;
                item.mediumBlobURL = url;
                img.src = url;
            })
            .catch(error => {
                console.debug("[MEDIUM] Asset resolution failed", {
                    index: item.index,
                    source: item.source,
                    errorName: error?.name,
                    errorMessage: error?.message
                });
                finish(false);
            });
    });
}

async function processMediumQueue(session) {
    if (mediumLoading || thumbnailPriorityPaused || session !== mediumLoadSession)
        return;

    mediumLoading = true;

    while (mediumQueue.length && session === mediumLoadSession && !thumbnailPriorityPaused) {
        const item = mediumQueue.shift();
        if (!item || item.mediumLoaded || item.mediumLoading)
            continue;

        const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
        if (!thumbnail || !thumbnail.loaded)
            continue;

        if (item.mediumFailed) {
            mediumQueue.push(item);
            if (!mediumQueue.some(entry => entry && !entry.mediumLoaded && !entry.mediumLoading && !entry.mediumFailed))
                break;
            continue;
        }

        await loadMedium(item, session);
    }

    mediumLoading = false;

    if (thumbnailPriorityPaused || session !== mediumLoadSession)
        return;

    const remainingNormal = mediumItems.some(item => {
        const thumbnail = item && thumbnailItems.find(entry => entry.index === item.index);
        return item && thumbnail?.loaded && !item.mediumLoaded && !item.mediumLoading && !item.mediumFailed;
    });

    if (remainingNormal) {
        rebuildMediumQueue(false, true);
        processMediumQueue(session);
        return;
    }

    if (mediumItems.some(item => item && !item.mediumLoaded && item.mediumFailed)) {
        imageRetryPending = true;
        scheduleImageRetry();
    }
}

function prioritizeVisibleMediums() {
    if (thumbnailPriorityPaused)
        return;
    mediumItems.forEach(item => {
        if (item && item.mediumFailed)
            item.mediumFailed = false;
    });
    rebuildMediumQueue(true, true);
    processMediumQueue(mediumLoadSession);
}

function startMediumLoading() {
    if (mediumLoading)
        return;

    stopMediumLoading();
    const session = mediumLoadSession;
    if (!mediumItems.length)
        return;

    rebuildMediumQueue(false, true);
    processMediumQueue(session);
}

function findMediumItem(src) {
    if (!src)
        return null;
    return mediumItems.find(item => item && (item.mediumSrc === src || item.src === src)) || null;
}

function markMediumItemLoaded(url, image, blobURL = null) {
    if (!url)
        return null;
    const item = findMediumItem(url);
    if (!item)
        return null;

    item.mediumLoaded = true;
    item.mediumFailed = false;
    item.mediumLoading = false;
    item.mediumImage = image || item.mediumImage;
    item.mediumBlobURL = blobURL || item.mediumBlobURL;

    const thumbnail = thumbnailItems.find(entry => entry.index === item.index);
    if (thumbnail) {
        thumbnail.mediumLoaded = true;
        thumbnail.mediumImage = item.mediumImage;
        thumbnail.mediumBlobURL = item.mediumBlobURL;
        thumbnail.mediumSrc = blobURL || url;
        if (thumbnail.slot && thumbnail.img) {
            thumbnail.img.style.visibility = "hidden";
            thumbnail.img.style.opacity = "0";
        }
    }

    mediumQueue = mediumQueue.filter(queueItem => queueItem !== item);
    return item;
}

let fullImageLoading = false;
let fullImageLoaded = false;
let displayingFull = false;

let modalTemporaryMedium = false;
let modalMediumTimer = null;

const minZoom = 1;
const maxZoom = 5;
const zoomStep = 0.25;
const zoomTargetStrength = 1.85;
const imagePanBoundaryMultiplier = 1;

const autoResolutionSwitch = true;
const autoResolutionSwitchDelay = 400;
const autoResolutionSwitchRatio = 0.10;

const resolutionSwitchOnZoom = true;
const resolutionSwitchOnPan = false;
const resolutionSwitchDelay = 100;
const resolutionSwitchRatio = 0.10;

let centerAnimationFrame = null;

let centerReturnTimer = null;
let centerReturnAnimation = null;
const centerAnimationDuration = 3000;
const centerAnimationThreshold = 0.50;

let zoomEndTimer = null

    let zoomLevelTimer = null;
const zoomLevelDisplay = document.getElementById("zoomLevel");

const fullSwitchZoom =
    minZoom +
    (maxZoom - minZoom) *
    autoResolutionSwitchRatio;

const resolutionSwitchZoom =
    minZoom +
    (maxZoom - minZoom) *
    resolutionSwitchRatio;

let fullSwitchTimer = null;

let interactingWithImage = false;
let zoomSwitchedFromFull = false;
let panStartedInFull = false;

async function load(url, name, loadID) {

	if (!url)
		return;

	if (name === "full") {

		if (fullImageLoading)
			return;

		fullImageLoading =
			true;

	}

	const loadingBar =
		document.getElementById(
			"modalLoadingBar");

	const loadingProgress =
		document.getElementById(
			"modalLoadingProgress");

	const showLoadingBar = (
		resetProgress = true) => {

		if (loadingBar) {

			loadingBar.style.opacity =
				"1";

		}

		if (
			resetProgress &&
			loadingProgress) {

			loadingProgress.style.width =
				"0%";

		}

	};

	const hideLoadingBar = () => {

		if (loadingBar) {

			loadingBar.style.opacity =
				"0";

		}

	};

	if (
		name === "medium" ||
		name === "full") {

		if (loadingBar) {

			loadingBar.style.opacity =
				"0";

		}

		if (loadingProgress) {

			loadingProgress.style.width =
				"0%";

		}

	}

	const controller =
		new AbortController();

	activeImageLoaders.push(controller);

	const removeLoader = () => {

		const index =
			activeImageLoaders.indexOf(controller);

		if (index !== -1) {

			activeImageLoaders.splice(
				index,
				1);

		}

	};

	try {

		const response =
			await fetch(
				url, {
				signal:
				controller.signal
			});

		if (!response.ok) {

			throw new Error(
				`HTTP ${response.status} ${response.statusText}`);

		}

		const total =
			Number(
				response.headers.get(
					"Content-Length")) || 0;

		const reader =
			response.body.getReader();

		const chunks =
			[];

		let received =
			0;

		let chunkCount =
			0;

		while (true) {

			const {
				done,
				value
			} =
				await reader.read();

			if (done)
				break;

			chunkCount++;

			chunks.push(value);

			received +=
				value.length;

			if (
				chunkCount === 1 &&
				isModalLoadActive(loadID) &&
				loadingBar) {

				const downloadComplete =
					total &&
					received >= total;

				if (!downloadComplete) {

					showLoadingBar();

				}

			}

			if (
				isModalLoadActive(loadID) &&
				loadingProgress) {

				if (total) {

					const percent =
						Math.min(
							100,
							(
								received /
								total
							) * 100);

					loadingProgress.style.width =
						`${percent}%`;

				} else {

					const pseudoPercent =
						10 +
						(
							(
								received /
								(
									received +
									1024 * 1024
								)
							) * 80
						);

					loadingProgress.style.width =
						`${Math.min(
							90,
							pseudoPercent
						)}%`;

				}

			}

		}

		if (
			isModalLoadActive(loadID) &&
			loadingProgress) {

			loadingProgress.style.width =
				"100%";

		}

		const blob =
			new Blob(
				chunks, {
				type:
					response.headers.get(
						"Content-Type") ||
					"image/jpeg"
			});

		const blobURL =
			URL.createObjectURL(blob);

		if (!isModalLoadActive(loadID)) {

			URL.revokeObjectURL(blobURL);

			if (name === "full") {

				fullImageLoading =
					false;

			}

			return;

		}

		const decodedImage =
			new Image();

		decodedImage.src =
			blobURL;

		await new Promise(
			(
				resolve,
				reject) => {

				decodedImage.onload =
					resolve;

				decodedImage.onerror =
					reject;

			});

		if (decodedImage.decode) {

			try {

				await decodedImage.decode();

			} catch {}

		}

		if (!isModalLoadActive(loadID)) {

			URL.revokeObjectURL(blobURL);

			if (name === "full") {

				fullImageLoading =
					false;

			}

			return;

		}

		if (name === "thumb") {

			if (modalImgSmall) {

				modalImgSmall.src =
					blobURL;

				resizeThumb(modalImgSmall);

				modalImgSmall.style.visibility =
					"visible";

				modalImgSmall.style.zIndex =
					"4";

			}

			if (modalMediumSrc) {

				load(
					modalMediumSrc,
					"medium",
					loadID);

			} else if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

			return;

		}

		if (name === "medium") {

            if (modalRetry && modalRetry.loadID === loadID && modalRetry.name === name)
                modalRetry = null;

			if (!modalImgMedium) {

				modalMediumLoading =
					false;

				return;

			}

			const registeredMedium =
				markMediumItemLoaded(url,
					decodedImage,
					blobURL);

			modalImgMedium.style.visibility =
				"hidden";

			modalImgMedium.style.opacity =
				"1";

			modalImgMedium.style.zIndex =
				"3";

			modalImgMedium.src =
				blobURL;

			if (
				decodedImage &&
				decodedImage.naturalWidth &&
				decodedImage.naturalHeight
			) {

				const wW =
					window.innerWidth;

				const wH =
					window.innerHeight;

				const iW =
					decodedImage.naturalWidth;

				const iH =
					decodedImage.naturalHeight;

				const scale =
					Math.min(
						wW / iW,
						wH / iH
					);

				modalImgMedium.style.width =
					`${iW * scale}px`;

				modalImgMedium.style.height =
					`${iH * scale}px`;

			}

			modalMediumLoaded =
				true;

			modalMediumLoading =
				false;

			modalMediumImage =
				decodedImage;

			displayingFull =
				false;

			modalImgMedium.dataset.showingFull =
				"false";

			modalImgMedium.style.visibility =
				"visible";

			modalImgMedium.style.opacity =
				"1";

			modalImgMedium.style.filter =
				"none";

			modalImgMedium.style.zIndex =
				"3";

			if (modalImgSmall) {

				modalImgSmall.style.visibility =
					"hidden";

				modalImgSmall.style.opacity =
					"0";

			}

			if (modalImgFull) {

				modalImgFull.style.visibility =
					"hidden";

				modalImgFull.style.zIndex =
					"2";

			}

			applyTransform();

			if (loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

			if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID
				);

			} else {

				setTimeout(
					() => {

						if (
							isModalLoadActive(loadID) &&
							!fullImageLoading
						) {

							hideLoadingBar();

						}

					},
					250
				);

			}

			return;

		}

		if (name === "full") {

            if (modalRetry && modalRetry.loadID === loadID && modalRetry.name === name)
                modalRetry = null;

			if (!modalImgFull) {

				fullImageLoading =
					false;

				hideLoadingBar();

				return;

			}

			modalImgFull.src =
				blobURL;

			modalImgFull.style.visibility =
				"hidden";

			modalImgFull.style.opacity =
				"1";

			modalImgFull.style.filter =
				"none";

			fullImageLoaded =
				true;

			modalFullLoaded =
				true;

			fullImageLoading =
				false;

			if (loadingProgress) {

				loadingProgress.style.width =
					"100%";

			}

			setTimeout(
				() => {

				if (
					isModalLoadActive(loadID) &&
					!fullImageLoading) {

					hideLoadingBar();

				}

			},
				300);

			if (loadingTimer) {

				clearTimeout(loadingTimer);

				loadingTimer =
					null;

			}

			if (modalLoading) {

				modalLoading.classList.remove(
					"active");

				modalLoading.style.opacity =
					"0";

			}

			if (!modalMediumSrc) {

				imgResize(modalImgFull);

				modalImgFull.style.left =
					"50%";

				modalImgFull.style.top =
					"50%";

				modalImgFull.style.visibility =
					"visible";

				modalImgFull.style.zIndex =
					"3";

				displayingFull =
					true;

				modalImgFull.dataset.showingFull =
					"true";

				if (modalImgSmall) {

					modalImgSmall.style.visibility =
						"hidden";

					modalImgSmall.style.opacity =
						"0";

				}

				applyTransform();

				return;

			}

			if (modalImgMedium) {

				modalImgFull.style.width =
					modalImgMedium.style.width;

				modalImgFull.style.height =
					modalImgMedium.style.height;

			}

			modalImgFull.style.left =
				"50%";

			modalImgFull.style.top =
				"50%";

			modalImgFull.style.visibility =
				"hidden";

			applyTransform();

			if (
				!displayingFull &&
				!imgDragging &&
				!interactingWithImage &&
				!manualFullEnabled) {

				const wantsFull =
					autoResolutionSwitch &&
					imgTransform.scale >=
					fullSwitchZoom;

				if (wantsFull) {

					if (fullSwitchTimer) {

						clearTimeout(fullSwitchTimer);

						fullSwitchTimer =
							null;

					}

					fullSwitchTimer =
						setTimeout(
							() => {

							fullSwitchTimer =
								null;

							if (
								manualFullEnabled ||
								displayingFull ||
								imgDragging ||
								interactingWithImage) {

								return;

							}

							const stillWantsFull =
								autoResolutionSwitch &&
								imgTransform.scale >=
								fullSwitchZoom;

							if (!stillWantsFull)
								return;

							switchToFull();

						},

							resolutionSwitchOnZoom
								? resolutionSwitchDelay
								: autoResolutionSwitchDelay);

				}

			}

			return;

		}

	} catch (error) {

        if (error?.name !== "AbortError") {
            noteImageFailure();
            console.debug(`[MODAL ${name.toUpperCase()}] Load failed; deferred for retry`, {
                url,
                errorName: error?.name,
                errorMessage: error?.message
            });
            modalRetry = {
                url,
                name,
                loadID
            };
        }

		if (
			error.name ===
			"AbortError") {

			if (name === "full") {

				fullImageLoading =
					false;

			}

			if (name === "medium") {

				modalMediumLoading =
					false;

			}

			return;

		}

		if (!isModalLoadActive(loadID)) {

			if (name === "full") {

				fullImageLoading =
					false;

			}

			if (name === "medium") {

				modalMediumLoading =
					false;

			}

			return;

		}

		if (name === "full") {

			fullImageLoading =
				false;

			fullImageLoaded =
				false;

			modalFullLoaded =
				false;

		}

		hideLoadingBar();

		if (loadingProgress) {

			loadingProgress.style.width =
				"0%";

		}

		if (modalLoading) {

			modalLoading.classList.remove(
				"active");

			modalLoading.style.opacity =
				"0";

		}

		if (name === "medium") {

			modalMediumLoaded =
				false;

			modalMediumLoading =
				false;

			if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

			return;

		}

		if (name === "full") {

			if (
				modalMediumSrc &&
				modalMediumLoaded) {

				displayingFull =
					false;

				showMediumImage();

			}

			return;

		}

		if (name === "thumb") {

			if (modalMediumSrc) {

				load(
					modalMediumSrc,
					"medium",
					loadID);

			} else if (modalFullSrc) {

				load(
					modalFullSrc,
					"full",
					loadID);

			}

		}

	} finally {

		removeLoader();

	}

}

function isModalLoadActive(id) {
    return id === modalLoadID;
}

async function openModal(thumbSrc, mediumSrc, fullSrc, sourceThumb) {
	pauseThumbnailLoading();
	stopMediumLoading();

	const sourceItem =
		sourceThumb?._thumbnailItem || null;

	const mediumItem =
		findMediumItem(mediumSrc);

	const sourceMediumImage =
		(
			mediumItem &&
			mediumItem.mediumLoaded &&
			mediumItem.mediumImage
		)
			? mediumItem.mediumImage
			: null;

    const loadID =
        ++modalLoadID;

    manualFullEnabled =
        false;

    modalMediumSrc =
        mediumSrc;

    modalFullSrc =
        fullSrc;

    modalMediumLoaded =
        false;

    modalMediumLoading =
        false;

    modalMediumImage =
        null;

    modalTemporaryMedium =
        false;

    modalFullLoaded =
        false;

    modalShowingFull =
        false;

    fullImageLoading =
        false;

    fullImageLoaded =
        false;

    displayingFull =
        false;

    if (modalMediumTimer) {

        clearTimeout(modalMediumTimer);

        modalMediumTimer =
            null;

    }

    if (fullSwitchTimer) {

        clearTimeout(fullSwitchTimer);

        fullSwitchTimer =
            null;

    }

    cancelImageLoads();

    const modal =
        document.getElementById(
            "modal");

    document.documentElement.style.overflow =
        "hidden";

    document.body.style.overflow =
        "hidden";

    modalImgSmall =
        document.getElementById(
            "modalImgSmall");

    modalImgMedium =
        document.getElementById(
            "modalImgMedium");

    modalImgFull =
        document.getElementById(
            "modalImgFull");

    const loader =
        document.getElementById(
            "modalLoading");

    const fullButton =
        document.getElementById(
            "modalFullButton");

    modal.style.display =
        "flex";

	let sourceThumbRect =
		null;

	let sourceThumbSrc =
		null;

	let sourceThumbnailImage =
		null;

	if (sourceThumb) {

		sourceThumbnailImage =
			sourceThumb.querySelector(".thumbnail-image");

		if (sourceThumbnailImage) {

			const rect =
				sourceThumbnailImage.getBoundingClientRect();

			sourceThumbRect = {

				left:
					rect.left,

				top:
					rect.top,

				width:
					rect.width,

				height:
					rect.height

			};

			sourceThumbSrc =
				sourceThumbnailImage.currentSrc ||
				sourceThumbnailImage.src ||
				null;

		}

	}

    if (modalImgSmall) {

        modalImgSmall.style.visibility =
            "hidden";

        modalImgSmall.style.opacity =
            "1";

        modalImgSmall.style.zIndex =
            "4";

        modalImgSmall.style.position =
            "absolute";

        modalImgSmall.style.left =
            "50%";

        modalImgSmall.style.top =
            "50%";

        modalImgSmall.style.contain =
            "none";

        modalImgSmall.style.objectFit =
            "contain";

        modalImgSmall.style.transform =
            "translate(-50%, -50%)";

        modalImgSmall.src =
            "";

        if (
            sourceThumb &&
            sourceThumbSrc) {

            modalImgSmall.src =
                sourceThumbSrc;

            if (sourceThumbRect) {

                modalImgSmall.style.width =
                    sourceThumbRect.width +
                    "px";

                modalImgSmall.style.height =
                    sourceThumbRect.height +
                    "px";

            }

            modalImgSmall.style.visibility =
                "visible";

        }

    }

    if (modalImgMedium) {

        modalImgMedium.style.visibility =
            "hidden";

        modalImgMedium.style.opacity =
            "1";

        modalImgMedium.style.zIndex =
            "3";

        modalImgMedium.style.position =
            "absolute";

        modalImgMedium.style.left =
            "50%";

        modalImgMedium.style.top =
            "50%";

        modalImgMedium.style.contain =
            "none";

        modalImgMedium.style.objectFit =
            "contain";

    }

    if (modalImgFull) {

        modalImgFull.style.visibility =
            "hidden";

        modalImgFull.style.opacity =
            "1";

        modalImgFull.style.filter =
            "none";

        modalImgFull.style.zIndex =
            "3";

        modalImgFull.style.position =
            "absolute";

        modalImgFull.style.left =
            "50%";

        modalImgFull.style.top =
            "50%";

        modalImgFull.style.contain =
            "none";

        modalImgFull.style.objectFit =
            "contain";

        modalImgFull.style.transform =
            "translate(-50%, -50%) translate(0px, 0px) scale(1)";

        modalImgFull.src =
            "";

    }

    if (loadingTimer) {

        clearTimeout(loadingTimer);

        loadingTimer =
            null;

    }

    if (loader) {

        loader.classList.remove(
            "active");

    }

    imgTransform = {

        x:
        0,

        y:
        0,

        scale:
        minZoom

    };

    applyTransform();

    imgDragging =
        false;

    imgMoved =
        false;

    interactingWithImage =
        false;

    zoomSwitchedFromFull =
        false;

    zooming =
        false;

    zoomAnchorX =
        0;

    zoomAnchorY =
        0;

    let stage =
        -1;

    if (fullButton) {

        const hasMedium =
            !!mediumSrc;

        const hasFull =
            !!fullSrc;

        const hasMultipleResolutions =
            hasMedium &&
            hasFull;

        fullButton.style.display =
            hasMultipleResolutions
             ? "block"
             : "none";

        fullButton.disabled =
            false;

        fullButton.style.opacity =
            "0.8";

        if (!hasMultipleResolutions) {

            fullButton.onclick =
                null;

            fullButton.onpointerdown =
                null;

            fullButton.onpointerup =
                null;

        } else {

            fullButton.onclick =
                e => {

                e.stopPropagation();

                if (manualFullEnabled) {

                    manualFullEnabled =
                        false;

                    enforceAutoResolution();

                    return;

                }

                if (fullImageLoaded) {

                    manualFullEnabled =
                        true;

                    if (fullSwitchTimer) {

                        clearTimeout(fullSwitchTimer);

                        fullSwitchTimer =
                            null;

                    }

                    switchToFull();

                }

            };

            fullButton.onpointerdown =
                e => {

                e.stopPropagation();

            };

            fullButton.onpointerup =
                e => {

                e.stopPropagation();

            };

        }

    }

    function display(url,
        resize,
        newStage) {

        if (!isModalLoadActive(loadID))
            return;

        if (newStage <= stage)
            return;

        if (newStage === 2) {

            fullImageLoaded =
                true;

            modalFullLoaded =
                true;

			resumeThumbnailLoading();

            return;

        }

        stage =
            newStage;

        if (newStage === 0) {

            if (!modalImgSmall)
                return;

            modalImgSmall.src =
                url;

            resizeThumb(modalImgSmall);

            modalImgSmall.style.visibility =
                "visible";

            modalImgSmall.style.opacity =
                "1";

            modalImgSmall.style.filter =
                "none";

            modalImgSmall.style.zIndex =
                "4";

            applyTransform();

            return;

        }

		if (newStage === 1) {

			if (!modalImgMedium)
				return;

			const showMedium =
				() => {

				if (!isModalLoadActive(loadID))
					return;

				imgResize(modalImgMedium);

				modalMediumLoaded =
					true;

				displayingFull =
					false;

				modalImgMedium.dataset.showingFull =
					"false";

				modalImgMedium.style.visibility =
					"visible";

				modalImgMedium.style.opacity =
					"1";

				modalImgMedium.style.zIndex =
					"3";

				if (modalImgSmall) {

					modalImgSmall.style.visibility =
						"hidden";

					modalImgSmall.style.opacity =
						"0";

				}

				showMediumImage();

				applyTransform();

				if (loadingTimer) {

					clearTimeout(loadingTimer);

					loadingTimer =
						null;

				}

				if (loader) {

					loader.classList.remove("active");

				}

				if (!fullSrc) {

					resumeThumbnailLoading();

				}

			};

			modalImgMedium.src =
				url;

			if (
				modalImgMedium.complete &&
				modalImgMedium.naturalWidth > 0
			) {

				showMedium();

			} else {

				modalImgMedium.onload =
					() => {

					modalImgMedium.onload =
						null;

					showMedium();

				};

				modalImgMedium.onerror =
					() => {

					modalImgMedium.onload =
						null;

				};

			}

		}

    }

    modal.addEventListener(
        "wheel",
        imgZoom, {
        passive: false
    });

    modal.addEventListener(
        "pointerdown",
        imgPan);

    modal.addEventListener(
        "pointermove",
        panImage);

    modal.addEventListener(
        "pointerup",
        imgPanEnd);

    modal.addEventListener(
        "pointercancel",
        imgPanEnd);

    modal.addEventListener(
        "touchstart",
        e => {

        if (e.touches.length === 2) {

            e.preventDefault();

            lastPinchDistance =
                getPinchDistance(
                    e.touches);

        }

    }, {
        passive: false
    });

    modal.addEventListener(
        "touchmove",
        e => {

        if (e.touches.length === 2) {

            e.preventDefault();

            const distance =
                getPinchDistance(
                    e.touches);

            const change =
                distance -
                lastPinchDistance;

            imgTransform.scale =
                clamp(
                    imgTransform.scale +
                    change * 0.005,

                    minZoom,
                    maxZoom);

            lastPinchDistance =
                distance;

            applyTransform();

            const img =
                displayingFull
                 ? modalImgFull
                 : modalImgMedium;

            if (img)
                constrainImage(img);

        }

    }, {
        passive: false
    });

    modal.addEventListener(
        "touchend",
        e => {

        if (e.touches.length < 2)
            lastPinchDistance =
                0;

    });

	if (modalImgFull) {

		modalImgFull.addEventListener(
			"load",
			() => {

				if (
					!isModalLoadActive(loadID)
				) {

					return;

				}

				fullImageLoaded =
					true;

				modalFullLoaded =
					true;

				resumeThumbnailLoading();

			},
			{
				once:
					true
			}
		);

	}

    if (sourceItem && !sourceItem.loaded) {
        let thumbnailURL = null;
        try {
            thumbnailURL = await forceLoadThumbnail(sourceItem);
        } catch (error) {
            console.debug("[MODAL THUMBNAIL] Asset resolution failed", {
                index: sourceItem.index,
                source: sourceItem.source,
                errorName: error?.name,
                errorMessage: error?.message
            });
        }

        if (!thumbnailURL && isModalLoadActive(loadID)) {
            sourceItem.thumbnailFailed = true;
            noteImageFailure();
            console.debug("[MODAL THUMBNAIL] Failed; medium/full deferred until thumbnail succeeds", {
                index: sourceItem.index,
                source: sourceItem.source
            });
            modalRetry = {
                name: "open",
                loadID,
                thumbSrc: sourceItem.source === "telegram" ? "" : getImageURLs(sourceItem.image).thumb,
                mediumSrc: sourceItem.source === "telegram" ? "" : getImageURLs(sourceItem.image).medium,
                fullSrc: sourceItem.source === "telegram" ? "" : getImageURLs(sourceItem.image).full,
                slot: sourceThumb
            };
            return;
        }
    }

    if (sourceMediumImage) {
        modalMediumLoaded = true;
        modalMediumLoading = false;
        modalMediumImage = sourceMediumImage;
        display(sourceMediumImage.src, true, 1);
        if (fullSrc)
            load(fullSrc, "full", loadID);
        else
            resumeThumbnailLoading();
    } else if (sourceItem?.image) {
        const knownMediumItem = mediumItems.find(item => item && item.index === sourceItem.index);
        let medium = knownMediumItem?.mediumLoaded
            ? knownMediumItem.mediumBlobURL || knownMediumItem.src
            : null;
        if (!medium) {
            try {
                medium = await resolveImageAsset(sourceItem, "medium", () => isModalLoadActive(loadID));
            } catch {}
        }
        if (medium && isModalLoadActive(loadID)) {
            if (knownMediumItem)
                knownMediumItem.src = medium;
            modalMediumSrc = medium;
            let full = null;
            try {
                full = await resolveImageAsset(sourceItem, "full", () => isModalLoadActive(loadID));
            } catch {}
            modalFullSrc = full || medium;
            load(medium, "medium", loadID);
        } else if (fullSrc) {
            load(fullSrc, "full", loadID);
        } else {
            if (isModalLoadActive(loadID)) {
                noteImageFailure();
                modalRetry = {
                    url: mediumSrc || fullSrc,
                    name: mediumSrc ? "medium" : "full",
                    loadID
                };
            }
            resumeThumbnailLoading();
        }
    } else if (mediumSrc) {
        load(mediumSrc, "medium", loadID);
    } else if (fullSrc) {
        load(fullSrc, "full", loadID);
    } else {
        resumeThumbnailLoading();
    }

}
function closeModal(resumeGallery = true) {

	modalLoadID++;
    modalRetry = null;

	cancelImageLoads();

	fullImageLoading =
		false;

	modalMediumLoading =
		false;

	if (
		resumeGallery
	) {

		thumbnailPriorityPaused =
			false;

		processThumbnailQueue(thumbnailLoadSession);

	}

	const modal =
		document.getElementById("modal");

	document.documentElement.style.overflow =
		"";

	document.body.style.overflow =
		"";

	const mediumImg =
		document.getElementById("modalImgMedium");

	const fullImg =
		document.getElementById("modalImgFull");

	const loader =
		document.getElementById("modalLoading");

	modal.style.display =
		"none";

	if (mediumImg) {

		mediumImg.src =
			"";

		mediumImg.style.width =
			"";

		mediumImg.style.height =
			"";

		mediumImg.style.transform =
			"none";

		mediumImg.style.visibility =
			"hidden";

	}

	if (fullImg) {

		fullImg.src =
			"";

		fullImg.style.width =
			"";

		fullImg.style.height =
			"";

		fullImg.style.transform =
			"none";

		fullImg.style.visibility =
			"hidden";

	}

	if (loader) {

		loader.classList.remove(
			"active");

	}

	const loadingBar =
		document.getElementById(
			"modalLoadingBar");

	const loadingProgress =
		document.getElementById(
			"modalLoadingProgress");

	if (loadingBar) {

		loadingBar.style.opacity =
			"0";

	}

	if (loadingProgress) {

		loadingProgress.style.width =
			"0%";

	}

	if (loadingTimer) {

		clearTimeout(loadingTimer);

		loadingTimer =
			null;

	}

	imgTransform = {
		x: 0,
		y: 0,
		scale: minZoom
	};

}

window.addEventListener("resize", () => {

    const modal =
        document.getElementById("modal");

    if (
        !modal ||
        modal.style.display === "none") {

        return;

    }

    let img = null;

    if (displayingFull) {

        img =
            modalImgFull;

    } else if (
        modalMediumLoaded &&
        modalImgMedium &&
        modalImgMedium.style.visibility !==
        "hidden") {

        img =
            modalImgMedium;

    } else if (modalImgSmall) {

        img =
            modalImgSmall;

    }

    if (!img)
        return;

    if (img === modalImgSmall) {

        resizeThumb(img);

    } else {

        imgResize(img);

    }

    applyTransform();

    constrainImage(img);

});

let imgDragging = false;
let dragStart = {};
let imgTransform = {
    x: 0,
    y: 0,
    scale: minZoom
};

let imgMoved = false;

initAlbums();

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function applyTransform() {

    const transform =
        `translate(-50%, -50%) ` +
        `translate(${imgTransform.x}px, ${imgTransform.y}px) ` +
`scale(${imgTransform.scale})`;

    if (modalImgMedium) {
        modalImgMedium.style.transform =
            transform;
    }

    if (modalImgFull) {
        modalImgFull.style.transform =
            transform;
    }

    const visibleImg =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (visibleImg) {

    }

}

const zoomAnchorDuration = 150;

function getBounds(img) {

    if (!img) {
        return {
            x: 0,
            y: 0
        };
    }

    const rect =
        img.getBoundingClientRect();

    const width =
        rect.width;

    const height =
        rect.height;

    const viewportWidth =
        window.innerWidth;

    const viewportHeight =
        window.innerHeight;

    const halfWidth =
        width / 2;

    const halfHeight =
        height / 2;

    const halfViewportWidth =
        viewportWidth / 2;

    const halfViewportHeight =
        viewportHeight / 2;

    const normalX =
        halfWidth +
        halfViewportWidth
         -
        Math.min(halfWidth,
            halfViewportWidth);

    const normalY =
        halfHeight +
        halfViewportHeight
         -
        Math.min(halfHeight,
            halfViewportHeight);

    const edgeX =
        Math.abs(
            halfWidth -
            halfViewportWidth);

    const edgeY =
        Math.abs(
            halfHeight -
            halfViewportHeight);

    const multiplier =
        Number.isFinite(imagePanBoundaryMultiplier)
         ? imagePanBoundaryMultiplier
         : 1;

    const amount =
        clamp(
            (multiplier - 1) / 0.5,
            0,
            1);

    const maximumX =
        halfWidth;

    const maximumY =
        halfHeight;

    return {

        x:
        edgeX +
        (maximumX - edgeX) *
        amount,

        y:
        edgeY +
        (maximumY - edgeY) *
        amount

    };

}

function endZoomGesture() {

    if (zoomEndTimer) {

        clearTimeout(zoomEndTimer);

    }

    zoomEndTimer =
        setTimeout(() => {

            zooming = false;

            zoomEndTimer = null;

            if (!autoResolutionSwitch)
                return;

            if (manualFullEnabled)
                return;

            const autoWantsFull =
                imgTransform.scale >=
                fullSwitchZoom;

            if (!autoWantsFull) {

                if (
                    displayingFull &&
                    modalMediumLoaded) {

                    switchToMedium();

                }

                zoomSwitchedFromFull =
                    false;

                return;

            }

            if (
                resolutionSwitchOnZoom &&
                zoomSwitchedFromFull &&
                fullImageLoaded &&
                modalMediumLoaded &&
                !displayingFull) {

                zoomSwitchedFromFull =
                    false;

                if (fullSwitchTimer) {

                    clearTimeout(fullSwitchTimer);

                    fullSwitchTimer =
                        null;

                }

                fullSwitchTimer =
                    setTimeout(() => {

                        fullSwitchTimer =
                            null;

                        if (
                            manualFullEnabled ||
                            !autoResolutionSwitch ||
                            !fullImageLoaded ||
                            imgDragging ||
                            interactingWithImage ||
                            displayingFull) {

                            return;

                        }

                        if (
                            imgTransform.scale <
                            fullSwitchZoom) {

                            return;

                        }

                        switchToFull();

                    }, resolutionSwitchDelay);

                return;

            }

            if (
                !displayingFull &&
                fullImageLoaded &&
                !imgDragging &&
                !interactingWithImage) {

                switchToFull();

            }

        }, resolutionSwitchDelay);

}

function imgZoom(e) {

    e.preventDefault();

    const img =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (!img)
        return;

    const oldScale =
        Number.isFinite(imgTransform.scale)
         ? imgTransform.scale
         : minZoom;

    const direction =
        e.deltaY < 0
         ? 1
         : -1;

    const rect =
        img.getBoundingClientRect();

    const unscaledWidth =
        rect.width /
        oldScale;

    const unscaledHeight =
        rect.height /
        oldScale;

    const widthScale =
        window.innerWidth /
        unscaledWidth;

    const heightScale =
        window.innerHeight /
        unscaledHeight;

    const firstZoomScale =
        Math.max(widthScale,
            heightScale);

    let newScale;

    if (
        direction > 0 &&
        oldScale < firstZoomScale) {

        newScale =
            clamp(firstZoomScale,
                minZoom,
                maxZoom);

    } else {

        newScale =
            clamp(
                oldScale +
                direction * zoomStep,
                minZoom,
                maxZoom);

    }

    if (newScale === oldScale)
        return;

    const imageCenterX =
        rect.left +
        rect.width / 2;

    const imageCenterY =
        rect.top +
        rect.height / 2;

    const mouseOffsetX =
        e.clientX -
        imageCenterX;

    const mouseOffsetY =
        e.clientY -
        imageCenterY;

    const ratio =
        newScale /
        oldScale;

    const viewportCenterX =
        window.innerWidth / 2;

    const viewportCenterY =
        window.innerHeight / 2;

    const newCenterX =
        e.clientX -
        mouseOffsetX * ratio;

    const newCenterY =
        e.clientY -
        mouseOffsetY * ratio;

    let newX =
        newCenterX -
        viewportCenterX;

    let newY =
        newCenterY -
        viewportCenterY;

    const newWidth =
        unscaledWidth *
        newScale;

    const newHeight =
        unscaledHeight *
        newScale;

    const halfWidth =
        newWidth / 2;

    const halfHeight =
        newHeight / 2;

    const halfViewportWidth =
        window.innerWidth / 2;

    const halfViewportHeight =
        window.innerHeight / 2;

    const edgeX =
        Math.abs(
            halfWidth -
            halfViewportWidth);

    const edgeY =
        Math.abs(
            halfHeight -
            halfViewportHeight);

    const maximumX =
        halfWidth;

    const maximumY =
        halfHeight;

    const multiplier =
        Number.isFinite(imagePanBoundaryMultiplier)
         ? imagePanBoundaryMultiplier
         : 1;

    const boundaryAmount =
        clamp(
            (multiplier - 1) / 0.5,
            0,
            1);

    const boundsX =
        edgeX +
        (maximumX - edgeX) *
        boundaryAmount;

    const boundsY =
        edgeY +
        (maximumY - edgeY) *
        boundaryAmount;

    newX =
        clamp(
            newX,
            -boundsX,
            boundsX);

    newY =
        clamp(
            newY,
            -boundsY,
            boundsY);

    imgTransform.x =
        Number.isFinite(newX)
         ? newX
         : imgTransform.x;

    imgTransform.y =
        Number.isFinite(newY)
         ? newY
         : imgTransform.y;

    imgTransform.scale =
        newScale;

    if (
        newScale <
        firstZoomScale) {

        scheduleCenterReturn();

    } else {

        cancelCenterReturn();

    }

    applyTransform();

    if (
        typeof showZoomLevel ===
        "function") {

        showZoomLevel();

    }

    if (manualFullEnabled)
        return;

    if (autoResolutionSwitch) {

        if (
            newScale <
            fullSwitchZoom) {

            if (fullSwitchTimer) {

                clearTimeout(fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

            if (
                displayingFull &&
                modalMediumLoaded) {

                switchToMedium();

            }

        } else {

            if (
                !displayingFull &&
                fullImageLoaded &&
                !imgDragging &&
                !interactingWithImage) {

                if (fullSwitchTimer) {

                    clearTimeout(fullSwitchTimer);

                    fullSwitchTimer =
                        null;

                }

                fullSwitchTimer =
                    setTimeout(() => {

                        fullSwitchTimer =
                            null;

                        if (
                            manualFullEnabled ||
                            !autoResolutionSwitch ||
                            !fullImageLoaded ||
                            displayingFull ||
                            imgDragging ||
                            interactingWithImage) {

                            return;

                        }

                        if (
                            imgTransform.scale >=
                            fullSwitchZoom) {

                            switchToFull();

                        }

                    }, autoResolutionSwitchDelay);

            }

        }

    }

    if (
        resolutionSwitchOnZoom &&
        autoResolutionSwitch &&
        displayingFull &&
        modalMediumLoaded &&
        newScale >= resolutionSwitchZoom) {

        if (fullSwitchTimer) {

            clearTimeout(fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        zoomSwitchedFromFull =
            true;

        switchToMedium();

    }

    if (
        typeof endZoomGesture ===
        "function") {

        endZoomGesture();

    }

}

function imgPan(e) {

if (e.button !== 0)
    return;

if (
    e.target.closest &&
    (
        e.target.closest("#modalFullButton") ||
        e.target.closest("button"))) {

    return;

}

e.preventDefault();

const startedInFull =
    displayingFull &&
    !manualFullEnabled &&
    fullImageLoaded &&
    modalMediumLoaded;

panStartedInFull =
    startedInFull &&
    resolutionSwitchOnPan;

if (fullSwitchTimer) {

    clearTimeout(fullSwitchTimer);

    fullSwitchTimer = null;

}

const img =
    displayingFull
     ? modalImgFull
     : modalImgMedium;

if (!img)
    return;

if (
    startedInFull &&
    resolutionSwitchOnPan) {

    switchToMedium();

}

const panImg =
    displayingFull
     ? modalImgFull
     : modalImgMedium;

if (!panImg)
    return;

cancelCenterReturn();

interactingWithImage =
    true;

imgDragging =
    true;

imgMoved =
    false;

dragStart = {

    x: e.clientX,
    y: e.clientY,

    imgX: imgTransform.x,
    imgY: imgTransform.y

};

try {

    modal.setPointerCapture(
        e.pointerId);

} catch {}

}

function panImage(e) {

    if (!imgDragging || !dragStart)
        return;

    const img =
        displayingFull
         ? modalImgFull
         : modalImgMedium;

    if (!img)
        return;

    const dx =
        e.clientX -
        dragStart.x;

    const dy =
        e.clientY -
        dragStart.y;

    if (
        Math.abs(dx) > 5 ||
        Math.abs(dy) > 5) {

        imgMoved = true;

    }

    const bounds =
        getBounds(img);

    imgTransform.x =
        clamp(
            dragStart.imgX + dx,
            -bounds.x,
            bounds.x);

    imgTransform.y =
        clamp(
            dragStart.imgY + dy,
            -bounds.y,
            bounds.y);

    applyTransform();

}

function imgPanEnd(e) {

    if (!imgDragging)
        return;

    imgDragging =
        false;

    interactingWithImage =
        false;

    try {

        if (
            modal.hasPointerCapture(
                e.pointerId)) {

            modal.releasePointerCapture(
                e.pointerId);

        }

    } catch {}

    if (!imgMoved) {

        dragStart =
            null;

        panStartedInFull =
            false;

        closeModal();

        return;

    }

    dragStart =
        null;

    const autoWantsFull =
        autoResolutionSwitch &&
        imgTransform.scale >=
        fullSwitchZoom;

    if (
        panStartedInFull &&
        !manualFullEnabled &&
        resolutionSwitchOnPan &&
        fullImageLoaded &&
        modalMediumLoaded) {

        if (autoWantsFull) {

            scheduleFullRestore();

        } else {

            if (fullSwitchTimer) {

                clearTimeout(fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

        }

    }

    else if (
        !panStartedInFull &&
        !manualFullEnabled &&
        !displayingFull &&
        fullImageLoaded) {

        if (autoWantsFull) {

            if (fullSwitchTimer) {

                clearTimeout(fullSwitchTimer);

                fullSwitchTimer =
                    null;

            }

            switchToFull();

        }

    }

    panStartedInFull =
        false;

}

function scheduleFullRestore() {

    if (fullSwitchTimer) {

        clearTimeout(fullSwitchTimer);

        fullSwitchTimer = null;

    }

    if (manualFullEnabled)
        return;

    if (!resolutionSwitchOnPan)
        return;

    if (
        !fullImageLoaded ||
        !modalMediumLoaded) {

        return;

    }

    fullSwitchTimer =
        setTimeout(() => {

            fullSwitchTimer = null;

            if (
                manualFullEnabled ||
                !fullImageLoaded ||
                !modalMediumLoaded ||
                displayingFull ||
                imgDragging ||
                interactingWithImage) {

                return;

            }

            switchToFull();

        }, resolutionSwitchDelay);

}

function enforceAutoResolution() {

    if (manualFullEnabled)
        return;

    if (
        !autoResolutionSwitch ||
        !fullImageLoaded) {

        return;

    }

    if (
        imgTransform.scale <
        fullSwitchZoom) {

        if (fullSwitchTimer) {

            clearTimeout(fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        if (
            displayingFull &&
            modalMediumLoaded) {

            switchToMedium();

        }

        return;

    }

    if (
        imgTransform.scale >=
        fullSwitchZoom &&
        !displayingFull &&
        !imgDragging &&
        !interactingWithImage) {

        if (fullSwitchTimer) {

            clearTimeout(fullSwitchTimer);

            fullSwitchTimer =
                null;

        }

        fullSwitchTimer =
            setTimeout(() => {

                fullSwitchTimer =
                    null;

                if (
                    manualFullEnabled ||
                    !autoResolutionSwitch ||
                    !fullImageLoaded ||
                    displayingFull ||
                    imgDragging ||
                    interactingWithImage) {

                    return;

                }

                if (
                    imgTransform.scale >=
                    fullSwitchZoom) {

                    switchToFull();

                }

            }, autoResolutionSwitchDelay);

    }

}

function switchToFull() {

    if (
        !modalImgMedium ||
        !modalImgFull ||
        !modalFullSrc) {
        return;

    }

    if (!fullImageLoaded) {
        if (loadingTimer) {

            clearTimeout(loadingTimer);

            loadingTimer =
                null;

        }

        if (!fullImageLoading) {
			load(
				fullSrc,
				"full",
				loadID);

        }

        return;

    }

    if (loadingTimer) {

        clearTimeout(loadingTimer);

        loadingTimer =
            null;

    }

    if (modalLoading) {

        modalLoading.classList.remove(
            "active");

        modalLoading.style.opacity =
            "0";

    }

    modalImgFull.style.width =
        modalImgMedium.style.width;

    modalImgFull.style.height =
        modalImgMedium.style.height;

    modalImgFull.style.left =
        "50%";

    modalImgFull.style.top =
        "50%";

    modalImgFull.style.opacity =
        "1";

    modalImgFull.style.filter =
        "none";

    applyTransform();

    void modalImgFull.offsetWidth;

    displayingFull =
        true;

    modalImgFull.dataset.showingFull =
        "true";

    modalImgMedium.dataset.showingFull =
        "false";

    modalImgFull.style.visibility =
        "visible";

    modalImgFull.style.zIndex =
        "3";

    modalImgMedium.style.visibility =
        "hidden";

    modalImgMedium.style.opacity =
        "1";

    applyTransform();
}

function switchToMedium() {
    if (!modalImgMedium) {
        return;
    }

    if (modalImgFull) {

        modalImgMedium.style.width =
            modalImgFull.style.width;

        modalImgMedium.style.height =
            modalImgFull.style.height;

    }

    modalImgMedium.style.opacity =
        "1";

    if (modalImgFull)
        modalImgFull.style.opacity =
            "1";

    modalImgMedium.style.filter =
        "blur(4px)";

    modalImgMedium.style.visibility =
        "visible";

    applyTransform();

    requestAnimationFrame(() => {

        modalImgMedium.style.filter =
            "blur(0px)";

    });

    if (modalImgFull)
        modalImgFull.style.visibility =
            "hidden";

    displayingFull =
        false;

    modalImgMedium.dataset.showingFull =
        "false";

    setTimeout(() => {

        if (modalImgMedium) {

            modalImgMedium.style.filter =
                "none";

            modalImgMedium.style.opacity =
                "1";

        }

        if (modalImgFull) {

            modalImgFull.style.filter =
                "none";

            modalImgFull.style.opacity =
                "1";

        }

    }, 150);
}

function showMediumImage() {

    if (!modalImgMedium)
        return;

    modalImgMedium.style.visibility =
        "visible";

    if (modalImgFull)
        modalImgFull.style.visibility =
            "hidden";

    displayingFull = false;

    applyTransform();
}

function showFullImage() {

    if (
        !modalImgMedium ||
        !modalImgFull ||
        !fullImageLoaded)
        return;

    modalImgFull.style.width =
        modalImgMedium.style.width;

    modalImgFull.style.height =
        modalImgMedium.style.height;

    modalImgFull.style.left = "50%";
    modalImgFull.style.top = "50%";

    applyTransform();

    modalImgFull.style.visibility =
        "visible";

    modalImgMedium.style.visibility =
        "hidden";

    displayingFull = true;
}

function resizeThumb(elem) {

    if (
        !elem ||
        !elem.naturalWidth ||
        !elem.naturalHeight)
        return;

    const maxSize =
        Math.min(
            window.innerWidth,
            window.innerHeight) / 1.5;

    const scale =
        maxSize /
        Math.max(
            elem.naturalWidth,
            elem.naturalHeight);

    elem.style.width =
`${elem.naturalWidth * scale}px`;

    elem.style.height =
`${elem.naturalHeight * scale}px`;
}

function imgResize(elem) {

    const wH = window.innerHeight;
    const wW = window.innerWidth;

    const iH = elem.naturalHeight;
    const iW = elem.naturalWidth;

    const scale = Math.min(
            wW / iW,
            wH / iH);

    elem.style.width =
`${iW * scale}px`;

    elem.style.height =
`${iH * scale}px`;

}

function constrainImage(img) {

    if (!img)
        return;

    const bounds =
        getBounds(img);

    imgTransform.x =
        clamp(
            imgTransform.x,
            -bounds.x,
            bounds.x);

    imgTransform.y =
        clamp(
            imgTransform.y,
            -bounds.y,
            bounds.y);

}

function showZoomLevel() {

    if (!zoomLevelDisplay)
        return;

    zoomLevelDisplay.textContent =
`${parseFloat(imgTransform.scale.toFixed(2))}x`;

    zoomLevelDisplay.classList.add("visible");

    if (zoomLevelTimer) {

        clearTimeout(zoomLevelTimer);

    }

    zoomLevelTimer =
        setTimeout(() => {

            zoomLevelDisplay.classList.remove(
                "visible");

            zoomLevelTimer = null;

        }, 2000);
}

function showImage(offset) {

    if (
        !currentAlbum ||
        !currentAlbum.images ||
        !currentAlbum.images.length
    ) {
        return;
    }

    const total =
        currentAlbum.images.length;

    let index =
        currentImageIndex;

    for (let i = 0; i < total; i++) {

        index += offset;

        if (index >= total) {
            index = 0;
        }

        if (index < 0) {
            index = total - 1;
        }

        const img =
            currentAlbum.images[index];

        if (!img) {
            continue;
        }

        const isTelegramImage =
            img.source === "telegram";

        if (isTelegramImage) {

            if (!img.telegramFileID) {
                continue;
            }

        }
        else {

            const urls = getImageURLs(img);

            if (!urls.thumb) {
                continue;
            }

        }

        const thumb =
            document.querySelector(`.thumbnail-slot[data-index="${index}"]`);

        if (
            thumb &&
            getComputedStyle(thumb).display === "none"
        ) {
            continue;
        }

        currentImageIndex =
            index;

        const urls = getImageURLs(img);
        const thumbSrc = isTelegramImage ? "" : urls.thumb;
        const mediumSrc = isTelegramImage ? "" : urls.medium;
        const fullSrc = isTelegramImage ? "" : urls.full;

        scrollToCurrentThumbnail(index);
        scheduleThumbnailVisibilityCheck();
        openModal(thumbSrc, mediumSrc, fullSrc, thumb);

        return;
    }
}

function nextImage() {
    showImage(1);
}

function previousImage() {
    showImage(-1);
}

document.addEventListener("keydown", e => {

    const modal = document.getElementById("modal");

    if (modal.style.display !== "flex")
        return;

    if (e.key === "ArrowRight") {
        nextImage();
    }

    if (e.key === "ArrowLeft") {
        previousImage();
    }

});

let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let touchStartTime = 0;
let touchIsLong = false;
let touchTimer = null;
let lastPinchDistance = 0;

function getPinchDistance(touches) {

    const dx =
        touches[0].clientX -
        touches[1].clientX;

    const dy =
        touches[0].clientY -
        touches[1].clientY;

    return Math.sqrt(
        dx * dx +
        dy * dy);
}

document.addEventListener("touchstart", e => {

    const modal = document.getElementById("modal");

    if (modal.style.display !== "flex")
        return;

    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    touchStartTime = Date.now();

    touchIsLong = false;

    touchTimer = setTimeout(() => {
        touchIsLong = true;
    }, 250);

}, {
    passive: true
});

document.addEventListener("touchmove", e => {

    if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
    }

    if (touchIsLong)
        return;

}, {
    passive: true
});

document.addEventListener("touchend", e => {

    const modal = document.getElementById("modal");

    if (modal.style.display !== "flex")
        return;

    if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
    }

    if (touchIsLong)
        return;

    const elapsed = Date.now() - touchStartTime;

    if (elapsed > 300)
        return;

    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;

    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    if (Math.abs(diffY) > Math.abs(diffX))
        return;

    if (Math.abs(diffX) < 50)
        return;

    if (diffX < 0) {
        nextImage();
    } else {
        previousImage();
    }

}, {
    passive: true
});

function scrollToCurrentThumbnail(index) {

    const thumb = document.querySelector(
`.thumbnail-slot[data-index="${index}"]`);

    if (!thumb)
        return;

    const rect = thumb.getBoundingClientRect();

    const scrollY =
        window.scrollY +
        rect.top -
        (window.innerHeight / 2) +
        (rect.height / 2);

    window.scrollTo({
        top: scrollY,
        behavior: "smooth"
    });
}

function cancelImageLoads() {

    if (!activeImageLoaders)
        return;

    for (
        const controller
        of activeImageLoaders) {

        try {

            controller.abort();

        } catch {}

    }

    activeImageLoaders.length = 0;
}

window.addEventListener("popstate", async () => {

        const previousTemporaryID =
            currentTemporaryAlbumID;

        currentTemporaryAlbumID =
            null;

        const query =
            decodeURIComponent(
                location.search.substring(1)
            );

        if (
            !query
        ) {

            if (
                previousTemporaryID
            ) {

                deleteTemporaryAlbum(previousTemporaryID);

            }

            closeModal();

            await showAlbums();

            return;

        }

        if (
            query.startsWith("$")
        ) {

            if (
                previousTemporaryID
            ) {

                deleteTemporaryAlbum(previousTemporaryID);

            }

            const albumID =
                query.substring(1);

            await reloadAlbums();

            const album =
                albums.find(
                    a =>
                        a.id === albumID
                );

            if (
                album
            ) {

                closeModal();

                loadAlbum(album, false);

                return;

            }

            await showAlbums();

            return;

        }

        if (
            query.startsWith("=")
        ) {

            const albumID =
                query.substring(1);

            const album =
                getTemporaryAlbum(albumID);

            if (
                album
            ) {

                currentTemporaryAlbumID =
                    albumID;

                closeModal();

                loadAlbum(album, false);

                return;

            }

            await showAlbums();

            return;

        }

        if (
            previousTemporaryID
        ) {

            deleteTemporaryAlbum(previousTemporaryID);

        }

        const albumQuery =
            createQueryAlbum(query);

        closeModal();

        loadAlbum(albumQuery, false);

    }
);

document.getElementById("filterMode").onclick = function () {

    filterMode =
        filterMode === "any"
         ? "all"
         : "any";

    this.textContent =
        filterMode === "any"
         ? "Any"
         : "All";

    applyTagFilter();

};

function applyTagFilter() {

    if (!currentAlbum) {

        const albums =
            document.querySelectorAll(".album");

        albums.forEach(element => {

            const tags =
                (element.alt || "")
                .split(",")
                .map(t => t.trim());

            const excluded =
                [...excludedTags].some(
                    tag => tags.includes(tag)
                );

            if (excluded) {

                element.style.display =
                    "none";

                return;

            }

            if (!selectedTags.size) {

                element.style.display =
                    "";

                return;

            }

            let show;

            if (
                filterMode === "all"
            ) {

                show =
                    [...selectedTags].every(
                        tag =>
                            tags.includes(tag)
                    );

            } else {

                show =
                    [...selectedTags].some(
                        tag =>
                            tags.includes(tag)
                    );

            }

            element.style.display =
                show ? "" : "none";

        });

        updateGalleryLayout();

        return;

    }

    const slots =
        document.querySelectorAll(".thumbnail-slot");

    slots.forEach(slot => {

        const item =
            slot._thumbnailItem;

        const tags =
            item && item.tags
                ? item.tags
                : [];

        const excluded =
            [...excludedTags].some(
                tag =>
                    tags.includes(tag)
            );

        if (excluded) {

            slot.style.display =
                "none";

            return;

        }

        if (!selectedTags.size) {

            slot.style.display =
                "";

            return;

        }

        let show;

        if (
            filterMode === "all"
        ) {

            show =
                [...selectedTags].every(
                    tag =>
                        tags.includes(tag)
                );

        } else {

            show =
                [...selectedTags].some(
                    tag =>
                        tags.includes(tag)
                );

        }

        slot.style.display =
            show ? "" : "none";

    });

    updateGalleryLayout();

}

function updateGalleryLayout(animate = true) {
    applyGalleryLayout(animate);
}

function getGalleryColumnCount(
    width,
    minColumnsToUse = minColumns,
    maxColumnsToUse = maxColumns,
    minWidthToUse = minThumbWidth) {

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const columns =
        Math.floor(
            (width + gap) /
            (minWidthToUse + gap));

    return Math.max(
        minColumnsToUse,
        Math.min(maxColumnsToUse,
            columns));
}

function calculateGalleryLayout() {

    const gallery =
        document.getElementById("gallery");

    const isHomePage =
        !currentAlbum;

    const items =
        isHomePage

        ? [
            ...gallery.querySelectorAll(".album")
        ].filter(
            element =>
                getComputedStyle(element).display !== "none"
        )

        : [
            ...gallery.querySelectorAll(".thumbnail-slot")
        ].filter(
            element =>
                getComputedStyle(element).display !== "none"
        );

    const minColumnsToUse =
        isHomePage
        ? homeMinColumns
        : minColumns;

    const maxColumnsToUse =
        isHomePage
        ? homeMaxColumns
        : maxColumns;

    const minWidthToUse =
        isHomePage
        ? homeMinThumbWidth
        : minThumbWidth;

    const style =
        getComputedStyle(gallery);

    const paddingLeft =
        parseFloat(style.paddingLeft) || 0;

    const paddingRight =
        parseFloat(style.paddingRight) || 0;

    const paddingTop =
        parseFloat(style.paddingTop) || 0;

    const paddingBottom =
        parseFloat(style.paddingBottom) || 0;

    const galleryRect =
        gallery.getBoundingClientRect();

    const galleryWidth =
        galleryRect.width -
        paddingLeft -
        paddingRight;

    const columns =
        getGalleryColumnCount(galleryWidth,
            minColumnsToUse,
            maxColumnsToUse,
            minWidthToUse);

    const gap =
        window.innerWidth *
        (galleryGap / 100);

    const itemWidth =
        (
            galleryWidth -
            gap * (columns - 1)
        ) /
        columns;

    const itemHeight =
        isHomePage
        ? itemWidth *
            homeHeightMultiplier
        : itemWidth;

    const positions =
        [];

    items.forEach(
        (item, index) => {

            const column =
                index %
                columns;

            const row =
                Math.floor(
                    index /
                    columns
                );

            const left =
                paddingLeft +
                column *
                (
                    itemWidth +
                    gap
                );

            const top =
                paddingTop +
                row *
                (
                    itemHeight +
                    gap
                );

            positions.push({

                element:
                    item,

                left:
                    left,

                top:
                    top,

                width:
                    itemWidth,

                height:
                    itemHeight

            });

        }
    );

    const rows =
        items.length > 0
        ? Math.ceil(
            items.length /
            columns
        )
        : 0;

    const imageAreaHeight =
        rows > 0

        ? (
            rows *
            itemHeight +
            (
                rows - 1
            ) *
            gap
        )

        : 0;

    const requiredHeight =
        paddingTop +
        imageAreaHeight +
        paddingBottom;

    return {

        positions,

        height:
            requiredHeight,

        columns

    };

}

function applyGalleryLayout(animate = true) {

    const gallery =
        document.getElementById("gallery");

    const layout =
        calculateGalleryLayout();

    gallery.style.height =
        layout.height + "px";

    layout.positions.forEach(info => {

        const item =
            info.element;

        if (!animate) {
            item.style.transition = "none";
        }

        item.style.position = "absolute";

        item.style.left =
            info.left + "px";

        item.style.top =
            info.top + "px";

        item.style.width =
            info.width + "px";

        item.style.height =
            info.height + "px";

        if (!animate) {

            item.offsetWidth;

            item.style.transition = "";

        }

    });

    return layout;
}

const tagToggle =
    document.getElementById("tagToggle");

const tagBar =
    document.getElementById("tagBar");

tagToggle.addEventListener("click", () => {

    tagBar.classList.toggle("hidden");
    saveTagBarState();

    const startTime =
        performance.now();

    function animateTagGallery(time) {

        const elapsed =
            time - startTime;

        applyGalleryLayout(true);

        if (elapsed < 500) {

            requestAnimationFrame(animateTagGallery);

        }
    }

    requestAnimationFrame(animateTagGallery);

});

let galleryResizeCheck = null;
let lastMeasuredGalleryWidth = null;
let stableChecks = 0;

function startGalleryResizeTracking() {

    clearInterval(galleryResizeCheck);

    stableChecks = 0;
    lastMeasuredGalleryWidth = null;

    galleryResizeCheck = setInterval(() => {

        const gallery =
            document.getElementById("gallery");

        if (!gallery) {
            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;
            return;
        }

        const width =
            gallery.getBoundingClientRect().width;

        if (
            lastMeasuredGalleryWidth !== null &&
            Math.abs(
                width -
                lastMeasuredGalleryWidth) < 0.01) {

            stableChecks++;

        } else {

            stableChecks = 0;

        }

        lastMeasuredGalleryWidth = width;

        updateGalleryLayout();

        if (stableChecks >= 3) {

            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;

        }

    }, 75);
}

window.addEventListener("resize", () => {

    startGalleryResizeTracking();

});

function buildTagList(tags) {
    const tagContainer = document.getElementById("tagList");

    tagContainer.innerHTML = "";

    tags
    .sort((a, b) => a.localeCompare(b))
    .forEach(tag => {

        const btn = document.createElement("button");

        btn.className = "tag";
        btn.textContent = tag;

        btn.onclick = () => {

            if (excludedTags.has(tag)) {

                excludedTags.delete(tag);
                btn.classList.remove("excluded");

            }

            if (selectedTags.has(tag)) {

                selectedTags.delete(tag);
                btn.classList.remove("selected");

            } else {

                selectedTags.add(tag);
                btn.classList.add("selected");

            }

            clearButton.style.display =
                (selectedTags.size || excludedTags.size)
             ? ""
             : "none";

            applyTagFilter();

        };

        btn.oncontextmenu = (e) => {

            if (selectedTags.has(tag)) {

                selectedTags.delete(tag);
                btn.classList.remove("selected");

            }

            if (excludedTags.has(tag)) {

                excludedTags.delete(tag);
                btn.classList.remove("excluded");

            } else {

                excludedTags.add(tag);
                btn.classList.add("excluded");

            }

            clearButton.style.display =
                (selectedTags.size || excludedTags.size)
             ? ""
             : "none";

            applyTagFilter();

        };

        tagContainer.appendChild(btn);

    });

}

const clearButton = document.getElementById("clearTags");

clearButton.onclick = () => {

    selectedTags.clear();
    excludedTags.clear();

    document.querySelectorAll("#tagList .tag")
    .forEach(btn => {
        btn.classList.remove("selected");
        btn.classList.remove("excluded");
    });

    applyTagFilter();

    clearButton.style.display = "none";

};

const XMP = {

    getData: function (img, callback) {

        fetch(img.src)
        .then(r => r.arrayBuffer())
        .then(buffer => {

            const xmpString = findXMP(buffer);

            if (!xmpString) {
                callback.call(img, null);
                return;
            }

            img.xmpraw = xmpString;
            img.xmp = parseXMP(xmpString);
            img.xmptags = createXMPShortcuts(img.xmp);

            callback.call(img, img.xmp);

        });

    }

};

function findXMP(buffer) {

    const bytes = new Uint8Array(buffer);

    const text = new TextDecoder("utf-8")
        .decode(bytes);

    const start = text.indexOf("<x:xmpmeta");

    if (start === -1)
        return null;

    const end = text.indexOf("</x:xmpmeta>", start);

    if (end === -1)
        return null;

    return text.substring(
        start,
        end + "</x:xmpmeta>".length);

}

function parseXMP(xmpString) {

    const xml = new DOMParser()
        .parseFromString(xmpString, "application/xml");

    function cleanName(name) {

        return name.includes(":")
         ? name.split(":")[1]
         : name;

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

        for (const attr of node.attributes || []) {

            obj[cleanName(attr.name)] =
                attr.value;

        }

        if (node.children.length === 0) {

            const text = node.textContent.trim();

            return text || obj;

        }

        for (const child of node.children) {

            addChild(
                obj,
                cleanName(child.nodeName),
                parseNode(child));

        }

        return obj;

    }

    return parseNode(xml.documentElement);

}

function createXMPShortcuts(xmp) {

    const desc =
        xmp.RDF?.Description || {};

    return {

        subject:
        Array.isArray(desc.subject?.Bag?.li)
         ? desc.subject.Bag.li
         : desc.subject?.Bag?.li
         ? [desc.subject.Bag.li]
         : [],

        dimensions:
        desc.Regions?.AppliedToDimensions || null,

        faces:
        (() => {

            const faces =
                desc.Regions?.RegionList?.Bag?.li || [];

            const list =
                Array.isArray(faces)
                 ? faces
                 : [faces];

            return list.map(f => {

                const d =
                    f.Description || f;

                return {
                    name: d.Name,
                    type: d.Type,
                    area: d.Area
                };

            });

        })()

    };

}

function getAllTags() {

    const tags = new Set();

    albums.forEach(album => {

        (album.tags || []).forEach(tag => {
            tags.add(tag.toLowerCase());
        });

    });

    return [...tags];

}

const searchInput = document.getElementById("tagSearch");
const suggestionBox = document.getElementById("tagSuggestions");
let suggestions = [];
let selectedSuggestionIndex = -1;

let activeTagIndex = 0;
let previousTagIndex = 0;

function getTagParts() {

    return searchInput.value.split(",");
}

function getCurrentTagIndex() {

    const value = searchInput.value;
    const cursor = searchInput.selectionStart;

    return value
    .slice(0, cursor)
    .split(",")
    .length - 1;
}

function isValidTag(tag) {

    const lower =
        tag.trim().toLowerCase();

    if (!lower)
        return false;

    return getAllTags().some(existing =>
        existing.trim().toLowerCase() === lower);
}

function removeTagAt(index) {

    const parts = getTagParts();

    if (
        index < 0 ||
        index >= parts.length) {
        return;
    }

    let start = 0;

    for (let i = 0; i < index; i++) {
        start += parts[i].length + 1;
    }

    parts.splice(index, 1);

    searchInput.value =
        parts
        .map(part => part.trim())
        .filter(Boolean)
        .join(", ");

    const newPosition =
        Math.min(
            start,
            searchInput.value.length);

    searchInput.setSelectionRange(newPosition,
        newPosition);
}

function validatePreviousTag() {

    const parts = getTagParts();

    if (
        previousTagIndex < 0 ||
        previousTagIndex >= parts.length) {
        return;
    }

    const tag =
        parts[previousTagIndex].trim();

    if (!tag)
        return;

    if (isValidTag(tag))
        return;

    removeTagAt(previousTagIndex);
}

function removeCurrentPartialTag() {

    const value = searchInput.value;

    if (value.endsWith(", "))
        return;

    const cursor =
        searchInput.selectionStart;

    const beforeCursor =
        value.slice(0, cursor);

    const start =
        beforeCursor.lastIndexOf(",") + 1;

    const afterCursor =
        value.indexOf(",", cursor);

    const end =
        afterCursor === -1
         ? value.length
         : afterCursor;

    const before =
        value.slice(0, start);

    const after =
        value.slice(end);

    let newValue =
        before + after;

    newValue =
        newValue
        .replace(/,\s*,/g, ", ")
        .replace(/^,\s*/, "")
        .replace(/\s+,/g, ",")
        .replace(/,\s*$/, ", ");

    if (
        newValue &&
        !newValue.endsWith(", ")) {
        newValue =
            newValue.replace(/,\s*$/, ", ");
    }

    searchInput.value =
        newValue;

    selectedSuggestionIndex = -1;

    suggestionBox.innerHTML = "";

    previousSearchValue =
        searchInput.value;
}

const getSortedMatches = (text, excludedTags = []) => {

    const lowerText = text.toLowerCase();

    const excluded = new Set(
            excludedTags.map(tag =>
                tag.trim().toLowerCase()));

    return getAllTags()
    .filter(tag => {

        const lowerTag =
            tag.trim().toLowerCase();

        return (
            lowerTag.includes(lowerText) &&
            !excluded.has(lowerTag));

    })
    .sort((a, b) => {

        const aLower =
            a.trim().toLowerCase();

        const bLower =
            b.trim().toLowerCase();

        const aStarts =
            aLower.startsWith(lowerText);

        const bStarts =
            bLower.startsWith(lowerText);

        if (aStarts && !bStarts)
            return -1;

        if (!aStarts && bStarts)
            return 1;

        return aLower.localeCompare(bLower);

    });

};

let previousSearchValue = "";

searchInput.addEventListener("input", () => {

    const value = searchInput.value;

    const currentIndex =
        getCurrentTagIndex();

    if (
        currentIndex !== activeTagIndex) {

        previousTagIndex =
            activeTagIndex;

        validatePreviousTag();

        activeTagIndex =
            getCurrentTagIndex();

    } else {

        activeTagIndex =
            currentIndex;

    }

    selectedSuggestionIndex = -1;

    suggestionBox.innerHTML = "";
    suggestions.length = 0;

    const parts =
        searchInput.value.split(",");

    const currentTag =
        (parts[activeTagIndex] || "").trim();

    const text =
        currentTag.toLowerCase();

    const enteredTags = parts
        .map((tag, index) => ({
                tag: tag.trim(),
                index
            }))
        .filter(item =>
            item.tag &&
            item.index !== activeTagIndex)
        .map(item => item.tag.toLowerCase());

    if (text) {

        getSortedMatches(text,
            enteredTags).forEach(tag => {

            const div =
                document.createElement("div");

            div.className =
                "suggestion";

            div.textContent =
                tag;

            div.onclick = () => {

                const parts =
                    searchInput.value.split(",");

                parts[activeTagIndex] =
                    tag;

                searchInput.value =
                    parts
                    .map(part => part.trim())
                    .join(", ");

                if (
                    activeTagIndex ===
                    parts.length - 1) {

                    searchInput.value += ", ";

                }

                suggestionBox.innerHTML = "";
                suggestions.length = 0;
                selectedSuggestionIndex = -1;

                searchInput.focus();

                const newPosition =
                    searchInput.value.length;

                searchInput.setSelectionRange(newPosition,
                    newPosition);

            };

            suggestionBox.appendChild(div);

            suggestions.push(div);

        });

    }

    previousSearchValue =
        searchInput.value;

});

searchInput.addEventListener("click", () => {

    const newIndex =
        getCurrentTagIndex();

    if (
        newIndex !== activeTagIndex) {

        previousTagIndex =
            activeTagIndex;

        validatePreviousTag();

        activeTagIndex =
            getCurrentTagIndex();

    }

});

searchInput.addEventListener("keydown", e => {

    if (e.key === "Tab" && !e.shiftKey) {

        e.preventDefault();
        e.stopImmediatePropagation();

        const parts =
            searchInput.value.split(",");

        const partial =
            (parts[activeTagIndex] || "").trim();

        if (!partial)
            return;

        const enteredTags = parts
            .map((tag, index) => ({
                    tag: tag.trim(),
                    index
                }))
            .filter(item =>
                item.tag &&
                item.index !== activeTagIndex)
            .map(item => item.tag);

        const matches =
            getSortedMatches(partial,
                enteredTags);

        if (matches.length) {

            parts[activeTagIndex] =
                matches[0];

            searchInput.value =
                parts
                .map(part => part.trim())
                .join(", ");

            const nextIndex =
                activeTagIndex + 1;

            if (
                nextIndex >= parts.length) {

                searchInput.value += ", ";

            }

            let cursorPosition = 0;

            for (
                let i = 0;
                i <= activeTagIndex;
                i++) {

                cursorPosition +=
                parts[i].trim().length;

                if (i < activeTagIndex)
                    cursorPosition += 2;
            }

            cursorPosition += 2;

            activeTagIndex =
                Math.min(
                    nextIndex,
                    searchInput.value.split(",").length - 1);

            suggestionBox.innerHTML = "";
            suggestions.length = 0;
            selectedSuggestionIndex = -1;

            searchInput.focus();

            searchInput.setSelectionRange(cursorPosition,
                cursorPosition);

        }

        return;
    }

    if (e.key === "Tab" && e.shiftKey) {

        e.preventDefault();
        e.stopImmediatePropagation();

        const parts =
            searchInput.value.split(",");

        const current =
            (parts[activeTagIndex] || "").trim();

        let removeIndex;

        if (current) {

            removeIndex =
                activeTagIndex;

        }

        else {

            removeIndex =
                parts.length - 2;

        }

        if (
            removeIndex < 0 ||
            removeIndex >= parts.length) {
            return;
        }

        parts.splice(removeIndex, 1);

        searchInput.value =
            parts
            .map(part => part.trim())
            .filter(Boolean)
            .join(", ");

        if (searchInput.value)
            searchInput.value += ", ";

        suggestionBox.innerHTML = "";
        suggestions.length = 0;
        selectedSuggestionIndex = -1;

        activeTagIndex =
            Math.max(
                0,
                Math.min(
                    removeIndex,
                    searchInput.value.split(",").length - 1));

        searchInput.focus();

        const position =
            searchInput.value.length;

        searchInput.setSelectionRange(position,
            position);

        return;
    }

    if (e.key === "ArrowDown") {

        if (!suggestions.length)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        selectedSuggestionIndex++;

        if (
            selectedSuggestionIndex >=
            suggestions.length) {
            selectedSuggestionIndex = 0;
        }

        updateSelectedSuggestion();

        return;
    }

    if (e.key === "ArrowUp") {

        if (!suggestions.length)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        selectedSuggestionIndex--;

        if (selectedSuggestionIndex < 0) {
            selectedSuggestionIndex =
                suggestions.length - 1;
        }

        updateSelectedSuggestion();

        return;
    }

    if (e.key === "Escape") {

        e.preventDefault();

        removeCurrentPartialTag();

        searchInput.blur();

        return;
    }

    if (
        e.key === "Enter" &&
        selectedSuggestionIndex >= 0 &&
        suggestions.length) {

        e.preventDefault();
        e.stopImmediatePropagation();

        suggestions[
            selectedSuggestionIndex
        ].click();

        return;
    }

}, true);

document.addEventListener("mousedown", e => {

    if (
        e.target !== searchInput &&
        !suggestionBox.contains(e.target)) {

        removeCurrentPartialTag();

    }

});

function updateSelectedSuggestion() {

    suggestions.forEach((suggestion, index) => {

        if (index === selectedSuggestionIndex) {

            suggestion.style.backgroundColor = "#ccc";
            suggestion.style.color = "black";

        } else {

            suggestion.style.backgroundColor = "";
            suggestion.style.color = "";

        }

    });

    if (
        selectedSuggestionIndex >= 0 &&
        selectedSuggestionIndex < suggestions.length) {

        suggestions[
            selectedSuggestionIndex
        ].scrollIntoView({
            block: "nearest"
        });

    }

}

function searchAlbumsByTags() {

    const query = searchInput.value
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

    if (!query.length)
        return;

    const results = albums.filter(album => {

        const albumTags = (album.tags || [])
        .map(t => t.toLowerCase());

        return query.every(tag =>
            albumTags.includes(tag));

    });

    showSearchResults(results);

}

function showSearchResults(results) {

    closeModal(false);

    history.replaceState(
        null,
        "",
        window.location.pathname);

    isQueryAlbum = false;
    currentAlbum = null;

    document.getElementById("backButton").style.display = "none";
    document.getElementById("saveButton").style.display = "none";

    const tagContainer =
        document.getElementById("tagBar");

    if (tagContainer) {

        tagContainer.style.display = "none";

        document.getElementById("tagToggle").style.display = "none";

    }

    const gallery =
        document.getElementById("gallery");

    gallery.innerHTML = "";

    if (!results.length) {

        gallery.textContent =
            "No albums found.";

        return;

    }

    results.forEach(album => {

        const cover =
            album.images[
                Math.floor(
                    Math.random() *
                    album.images.length
                )
            ];

        const card =
            document.createElement("div");

        card.className =
            "album";

        const img =
            document.createElement("img");

        img.src =
            cover.thumb.url;

        const title =
            document.createElement("div");

        title.textContent =
            album.name;

        card.appendChild(img);
        card.appendChild(title);

        card.onclick =
            () => loadAlbum(album);

        gallery.appendChild(card);

    });

    startGalleryResizeTracking();

}

const clearSearch =
    document.getElementById("clearSearch");

clearSearch.addEventListener("click", () => {

    searchInput.value = "";

    suggestionBox.innerHTML = "";
    suggestions.length = 0;
    selectedSuggestionIndex = -1;

    activeTagIndex = 0;
    previousTagIndex = 0;

    searchInput.focus();

});

document.getElementById("searchButton").onclick =
    searchAlbumsByTags;

searchInput.addEventListener("keydown", e => {

    if (e.key === "Enter") {
        searchAlbumsByTags();
    }

});

document.getElementById("regenerateAlbum").onclick = () => {

    if (!currentAlbum)
        return;

    const newID = generateAlbumID(
            currentAlbum.name,
            currentAlbum.id);

    currentAlbum.id = newID;

    history.replaceState(
        null,
        "",
        "?$" + encodeURIComponent(newID));

    const query = createAlbumQuery(currentAlbum);

    const js = `,
	{
		id: "${newID.replace(/"/g, '\\"')}",
		name: "${currentAlbum.name.replace(/"/g, '\\"')}",
		url: \`
			?${query}
		\`.trim(),
		tags: ${JSON.stringify(currentAlbum.tags || [])}
	}`;

    navigator.clipboard.writeText(js)
    .then(() => {
        alert("Regenerated albums.js entry and copied it to clipboard!");
    })
    .catch(() => {
        prompt("Copy this into albums.js:", js);
    });

};

function saveTagBarState() {

    const tagBar =
        document.getElementById("tagBar");
    if (!tagBar.classList.contains("hidden")) {
        tagBar.style.visibility = "visible";
    }

    localStorage.setItem(
        "tagBarHidden",
        tagBar.classList.contains("hidden"));
}

function loadTagBarState() {

    const tagBar =
        document.getElementById("tagBar");

    const hidden =
        localStorage.getItem("tagBarHidden") === "true";

    tagBar.classList.add("noTransition");

    if (hidden) {
        tagBar.classList.add("hidden");
    } else {
        tagBar.classList.remove("hidden");
        tagBar.style.visibility = "visible";
    }

    tagBar.offsetWidth;

    tagBar.classList.remove("noTransition");
}

function cancelCenterReturn() {

    if (centerReturnTimer !== null) {

        clearTimeout(centerReturnTimer);

        centerReturnTimer = null;

    }

    if (centerReturnAnimation !== null) {

        cancelAnimationFrame(centerReturnAnimation);

        centerReturnAnimation = null;

    }

}

function scheduleCenterReturn() {

    if (centerReturnTimer !== null)
        return;

    if (
        Math.abs(imgTransform.x) < 0.01 &&
        Math.abs(imgTransform.y) < 0.01 &&
        Math.abs(imgTransform.scale - minZoom) < 0.001) {

        return;

    }

    centerReturnTimer =
        setTimeout(() => {

            centerReturnTimer = null;

            if (
                imgDragging ||
                interactingWithImage ||
                zooming) {

                return;

            }

            const img =
                displayingFull
                 ? modalImgFull
                 : modalImgMedium;

            if (!img)
                return;

            const startX =
                imgTransform.x;

            const startY =
                imgTransform.y;

            const startScale =
                imgTransform.scale;

            if (
                Math.abs(startX) < 0.01 &&
                Math.abs(startY) < 0.01 &&
                Math.abs(startScale - minZoom) < 0.001) {

                return;

            }

            const startTime =
                performance.now();

            const duration =
                centerAnimationDuration;

            function animateCenter(now) {

                if (
                    imgDragging ||
                    interactingWithImage ||
                    zooming) {

                    centerReturnAnimation =
                        null;

                    return;

                }

                const progress =
                    Math.min(
                        1,
                        (now - startTime) /
                        duration);

                const eased =
                    1 -
                    Math.pow(
                        1 - progress,
                        3);

                imgTransform.x =
                    startX *
                    (1 - eased);

                imgTransform.y =
                    startY *
                    (1 - eased);

                imgTransform.scale =
                    startScale +
                    (
                        minZoom -
                        startScale) *
                    eased;

                applyTransform();

                if (progress < 1) {

                    centerReturnAnimation =
                        requestAnimationFrame(animateCenter);

                } else {

                    imgTransform.x = 0;
                    imgTransform.y = 0;
                    imgTransform.scale = minZoom;

                    applyTransform();

                    centerReturnAnimation =
                        null;

                }

            }

            centerReturnAnimation =
                requestAnimationFrame(animateCenter);

        }, 3000);

}

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

        const bytes = Uint8Array.from(
            binary,
            char => char.charCodeAt(0)
        );

        return new TextDecoder().decode(bytes);

    } catch (error) {

        return null;
    }
}

function openAddImageEditor() {

    const existing =
        document.getElementById("addImageEditor");

    if (existing) {

        existing.remove();

    }

    const overlay =
        document.createElement("div");

    overlay.id =
        "addImageEditor";

    overlay.style.position =
        "fixed";

    overlay.style.inset =
        "0";

    overlay.style.zIndex =
        "10000";

    overlay.style.background =
        "rgba(0,0,0,0.75)";

    overlay.style.display =
        "flex";

    overlay.style.alignItems =
        "center";

    overlay.style.justifyContent =
        "center";

    const editor =
        document.createElement("div");

    editor.style.background =
        "#222";

    editor.style.padding =
        "20px";

    editor.style.borderRadius =
        "8px";

    editor.style.width =
        "min(500px, 90vw)";

    editor.style.boxSizing =
        "border-box";

    const title =
        document.createElement("div");

    title.textContent =
        "Add Image";

    title.style.fontSize =
        "20px";

    title.style.marginBottom =
        "15px";

    editor.appendChild(title);

    const fields = {};

    [
        ["thumb", "Thumbnail URL"],
        ["medium", "Medium URL"],
        ["image", "Large / Full URL"]
    ].forEach(
        ([name, label]) => {

            const container =
                document.createElement("div");

            container.style.marginBottom =
                "12px";

            const text =
                document.createElement("div");

            text.textContent =
                label;

            text.style.marginBottom =
                "4px";

            const input =
                document.createElement("input");

            input.type =
                "text";

            input.placeholder =
                "https://...";

            input.style.width =
                "100%";

            input.style.boxSizing =
                "border-box";

            input.style.padding =
                "8px";

            fields[name] =
                input;

            container.appendChild(text);

            container.appendChild(input);

            editor.appendChild(container);

        }
    );

    const buttons =
        document.createElement("div");

    buttons.style.display =
        "flex";

    buttons.style.justifyContent =
        "flex-end";

    buttons.style.gap =
        "10px";

    const cancel =
        document.createElement("button");

    cancel.textContent =
        "Cancel";

    cancel.onclick =
        () => {

            overlay.remove();

        };

    const add =
        document.createElement("button");

    add.textContent =
        "Add Image";

    add.onclick =
        () => {

            const thumb =
                fields.thumb.value.trim();

            const medium =
                fields.medium.value.trim();

            const image =
                fields.image.value.trim();

            if (
                !thumb &&
                !medium &&
                !image
            ) {

                alert("Enter at least one image URL.");

                return;

            }

            const fallback =
                image ||
                medium ||
                thumb;

            const newImage = {

				thumb: {
					url:
						thumb ||
						fallback
				},

				medium: {
					url:
						medium ||
						image ||
						fallback
				},

				image: {
					url:
						image ||
						medium ||
						fallback
				},

				tags:
					[],

				added:
					true

			};

            if (
                !Array.isArray(currentAlbum.images)
            ) {

                currentAlbum.images =
                    [];

            }

            currentAlbum.images.push(newImage);

            currentAlbum.edited =
                true;

            overlay.remove();

            showEditedAlbumSaveButton();

            loadAlbum(currentAlbum, false);

        };

    buttons.appendChild(cancel);

    buttons.appendChild(add);

    editor.appendChild(buttons);

    overlay.appendChild(editor);

    document.body.appendChild(overlay);

    fields.thumb.focus();

}

function showAddImageButton() {

    let button =
        document.getElementById("addAlbumImageButton");

    if (!button) {

        button =
            document.createElement("button");

        button.id =
            "addAlbumImageButton";

        button.textContent =
            "+ Add Image";

        button.onclick =
            () => {

                openAddImageEditor();

            };

        button.style.position =
            "fixed";

        button.style.bottom =
            "10px";

        button.style.left =
            "50%";

        button.style.transform =
            "translateX(-50%)";

        button.style.zIndex =
            "5000";

        document.body.appendChild(button);

    }

    button.style.display =
        "";

}

function hideAddImageButton() {

    const button =
        document.getElementById("addAlbumImageButton");

    if (button) {

        button.style.display =
            "none";

    }

}

function showEditedAlbumSaveButton() {

    const saveButton =
        document.getElementById("saveButton");

    if (!saveButton)
        return;

    saveButton.style.display =
        "";

    saveButton.onclick =
        () => {

            if (!currentAlbum)
                return;

            let saved =
                JSON.parse(
                    localStorage.getItem("savedAlbums") || "[]"
                );

            const savedAlbum =
                JSON.parse(
                    JSON.stringify(currentAlbum)
                );

            savedAlbum.storage =
                true;

            savedAlbum.edited =
                true;

            saved =
                saved.filter(
                    album =>
                        album.id !==
                        savedAlbum.id
                );

            saved.push(savedAlbum);

            localStorage.setItem(
                "savedAlbums",
                JSON.stringify(saved)
            );

            currentAlbum =
                savedAlbum;

            alert("Album saved locally.");

            showEditedAlbumSaveButton();

        };

}

async function initializeTelegramClient() {

    if (window.telegramClient) {

        return window.telegramClient;

    }

    if (
        !window.telegramAppId ||
        !window.telegramAppHash
    ) {

        return null;

    }

    if (
        !window.TelegramClient ||
        !window.TelegramStorageIndexedDB
    ) {

        throw new Error("MTKruto has not been loaded.");

    }

    const client =
        new window.TelegramClient({

            apiId:
                Number(window.telegramAppId),

            apiHash:
                window.telegramAppHash,

            storage:
                new window.TelegramStorageIndexedDB("telegram-browser-gallery")

        });

    window.telegramClient =
        client;

    await client.start({

        phone: async () => {

            const value =
                prompt("Enter your Telegram phone number:");

            if (value === null) {
                throw new Error("Telegram login cancelled.");
            }

            return value;

        },

        code: async () => {

            const value =
                prompt("Enter the Telegram login code:");

            if (value === null) {
                throw new Error("Telegram login cancelled.");
            }

            return value;

        },

        password: async () => {

            const value =
                prompt("Enter your Telegram 2FA password:");

            if (value === null) {
                throw new Error("Telegram login cancelled.");

            }

            return value;

        }

    });

    return client;
}

async function loadTelegramAlbumCover(album) {

    if (
        !window.telegramClient
    ) {
        throw new Error("Telegram client is not initialized.");
    }

    const client =
        window.telegramClient;

    const match =
        album.url.match(
            /^tg:\/\/chat\/(-?\d+)(?:\?(.+))?$/
        );

    if (!match) {
        throw new Error(
            "Invalid Telegram album URL: " +
            album.url
        );
    }

    const chatId =
        Number(match[1]);

    const optionString =
        match[2] ||
        "";

    const options =
        new URLSearchParams(optionString);

    const coverMessageID =
        options.get("cover");

    let chat =
        null;

    if (
        Array.isArray(window.telegramChats)
    ) {

        const found =
            window.telegramChats.find(
                item =>
                    item &&
                    item.chat &&
                    String(item.chat.id) ===
                    String(chatId)
            );

        if (found) {
            chat =
                found.chat;
        }

    }

    if (!chat) {

        const chats =
            await client.getChats();

        window.telegramChats =
            chats;

        const found =
            chats.find(
                item =>
                    item &&
                    item.chat &&
                    String(item.chat.id) ===
                    String(chatId)
            );

        if (found) {
            chat =
                found.chat;
        }

    }

    if (!chat) {
        throw new Error(
            "Telegram chat was not found: " +
            chatId
        );
    }

    let message = null;

    if (coverMessageID) {

        message =
            await client.getMessage(
                chat.id,
                Number(coverMessageID)
            );

    }
    else {

        const messages =
            await client.getHistory(
                chat.id,
                {
                    limit: 100
                }
            );

        message =
            messages.find(
                message =>
                    message &&
                    message.document &&
                    typeof message.document.mimeType ===
                        "string" &&
                    message.document.mimeType.startsWith("image/")
            );

    }

    if (
        !message ||
        !message.document
    ) {

        throw new Error("Telegram cover message is not an image.");

    }

    const fileDocument =
        message.document;

    const mimeType =
        fileDocument.mimeType ||
        "image/jpeg";

    let thumbnail =
        null;

    if (
        Array.isArray(fileDocument.thumbnails) &&
        fileDocument.thumbnails.length
    ) {

        thumbnail =
            fileDocument.thumbnails
                .slice()
                .sort(
                    (a, b) =>
                        (
                            (b.width || 0) *
                            (b.height || 0)
                        ) -
                        (
                            (a.width || 0) *
                            (a.height || 0)
                        )
                )[0];

    }

    if (!thumbnail) {

        throw new Error("Telegram cover has no thumbnail.");

    }

    const chunks =
        [];

    for await (
        const chunk of
        client.download(
            thumbnail.fileId,
            {
                chunkSize:
                    64 * 1024
            }
        )
    ) {

        chunks.push(chunk);

    }

    const blob =
        new Blob(
            chunks,
            {
                type:
                    mimeType
            }
        );

    const url =
        URL.createObjectURL(blob);

    return {
        url:
            url,

        messageID:
            message.id
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
                await window.telegramClient.getChats();

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

async function openTemporaryTelegramAlbum(chatID) {

    if (
        !chatID
    ) {
        return;
    }

    if (
        !window.telegramClient
    ) {

        alert("Telegram client is not initialized.");

        return;

    }

    try {

        let chat =
            null;

        if (
            Array.isArray(window.telegramChats)
        ) {

            const found =
                window.telegramChats.find(
                    item =>
                        item &&
                        item.chat &&
                        String(item.chat.id) ===
                        String(chatID)
                );

            if (found) {

                chat =
                    found.chat;

            }

        }

        if (!chat) {

            const chats =
                await window.telegramClient.getChats();

            window.telegramChats =
                chats;

            const found =
                chats.find(
                    item =>
                        item &&
                        item.chat &&
                        String(item.chat.id) ===
                        String(chatID)
                );

            if (found) {

                chat =
                    found.chat;

            }

        }

        if (!chat) {

            throw new Error(
                "Telegram chat was not found: " +
                chatID
            );

        }

        const messages =
            await window.telegramClient.getHistory(
                chat.id,
                {
                    limit:
                        100
                }
            );

        const imageMessages =
            [];

        for (
            const message of
            messages
        ) {

            if (
                !message ||
                !message.document
            ) {

                continue;

            }

            const document =
                message.document;

            const mimeType =
                document.mimeType ||
                "";

            if (
                !mimeType.startsWith("image/")
            ) {

                continue;

            }

            imageMessages.push(message);

        }

        if (
            !imageMessages.length
        ) {

            alert("No image messages were found in this Telegram chat.");

            return;

        }

        const messageIDs =
            imageMessages.map(
                message =>
                    message.id
            );

        const coverMessageID =
            imageMessages[0].id;

        const telegramURL =
            "tg://chat/" +
            String(chat.id) +
            "?cover=" +
            encodeURIComponent(coverMessageID) +
            "&messages=" +
            messageIDs
                .map(
                    id =>
                        encodeURIComponent(id)
                )
                .join(",");

        const album =
            {
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

                url:
                    telegramURL,

                tags:
                    [],

                images:
                    [],

                temporary:
                    true,

                edited:
                    false
            };

        currentTemporaryAlbumID =
            album.id;

        saveTemporaryAlbum(album);

        history.pushState(
            null,
            "",
            "?=" +
            encodeURIComponent(album.id)
        );

        loadAlbum(album, false);

        showAlbumButtons(true);

    }
    catch (error) {

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

async function reloadAlbums() {

    albums.length = 0;

    const GITHUB_STORAGE_KEY =
        "githubID";

    const query =
        window.location.search.substring(1);

    let pasteID =
        null;

    if (
        query.startsWith("@")
    ) {

        pasteID =
            decodeBase64URL(
                query.substring(1)
            );

        if (
            !pasteID
        ) {

            pasteID =
                null;

        }
        else {

            localStorage.setItem(GITHUB_STORAGE_KEY,
                pasteID);

        }

    }

    else {

        pasteID =
            localStorage.getItem(GITHUB_STORAGE_KEY);

    }

    let manualAlbums = [];

    if (pasteID) {

        try {

            const response =
                await fetch(pasteID);

            if (!response.ok) {

                throw new Error(`HTTP ${response.status}`);

            }

            const text =
                await response.text();

            const start =
                text.indexOf("MANUAL_ALBUMS");

            if (
                start === -1
            ) {

                throw new Error("MANUAL_ALBUMS was not found in GitHub file.");

            }

            const arrayStart =
                text.indexOf(
                    "[",
                    start
                );

            if (
                arrayStart === -1
            ) {

                throw new Error("MANUAL_ALBUMS array start was not found.");

            }

            let depth =
                0;

            let arrayEnd =
                -1;

            let inString =
                false;

            let stringChar =
                null;

            let escaped =
                false;

            for (
                let i = arrayStart;
                i < text.length;
                i++
            ) {

                const char =
                    text[i];

                if (escaped) {

                    escaped =
                        false;

                    continue;

                }

                if (inString) {

                    if (
                        char === "\\"
                    ) {

                        escaped =
                            true;

                    }
                    else if (
                        char === stringChar
                    ) {

                        inString =
                            false;

                        stringChar =
                            null;

                    }

                    continue;

                }

                if (
                    char === '"' ||
                    char === "'" ||
                    char === "`"
                ) {

                    inString =
                        true;

                    stringChar =
                        char;

                    continue;

                }

                if (
                    char === "["
                ) {

                    depth++;

                }
                else if (
                    char === "]"
                ) {

                    depth--;

                    if (
                        depth === 0
                    ) {

                        arrayEnd =
                            i;

                        break;

                    }

                }

            }

            if (
                arrayEnd === -1
            ) {

                throw new Error("Could not find end of MANUAL_ALBUMS.");

            }

            const arrayText =
                text.substring(
                    arrayStart,
                    arrayEnd + 1
                );

            manualAlbums =
                Function(
                    `"use strict"; return (${arrayText});`
                )();

            if (
                !Array.isArray(manualAlbums)
            ) {

                throw new Error("Extracted MANUAL_ALBUMS is not an array.");

            }

        }
        catch (error) {

            manualAlbums =
                [];

        }

    }

    else if (
        typeof MANUAL_ALBUMS !==
        "undefined"
    ) {

        manualAlbums =
            MANUAL_ALBUMS;

    }

    manualAlbums.forEach(
		album => {

			const isTelegram =
				typeof album.url === "string" &&
				album.url.startsWith("tg://chat/");

			albums.push({

				id:
					album.id,

				name:
					album.name,

				images:
					isTelegram
						? []
						: parseQuery(
							getAlbumQuery(album.url)
						),

				url:
					album.url,

				tags:
					album.tags ||
					[]

			});

		}
	);

    const saved =
        JSON.parse(
            localStorage.getItem("savedAlbums") || "[]"
        );

    saved.forEach(
        album => {

            albums.push({

                ...album,

                tags:
                    album.tags ||
                    [],

                storage:
                    true

            });

        }
    );

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
        show ? "" : "none";

    document.getElementById("tagToggle").style.display =
        show ? "" : "none";
}
