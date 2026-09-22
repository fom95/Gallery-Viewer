/*
 * 04-telegram-import.js
 *
 * Telegram is now only used directly for two things: connecting the
 * client, and browsing chats/messages to build a temp album's image
 * list. Actual image bytes (thumb/medium/full) are served by whatever
 * the "telegram" entry in config.providers points at -- your
 * Cloudflare Worker -- through the normal resolveImageAsset()
 * pipeline (06-image-asset-sources.js), the same as every other
 * provider. There is no more raw MTProto downloading of media bytes
 * anywhere in this file.
 */

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
				new window.TelegramStorageIndexedDB(
					"telegram-browser-gallery"
				),

			persistCache:
				false

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
        messages
    };

}


/*
 * Finds a chat by ID, using window.telegramChats as a cache (shared
 * with the chat-picker dialog) before falling back to a fresh
 * getChats() call.
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
        await window.telegramClient.getChats({ limit: 500 });

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
 * Loads (or reloads) a Telegram album's image list. Only contacts
 * Telegram to enumerate which messages exist and carry media --
 * nothing here downloads any image bytes.
 */
async function loadTelegramAlbum(album) {

    if (!window.telegramClient) {

        throw new Error(
            "Telegram client is not initialized."
        );

    }

    const client =
        window.telegramClient;

    const parsed =
        parseTelegramAlbumUrl(album.url);

    if (!parsed) {

        throw new Error(
            "Invalid Telegram album URL: " + album.url
        );

    }

    const chat =
        await findTelegramChat(parsed.chatId);

    let messages =
        [];

    if (parsed.messages.length) {

        messages =
            await client.getMessages(chat.id, parsed.messages);

    } else {

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

        const hasMedia =
            (
                message.photo &&
                typeof message.photo.fileId === "string" &&
                message.photo.fileId
            ) ||
            (
                message.document &&
                (
                    message.document.mimeType ||
                    message.document.mime_type ||
                    ""
                ).startsWith("image/")
            ) ||
            !!message.video;

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
                    (candidate.document || candidate.photo)
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
         * Retrieve the ENTIRE chat history.
         *
         * Telegram gives us newest -> oldest.
         * offset_id walks backwards through the history.
         */

        const peer =
            await client.getInputPeer(
                chat.id
            );

        const allMessages =
            new Map();

        let offsetID = 0;

        while (true) {

            const result =
                await client.invoke({
                    _:
                        "messages.getHistory",

                    peer,

                    offset_id:
                        offsetID,

                    offset_date:
                        0,

                    add_offset:
                        0,

                    limit:
                        100,

                    max_id:
                        0,

                    min_id:
                        0,

                    hash:
                        0n
                });

            const page =
                result &&
                Array.isArray(result.messages)
                    ? result.messages
                    : [];

            if (!page.length) {
                break;
            }

            let oldestID = null;

            for (const message of page) {

                if (
                    !message ||
                    message.id == null
                ) {
                    continue;
                }

                allMessages.set(
                    String(message.id),
                    message
                );

                if (
                    oldestID === null ||
                    BigInt(String(message.id)) <
                    BigInt(String(oldestID))
                ) {

                    oldestID =
                        message.id;
                }
            }

            if (oldestID === null) {
                break;
            }

            if (
                offsetID !== 0 &&
                BigInt(String(oldestID)) >=
                BigInt(String(offsetID))
            ) {

                console.warn(
                    "Telegram history pagination stopped because " +
                    "the oldest message ID did not move backwards.",
                    {
                        previousOffsetID:
                            offsetID,

                        oldestID:
                            oldestID
                    }
                );

                break;
            }

            offsetID =
                oldestID;
        }


        /*
         * Oldest -> newest.
         */

        const messages =
            Array.from(
                allMessages.values()
            ).sort(
                (a, b) => {

                    const A =
                        BigInt(String(a.id));

                    const B =
                        BigInt(String(b.id));

                    if (A < B) {
                        return -1;
                    }

                    if (A > B) {
                        return 1;
                    }

                    return 0;
                }
            );


        /*
         * Keep normal/user-created messages only.
         */

        const targetMessages =
            messages.filter(
                message =>
                    message &&
                    message._ === "message"
            );


        if (!targetMessages.length) {

            alert(
                "No user-created messages were found in this Telegram chat."
            );

            return;
        }

        const messageIDs =
			targetMessages.map(
				message =>
					message.id
			);


        const coverMessageID =
            messageIDs[0];


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
                .join(",");


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
