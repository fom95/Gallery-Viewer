/*
 * 04-telegram-import.js
 *
 * Everything Telegram: connecting the client, bulk-importing a chat's
 * photos into an album, loading a chat's cover image, and the chat
 * picker UI. This is one of the two current bulk-import sources.
 */

async function loadTelegramAlbum(album) {

    if (!window.telegramClient) {

        throw new Error(
            "Telegram client is not initialized."
        );

    }

    const client =
        window.telegramClient;


    /*
     * Parse Telegram album URL.
     */

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
        new URLSearchParams(
            optionString
        );

    const coverMessageID =
        options.get("cover");

    const messageString =
        options.get("messages");


    let requestedMessageIDs =
        [];

    if (messageString) {

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


    /*
     * Find the chat.
     */

    let chat =
        null;

    if (
        Array.isArray(
            window.telegramChats
        )
    ) {

        const found =
            window.telegramChats.find(
                item =>
                    item &&
                    item.chat &&
                    String(
                        item.chat.id
                    ) ===
                    String(chatId)
            );

        if (found) {

            chat =
                found.chat;

        }

    }


    if (!chat) {

        const chats =
            await client.getChats({
                limit:
                    500
            });

        window.telegramChats =
            chats;

        const found =
            chats.find(
                item =>
                    item &&
                    item.chat &&
                    String(
                        item.chat.id
                    ) ===
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


    /*
     * Retrieve the requested messages.
     */

    let messages =
        [];

    if (
        requestedMessageIDs.length
    ) {

        messages =
            await client.getMessages(
                chat.id,
                requestedMessageIDs
            );

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


    /*
     * Restore the exact order from the URL.
     */

    if (
        requestedMessageIDs.length
    ) {

        const messageMap =
            new Map();

        for (
            const message of
            messages
        ) {

            if (
                message &&
                Number.isInteger(
                    message.id
                )
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
                        messageMap.get(
                            messageID
                        )
                )
                .filter(
                    message =>
                        !!message
                );

    }
	
	 /*
     * Process every retrieved message.
     */
	
	const existingTagsByMessageID =
		new Map(
			(album.images || [])
				.filter(
					image =>
						image &&
						image.source === "telegram" &&
						image.messageID != null
				)
				.map(
					image => [
						String(image.messageID),
						Array.isArray(image.tags)
							? image.tags.slice()
							: []
					]
				)
		);

    const images =
        [];


    let photoCount =
        0;

    let documentCount =
        0;

    let videoCount =
        0;

    let noMediaCount =
        0;

    let noFileIDCount =
        0;


    for (
        const message of
        messages
    ) {

        if (!message) {

            continue;

        }


        let media =
            null;

        let fileID =
            null;

        let mimeType =
            "";

        let fileName =
            "";

        let width =
            null;

        let height =
            null;

        let mediaType =
            "media";


        /*
         * PHOTO
         */

        if (
            message.photo &&
            typeof message.photo.fileId ===
                "string" &&
            message.photo.fileId
        ) {

            media =
                message.photo;

            fileID =
                message.photo.fileId;

            mimeType =
                "image/jpeg";

            width =
                message.photo.width ??
                null;

            height =
                message.photo.height ??
                null;

            mediaType =
                "photo";

            photoCount++;

        }


        /*
         * DOCUMENT
         */

        else if (
            message.document &&
            (
                message.document.mimeType ||
                message.document.mime_type ||
                ""
            ).startsWith(
                "image/"
            )
        ) {

            media =
                message.document;

            if (
                typeof media.fileId ===
                    "string" &&
                media.fileId
            ) {

                fileID =
                    media.fileId;

            }

            mimeType =
                media.mimeType ||
                media.mime_type ||
                "";

            fileName =
                media.fileName ||
                media.file_name ||
                "";

            width =
                media.width ??
                null;

            height =
                media.height ??
                null;

            mediaType =
                "document";

            documentCount++;

        }


        /*
         * VIDEO
         */

        else if (
            message.video
        ) {

            media =
                message.video;

            if (
                typeof media.fileId ===
                    "string" &&
                media.fileId
            ) {

                fileID =
                    media.fileId;

            }

            mimeType =
                media.mimeType ||
                media.mime_type ||
                "video/mp4";

            fileName =
                media.fileName ||
                media.file_name ||
                "";

            width =
                media.width ??
                null;

            height =
                media.height ??
                null;

            mediaType =
                "video";

            videoCount++;

        }


        if (!media) {

            noMediaCount++;

            continue;

        }


        if (!fileID) {

            noFileIDCount++;

            console.warn(
                "Telegram media has no usable fileId; " +
                "skipping message " +
                message.id
            );

            continue;

        }


        /*
         * Find the smallest Telegram thumbnail.
         */

        let thumbnailFileID =
            fileID;

        let telegramThumbnail =
            null;

        if (
            media &&
            Array.isArray(
                media.thumbnails
            ) &&
            media.thumbnails.length
        ) {

            const smallestThumbnail =
                media.thumbnails
                    .slice()
                    .sort(
                        (a, b) =>
                            (
                                (a.width || 0) *
                                (a.height || 0)
                            ) -
                            (
                                (b.width || 0) *
                                (b.height || 0)
                            )
                    )[0];

            if (
                smallestThumbnail &&
                typeof smallestThumbnail.fileId ===
                    "string" &&
                smallestThumbnail.fileId
            ) {

                thumbnailFileID =
                    smallestThumbnail.fileId;

                telegramThumbnail = {

                    fileId:
                        smallestThumbnail.fileId,

                    width:
                        smallestThumbnail.width ??
                        null,

                    height:
                        smallestThumbnail.height ??
                        null,

                    type:
                        smallestThumbnail.type ??
                        null

                };

            }

        }


        /*
         * Create the album item.
         *
         * tags starts empty and is populated asynchronously
         * from the embedded XMP metadata below.
         */

        images.push({

            source:
                "telegram",

            telegramChatID:
                chat.id,

            messageID:
                message.id,

            telegramFileID:
                fileID,

            telegramThumbnailFileID:
                thumbnailFileID,

            telegramThumbnail:
                telegramThumbnail,

            mimeType:
                mimeType,

            fileName:
                fileName,

            width:
                width,

            height:
                height,

            tags:
				existingTagsByMessageID.get(
					String(message.id)
				) || [],

            telegramMediaType:
                mediaType

        });

    }


    /*
     * Store media items immediately so the gallery can
     * begin displaying without waiting for full originals.
     */

    album.images =
        images;


    /*
     * Determine cover.
     */

    let coverImage =
        null;

    if (
        coverMessageID
    ) {

        coverImage =
            images.find(
                image =>
                    String(
                        image.messageID
                    ) ===
                    String(
                        coverMessageID
                    )
            );

    }


    if (
        !coverImage &&
        images.length
    ) {

        coverImage =
            images[0];

    }


    /*
     * Store Telegram metadata.
     */

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


async function loadTelegramAlbumCover(album) {

    if (!window.telegramClient) {
        throw new Error(
            "Telegram client is not initialized."
        );
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
        new URLSearchParams(
            optionString
        );

    const coverMessageID =
        options.get("cover");

    const messageIDs =
        options.get("messages");

    let chat =
        null;

    if (
        Array.isArray(
            window.telegramChats
        )
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

    /*
     * Choose exactly one message.
     *
     * If a cover was explicitly specified, use it.
     * Otherwise choose one message ID locally so we
     * never request the entire album just to choose
     * a random cover.
     */
    let selectedMessageID =
        null;

    if (coverMessageID) {

        selectedMessageID =
            Number(
                coverMessageID
            );

    }
    else if (messageIDs) {

        const ids =
            messageIDs
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

        if (ids.length) {

            selectedMessageID =
                ids[
                    Math.floor(
                        Math.random() *
                        ids.length
                    )
                ];
        }
    }

    /*
     * If there were no message IDs in the URL,
     * fall back to a small history request.
     */
    let message =
        null;

    if (selectedMessageID) {

        message =
            await client.getMessage(
                chat.id,
                selectedMessageID
            );

    }
    else {

        const history =
            await client.getHistory(
                chat.id,
                {
                    limit:
                        20
                }
            );

        const imageMessages =
            history.filter(
                candidate =>
                    candidate &&
                    (
                        candidate.document ||
                        candidate.photo
                    )
            );

        if (!imageMessages.length) {
            throw new Error(
                "Telegram album contains no image messages."
            );
        }

        message =
            imageMessages[
                Math.floor(
                    Math.random() *
                    imageMessages.length
                )
            ];

        selectedMessageID =
            Number(
                message.id
            );
    }

    if (!message) {
        throw new Error(
            "Telegram cover message was not found."
        );
    }

    /*
     * Download a thumbnail from a raw Telegram
     * messageMediaDocument/messageMediaPhoto.
     *
     * This is intentionally based on the raw MTProto
     * representation because that is the structure
     * which is guaranteed to contain the current
     * file_reference and thumbnail information.
     */
    async function downloadRawMediaThumbnail(
        rawMessage
    ) {

        if (
            !rawMessage ||
            !rawMessage.media
        ) {
            throw new Error(
                "Telegram cover message has no media."
            );
        }

        let location =
            null;

        if (
            rawMessage.media._ ===
                "messageMediaDocument"
        ) {

            const document =
                rawMessage.media.document;

            if (
                !document ||
                document._ !==
                    "document"
            ) {
                throw new Error(
                    "Telegram cover document is unavailable."
                );
            }

            const thumbs =
                Array.isArray(
                    document.thumbs
                )
                    ? document.thumbs.filter(
                        thumb =>
                            thumb &&
                            (
                                thumb._ ===
                                    "photoSize" ||
                                thumb._ ===
                                    "photoCachedSize"
                            )
                    )
                    : [];

            if (!thumbs.length) {
                throw new Error(
                    "Telegram cover has no thumbnail."
                );
            }

            const thumbnail =
                thumbs
                    .slice()
                    .sort(
                        (a, b) =>
                            (
                                (b.w || 0) *
                                (b.h || 0)
                            ) -
                            (
                                (a.w || 0) *
                                (a.h || 0)
                            )
                    )[0];

            if (
                thumbnail._ ===
                    "photoCachedSize"
            ) {

                return new Blob(
                    [
                        thumbnail.bytes
                    ],
                    {
                        type:
                            "image/jpeg"
                    }
                );
            }

            location = {
                _:
                    "inputDocumentFileLocation",

                id:
                    document.id,

                access_hash:
                    document.access_hash,

                file_reference:
                    document.file_reference ||
                        new Uint8Array(),

                thumb_size:
                    thumbnail.type ||
                    ""
            };
        }

        else if (
            rawMessage.media._ ===
                "messageMediaPhoto"
        ) {

            const photo =
                rawMessage.media.photo;

            if (
                !photo ||
                photo._ !==
                    "photo"
            ) {
                throw new Error(
                    "Telegram cover photo is unavailable."
                );
            }

            const sizes =
                Array.isArray(
                    photo.sizes
                )
                    ? photo.sizes.filter(
                        size =>
                            size &&
                            (
                                size._ ===
                                    "photoSize" ||
                                size._ ===
                                    "photoCachedSize"
                            )
                    )
                    : [];

            if (!sizes.length) {
                throw new Error(
                    "Telegram cover has no thumbnail."
                );
            }

            const thumbnail =
                sizes
                    .slice()
                    .sort(
                        (a, b) =>
                            (
                                (b.w || 0) *
                                (b.h || 0)
                            ) -
                            (
                                (a.w || 0) *
                                (a.h || 0)
                            )
                    )[0];

            if (
                thumbnail._ ===
                    "photoCachedSize"
            ) {

                return new Blob(
                    [
                        thumbnail.bytes
                    ],
                    {
                        type:
                            "image/jpeg"
                    }
                );
            }

            location = {
                _:
                    "inputPhotoFileLocation",

                id:
                    photo.id,

                access_hash:
                    photo.access_hash,

                file_reference:
                    photo.file_reference ||
                        new Uint8Array(),

                thumb_size:
                    thumbnail.type ||
                    ""
            };
        }

        else {

            throw new Error(
                "Telegram cover message is not an image."
            );
        }

        if (!location) {
            throw new Error(
                "Telegram cover thumbnail location could not be created."
            );
        }

        const chunks =
            await downloadTelegramLocationRaw(
                location,
                {
                    chunkSize:
                        64 * 1024
                }
            );

        if (
            !chunks ||
            !chunks.length
        ) {
            throw new Error(
                "Telegram returned an empty cover thumbnail."
            );
        }

        return new Blob(
            chunks,
            {
                type:
                    "image/jpeg"
            }
        );
    }

    /*
     * Always refresh this ONE selected message.
     *
     * This is the important difference from the
     * original problematic version: we refresh only
     * the randomly selected message, never all
     * messages in the album.
     *
     * It also restores the raw-media handling from
     * the version that was known to work.
     */
    const inputChannel =
        await client.getInputChannel(
            chat.id
        );

    const result =
        await client.invoke({
            _:
                "channels.getMessages",

            channel:
                inputChannel,

            id: [
                {
                    _:
                        "inputMessageID",

                    id:
                        selectedMessageID
                }
            ]
        });

    const rawMessage =
        Array.isArray(
            result?.messages
        )
            ? result.messages.find(
                item =>
                    item &&
                    Number(item.id) ===
                        selectedMessageID
            )
            : null;

    if (!rawMessage) {
        throw new Error(
            "Telegram cover message could not be refreshed."
        );
    }

    const blob =
        await downloadRawMediaThumbnail(
            rawMessage
        );

    return {
        url:
            URL.createObjectURL(
                blob
            ),

        messageID:
            selectedMessageID
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


        /*
         * Find the selected chat.
         */

        let chat = null;

        if (Array.isArray(window.telegramChats)) {

            const found =
                window.telegramChats.find(
                    item =>
                        item &&
                        item.chat &&
                        String(item.chat.id) ===
                        String(chatID)
                );

            if (found) {
                chat = found.chat;
            }
        }

        if (!chat) {

            const chats =
                await client.getChats({
                    limit: 500
                });

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
                chat = found.chat;
            }
        }

        if (!chat) {
            throw new Error(
                "Telegram chat was not found: " +
                chatID
            );
        }


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

            images:
                [],

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
         * Load the actual Telegram media.
         *
         * loadTelegramAlbum() does NOT perform any XMP
         * processing. It only creates the image records.
         */

        await loadAlbum(
            album,
            false
        );

        /*
		 * Wait until every image has gone through the normal
		 * medium/full Telegram loading path.
		 *
		 * Telegram's "medium" loader downloads the full original,
		 * and the Telegram image source extracts XMP from that
		 * same Blob before returning the image URL.
		 */
		await waitForMediumLoading();
		
		setTelegramImportSavingState(false);

		const allTags = [];
		for (const image of album.images) {
			for (const tag of image.tags || []) {
				allTags.push(tag);
			}
		}
		album.tags = uniqueTags(allTags);

		console.log(
			"[Telegram TEMP] Medium loading complete; saving album",
			{
				images: album.images.length,
				imagesWithTags: album.images.filter(
					image =>
						Array.isArray(image.tags) &&
						image.tags.length
				).length,
				totalTags: album.images.reduce(
					(count, image) =>
						count +
						(
							Array.isArray(image.tags)
								? image.tags.length
								: 0
						),
					0
				)
			}
		);

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
