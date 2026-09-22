/*
 * 21-config-editor.js
 *
 * A form for building the site config (album URL + per-provider
 * credentials/blueprints) without hand-writing the object and calling
 * compressAlbum() in the console. Opens from the settings cog on the
 * home page.
 */

/*
 * One pair-row is either:
 *   - name blank, value filled  -> a plain literal ("value")
 *   - name filled, value blank  -> a field reference (["name"])
 *   - both filled                -> a conditional literal
 *                                   (["value", "name"])
 * This covers every blueprint part type (see buildProviderUrl() in
 * 00b-config-and-providers.js) with just two fields per row.
 */
function createSettingsPairRow(container, name = "", value = "") {

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
        "text";

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

    row.append(nameInput, valueInput, removeBtn);

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


function createSettingsSourceBlock(sourcesList, sourceName, blueprint, credentials) {

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

    header.append(nameInput, removeBtn);

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
        () => createSettingsPairRow(credContainer);

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

    block.append(
        header,
        credTitle, credContainer, credAddBtn,
        mapTitle, mapContainer, mapAddBtn
    );

    sourcesList.appendChild(block);

    if (credentials) {

        for (const [name, value] of Object.entries(credentials))
            createSettingsPairRow(credContainer, name, String(value));

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

    return block;

}


function openSettingsEditor() {

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

    const box =
        document.createElement("div");

    box.style.background =
        "#222";

    box.style.padding =
        "20px";

    box.style.borderRadius =
        "8px";

    box.style.width =
        "min(560px, 92vw)";

    box.style.maxHeight =
        "85vh";

    box.style.overflowY =
        "auto";

    box.style.boxSizing =
        "border-box";

    const title =
        document.createElement("div");

    title.textContent =
        "Site Settings";

    title.style.fontSize =
        "20px";

    title.style.marginBottom =
        "15px";

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

            const name =
                prompt("Source name (e.g. imgbb, telegram):");

            if (!name || !name.trim())
                return;

            createSettingsSourceBlock(sourcesList, name.trim(), null, null);

        };

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

            const issues =
                [];

            const providers =
                {};

            const credentials =
                {};

            sourcesList
                .querySelectorAll(".settings-source")
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

                    providers[name] =
                        mapParts;

                    const creds =
                        collectSettingsCredentialPairs(credContainer);

                    if (Object.keys(creds).length)
                        credentials[name] = creds;

                });

            if (issues.length) {

                alert(
                    "Please fix the following before generating:\n\n" +
                    issues.join("\n")
                );

                return;

            }

            const config =
                {};

            const albumUrl =
                albumInput.value.trim();

            if (albumUrl)
                config.album = albumUrl;

            if (Object.keys(credentials).length)
                config.credentials = credentials;

            if (Object.keys(providers).length)
                config.providers = providers;

            let encoded;

            try {

                encoded =
                    await compressAlbum(config);

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

            const fullUrl =
                location.origin +
                location.pathname +
                "?@" +
                encoded;

            resultTextarea.value =
                fullUrl;

            resultBox.style.display =
                "";

        };

    buttons.append(cancelBtn, generateBtn);

    box.append(
        title,
        albumLabel, albumInput,
        sourcesList,
        addSourceBtn,
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

        for (const [name, blueprint] of Object.entries(siteConfig.providers)) {

            createSettingsSourceBlock(
                sourcesList,
                name,
                blueprint,
                siteConfig.credentials?.[name]
            );

        }

    }

}
