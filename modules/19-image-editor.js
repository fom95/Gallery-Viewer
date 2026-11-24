/*
 * 19-image-editor.js
 *
 * The "add a single image" editor -- the current one-at-a-time import
 * path -- plus the base64 URL helpers it (and the routing module) use.
 */

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


function openAddImageEditor(options = {}) {

    const album =
        options.album || currentAlbum;

    const titleText =
        options.title || "Add Image";

    const submitLabel =
        options.submitLabel || "Add Image";

    const initial =
        options.initial || {};

    const initialTags =
        Array.isArray(options.initialTags)
            ? options.initialTags.slice()
            : [];

    /*
     * Tags the image had in the pristine remote record. When present,
     * saved tags outside this set are shown as local additions.
     */
    const baselineTags =
        Array.isArray(options.baselineTags)
            ? options.baselineTags.slice()
            : null;

    /*
     * Pristine remote URLs, if any, so a previously saved local URL
     * override is still outlined when the editor is reopened.
     */
    const baselineUrls =
        options.baselineUrls &&
        typeof options.baselineUrls === "object"
            ? options.baselineUrls
            : null;

    /*
     * Optional map of field name -> already-resolved asset URL for
     * this image/size. Lets the preview reuse exactly what the gallery
     * or viewer loaded (including blob URLs for fallback/download
     * sources) instead of starting a fresh request from the raw field
     * value.
     */
    const previewSources =
        options.previewSources &&
        typeof options.previewSources === "object"
            ? options.previewSources
            : null;

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
        "rgba(0,0,0,0.78)";

    overlay.style.display =
        "flex";

    overlay.style.alignItems =
        "center";

    overlay.style.justifyContent =
        "center";

    overlay.tabIndex =
        -1;

    overlay.style.outline =
        "none";

    const editor =
        document.createElement("div");

    editor.className =
        "image-editor-dialog";

    editor.style.background =
        "#222";

    editor.style.padding =
        "20px";

    editor.style.borderRadius =
        "8px";

    editor.style.width =
        "min(1000px, 96vw)";

    editor.style.maxHeight =
        "92vh";

    editor.style.boxSizing =
        "border-box";

    editor.style.display =
        "flex";

    editor.style.flexDirection =
        "column";

    editor.style.overflow =
        "hidden";

    const title =
        document.createElement("div");

    title.textContent =
        titleText;

    title.style.fontSize =
        "20px";

    title.style.marginBottom =
        "12px";

    title.style.flex =
        "0 0 auto";

    editor.appendChild(title);

    const body =
        document.createElement("div");

    body.className =
        "image-editor-body";

    const preview =
        document.createElement("div");

    preview.className =
        "image-editor-preview";

    const side =
        document.createElement("div");

    side.className =
        "image-editor-side";

    body.appendChild(preview);
    body.appendChild(side);

    editor.appendChild(body);

    /* ---------------------------------------------------------------- */
    /* Preview pane: wheel-zoom and drag-pan, no resolution switching.   */
    /* ---------------------------------------------------------------- */

    const previewLabel =
        document.createElement("div");

    previewLabel.className =
        "image-editor-preview-label";

    previewLabel.textContent =
        "Thumbnail preview";

    const previewImg =
        document.createElement("img");

    previewImg.alt =
        "";

    previewImg.decoding =
        "async";

    previewImg.draggable =
        false;

    previewImg.style.transformOrigin =
        "center center";

    previewImg.style.willChange =
        "transform";

    const previewEmpty =
        document.createElement("div");

    previewEmpty.className =
        "image-editor-preview-empty";

    previewEmpty.textContent =
        "No preview yet";

    preview.appendChild(previewLabel);
    preview.appendChild(previewImg);
    preview.appendChild(previewEmpty);

    let previewZoom =
        1;

    let previewPanX =
        0;

    let previewPanY =
        0;

    let previewDragging =
        false;

    let previewPointerId =
        null;

    let previewLastX =
        0;

    let previewLastY =
        0;

    const applyPreviewTransform =
        () => {

            previewImg.style.transform =
                `translate(${previewPanX}px, ${previewPanY}px) ` +
                `scale(${previewZoom})`;

        };

    const clampPreviewPan =
        () => {

            if (
                !previewImg.naturalWidth ||
                previewZoom <= 1.001
            ) {

                previewPanX =
                    0;

                previewPanY =
                    0;

                return;

            }

            const paneWidth =
                preview.clientWidth;

            const paneHeight =
                preview.clientHeight;

            const imageWidth =
                previewImg.offsetWidth;

            const imageHeight =
                previewImg.offsetHeight;

            const maxX =
                Math.max(
                    0,
                    (
                        imageWidth *
                        previewZoom -
                        paneWidth
                    ) / 2
                );

            const maxY =
                Math.max(
                    0,
                    (
                        imageHeight *
                        previewZoom -
                        paneHeight
                    ) / 2
                );

            previewPanX =
                Math.max(
                    -maxX,
                    Math.min(
                        maxX,
                        previewPanX
                    )
                );

            previewPanY =
                Math.max(
                    -maxY,
                    Math.min(
                        maxY,
                        previewPanY
                    )
                );

        };

    const resetPreviewTransform =
        () => {

            previewZoom =
                1;

            previewPanX =
                0;

            previewPanY =
                0;

            applyPreviewTransform();

        };

    const zoomPreviewAt =
        (factor, clientX, clientY) => {

            const oldZoom =
                previewZoom;

            const nextZoom =
                Math.max(
                    1,
                    Math.min(
                        5,
                        oldZoom * factor
                    )
                );

            if (
                Math.abs(
                    nextZoom -
                    oldZoom
                ) < 0.001
            ) {
                return;
            }

            if (
                Number.isFinite(clientX) &&
                Number.isFinite(clientY)
            ) {

                const rect =
                    preview.getBoundingClientRect();

                const centerX =
                    clientX -
                    (rect.left + rect.width / 2);

                const centerY =
                    clientY -
                    (rect.top + rect.height / 2);

                const ratio =
                    nextZoom / oldZoom;

                previewPanX =
                    centerX -
                    (centerX - previewPanX) * ratio;

                previewPanY =
                    centerY -
                    (centerY - previewPanY) * ratio;

            } else {

                previewPanX *=
                    nextZoom / oldZoom;

                previewPanY *=
                    nextZoom / oldZoom;

            }

            previewZoom =
                nextZoom;

            clampPreviewPan();
            applyPreviewTransform();

        };

    preview.addEventListener(
        "wheel",
        event => {

            if (!previewImg.naturalWidth)
                return;

            event.preventDefault();
            event.stopPropagation();

            zoomPreviewAt(
                event.deltaY < 0
                    ? 1.12
                    : 1 / 1.12,
                event.clientX,
                event.clientY
            );

        },
        { passive: false }
    );

    preview.addEventListener(
        "pointerdown",
        event => {

            overlay.focus({
                preventScroll: true
            });

            if (
                event.button !== 0 ||
                !previewImg.naturalWidth ||
                previewZoom <= 1
            ) {
                return;
            }

            previewDragging =
                true;

            previewPointerId =
                event.pointerId;

            previewLastX =
                event.clientX;

            previewLastY =
                event.clientY;

            preview.classList.add(
                "dragging"
            );

            try {
                preview.setPointerCapture(
                    event.pointerId
                );
            } catch {}

            event.preventDefault();
            event.stopPropagation();

        }
    );

    preview.addEventListener(
        "pointermove",
        event => {

            if (
                !previewDragging ||
                event.pointerId !== previewPointerId
            ) {
                return;
            }

            previewPanX +=
                event.clientX -
                previewLastX;

            previewPanY +=
                event.clientY -
                previewLastY;

            previewLastX =
                event.clientX;

            previewLastY =
                event.clientY;

            clampPreviewPan();
            applyPreviewTransform();

            event.preventDefault();

        }
    );

    const endPreviewDrag =
        event => {

            if (
                !previewDragging ||
                (
                    event &&
                    event.pointerId !== previewPointerId
                )
            ) {
                return;
            }

            previewDragging =
                false;

            preview.classList.remove(
                "dragging"
            );

            try {

                if (
                    event &&
                    preview.hasPointerCapture?.(
                        event.pointerId
                    )
                ) {
                    preview.releasePointerCapture(
                        event.pointerId
                    );
                }

            } catch {}

            previewPointerId =
                null;

        };

    preview.addEventListener(
        "pointerup",
        endPreviewDrag
    );

    preview.addEventListener(
        "pointercancel",
        endPreviewDrag
    );

    const previewNames = {
        thumb: "Thumbnail preview",
        medium: "Medium preview",
        image: "Full-size preview"
    };

    let previewTimer =
        null;

    let activeName =
        "thumb";

    const showPreview = (name, immediate = false) => {

        activeName =
            name;

        previewLabel.textContent =
            previewNames[name] ||
            "Preview";

        if (previewTimer) {

            clearTimeout(previewTimer);
            previewTimer = null;

        }

        const apply = () => {

            if (activeName !== name)
                return;

            const rawUrl =
                fields[name]?.value.trim();

            if (!rawUrl) {

                previewImg.dataset.previewSource =
                    "";

                previewImg.dataset.previewUrl =
                    "";

                previewImg.style.display =
                    "none";

                previewEmpty.textContent =
                    "No preview yet";

                previewEmpty.style.display =
                    "";

                resetPreviewTransform();

                return;

            }

            /*
             * While the field still holds its original value, prefer
             * the asset URL already resolved for this image/size, then
             * a blob another surface has already downloaded. Only fall
             * back to the raw field value when neither exists.
             */
            const resolvedUrl =
                previewSources?.[name] &&
                rawUrl ===
                    String(initial[name] || "").trim()
                    ? previewSources[name]
                    : "";

            const cachedBlob =
                typeof getCachedImageBlobURL === "function"
                    ? (
                        getCachedImageBlobURL(rawUrl) ||
                        (
                            resolvedUrl
                                ? getCachedImageBlobURL(
                                    resolvedUrl
                                )
                                : null
                        )
                    )
                    : null;

            const url =
                cachedBlob ||
                resolvedUrl ||
                rawUrl;

            const previewKey =
                rawUrl + "\u0000" + url;

            /*
             * Clicking another field that points at the same URL must
             * not restart the <img> load or reset the zoom.
             */
            if (
                previewImg.dataset.previewSource ===
                previewKey
            ) {

                if (
                    previewImg.complete &&
                    previewImg.naturalWidth
                ) {

                    previewImg.style.display =
                        "block";

                    previewEmpty.style.display =
                        "none";

                }

                return;

            }

            previewImg.dataset.previewSource =
                previewKey;

            previewImg.dataset.previewUrl =
                url;

            previewImg.style.display =
                "none";

            previewEmpty.textContent =
                "Loading preview…";

            previewEmpty.style.display =
                "";

            resetPreviewTransform();

            previewImg.onload =
                () => {

                    if (
                        previewImg.dataset.previewSource !==
                        previewKey
                    ) {
                        return;
                    }

                    previewImg.style.display =
                        "block";

                    previewEmpty.style.display =
                        "none";

                    clampPreviewPan();
                    applyPreviewTransform();

                };

            previewImg.onerror =
                () => {

                    if (
                        previewImg.dataset.previewSource !==
                        previewKey
                    ) {
                        return;
                    }

                    previewImg.style.display =
                        "none";

                    previewEmpty.textContent =
                        "Preview could not load.";

                    previewEmpty.style.display =
                        "";

                };

            /*
             * Load through the shared blob cache when possible. That
             * fetches each size once: the viewer then reuses the same
             * blob instead of downloading it again. Fall back to the
             * plain URL if the fetch route is unavailable.
             */
            const setPreviewSource = source => {

                if (
                    previewImg.dataset.previewSource !==
                    previewKey
                ) {
                    return;
                }

                previewImg.src =
                    source || url;

            };

            if (
                name !== "image" ||
                url.startsWith("blob:") ||
                typeof prefetchImageBlob !== "function"
            ) {

                setPreviewSource(url);

            } else {

                prefetchImageBlob(url)
                    .then(blobURL =>
                        setPreviewSource(
                            blobURL || url
                        )
                    )
                    .catch(() => setPreviewSource(url));

            }

        };

        if (immediate)
            apply();
        else
            previewTimer =
                setTimeout(apply, 200);

    };

    /* ---------------------------------------------------------------- */
    /* URL fields                                                        */
    /* ---------------------------------------------------------------- */

    const fields = {};

    const urlSection =
        document.createElement("div");

    urlSection.className =
        "image-editor-urls";

    [
        ["thumb", "Thumbnail"],
        ["medium", "Medium"],
        ["image", "Large / Full"]
    ].forEach(
        ([name, label]) => {

            const container =
                document.createElement("div");

            container.style.marginBottom =
                "6px";

            const text =
                document.createElement("div");

            text.textContent =
                label;

            text.style.marginBottom =
                "3px";

            text.style.fontSize =
                "11px";

            text.style.opacity =
                "0.75";

            const input =
                document.createElement("input");

            input.type =
                "text";

            input.className =
                "image-editor-url-field";

            input.placeholder =
                "https://...";

            input.value =
                initial[name] || "";

            input.style.width =
                "100%";

            input.style.boxSizing =
                "border-box";

            input.style.padding =
                "5px 7px";

            input.style.background =
                "#161619";

            input.style.color =
                "#eee";

            input.style.border =
                "1px solid #444";

            input.style.borderRadius =
                "4px";

            input.style.font =
                "inherit";

            input.style.fontSize =
                "12px";

            input.addEventListener(
                "focus",
                () => showPreview(name, true)
            );

            input.addEventListener(
                "click",
                () => showPreview(name, true)
            );

            input.addEventListener(
                "input",
                () => {

                    if (activeName === name)
                        showPreview(name, false);

                    refreshFieldStates();
                    updateEditorActions();

                }
            );

            fields[name] =
                input;

            container.appendChild(text);
            container.appendChild(input);

            urlSection.appendChild(container);

        }
    );

    side.appendChild(urlSection);

    /* ---------------------------------------------------------------- */
    /* Tags                                                              */
    /* ---------------------------------------------------------------- */

    const tagsSection =
        document.createElement("div");

    tagsSection.className =
        "image-editor-tags";

    const tagsTitle =
        document.createElement("div");

    tagsTitle.textContent =
        "Tags";

    tagsTitle.style.fontSize =
        "12px";

    tagsTitle.style.opacity =
        "0.75";

    const tagsScroll =
        document.createElement("div");

    tagsScroll.className =
        "image-editor-tags-scroll";

    const chips =
        document.createElement("div");

    chips.className =
        "image-editor-tag-chips";

    const tagBox =
        document.createElement("div");

    tagBox.className =
        "image-editor-tag-box";

    const tagInput =
        document.createElement("input");

    tagInput.type =
        "text";

    tagInput.className =
        "image-editor-tag-input";

    tagInput.placeholder =
        "Add a tag…";

    tagInput.autocomplete =
        "off";

    const tagSuggestionsBox =
        document.createElement("div");

    tagSuggestionsBox.className =
        "image-editor-tag-suggestions";

    tagBox.appendChild(tagInput);
    tagBox.appendChild(tagSuggestionsBox);

    tagsScroll.appendChild(chips);

    tagsSection.append(
        tagsTitle,
        tagBox,
        tagsScroll
    );

    side.appendChild(tagsSection);

    const normalizeTag =
        value =>
            typeof normalizeTagForMatch ===
                "function"
                ? normalizeTagForMatch(value)
                : String(value || "")
                    .trim()
                    .toLowerCase();

    const labelTag =
        value =>
            typeof formatTagLabel ===
                "function"
                ? formatTagLabel(value)
                : String(value || "");

    /*
     * Baseline tags for "added" marks: the pristine remote tags when
     * available, otherwise the tags the editor opened with (so tags
     * added during this session are still highlighted).
     */
    const originalTagKeys =
        new Set(
            (baselineTags || initialTags)
                .map(normalizeTag)
                .filter(Boolean)
        );

    let savedTags =
        [];

    for (const tag of initialTags) {

        const normalized =
            normalizeTag(tag);

        if (
            normalized &&
            !savedTags.some(
                existing =>
                    normalizeTag(existing) ===
                    normalized
            )
        ) {
            savedTags.push(tag);
        }

    }

    let baseTags =
        savedTags.slice();

    let newTags =
        [];

    /*
     * Tags added in this editor session and then removed again. They
     * stay visible as grey "removed" chips until Save/Cancel, but they
     * were never on the image before this session, so they do not count
     * as an edit and disappear when saved.
     */
    const removedNewTagKeys =
        new Set();

    const savedUrls = {
        thumb:
            initial.thumb || "",
        medium:
            initial.medium || "",
        image:
            initial.image || ""
    };

    /*
     * Amber outline for URL fields that differ from the last saved
     * value. When the pristine remote URL set is known (local-edit
     * mode), compare against that instead so saved overrides stay
     * marked. Cancel resets to the saved values.
     */
    const refreshFieldStates =
        () => {

            const reference =
                baselineUrls || savedUrls;

            for (const name of ["thumb", "medium", "image"]) {

                const field =
                    fields[name];

                if (!field)
                    continue;

                field.classList.toggle(
                    "image-editor-field-changed",
                    field.value.trim() !==
                        (reference[name] || "")
                );

            }

        };

    refreshFieldStates();

    /*
     * Tags present in the pristine record but missing from the saved
     * image were removed locally in an earlier session. Keep them in
     * the same greyed-out, restorable state as a removal made now.
     */
    const baselineRemovedTagKeys =
        tags => {

            const tagKeys =
                new Set(
                    (tags || [])
                        .map(normalizeTag)
                        .filter(Boolean)
                );

            return new Set(
                (baselineTags || [])
                    .map(normalizeTag)
                    .filter(
                        key =>
                            key &&
                            !tagKeys.has(key)
                    )
            );

        };

    let removedTagKeys =
        baselineRemovedTagKeys(savedTags);

    const finalTags =
        () => [

            ...baseTags.filter(
                tag =>
                    !removedTagKeys.has(
                        normalizeTag(tag)
                    )
            ),

            ...newTags.filter(
                tag =>
                    !removedNewTagKeys.has(
                        normalizeTag(tag)
                    )
            )

        ];

    const tagsEqual =
        (a, b) =>
            a.length === b.length &&
            a.every(
                (tag, index) =>
                    normalizeTag(tag) ===
                    normalizeTag(b[index])
            );

    const addLocalTag =
        rawText => {

            const pieces =
                String(rawText || "")
                    .split(",")
                    .map(piece => piece.trim())
                    .filter(Boolean);

            let changed =
                false;

            for (const piece of pieces) {

                const normalized =
                    normalizeTag(piece);

                if (!normalized)
                    continue;

                if (
                    removedNewTagKeys.has(
                        normalized
                    )
                ) {

                    removedNewTagKeys.delete(
                        normalized
                    );

                    changed =
                        true;

                    continue;

                }

                if (
                    removedTagKeys.has(
                        normalized
                    )
                ) {

                    removedTagKeys.delete(
                        normalized
                    );

                    if (
                        !baseTags.some(
                            candidate =>
                                normalizeTag(candidate) ===
                                normalized
                        )
                    ) {

                        const original =
                            (baselineTags || [])
                                .find(
                                    candidate =>
                                        normalizeTag(candidate) ===
                                        normalized
                                );

                        baseTags.push(
                            original || piece
                        );

                    }

                    changed =
                        true;

                    continue;

                }

                if (
                    baseTags.some(
                        tag =>
                            normalizeTag(tag) ===
                            normalized
                    )
                ) {
                    continue;
                }

                if (
                    newTags.some(
                        tag =>
                            normalizeTag(tag) ===
                            normalized
                    )
                ) {
                    continue;
                }

                const canonical =
                    typeof getAllSearchTags ===
                        "function"
                        ? getAllSearchTags().find(
                            tag =>
                                normalizeTag(tag) ===
                                normalized
                        )
                        : null;

                newTags.push(
                    canonical ||
                    piece.replace(/\s+/g, "_")
                );

                changed =
                    true;

            }

            if (!changed)
                return false;

            renderTagChips();
            renderTagSuggestions(tagInput.value);
            updateEditorActions();

            return true;

        };

    const toggleBaseTag =
        tag => {

            const normalized =
                normalizeTag(tag);

            if (
                removedTagKeys.has(
                    normalized
                )
            ) {
                removedTagKeys.delete(
                    normalized
                );

                if (
                    !baseTags.some(
                        candidate =>
                            normalizeTag(candidate) ===
                            normalized
                    )
                ) {

                    const original =
                        (baselineTags || [])
                            .find(
                                candidate =>
                                    normalizeTag(candidate) ===
                                    normalized
                            );

                    baseTags.push(
                        original || tag
                    );

                }

            } else {
                removedTagKeys.add(
                    normalized
                );
            }

            renderTagChips();
            renderTagSuggestions(tagInput.value);
            updateEditorActions();

        };

    const removeNewTag =
        tag => {

            const normalized =
                normalizeTag(tag);

            const index =
                newTags.findIndex(
                    candidate =>
                        normalizeTag(candidate) ===
                        normalized
                );

            if (index < 0)
                return;

            removedNewTagKeys.add(
                normalized
            );

            renderTagChips();
            renderTagSuggestions(tagInput.value);
            updateEditorActions();

        };

    /*
     * A tag added locally and already saved is part of baseTags after a
     * save. Removing it drops it entirely: unlike an original tag it
     * has no greyed-out "removed" state, because there is no remote
     * version to restore.
     */
    const removeAddedBaseTag =
        tag => {

            const normalized =
                normalizeTag(tag);

            const index =
                baseTags.findIndex(
                    candidate =>
                        normalizeTag(candidate) ===
                        normalized
                );

            if (index < 0)
                return;

            baseTags.splice(index, 1);

            renderTagChips();
            renderTagSuggestions(tagInput.value);
            updateEditorActions();

        };

    const renderTagChips =
        () => {

            chips.innerHTML = "";

            const hasRemovedTags =
                (baselineTags || baseTags)
                    .some(
                        tag =>
                            removedTagKeys.has(
                                normalizeTag(tag)
                            )
                    );

            if (
                !baseTags.length &&
                !newTags.length &&
                !hasRemovedTags
            ) {

                const empty =
                    document.createElement("span");

                empty.className =
                    "image-editor-tag-none";

                empty.textContent =
                    "No tags yet";

                chips.appendChild(empty);

                return;

            }

            const appendChip =
                (tag, className, title, onclick) => {

                    const chip =
                        document.createElement("span");

                    chip.className =
                        "search-tag " + className;

                    chip.title =
                        title;

                    chip.setAttribute(
                        "role",
                        "button"
                    );

                    chip.tabIndex =
                        0;

                    const label =
                        document.createElement("span");

                    label.className =
                        "search-tag-label";

                    label.textContent =
                        labelTag(tag);

                    chip.appendChild(label);

                    chip.onclick =
                        onclick;

                    chip.onkeydown =
                        event => {

                            if (
                                event.key === "Enter" ||
                                event.key === " "
                            ) {

                                event.preventDefault();
                                onclick();

                            }

                        };

                    chips.appendChild(chip);

                };

            baseTags.forEach(tag => {

                const normalized =
                    normalizeTag(tag);

                if (
                    removedTagKeys.has(
                        normalized
                    )
                ) {
                    return;
                }

                if (
                    originalTagKeys.has(
                        normalized
                    )
                ) {

                    appendChip(
                        tag,
                        "",
                        "Click to mark for deletion",
                        () => toggleBaseTag(tag)
                    );

                } else {

                    appendChip(
                        tag,
                        "new",
                        "Added locally — click to remove",
                        () => removeAddedBaseTag(tag)
                    );

                }

            });

            newTags.forEach(tag => {

                const normalized =
                    normalizeTag(tag);

                if (
                    removedNewTagKeys.has(
                        normalized
                    )
                ) {
                    return;
                }

                appendChip(
                    tag,
                    "new",
                    "Click to remove this new tag",
                    () => removeNewTag(tag)
                );

            });

            /*
             * Removed original tags stay visible at the end, out of
             * their normal order, greyed out. They only exist in the
             * editor: clicking one restores it. Previously-removed
             * tags are not in baseTags, so use the pristine list.
             */
            const removedTagSource =
                baselineTags &&
                baselineTags.length
                    ? baselineTags
                    : baseTags;

            removedTagSource.forEach(tag => {

                if (
                    !removedTagKeys.has(
                        normalizeTag(tag)
                    )
                ) {
                    return;
                }

                appendChip(
                    tag,
                    "removed",
                    "Click to restore this tag",
                    () => toggleBaseTag(tag)
                );

            });

            /*
             * Added-in-this-session tags that were removed again stay
             * greyed until Save/Cancel, but are not real edits and are
             * discarded on Save.
             */
            newTags.forEach(tag => {

                const normalized =
                    normalizeTag(tag);

                if (
                    !removedNewTagKeys.has(
                        normalized
                    )
                ) {
                    return;
                }

                appendChip(
                    tag,
                    "removed",
                    "Click to restore this tag",
                    () => {

                        removedNewTagKeys.delete(
                            normalized
                        );

                        renderTagChips();
                        renderTagSuggestions(
                            tagInput.value
                        );
                        updateEditorActions();

                    }
                );

            });

        };

    const tagVocabulary =
        () => {

            const values =
                new Set();

            if (typeof getAllSearchTags === "function") {

                for (const tag of getAllSearchTags())
                    values.add(tag);

            }

            if (Array.isArray(album?.tags)) {

                for (const tag of album.tags)
                    values.add(tag);

            }

            return [...values];

        };

    let tagSuggestions =
        [];

    let selectedTagSuggestion =
        -1;

    const updateSelectedTagSuggestion =
        () => {

            tagSuggestions.forEach(
                (suggestion, index) => {

                    suggestion.classList.toggle(
                        "selected",
                        index === selectedTagSuggestion
                    );

                }
            );

            if (
                selectedTagSuggestion >= 0 &&
                selectedTagSuggestion <
                tagSuggestions.length
            ) {

                tagSuggestions[
                    selectedTagSuggestion
                ].scrollIntoView({
                    block: "nearest"
                });

            }

        };

    const hideTagSuggestions =
        () => {

            tagSuggestionsBox.innerHTML = "";
            tagSuggestions = [];
            selectedTagSuggestion = -1;
            tagSuggestionsBox.style.display = "none";

        };

    const renderTagSuggestions =
        text => {

            if (!tagBox.contains(document.activeElement)) {

                hideTagSuggestions();
                return;

            }

            const normalized =
                normalizeTag(text);

            const excluded =
                finalTags().map(normalizeTag);

            if (!normalized) {

                hideTagSuggestions();
                return;

            }

            let matches;

            if (typeof getSortedMatches === "function") {

                matches =
                    getSortedMatches(
                        normalized,
                        finalTags()
                    ).slice(0, 80);

            } else {

                matches =
                    tagVocabulary()
                        .filter(
                            tag =>
                                normalizeTag(tag).includes(
                                    normalized
                                ) &&
                                !excluded.includes(
                                    normalizeTag(tag)
                                )
                        )
                        .slice(0, 80);

            }

            tagSuggestionsBox.innerHTML = "";
            tagSuggestions = [];
            selectedTagSuggestion = -1;

            matches.forEach(tag => {

                const suggestion =
                    document.createElement("div");

                suggestion.className =
                    "suggestion";

                suggestion.dataset.tag =
                    tag;

                suggestion.textContent =
                    labelTag(tag);

                suggestion.onmousedown =
                    event => event.preventDefault();

                suggestion.onclick =
                    () => {

                        addLocalTag(tag);
                        tagInput.value = "";
                        renderTagSuggestions("");
                        tagInput.focus();

                    };

                tagSuggestionsBox.appendChild(
                    suggestion
                );

                tagSuggestions.push(
                    suggestion
                );

            });

            tagSuggestionsBox.style.display =
                matches.length
                    ? ""
                    : "none";

        };

    tagInput.addEventListener(
        "focus",
        () => renderTagSuggestions(
            tagInput.value
        )
    );

    tagInput.addEventListener(
        "input",
        () => renderTagSuggestions(
            tagInput.value
        )
    );

    tagInput.addEventListener(
        "blur",
        () => {

            setTimeout(() => {

                if (tagBox.contains(document.activeElement))
                    return;

                hideTagSuggestions();

            }, 0);

        }
    );

    tagInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "ArrowDown" ||
                event.key === "ArrowUp"
            ) {

                if (!tagSuggestions.length)
                    renderTagSuggestions(tagInput.value);

                if (!tagSuggestions.length) {

                    event.preventDefault();
                    event.stopPropagation();

                    return;

                }

                event.preventDefault();
                event.stopImmediatePropagation();

                if (event.key === "ArrowDown") {

                    selectedTagSuggestion =
                        (selectedTagSuggestion + 1) %
                        tagSuggestions.length;

                } else {

                    selectedTagSuggestion =
                        selectedTagSuggestion <= 0
                            ? tagSuggestions.length - 1
                            : selectedTagSuggestion - 1;

                }

                updateSelectedTagSuggestion();

                return;

            }

            if (event.key === "Enter") {

                event.preventDefault();
                event.stopImmediatePropagation();

                /*
                 * Enter submits exactly what is typed. It never uses the
                 * highlighted autocomplete suggestion.
                 */
                const typed =
                    tagInput.value.trim();

                if (typed)
                    addLocalTag(typed);

                tagInput.value = "";
                renderTagSuggestions("");

                return;

            }

            if (
                event.key === "Tab" &&
                !event.shiftKey
            ) {

                event.preventDefault();
                event.stopImmediatePropagation();

                const typed =
                    tagInput.value.trim();

                if (
                    typed &&
                    tagVocabulary().some(
                        tag =>
                            normalizeTag(tag) ===
                            normalizeTag(typed)
                    )
                ) {

                    addLocalTag(typed);
                    tagInput.value = "";
                    renderTagSuggestions("");

                    return;

                }

                let tag =
                    null;

                if (
                    selectedTagSuggestion >= 0 &&
                    tagSuggestions[selectedTagSuggestion]
                ) {

                    tag =
                        tagSuggestions[
                            selectedTagSuggestion
                        ].dataset.tag || null;

                } else if (typed) {

                    const matches =
                        typeof getSortedMatches ===
                            "function"
                            ? getSortedMatches(
                                normalizeTag(typed),
                                finalTags()
                            )
                            : tagVocabulary().filter(
                                candidate =>
                                    normalizeTag(candidate).includes(
                                        normalizeTag(typed)
                                    )
                            );

                    if (matches.length)
                        tag = matches[0];

                }

                if (tag) {

                    tagInput.value =
                        labelTag(tag);

                    const position =
                        tagInput.value.length;

                    tagInput.setSelectionRange(
                        position,
                        position
                    );

                    renderTagSuggestions(
                        tagInput.value
                    );

                }

                return;

            }

            if (event.key === ",") {

                event.preventDefault();
                event.stopImmediatePropagation();

                if (tagInput.value.trim())
                    addLocalTag(
                        tagInput.value
                    );

                tagInput.value = "";
                renderTagSuggestions("");

                return;

            }

            if (event.key === "Escape") {

                event.preventDefault();
                event.stopPropagation();

                if (tagInput.value) {

                    tagInput.value = "";
                    renderTagSuggestions("");

                } else {

                    hideTagSuggestions();

                }

            }

        },
        true
    );

    renderTagChips();

    /* ---------------------------------------------------------------- */
    /* Actions                                                           */
    /* ---------------------------------------------------------------- */

    const buttons =
        document.createElement("div");

    buttons.style.display =
        "flex";

    buttons.style.justifyContent =
        "flex-end";

    buttons.style.gap =
        "10px";

    buttons.style.marginTop =
        "12px";

    buttons.style.flex =
        "0 0 auto";

    const isEditMode =
        typeof options.onSave === "function";

    const cancel =
        document.createElement("button");

    cancel.textContent =
        "Cancel";

    cancel.className =
        "app-button app-button-danger";

    const submit =
        document.createElement("button");

    submit.className =
        isEditMode
            ? "app-button"
            : "app-button app-button-primary";

    submit.textContent =
        isEditMode
            ? "Close"
            : submitLabel;

    const currentUrls =
        () => ({
            thumb:
                fields.thumb.value.trim(),
            medium:
                fields.medium.value.trim(),
            image:
                fields.image.value.trim()
        });

    const isDirty =
        () => {

            if (!isEditMode)
                return false;

            const urls =
                currentUrls();

            if (
                urls.thumb !== savedUrls.thumb ||
                urls.medium !== savedUrls.medium ||
                urls.image !== savedUrls.image
            ) {
                return true;
            }

            return !tagsEqual(
                finalTags(),
                savedTags
            );

        };

    const updateEditorActions =
        () => {

            if (!isEditMode)
                return;

            const dirty =
                isDirty();

            submit.textContent =
                dirty
                    ? "Save"
                    : "Close";

            submit.classList.toggle(
                "app-button-primary",
                dirty
            );

            cancel.style.display =
                dirty
                    ? ""
                    : "none";

        };

    const collectValues =
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

                return null;

            }

            const fallback =
                image ||
                medium ||
                thumb;

            return {

                thumb:
                    thumb ||
                    fallback,

                medium:
                    medium ||
                    image ||
                    fallback,

                image:
                    image ||
                    medium ||
                    fallback,

                tags:
                    finalTags()
                        .slice()
                        .sort(
                            (a, b) =>
                                String(a).localeCompare(
                                    String(b)
                                )
                        )

            };

        };

    const cancelChanges =
        () => {

            fields.thumb.value =
                savedUrls.thumb;

            fields.medium.value =
                savedUrls.medium;

            fields.image.value =
                savedUrls.image;

            baseTags =
                savedTags.slice();

            newTags =
                [];

            removedNewTagKeys.clear();

            removedTagKeys =
                baselineRemovedTagKeys(
                    savedTags
                );

            tagInput.value =
                "";

            renderTagChips();
            hideTagSuggestions();
            showPreview(activeName, true);
            refreshFieldStates();
            updateEditorActions();

        };

    cancel.onclick =
        () => {

            if (!isEditMode) {

                overlay.remove();
                return;

            }

            cancelChanges();

        };

    submit.onclick =
        () => {

            if (
                isEditMode &&
                !isDirty()
            ) {

                overlay.remove();
                return;

            }

            const values =
                collectValues();

            if (!values)
                return;

            if (isEditMode) {

                options.onSave(
                    values
                );

                fields.thumb.value =
                    values.thumb;

                fields.medium.value =
                    values.medium;

                fields.image.value =
                    values.image;

                savedUrls.thumb =
                    values.thumb;

                savedUrls.medium =
                    values.medium;

                savedUrls.image =
                    values.image;

                savedTags =
                    values.tags.slice();

                baseTags =
                    savedTags.slice();

                newTags =
                    [];

                removedNewTagKeys.clear();

                removedTagKeys =
                    baselineRemovedTagKeys(
                        savedTags
                    );

                tagInput.value =
                    "";

                renderTagChips();
                hideTagSuggestions();
                showPreview(activeName, true);
                refreshFieldStates();
                updateEditorActions();

                return;

            }

            if (!album) {

                alert("No album is open.");

                return;

            }

            if (
                !Array.isArray(album.sources)
            ) {

                album.sources =
                    [];

            }

            let directIndex =
                album.sources.indexOf("direct");

            if (directIndex === -1) {

                directIndex =
                    album.sources.length;

                album.sources.push("direct");

            }

            if (!Array.isArray(album.tags))
                album.tags = [];

            const tagIndices = [];

            for (const tag of values.tags) {

                const normalized =
                    normalizeTag(tag);

                let index =
                    album.tags.findIndex(
                        existing =>
                            normalizeTag(existing) ===
                            normalized
                    );

                if (index < 0) {

                    album.tags.push(tag);
                    index =
                        album.tags.length - 1;

                }

                if (!tagIndices.includes(index))
                    tagIndices.push(index);

            }

            const newImage = {

                [directIndex]: {

                    thumb: {
                        url:
                            values.thumb
                    },

                    medium: {
                        url:
                            values.medium
                    },

                    full: {
                        url:
                            values.image
                    }

                },

                tags:
                    tagIndices,

                added:
                    true

            };

            if (typeof options.onAdd === "function") {

                overlay.remove();

                options.onAdd(
                    newImage
                );

                return;

            }

            if (
                !album.images ||
                typeof album.images !== "object"
            ) {

                album.images =
                    {};

            }

            const nextNumber =
                (
                    Object.keys(album.images)
                        .map(Number)
                        .filter(Number.isFinite)
                        .reduce((max, n) => Math.max(max, n), 0)
                ) + 1;

            album.images[nextNumber] =
                newImage;

            album.edited =
                true;

            overlay.remove();

            showEditedAlbumSaveButton();

            loadAlbum(album, false);

        };

    updateEditorActions();

    buttons.appendChild(cancel);
    buttons.appendChild(submit);


    editor.appendChild(buttons);

    overlay.appendChild(editor);

    document.body.appendChild(overlay);

    /*
     * Freeze the page behind the editor. Wheel containment below is
     * the primary guard, but this also stops scrollbar/keyboard page
     * movement and any wheel path that escapes the overlay.
     */
    document.body.classList.add(
        "image-editor-open"
    );

    document.documentElement.classList.add(
        "image-editor-open"
    );

    const nativeOverlayRemove =
        overlay.remove.bind(overlay);

    overlay.remove = () => {

        document.body.classList.remove(
            "image-editor-open"
        );

        document.documentElement.classList.remove(
            "image-editor-open"
        );

        nativeOverlayRemove();

    };

    /*
     * Arrow navigation inside the album editor replaces the dialog by
     * removing the old node directly, bypassing the override above.
     * Watch for that so the page lock never outlives the editor.
     */
    const editorRemovalObserver =
        new MutationObserver(() => {

            if (document.getElementById("addImageEditor"))
                return;

            document.body.classList.remove(
                "image-editor-open"
            );

            document.documentElement.classList.remove(
                "image-editor-open"
            );

            editorRemovalObserver.disconnect();

        });

    editorRemovalObserver.observe(
        document.body,
        { childList: true }
    );

    /* ---------------------------------------------------------------- */
    /* Keyboard/wheel containment                                        */
    /* ---------------------------------------------------------------- */

    const isEditableTarget =
        target =>
            target instanceof Element &&
            (
                target.matches(
                    "input, textarea, select"
                ) ||
                target.isContentEditable
            );

    const navigate =
        direction => {

            if (
                typeof options.onNavigate ===
                "function"
            ) {
                options.onNavigate(
                    direction
                );
            }

        };

    overlay.addEventListener(
        "keydown",
        event => {

            /*
             * Nothing except clicking a tag may remove or mark a tag.
             * Allow the browser's normal text deletion / focus move,
             * but block every other keydown handler for these keys.
             */
            if (
                event.target === tagInput &&
                (
                    event.key === "Backspace" ||
                    (
                        event.key === "Tab" &&
                        event.shiftKey
                    )
                )
            ) {
                event.stopImmediatePropagation();
                return;
            }

            /*
             * The document stays scrollable so smooth image-follow
             * scrolling works, so stop keys that would otherwise move
             * the page behind the dialog.
             */
            if (
                (
                    event.key === "PageUp" ||
                    event.key === "PageDown" ||
                    event.key === "Home" ||
                    event.key === "End" ||
                    event.key === " "
                ) &&
                !isEditableTarget(event.target) &&
                !(
                    event.target instanceof Element &&
                    event.target.closest("button")
                )
            ) {

                event.preventDefault();

                return;

            }

            if (!event.key.startsWith("Arrow"))
                return;

            if (isEditableTarget(event.target)) {

                if (
                    event.key === "ArrowUp" ||
                    event.key === "ArrowDown"
                ) {
                    event.preventDefault();
                }

                return;

            }

            event.preventDefault();

            if (event.key === "ArrowRight")
                navigate(1);
            else if (event.key === "ArrowLeft")
                navigate(-1);

        },
        true
    );

    /*
     * Wheel zooms only over the preview (its own listener stops the
     * event). The tags list and suggestions scroll natively; every
     * other part of the dialog swallows the wheel so the page behind
     * never scrolls.
     */
    overlay.addEventListener(
        "wheel",
        event => {

            if (
                event.target instanceof Element &&
                event.target.closest(
                    ".image-editor-tags-scroll, .image-editor-tag-suggestions"
                )
            ) {
                return;
            }

            event.preventDefault();

        },
        { passive: false }
    );

    overlay.addEventListener(
        "mousedown",
        event => {

            if (
                isEditableTarget(event.target) ||
                (
                    event.target instanceof Element &&
                    (
                        event.target.closest("button") ||
                        event.target.closest(
                            ".image-editor-tag-box"
                        ) ||
                        event.target.closest(
                            ".image-editor-tag-chips"
                        )
                    )
                )
            ) {
                return;
            }

            event.preventDefault();

            overlay.focus({
                preventScroll: true
            });

        }
    );

    const firstPopulated =
        ["image", "medium", "thumb"].find(
            name => (initial[name] || "").trim()
        ) || "image";

    showPreview(firstPopulated, true);

    overlay.focus({
        preventScroll: true
    });

}


/*
 * Appends a clickable "+" tile to the end of the album grid, in the
 * same spirit as the "Add New" tile on the home page. It's laid out by
 * the normal gallery grid system (see calculateGalleryLayout(), which
 * includes ".gallery-add-tile" alongside ".thumbnail-slot"), so it
 * always sits right after the last image and reflows along with
 * everything else -- rather than floating over the whole page.
 */
function createAddImageTile(gallery) {

    if (!gallery)
        return;

    const tile =
        document.createElement("div");

    tile.id =
        "addAlbumImageTile";

    tile.className =
        "gallery-add-tile";

    tile.textContent =
        "+";

    tile.title =
        "Add Image";

    tile.onclick =
        () => {

            openAddImageEditor();

        };

    gallery.appendChild(tile);

}


function showEditedAlbumSaveButton() {

    const saveButton =
        document.getElementById("saveButton");

    if (!saveButton)
        return;

    saveButton.style.display =
        "";

    saveButton.onclick =
        async () => {

            if (!currentAlbum)
                return;

            const saved =
                await getSavedAlbums();

            const index =
                saved.findIndex(
                    album =>
                        album.id ===
                        currentAlbum.id
                );

            const persistedAlbum =
                JSON.parse(
                    JSON.stringify(currentAlbum)
                );

            /*
             * Runtime and local-edit markers must never leak into the
             * savedAlbums format. This used to mix a plain object into
             * the compressed-string array, which made the same album
             * appear twice (or not at all) after a reload.
             */
            delete persistedAlbum.storage;
            delete persistedAlbum.localEdited;
            delete persistedAlbum.savedEdited;

            for (const key of Object.keys(persistedAlbum)) {

                if (key.startsWith("_"))
                    delete persistedAlbum[key];

            }

            persistedAlbum.edited =
                true;

            if (index >= 0) {

                if (
                    typeof saveSavedAlbumEditBase ===
                        "function"
                ) {
                    await saveSavedAlbumEditBase(
                        currentAlbum.id,
                        saved[index]
                    );
                }

                saved[index] =
                    persistedAlbum;

            } else {

                saved.push(persistedAlbum);

            }

            await setSavedAlbums(saved);

            currentAlbum = {
                ...persistedAlbum,
                storage:
                    true
            };

            if (
                typeof hasSavedAlbumEditBase ===
                    "function" &&
                hasSavedAlbumEditBase(
                    currentAlbum.id
                )
            ) {
                currentAlbum.savedEdited =
                    true;
            }

            if (typeof syncAlbumListEditFlags === "function")
                syncAlbumListEditFlags(currentAlbum);

            if (typeof syncAlbumPageEditButton === "function")
                syncAlbumPageEditButton(currentAlbum);

            alert("Album saved locally.");

            showEditedAlbumSaveButton();

        };

}
