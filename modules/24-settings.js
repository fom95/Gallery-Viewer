/*
 * 24-settings.js
 *
 * The home-page settings menu and the site config editor (album list
 * URL, per-provider credentials and URL blueprints).
 */

function createSecretReveal(input) {

    const toggle =
        document.createElement("button");

    toggle.type =
        "button";

    toggle.className =
        "settings-pair-reveal";

    toggle.textContent =
        "show";

    toggle.title =
        "Show or hide this value";

    toggle.onclick =
        () => {

            const hidden =
                input.type === "password";

            input.type =
                hidden ? "text" : "password";

            toggle.textContent =
                hidden ? "hide" : "show";

        };

    return toggle;

}


function attachSecretReveal(input) {

    input.type =
        "password";

    input.style.marginBottom =
        "0";

    const wrap =
        document.createElement("div");

    wrap.className =
        "settings-secret-row";

    wrap.append(
        input,
        createSecretReveal(input)
    );

    return wrap;

}


/*
 * One pair-row is either:
 *   - name blank, value filled  -> a plain literal ("value")
 *   - name filled, value blank  -> a field reference (["name"])
 *   - both filled                -> a conditional literal
 *                                   (["value", "name"])
 * This covers every blueprint part type (see buildProviderUrl() in
 * 00-config-and-state.js) with just two fields per row.
 *
 * options.secret masks the value and adds a show/hide control; the
 * credentials list uses it so tokens are not on screen by default.
 */
function createSettingsPairRow(
    container,
    name = "",
    value = "",
    options = {}
) {

    const row =
        document.createElement("div");

    row.className =
        "settings-pair-row";

    const nameInput =
        document.createElement("input");

    nameInput.type =
        "text";

    nameInput.className =
        "settings-pair-name";

    nameInput.placeholder =
        "Name";

    nameInput.value =
        name;

    const valueInput =
        document.createElement("input");

    valueInput.type =
        options.secret ? "password" : "text";

    valueInput.className =
        "settings-pair-value";

    valueInput.placeholder =
        "Value";

    valueInput.value =
        value;

    const removeBtn =
        document.createElement("button");

    removeBtn.type =
        "button";

    removeBtn.className =
        "settings-pair-remove";

    removeBtn.textContent =
        "×";

    removeBtn.onclick =
        () => row.remove();

    row.append(
        nameInput,
        valueInput,
        ...(options.secret
            ? [createSecretReveal(valueInput)]
            : []),
        removeBtn
    );

    container.appendChild(row);

    return row;

}


function collectSettingsCredentialPairs(container) {

    const result =
        {};

    container
        .querySelectorAll(".settings-pair-row")
        .forEach(row => {

            const name =
                row.querySelector(".settings-pair-name").value.trim();

            const value =
                row.querySelector(".settings-pair-value").value;

            if (!name)
                return;

            result[name] =
                value;

        });

    return result;

}


function collectSettingsMapParts(container) {

    const parts =
        [];

    container
        .querySelectorAll(".settings-pair-row")
        .forEach(row => {

            const name =
                row.querySelector(".settings-pair-name").value.trim();

            const value =
                row.querySelector(".settings-pair-value").value;

            if (!name && !value)
                return;

            if (!name) {

                parts.push(value);

            } else if (!value) {

                parts.push([name]);

            } else {

                parts.push([value, name]);

            }

        });

    return parts;

}


/*
 * The inverse of collectSettingsMapParts(), used to prefill the form
 * when reopening it with an already-loaded siteConfig.
 */
function blueprintPartToPair(part) {

    if (typeof part === "string")
        return { name: "", value: part };

    if (Array.isArray(part) && part.length >= 2)
        return { name: part[1], value: part[0] };

    if (Array.isArray(part) && part.length === 1)
        return { name: part[0], value: "" };

    return { name: "", value: "" };

}


function updateSettingsSourceSummary(block) {

    const summary =
        block.querySelector(".settings-source-summary");

    if (!summary)
        return;

    const mapCount =
        block.querySelectorAll(
            '.settings-pairs[data-kind="map"] .settings-pair-row'
        ).length;

    const credCount =
        block.querySelectorAll(
            '.settings-pairs[data-kind="credentials"] .settings-pair-row'
        ).length;

    const authMode =
        block.querySelector(".settings-auth-mode")?.value || "none";

    const authLabel =
        authMode === "signed-query"
            ? "signed auth"
            : authMode === "token-query"
                ? "token auth"
                : "no auth";

    const parts = [
        `${mapCount} URL part${mapCount === 1 ? "" : "s"}`,
        authLabel
    ];

    const videoMode =
        block.querySelector(".settings-delivery-videos")?.value || "auto";

    const imageMode =
        block.querySelector(".settings-delivery-images")?.value || "auto";

    if (imageMode !== "auto")
        parts.push(`images ${imageMode}`);

    if (videoMode !== "auto")
        parts.push(`video ${videoMode}`);

    if (credCount) {
        parts.push(
            `${credCount} credential${credCount === 1 ? "" : "s"}`
        );
    }

    summary.textContent =
        parts.join(" · ");

}


function setSettingsSourceExpanded(block, expanded) {

    block.classList.toggle(
        "expanded",
        expanded
    );

    const toggle =
        block.querySelector(".settings-source-toggle");

    if (toggle) {

        toggle.textContent =
            expanded ? "▾" : "▸";

        toggle.setAttribute(
            "aria-expanded",
            expanded ? "true" : "false"
        );

        toggle.title =
            expanded
                ? "Hide source settings"
                : "Show source settings";

    }

    if (!expanded)
        updateSettingsSourceSummary(block);

}


function createSettingsSourceBlock(
    sourcesList,
    sourceName,
    blueprint,
    credentials,
    auth = null
) {

    const block =
        document.createElement("div");

    block.className =
        "settings-source";

    const header =
        document.createElement("div");

    header.className =
        "settings-source-header";

    const nameInput =
        document.createElement("input");

    nameInput.type =
        "text";

    nameInput.className =
        "settings-source-name";

    nameInput.placeholder =
        "Source name (e.g. imgbb)";

    nameInput.value =
        sourceName || "";

    const removeBtn =
        document.createElement("button");

    removeBtn.type =
        "button";

    removeBtn.className =
        "settings-source-remove";

    removeBtn.textContent =
        "Remove Source";

    removeBtn.onclick =
        () => block.remove();

    const toggle =
        document.createElement("button");

    toggle.type =
        "button";

    toggle.className =
        "settings-source-toggle";

    toggle.textContent =
        "▸";

    toggle.setAttribute(
        "aria-expanded",
        "false"
    );

    toggle.title =
        "Show source settings";

    toggle.onclick =
        e => {

            e.stopPropagation();

            setSettingsSourceExpanded(
                block,
                !block.classList.contains("expanded")
            );

        };

    header.append(toggle, nameInput, removeBtn);

    header.onclick =
        e => {

            if (e.target.closest("input, button"))
                return;

            setSettingsSourceExpanded(
                block,
                !block.classList.contains("expanded")
            );

        };

    const summary =
        document.createElement("div");

    summary.className =
        "settings-source-summary";

    const credTitle =
        document.createElement("div");

    credTitle.className =
        "settings-subsection-title";

    credTitle.textContent =
        "Credentials (optional)";

    const credContainer =
        document.createElement("div");

    credContainer.className =
        "settings-pairs";

    credContainer.dataset.kind =
        "credentials";

    const credAddBtn =
        document.createElement("button");

    credAddBtn.type =
        "button";

    credAddBtn.className =
        "settings-add-pair";

    credAddBtn.textContent =
        "+ Add credential";

    credAddBtn.onclick =
        () => createSettingsPairRow(
            credContainer,
            "",
            "",
            { secret: true }
        );

    const mapTitle =
        document.createElement("div");

    mapTitle.className =
        "settings-subsection-title";

    mapTitle.textContent =
        "URL Map (at least one part is required)";

    const mapContainer =
        document.createElement("div");

    mapContainer.className =
        "settings-pairs";

    mapContainer.dataset.kind =
        "map";

    const mapAddBtn =
        document.createElement("button");

    mapAddBtn.type =
        "button";

    mapAddBtn.className =
        "settings-add-pair";

    mapAddBtn.textContent =
        "+ Add part";

    mapAddBtn.onclick =
        () => createSettingsPairRow(mapContainer);

    /*
     * Authentication belongs to the endpoint, not to the import
     * credentials. The two URL-based modes are what an <img> can use:
     * a signed query token (password never in the URL) or a static
     * token for endpoints that cannot sign.
     */
    const authTitle =
        document.createElement("div");

    authTitle.className =
        "settings-subsection-title";

    authTitle.textContent =
        "Endpoint authentication (optional)";

    const authRow =
        document.createElement("div");

    authRow.className =
        "settings-auth-row";

    const authMode =
        document.createElement("select");

    authMode.className =
        "settings-auth-mode";

    for (
        const [value, label] of [
            ["none", "None"],
            ["signed-query", "Signed URL (HMAC)"],
            ["token-query", "Static URL token"]
        ]
    ) {

        const option =
            document.createElement("option");

        option.value =
            value;

        option.textContent =
            label;

        authMode.appendChild(option);

    }

    const authParam =
        document.createElement("input");

    authParam.type =
        "text";

    authParam.className =
        "settings-auth-param";

    authParam.placeholder =
        "Query parameter (e.g. auth)";

    const authSecret =
        document.createElement("input");

    authSecret.type =
        "password";

    authSecret.className =
        "settings-auth-secret";

    authSecret.placeholder =
        "Signing password / token";

    const authSecretField =
        attachSecretReveal(authSecret);

    const authHint =
        document.createElement("div");

    authHint.className =
        "settings-auth-hint";

    const syncAuthUi =
        () => {

            const mode =
                authMode.value;

            const disabled =
                mode === "none";

            authParam.disabled =
                disabled;

            authSecret.disabled =
                disabled;

            authHint.textContent =
                mode === "signed-query"
                    ? "Appends ?param=expiry.hmac. The password signs " +
                      "each URL and never appears in one; the endpoint " +
                      "must verify it with the same value."
                    : mode === "token-query"
                        ? "Appends the token as-is. Use only when the " +
                          "endpoint cannot sign; URLs end up in logs and " +
                          "history."
                        : "No auth parameter is appended.";

        };

    authMode.onchange =
        syncAuthUi;

    authMode.value =
        auth?.mode || "none";

    authParam.value =
        auth?.param || "auth";

    authSecret.value =
        auth?.secret || "";

    syncAuthUi();

    authRow.append(authMode, authParam);

    /*
     * Delivery is optional. With no setting the site behaves exactly as
     * before: images go straight to the element and videos stream when
     * the endpoint supports ranges. Power users can force blob
     * downloads, external opening, or a non-range endpoint here.
     */
    const delivery =
        typeof getProviderDelivery === "function"
            ? getProviderDelivery(sourceName || "")
            : {
                images: "auto",
                videos: "auto",
                range: true,
                maxDownloadMB: 50
            };

    const deliveryTitle =
        document.createElement("div");

    deliveryTitle.className =
        "settings-subsection-title";

    deliveryTitle.textContent =
        "Delivery (optional)";

    const deliveryRow =
        document.createElement("div");

    deliveryRow.className =
        "settings-delivery-row";

    const imagesSelect =
        document.createElement("select");

    imagesSelect.className =
        "settings-delivery-images";

    for (
        const [value, label] of [
            ["auto", "Images: auto"],
            ["direct", "Images: direct URL"],
            ["download", "Images: download"]
        ]
    ) {

        const option =
            document.createElement("option");

        option.value = value;
        option.textContent = label;
        imagesSelect.appendChild(option);

    }

    const videosSelect =
        document.createElement("select");

    videosSelect.className =
        "settings-delivery-videos";

    for (
        const [value, label] of [
            ["auto", "Videos: auto"],
            ["stream", "Videos: stream"],
            ["download", "Videos: download"],
            ["external", "Videos: external"]
        ]
    ) {

        const option =
            document.createElement("option");

        option.value = value;
        option.textContent = label;
        videosSelect.appendChild(option);

    }

    imagesSelect.value =
        delivery.images;

    videosSelect.value =
        delivery.videos;

    deliveryRow.append(imagesSelect, videosSelect);

    const deliveryOptionsRow =
        document.createElement("div");

    deliveryOptionsRow.className =
        "settings-delivery-row settings-delivery-options";

    const rangeLabel =
        document.createElement("label");

    rangeLabel.className =
        "settings-delivery-check";

    const rangeInput =
        document.createElement("input");

    rangeInput.type =
        "checkbox";

    rangeInput.className =
        "settings-delivery-range";

    rangeInput.checked =
        delivery.range !== false;

    const rangeText =
        document.createElement("span");

    rangeText.textContent =
        "Endpoint supports ranges";

    rangeLabel.append(rangeInput, rangeText);

    const maxLabel =
        document.createElement("label");

    maxLabel.className =
        "settings-delivery-max";

    const maxText =
        document.createElement("span");

    maxText.textContent =
        "Max download (MB)";

    const maxInput =
        document.createElement("input");

    maxInput.type =
        "number";

    maxInput.className =
        "settings-delivery-max-input";

    maxInput.min = "1";
    maxInput.max = "4096";
    maxInput.value =
        String(delivery.maxDownloadMB);

    maxLabel.append(maxText, maxInput);

    deliveryOptionsRow.append(rangeLabel, maxLabel);

    const deliveryHint =
        document.createElement("div");

    deliveryHint.className =
        "settings-auth-hint";

    deliveryHint.textContent =
        "Auto streams when ranges are supported, otherwise downloads " +
        "small files and opens large ones externally. Download needs " +
        "CORS on the endpoint; direct URL is the fastest path.";

    const body =
        document.createElement("div");

    body.className =
        "settings-source-body";

    body.append(
        mapTitle, mapContainer, mapAddBtn,
        authTitle, authRow, authSecretField, authHint,
        deliveryTitle, deliveryRow, deliveryOptionsRow, deliveryHint,
        credTitle, credContainer, credAddBtn
    );

    block.append(header, summary, body);

    sourcesList.appendChild(block);

    if (credentials) {

        for (const [name, value] of Object.entries(credentials)) {

            /* Migrated into the auth subsection above. */
            if (name === "auth_password")
                continue;

            createSettingsPairRow(
                credContainer,
                name,
                String(value),
                { secret: true }
            );

        }

    }

    if (Array.isArray(blueprint) && blueprint.length) {

        for (const part of blueprint) {

            const pair =
                blueprintPartToPair(part);

            createSettingsPairRow(mapContainer, pair.name, pair.value);

        }

    } else {

        /*
         * The map is required, so a brand-new source starts with one
         * empty row ready to fill in rather than an empty list.
         */
        createSettingsPairRow(mapContainer);

    }

    setSettingsSourceExpanded(block, false);

    return block;

}


/*
 * Reads the editor's current form state into a site config object and
 * returns it together with a list of problems found (empty list means
 * it's valid). Shared by Generate (builds the ?@ URL) and Save & Apply
 * (stores the config and connects Telegram).
 */
function collectSiteConfigFromEditor(overlay) {

    const issues =
        [];

    const providers =
        {};

    const credentials =
        {};

    overlay
        .querySelectorAll(
            "#settingsSourcesList .settings-source"
        )
        .forEach(block => {

            const name =
                block.querySelector(".settings-source-name")
                    .value.trim();

            const mapContainer =
                block.querySelector(
                    '.settings-pairs[data-kind="map"]'
                );

            const credContainer =
                block.querySelector(
                    '.settings-pairs[data-kind="credentials"]'
                );

            if (!name) {

                issues.push("A source is missing a name.");

                return;

            }

            const mapParts =
                collectSettingsMapParts(mapContainer);

            if (!mapParts.length) {

                issues.push(
                    `"${name}" needs at least one URL map part.`
                );

                return;

            }

            const authMode =
                block.querySelector(".settings-auth-mode")
                    ?.value || "none";

            const authParam =
                block.querySelector(".settings-auth-param")
                    ?.value.trim() || "auth";

            const authSecret =
                block.querySelector(".settings-auth-secret")
                    ?.value.trim() || "";

            const provider = {
                url: mapParts
            };

            if (authMode !== "none") {

                if (!authSecret) {

                    issues.push(
                        `"${name}" has endpoint authentication but no ` +
                        "signing password/token."
                    );

                    return;

                }

                provider.auth = {
                    mode: authMode,
                    param: authParam,
                    secret: authSecret
                };

            }

            const imagesDelivery =
                block.querySelector(".settings-delivery-images")
                    ?.value || "auto";

            const videosDelivery =
                block.querySelector(".settings-delivery-videos")
                    ?.value || "auto";

            const rangeSupport =
                block.querySelector(".settings-delivery-range")
                    ?.checked !== false;

            const maxDownloadMB =
                Math.max(
                    1,
                    Math.min(
                        Number(
                            block.querySelector(
                                ".settings-delivery-max-input"
                            )?.value
                        ) || 50,
                        4096
                    )
                );

            const delivery = {};

            if (imagesDelivery !== "auto")
                delivery.images = imagesDelivery;

            if (videosDelivery !== "auto")
                delivery.videos = videosDelivery;

            if (!rangeSupport)
                delivery.range = false;

            if (maxDownloadMB !== 50)
                delivery.maxDownloadMB = maxDownloadMB;

            if (Object.keys(delivery).length)
                provider.delivery = delivery;

            providers[name] = provider;

            const creds =
                collectSettingsCredentialPairs(credContainer);

            if (Object.keys(creds).length)
                credentials[name] = creds;

        });

    const config =
        {};

    const albumUrl =
        overlay.querySelector("#settingsAlbumUrl")
            .value.trim();

    if (albumUrl)
        config.album = albumUrl;

    if (Object.keys(credentials).length)
        config.credentials = credentials;

    const workerUrl =
        overlay.querySelector("#settingsWorkerUrl")
            .value.trim();

    const workerToken =
        overlay.querySelector("#settingsWorkerToken")
            .value;

    if (workerUrl) {

        config.worker = {
            url: workerUrl
        };

        if (workerToken)
            config.worker.token = workerToken;

    }

    const tagsIndexUrl =
        overlay.querySelector("#settingsTagsIndexUrl")
            ?.value.trim() || "";

    const tagsIndexToken =
        (overlay.querySelector("#settingsTagsIndexToken")
            ?.value || "").trim();

    if (tagsIndexUrl) {

        config.tagsIndex = {
            url: tagsIndexUrl
        };

        if (tagsIndexToken)
            config.tagsIndex.token = tagsIndexToken;

    }

    if (Object.keys(providers).length)
        config.providers = providers;

    /*
     * Save the optional GitHub write token separately. It is not part of
     * config and therefore cannot leak through a generated config URL.
     */
    const albumLibraryToken =
        overlay.querySelector(
            "#settingsAlbumLibraryToken"
        )?.value || "";

    if (typeof setAlbumLibraryToken === "function")
        setAlbumLibraryToken(albumLibraryToken);

    return {
        config,
        issues
    };

}


/*
 * Whether a generated ?@ config link should carry secrets is a
 * per-browser preference, not part of the config itself: the link may
 * be pasted anywhere, while the choice of what goes into it should
 * stick for the person generating it.
 */
const SHARE_CONFIG_SECRETS_STORAGE_KEY =
    "shareConfigSecrets";

const SHARE_CONFIG_SESSION_STORAGE_KEY =
    "shareConfigTelegramSession";


function readConfigShareOption(key) {

    try {

        return localStorage.getItem(key) === "1";

    } catch {

        return false;

    }

}


function writeConfigShareOption(key, enabled) {

    try {

        localStorage.setItem(
            key,
            enabled ? "1" : "0"
        );

    } catch {}

}


/*
 * Builds the config that actually goes into a generated URL.
 *
 * The working config needs credentials to fetch images, but a link
 * does not have to. When secrets are excluded the payload keeps only
 * the public shape (album URL, provider maps, Worker/index URLs), so
 * whoever opens it keeps their own credentials. Turning on the
 * Telegram session option embeds an mtcute session string so a fresh
 * browser can connect without a phone login.
 */
function buildShareableSiteConfig(config, options = {}) {

    const share =
        JSON.parse(
            JSON.stringify(config || {})
        );

    delete share.telegramSession;

    if (!options.includeSecrets) {

        delete share.credentials;
        delete share.albumLibraryToken;

        if (share.providers) {

            for (const provider of Object.values(share.providers)) {

                if (provider)
                    delete provider.auth;

            }

        }

        if (share.worker)
            delete share.worker.token;

        if (share.tagsIndex)
            delete share.tagsIndex.token;

    } else {

        const token =
            typeof getAlbumLibraryToken === "function"
                ? getAlbumLibraryToken()
                : "";

        if (token)
            share.albumLibraryToken = token;

    }

    if (options.includeTelegramSession) {

        const session =
            typeof getConfiguredTelegramSession === "function"
                ? getConfiguredTelegramSession()
                : "";

        if (session)
            share.telegramSession = session;

    }

    return share;

}


function openSiteConfigEditor() {

    let overlay =
        document.getElementById("settingsOverlay");

    if (overlay) {

        overlay.style.display =
            "flex";

        return;

    }

    overlay =
        document.createElement("div");

    overlay.id =
        "settingsOverlay";

    overlay.className =
        "app-dialog-overlay";

    const box =
        document.createElement("div");

    box.className =
        "app-dialog";

    box.style.width =
        "min(560px, 94vw)";

    const title =
        document.createElement("div");

    title.className =
        "app-dialog-title";

    title.textContent =
        "Site Settings";

    const albumLabel =
        document.createElement("div");

    albumLabel.className =
        "settings-field-label";

    albumLabel.textContent =
        "Album List URL";

    const albumInput =
        document.createElement("input");

    albumInput.type =
        "text";

    albumInput.id =
        "settingsAlbumUrl";

    albumInput.placeholder =
        "https://.../album.txt";

    albumInput.style.width =
        "100%";

    albumInput.style.boxSizing =
        "border-box";

    albumInput.style.marginBottom =
        "16px";

    albumInput.value =
        siteConfig?.album || "";

    /*
     * The write token is stored outside siteConfig, so a generated link
     * only carries it when the "Include credentials and tokens" option
     * below is explicitly enabled.
     */
    const albumLibraryLabel =
        document.createElement("div");

    albumLibraryLabel.className =
        "settings-field-label";

    albumLibraryLabel.textContent =
        "GitHub album library token (optional)";

    const albumLibraryTokenInput =
        document.createElement("input");

    albumLibraryTokenInput.type =
        "password";

    albumLibraryTokenInput.id =
        "settingsAlbumLibraryToken";

    albumLibraryTokenInput.placeholder =
        "Fine-grained token with Contents: Read and write";

    albumLibraryTokenInput.style.width =
        "100%";

    albumLibraryTokenInput.style.boxSizing =
        "border-box";

    albumLibraryTokenInput.value =
        typeof getAlbumLibraryToken === "function"
            ? getAlbumLibraryToken()
            : "";

    const albumLibraryHint =
        document.createElement("div");

    albumLibraryHint.style.fontSize =
        "11px";

    albumLibraryHint.style.opacity =
        "0.65";

    albumLibraryHint.style.margin =
        "4px 0 16px";

    albumLibraryHint.textContent =
        "Enables the optional Upload to Library action for a GitHub-hosted album list. " +
        "Use a token limited to this repository with Contents: Read and write. " +
        "It is stored in this browser and only travels in a generated link when " +
        "\"Include credentials and tokens\" is enabled below.";

    const workerLabel =
        document.createElement("div");

    workerLabel.className =
        "settings-field-label";

    workerLabel.textContent =
        "Video Worker URL and access token (optional)";

    const workerUrlInput =
        document.createElement("input");

    workerUrlInput.type =
        "text";

    workerUrlInput.id =
        "settingsWorkerUrl";

    workerUrlInput.placeholder =
        "https://your-worker.example.com";

    workerUrlInput.style.width =
        "100%";

    workerUrlInput.style.boxSizing =
        "border-box";

    workerUrlInput.style.marginBottom =
        "6px";

    workerUrlInput.value =
        siteConfig?.worker?.url || "";

    const workerTokenInput =
        document.createElement("input");

    workerTokenInput.type =
        "password";

    workerTokenInput.id =
        "settingsWorkerToken";

    workerTokenInput.placeholder =
        "Access token for editing/sync";

    workerTokenInput.style.width =
        "100%";

    workerTokenInput.style.boxSizing =
        "border-box";

    workerTokenInput.style.marginBottom =
        "16px";

    workerTokenInput.value =
        siteConfig?.worker?.token || "";

    /*
     * The tag index lives on its own Worker and has its own write
     * token, so it does not borrow the Telegram credentials.
     */
    const tagsIndexLabel =
        document.createElement("div");

    tagsIndexLabel.className =
        "settings-field-label";

    tagsIndexLabel.textContent =
        "Tags Index Worker (Cloudflare D1, optional)";

    const tagsIndexUrlInput =
        document.createElement("input");

    tagsIndexUrlInput.type =
        "text";

    tagsIndexUrlInput.id =
        "settingsTagsIndexUrl";

    tagsIndexUrlInput.placeholder =
        "https://tags-index.your-name.workers.dev";

    tagsIndexUrlInput.style.width =
        "100%";

    tagsIndexUrlInput.style.boxSizing =
        "border-box";

    tagsIndexUrlInput.style.marginBottom =
        "6px";

    tagsIndexUrlInput.value =
        siteConfig?.tagsIndex?.url || "";

    const tagsIndexTokenInput =
        document.createElement("input");

    tagsIndexTokenInput.type =
        "password";

    tagsIndexTokenInput.id =
        "settingsTagsIndexToken";

    tagsIndexTokenInput.placeholder =
        "Index write token";

    tagsIndexTokenInput.style.width =
        "100%";

    tagsIndexTokenInput.style.boxSizing =
        "border-box";

    tagsIndexTokenInput.style.marginBottom =
        "16px";

    tagsIndexTokenInput.value =
        siteConfig?.tagsIndex?.token || "";

    const sourcesList =
        document.createElement("div");

    sourcesList.id =
        "settingsSourcesList";

    const addSourceBtn =
        document.createElement("button");

    addSourceBtn.type =
        "button";

    addSourceBtn.id =
        "settingsAddSource";

    addSourceBtn.textContent =
        "+ Add Source";

    addSourceBtn.onclick =
        () => {

            /*
             * window.prompt() throws in the desktop browser, so a new
             * source block is added straight away with its name field
             * focused -- the name is typed in the page itself.
             */
            const block =
                createSettingsSourceBlock(
                    sourcesList,
                    "",
                    null,
                    null
                );

            setSettingsSourceExpanded(block, true);

            const nameInput =
                block.querySelector(".settings-source-name");

            if (nameInput) {

                nameInput.focus();

                block.scrollIntoView({
                    block: "nearest"
                });

            }

        };

    /*
     * Secrets in generated links are opt-in. Keeping them out by
     * default is the same rule the album library token already used.
     */
    const shareSection =
        document.createElement("div");

    shareSection.className =
        "settings-share-section";

    const shareTitle =
        document.createElement("div");

    shareTitle.className =
        "settings-field-label";

    shareTitle.textContent =
        "Generated link contents";

    const shareSecretsRow =
        document.createElement("label");

    shareSecretsRow.className =
        "settings-share-option";

    const shareSecretsInput =
        document.createElement("input");

    shareSecretsInput.type =
        "checkbox";

    shareSecretsInput.id =
        "settingsShareSecrets";

    shareSecretsInput.checked =
        readConfigShareOption(
            SHARE_CONFIG_SECRETS_STORAGE_KEY
        );

    const shareSecretsText =
        document.createElement("span");

    shareSecretsText.textContent =
        "Include credentials and tokens";

    shareSecretsRow.append(
        shareSecretsInput,
        shareSecretsText
    );

    const shareSecretsHint =
        document.createElement("div");

    shareSecretsHint.className =
        "settings-share-hint";

    shareSecretsHint.textContent =
        "Writes provider credentials, endpoint auth secrets, the Worker and Tag Index " +
        "tokens, and the GitHub album library token into the compressed link so it works " +
        "on its own. Anyone with the link can read them.";

    const shareSessionRow =
        document.createElement("label");

    shareSessionRow.className =
        "settings-share-option";

    const shareSessionInput =
        document.createElement("input");

    shareSessionInput.type =
        "checkbox";

    shareSessionInput.id =
        "settingsShareTelegramSession";

    shareSessionInput.checked =
        readConfigShareOption(
            SHARE_CONFIG_SESSION_STORAGE_KEY
        );

    const shareSessionText =
        document.createElement("span");

    shareSessionText.textContent =
        "Include Telegram session";

    shareSessionRow.append(
        shareSessionInput,
        shareSessionText
    );

    const shareSessionHint =
        document.createElement("div");

    shareSessionHint.className =
        "settings-share-hint";

    shareSessionHint.textContent =
        "Embeds the current mtcute session string so a fresh browser can connect " +
        "without a phone login. It grants full access to the Telegram account, so " +
        "only put it in links you keep private.";

    shareSection.append(
        shareTitle,
        shareSecretsRow,
        shareSecretsHint,
        shareSessionRow,
        shareSessionHint
    );

    const persistShareOptions =
        () => {

            writeConfigShareOption(
                SHARE_CONFIG_SECRETS_STORAGE_KEY,
                shareSecretsInput.checked
            );

            writeConfigShareOption(
                SHARE_CONFIG_SESSION_STORAGE_KEY,
                shareSessionInput.checked
            );

        };

    shareSecretsInput.onchange =
        persistShareOptions;

    shareSessionInput.onchange =
        persistShareOptions;

    const resultBox =
        document.createElement("div");

    resultBox.id =
        "settingsResult";

    resultBox.style.display =
        "none";

    resultBox.style.marginTop =
        "16px";

    const resultLabel =
        document.createElement("div");

    resultLabel.className =
        "settings-field-label";

    resultLabel.textContent =
        "Generated URL";

    const resultTextarea =
        document.createElement("textarea");

    resultTextarea.id =
        "settingsResultUrl";

    resultTextarea.rows =
        4;

    resultTextarea.readOnly =
        true;

    const copyBtn =
        document.createElement("button");

    copyBtn.type =
        "button";

    copyBtn.textContent =
        "Copy";

    copyBtn.style.marginTop =
        "8px";

    copyBtn.onclick =
        () => {

            navigator.clipboard
                .writeText(resultTextarea.value)
                .then(() => alert("Copied!"))
                .catch(() => {});

        };

    resultBox.append(resultLabel, resultTextarea, copyBtn);

    const buttons =
        document.createElement("div");

    buttons.style.display =
        "flex";

    buttons.style.justifyContent =
        "flex-end";

    buttons.style.gap =
        "10px";

    buttons.style.marginTop =
        "16px";

    const cancelBtn =
        document.createElement("button");

    cancelBtn.type =
        "button";

    cancelBtn.textContent =
        "Cancel";

    cancelBtn.onclick =
        () => overlay.remove();

    const generateBtn =
        document.createElement("button");

    generateBtn.type =
        "button";

    generateBtn.textContent =
        "Generate";

    generateBtn.onclick =
        async () => {

            const {
                config,
                issues
            } = collectSiteConfigFromEditor(overlay);

            if (issues.length) {

                alert(
                    "Please fix the following before generating:\n\n" +
                    issues.join("\n")
                );

                return;

            }

            let encoded;

            try {

                /*
                 * Generate respects the share toggles. Save & Apply
                 * below still stores the full config in this browser,
                 * which needs its credentials to fetch images.
                 */
                encoded =
                    await compressAlbum(
                        buildShareableSiteConfig(
                            config,
                            {
                                includeSecrets:
                                    shareSecretsInput.checked,
                                includeTelegramSession:
                                    shareSessionInput.checked
                            }
                        )
                    );

            } catch (error) {

                alert(
                    "Failed to generate the URL:\n\n" +
                    (
                        error && error.message
                            ? error.message
                            : String(error)
                    )
                );

                return;

            }

            /*
             * location.origin is "null" for a file:// page, so build the
             * base from the current href instead of origin + pathname.
             */
            const baseUrl =
                location.href
                    .split("?")[0]
                    .split("#")[0];

            const fullUrl =
                baseUrl +
                "?@" +
                encoded;

            resultTextarea.value =
                fullUrl;

            resultBox.style.display =
                "";

        };

    const applyBtn =
        document.createElement("button");

    applyBtn.type =
        "button";

    applyBtn.textContent =
        "Save & Apply";

    applyBtn.title =
        "Store this configuration locally and connect Telegram";

    applyBtn.onclick =
        async () => {

            const {
                config,
                issues
            } = collectSiteConfigFromEditor(overlay);

            if (issues.length) {

                alert(
                    "Please fix the following before saving:\n\n" +
                    issues.join("\n")
                );

                return;

            }

            let encoded;

            try {

                encoded =
                    await compressAlbum(config);

            } catch (error) {

                alert(
                    "Failed to save the configuration:\n\n" +
                    (
                        error && error.message
                            ? error.message
                            : String(error)
                    )
                );

                return;

            }

            saveSiteConfigToStorage(encoded);

            siteConfig =
                config;

            await initProviderAuth();

            overlay.remove();

            /*
             * Credentials may have just appeared, so (re)connect
             * Telegram and rebuild the album list from the new config.
             */
            await initTelegramFromConfig();

            await reloadAlbums();

            await showAlbums();

        };

    buttons.append(cancelBtn, generateBtn, applyBtn);

    box.append(
        title,
        albumLabel, albumInput,
        albumLibraryLabel,
        attachSecretReveal(albumLibraryTokenInput),
        albumLibraryHint,
        workerLabel, workerUrlInput,
        attachSecretReveal(workerTokenInput),
        tagsIndexLabel, tagsIndexUrlInput,
        attachSecretReveal(tagsIndexTokenInput),
        sourcesList,
        addSourceBtn,
        shareSection,
        resultBox,
        buttons
    );

    overlay.appendChild(box);

    document.body.appendChild(overlay);

    overlay.onclick =
        (e) => {

            if (e.target === overlay)
                overlay.remove();

        };

    /*
     * Prefill from whatever config is already loaded, so reopening
     * this is an edit rather than starting from scratch every time.
     */
    if (siteConfig?.providers) {

        for (const name of Object.keys(siteConfig.providers)) {

            const definition =
                getProviderDefinition(name);

            createSettingsSourceBlock(
                sourcesList,
                name,
                definition?.blueprint || [],
                siteConfig.credentials?.[name],
                definition?.auth || null
            );

        }

    }

}

/* ----- Settings menu ----- */

function openSettingsEditor() {

    const existing =
        document.getElementById("settingsMenuOverlay");

    if (existing)
        existing.remove();

    const overlay =
        document.createElement("div");

    overlay.id =
        "settingsMenuOverlay";

    overlay.className =
        "app-dialog-overlay";

    const box =
        document.createElement("div");

    box.className =
        "app-dialog app-settings-menu";

    const title =
        document.createElement("div");

    title.className =
        "app-dialog-title";

    title.textContent =
        "Settings";

    box.appendChild(title);

    const entries = [
        {
            label: "Site Configuration",
            description: "Album list URL, sources and credentials.",
            action: () => openSiteConfigEditor()
        },
        {
            label: "Telegram Session",
            description: "Connect, copy the current session, or import a session string.",
            action: () => openTelegramSessionDialog()
        },
        {
            label: "Telegram Folder Uploader",
            description: "Upload files or folders to a Telegram chat and generate its metadata.json.",
            action: () => openTelegramUploader()
        }
    ];

    /*
     * Only show the index tool when a Worker URL and token are
     * configured; otherwise there is nothing to check.
     */
    if (
        siteConfig?.tagsIndex?.url &&
        siteConfig?.tagsIndex?.token
    ) {
        entries.push({
            label: "Search Index",
            description: "Check or rebuild the Cloudflare D1 tag index.",
            action: () => openTagIndexDialog()
        });
    }

    entries.forEach(entry => {

        const button =
            document.createElement("button");

        button.type =
            "button";

        button.className =
            "app-menu-item";

        const label =
            document.createElement("div");

        label.className =
            "app-menu-label";

        label.textContent =
            entry.label;

        const description =
            document.createElement("div");

        description.className =
            "app-menu-desc";

        description.textContent =
            entry.description;

        button.append(label, description);

        button.onclick =
            () => {

                overlay.remove();

                entry.action();

            };

        box.appendChild(button);

    });

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

    box.appendChild(close);

    overlay.appendChild(box);

    overlay.onclick =
        e => {

            if (e.target === overlay)
                overlay.remove();

        };

    document.body.appendChild(overlay);

}
