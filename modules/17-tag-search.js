/*
 * 17-tag-search.js
 *
 * The tag search box: committed tags as small chips, autocomplete
 * suggestions, keyboard navigation of suggestions, and searching albums
 * by tag.
 */

const searchInput = document.getElementById("tagSearch");

const suggestionBox = document.getElementById("tagSuggestions");

const searchBox = document.getElementById("tagSearchBox");

const searchChips = document.getElementById("tagSearchChips");

const clearSearch = document.getElementById("clearSearch");

const searchButton = document.getElementById("searchButton");

const searchResultsTags = document.getElementById("searchResultsTags");


/* Tags already committed to the query (the chips). */
let committedSearchTags = [];

/* Committed tags that exclude albums carrying them. */
let negatedSearchTags = [];

let suggestions = [];

let selectedSuggestionIndex = -1;

let showingSearchResults = false;

/* True between a mousedown on the magnifier and its click. */
let searchButtonMousedown = false;

/* Keeps a right-click on a tag from closing the open search field. */
let tagContextMenuGuard = 0;

/* Counts search runs so a slow index response cannot overwrite a newer
 * local one. */
let searchRequestSerial = 0;


function updateSearchControls() {

    const active =
        searchBox.classList.contains("active");

    const hasTags =
        searchQueryTagCount() > 0;

    const hasText =
        searchInput.value.trim().length > 0;

    searchBox.classList.toggle("has-chips", hasTags);

    if (searchButton)
        searchButton.style.display =
            (active || hasTags) ? "" : "none";

    if (active) {

        clearSearch.textContent = "×";
        clearSearch.title = "Clear search";
        clearSearch.setAttribute("aria-label", "Clear search");
        clearSearch.style.display =
            (hasTags || hasText) ? "block" : "none";

    } else {

        clearSearch.textContent = "+";
        clearSearch.title = "Add tags";
        clearSearch.setAttribute("aria-label", "Add tags");
        clearSearch.style.display = "block";

    }

    searchInput.placeholder =
        active
            ? (
                hasTags
                    ? "add tags..."
                    : "search tags..."
            )
            : (
                hasTags
                    ? ""
                    : "search tags..."
            );

}


function setSearchActive(active) {

    searchBox.classList.toggle("active", active);

    document.body.classList.toggle("search-active", active);

    if (!active) {

        /*
         * A partial word is not a tag: drop it when the field closes so
         * the collapsed box only shows committed chips.
         */
        searchInput.value = "";

        suggestionBox.innerHTML = "";
        suggestions = [];
        selectedSuggestionIndex = -1;

    }

    updateSearchControls();

}


function findSearchTagIndex(list, tag) {

    const normalized =
        normalizeTagForMatch(tag);

    return list.findIndex(existing =>
        normalizeTagForMatch(existing) === normalized
    );

}


function searchQueryTagCount() {

    return (
        committedSearchTags.length +
        negatedSearchTags.length
    );

}


let randomTagOrder = [];

let randomTagOrderCount = -1;


function getRandomTagOrder() {

    const all =
        getAllSearchTags();

    /*
     * A randomised order is cached for the session; a refresh builds a
     * new one. Rebuild only when the tag count changes so this stays
     * cheap even with thousands of tags.
     */
    if (all.length !== randomTagOrderCount) {

        randomTagOrder = all.slice();

        for (let i = randomTagOrder.length - 1; i > 0; i--) {

            const j =
                Math.floor(Math.random() * (i + 1));

            const swap =
                randomTagOrder[i];

            randomTagOrder[i] =
                randomTagOrder[j];
            randomTagOrder[j] = swap;

        }

        randomTagOrderCount = all.length;

    }

    return randomTagOrder;

}


function createSearchTagChip(tag, negative, rerunSearch, allowWhenInactive = false) {

    const chip =
        document.createElement("span");

    chip.className =
        "search-tag" +
        (negative ? " negative" : "");

    chip.title =
        (negative ? "Exclude: " : "") +
        tag +
        " — right-click to invert";

    const label =
        document.createElement("span");

    label.className =
        "search-tag-label";

    label.textContent =
        formatTagLabel(tag);

    const remove =
        document.createElement("button");

    remove.type =
        "button";

    remove.className =
        "search-tag-remove";

    remove.textContent =
        "×";

    remove.title =
        "Remove " + formatTagLabel(tag);

    remove.onclick =
        e => {

            e.stopPropagation();

            removeSearchTag(tag, negative, rerunSearch);

        };

    chip.append(label, remove);

    chip.onclick =
        () => searchInput.focus();

    chip.onmousedown =
        e => {

            /* Keep the input focused through the right-click. */
            if (e.button === 2) {

                tagContextMenuGuard = Date.now();
                e.preventDefault();

            }

        };

    chip.oncontextmenu =
        e => {

            e.preventDefault();
            e.stopPropagation();

            tagContextMenuGuard = Date.now();

            /*
             * In the collapsed box a tag is not invertible; on the
             * results page's chip row it always is.
             */
            if (
                !allowWhenInactive &&
                !searchBox.classList.contains("active")
            ) {
                return;
            }

            toggleSearchTagPolarity(tag, rerunSearch);

        };

    return chip;

}


function renderSearchTags() {

    if (searchChips) {

        searchChips.innerHTML = "";

        committedSearchTags.forEach(tag => {

            searchChips.appendChild(
                createSearchTagChip(tag, false, false, false)
            );

        });

        negatedSearchTags.forEach(tag => {

            searchChips.appendChild(
                createSearchTagChip(tag, true, false, false)
            );

        });

    }

    updateSearchControls();

}


function renderResultsSearchTags() {

    if (!searchResultsTags)
        return;

    searchResultsTags.innerHTML = "";

    committedSearchTags.forEach(tag => {

        searchResultsTags.appendChild(
            createSearchTagChip(tag, false, true, true)
        );

    });

    negatedSearchTags.forEach(tag => {

        searchResultsTags.appendChild(
            createSearchTagChip(tag, true, true, true)
        );

    });

}


function updateSearchResultsTagsVisibility() {

    if (!searchResultsTags)
        return;

    renderResultsSearchTags();

    searchResultsTags.style.display =
        (
            showingSearchResults &&
            searchQueryTagCount() > 0
        )
            ? "flex"
            : "none";

}


function rerunSearchAfterTagChange(rerunSearch) {

    if (!rerunSearch || !showingSearchResults)
        return;

    if (searchQueryTagCount() > 0) {

        searchAlbumsByTags();

    } else {

        showAlbums();

    }

}


function removeSearchTag(tag, negative, rerunSearch = false) {

    const list =
        negative
            ? negatedSearchTags
            : committedSearchTags;

    const index =
        findSearchTagIndex(list, tag);

    if (index < 0)
        return;

    list.splice(index, 1);

    renderSearchTags();
    updateSearchResultsTagsVisibility();
    renderSuggestions(searchInput.value);

    rerunSearchAfterTagChange(rerunSearch);

}


function toggleSearchTagPolarity(tag, rerunSearch = false) {

    const positiveIndex =
        findSearchTagIndex(committedSearchTags, tag);

    if (positiveIndex >= 0) {

        const [moved] =
            committedSearchTags.splice(positiveIndex, 1);

        if (findSearchTagIndex(negatedSearchTags, moved) < 0)
            negatedSearchTags.push(moved);

    } else {

        const negativeIndex =
            findSearchTagIndex(negatedSearchTags, tag);

        if (negativeIndex >= 0) {

            const [moved] =
                negatedSearchTags.splice(negativeIndex, 1);

            if (findSearchTagIndex(committedSearchTags, moved) < 0)
                committedSearchTags.push(moved);

        } else {

            /*
             * A suggestion that was not committed yet: right-click adds
             * it straight to the exclusions.
             */
            negatedSearchTags.push(tag);

        }

    }

    renderSearchTags();
    updateSearchResultsTagsVisibility();
    renderSuggestions(searchInput.value);

    rerunSearchAfterTagChange(rerunSearch);

}


function commitSearchTag(rawText) {

    const pieces =
        String(rawText || "")
        .split(",")
        .map(piece => piece.trim())
        .filter(Boolean);

    let added =
        false;

    for (const piece of pieces) {

        const normalized =
            normalizeTagForMatch(piece);

        if (!normalized)
            continue;

        /*
         * Use the tag's canonical spelling when it exists, but still
         * accept a typed tag that matches nothing so the chip reflects
         * exactly what was searched for (the results will be empty).
         */
        const canonical =
            getAllSearchTags().find(tag =>
                normalizeTagForMatch(tag) === normalized
            );

        const tag =
            canonical || piece.replace(/\s+/g, "_");

        /* Committing a tag makes it positive again. */
        const negativeIndex =
            findSearchTagIndex(negatedSearchTags, tag);

        if (negativeIndex >= 0)
            negatedSearchTags.splice(negativeIndex, 1);

        if (
            committedSearchTags.some(existing =>
                normalizeTagForMatch(existing) === normalized
            )
        ) {
            continue;
        }

        committedSearchTags.push(tag);
        added = true;

    }

    searchInput.value = "";
    selectedSuggestionIndex = -1;
    suggestions = [];
    suggestionBox.innerHTML = "";

    renderSearchTags();
    updateSearchResultsTagsVisibility();
    updateSearchControls();

    return added;

}


const getSortedMatches = (text, excludedTags = []) => {

    const lowerText = normalizeTagForMatch(text);

    const excluded = new Set(
            excludedTags.map(normalizeTagForMatch));

    return getAllSearchTags()
    .filter(tag => {

        const lowerTag =
            normalizeTagForMatch(tag);

        return (
            lowerTag.includes(lowerText) &&
            !excluded.has(lowerTag));

    })
    .sort((a, b) => {

        const aLower =
            normalizeTagForMatch(a);

        const bLower =
            normalizeTagForMatch(b);

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


function renderSuggestions(text) {

    suggestionBox.innerHTML = "";
    suggestions = [];
    selectedSuggestionIndex = -1;

    if (!searchBox.classList.contains("active"))
        return;

    const excluded =
        [...committedSearchTags, ...negatedSearchTags];

    const normalizedText =
        normalizeTagForMatch(text);

    let matches;

    if (!normalizedText) {

        /*
         * Nothing typed: show a random sample rather than every tag.
         * The shuffled order is cached per session, so this stays cheap
         * even with thousands of tags.
         */
        const excludedSet =
            new Set(excluded.map(normalizeTagForMatch));

        matches =
            getRandomTagOrder()
                .filter(tag =>
                    !excludedSet.has(normalizeTagForMatch(tag))
                )
                .slice(0, 60);

    } else {

        matches =
            getSortedMatches(normalizedText, excluded)
                .slice(0, 80);

    }

    matches.forEach(tag => {

        const div =
            document.createElement("div");

        div.className =
            "suggestion";

        div.dataset.tag =
            tag;

        div.textContent =
            formatTagLabel(tag);

        /* Keep focus in the input so the list does not close. */
        div.onmousedown =
            e => e.preventDefault();

        div.onclick =
            () => {

                commitSearchTag(tag);
                renderSuggestions("");
                searchInput.focus();

            };

        div.oncontextmenu =
            e => {

                e.preventDefault();
                e.stopPropagation();

                /* The box is open here, and must stay open. */
                tagContextMenuGuard = Date.now();

                toggleSearchTagPolarity(tag, false);

            };

        suggestionBox.appendChild(div);
        suggestions.push(div);

    });

}


function updateSelectedSuggestion() {

    suggestions.forEach((suggestion, index) => {

        suggestion.classList.toggle(
            "selected",
            index === selectedSuggestionIndex
        );

    });

    if (
        selectedSuggestionIndex >= 0 &&
        selectedSuggestionIndex < suggestions.length
    ) {

        suggestions[
            selectedSuggestionIndex
        ].scrollIntoView({
            block: "nearest"
        });

    }

}


searchInput.addEventListener("focus", () => {

    setSearchActive(true);

    renderSuggestions(searchInput.value);

});


searchInput.addEventListener("blur", () => {

    /*
     * Keyboard focus can leave the field without a mousedown; defer so
     * a click on a suggestion (which keeps focus) is not treated as a
     * leave, then close if focus really moved outside the box.
     */
    setTimeout(() => {

        if (searchBox.contains(document.activeElement))
            return;

        /*
         * Clicking the magnifier blurs the input but must not discard a
         * partial tag before its click handler searches for it.
         */
        if (searchButtonMousedown)
            return;

        /* A right-click on a tag must not close the search field. */
        if (Date.now() - tagContextMenuGuard < 500)
            return;

        if (searchButton && searchButton.contains(document.activeElement))
            return;

        setSearchActive(false);

    }, 0);

});


/*
 * Clicking anywhere in the collapsed field (where the hidden input no
 * longer occupies space) opens the search.
 */
searchBox.addEventListener("click", e => {

    if (searchBox.classList.contains("active"))
        return;

    if (e.target.closest(".search-tag-remove"))
        return;

    /*
     * The input can still hold focus after the box was closed, in which
     * case focus() alone would not fire the focus handler that opens it.
     */
    setSearchActive(true);
    searchInput.focus();
    renderSuggestions(searchInput.value);

});


searchInput.addEventListener("input", () => {

    /*
     * A comma commits the tags before it. Whatever follows stays in the
     * input as the current partial.
     */
    if (searchInput.value.includes(",")) {

        const parts =
            searchInput.value.split(",");

        const last =
            parts.pop();

        const complete =
            parts.join(",");

        if (complete.trim())
            commitSearchTag(complete);

        searchInput.value =
            last.replace(/^\s+/, "");

    }

    updateSearchControls();
    renderSuggestions(searchInput.value);

});


searchInput.addEventListener("keydown", e => {

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {

        if (!suggestions.length)
            renderSuggestions(searchInput.value);

        if (!suggestions.length)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.key === "ArrowDown") {

            selectedSuggestionIndex =
                (selectedSuggestionIndex + 1) %
                suggestions.length;

        } else {

            selectedSuggestionIndex =
                selectedSuggestionIndex <= 0
                    ? suggestions.length - 1
                    : selectedSuggestionIndex - 1;

        }

        updateSelectedSuggestion();

        return;

    }

    if (e.key === "Enter") {

        e.preventDefault();
        e.stopImmediatePropagation();

        if (
            selectedSuggestionIndex >= 0 &&
            suggestions[selectedSuggestionIndex]
        ) {

            suggestions[
                selectedSuggestionIndex
            ].click();

            return;

        }

        if (searchInput.value.trim()) {

            commitSearchTag(searchInput.value);
            renderSuggestions("");

            return;

        }

        searchAlbumsByTags();

        return;

    }

    if (e.key === "Escape") {

        e.preventDefault();

        if (searchInput.value) {

            searchInput.value = "";
            updateSearchControls();
            renderSuggestions("");

        } else {

            setSearchActive(false);

            searchInput.blur();

        }

        return;

    }

    if (e.key === ",") {

        e.preventDefault();

        if (searchInput.value.trim())
            commitSearchTag(searchInput.value);

        renderSuggestions("");

        return;

    }

    if (
        e.key === "Backspace" &&
        !searchInput.value &&
        searchQueryTagCount() > 0
    ) {

        e.preventDefault();

        if (negatedSearchTags.length) {

            removeSearchTag(
                negatedSearchTags[
                    negatedSearchTags.length - 1
                ],
                true
            );

        } else {

            removeSearchTag(
                committedSearchTags[
                    committedSearchTags.length - 1
                ],
                false
            );

        }

        renderSuggestions("");

        return;

    }

    if (e.key === "Tab" && !e.shiftKey) {

        e.preventDefault();
        e.stopImmediatePropagation();

        const typed =
            searchInput.value.trim();

        /*
         * A valid tag already typed is confirmed on Tab. A partial keeps
         * the existing behaviour: Tab autocompletes it to the first
         * match, and a second Tab then confirms it.
         */
        if (
            typed &&
            getAllSearchTags().some(tag =>
                normalizeTagForMatch(tag) ===
                normalizeTagForMatch(typed)
            )
        ) {

            commitSearchTag(typed);
            renderSuggestions("");
            return;

        }

        let tag =
            null;

        if (
            selectedSuggestionIndex >= 0 &&
            suggestions[selectedSuggestionIndex]
        ) {

            tag =
                suggestions[selectedSuggestionIndex].dataset.tag || null;

        } else if (typed) {

            const matches =
                getSortedMatches(
                    normalizeTagForMatch(typed),
                    [...committedSearchTags, ...negatedSearchTags]
                );

            if (matches.length)
                tag = matches[0];

        }

        /* Tab only completes the current word; Enter commits it. */
        if (tag) {

            searchInput.value =
                formatTagLabel(tag);

            const position =
                searchInput.value.length;

            searchInput.setSelectionRange(position, position);

            renderSuggestions(searchInput.value);

        }

        return;

    }

    if (e.key === "Tab" && e.shiftKey) {

        e.preventDefault();
        e.stopImmediatePropagation();

        if (searchInput.value) {

            searchInput.value = "";
            updateSearchControls();

        } else if (committedSearchTags.length) {

            removeSearchTag(
                committedSearchTags[
                    committedSearchTags.length - 1
                ],
                false
            );

        } else if (negatedSearchTags.length) {

            removeSearchTag(
                negatedSearchTags[
                    negatedSearchTags.length - 1
                ],
                true
            );

        }

        renderSuggestions("");

        return;

    }

}, true);


document.addEventListener("mousedown", e => {

    if (searchBox.contains(e.target))
        return;

    if (searchButton && searchButton.contains(e.target))
        return;

    setSearchActive(false);

});


document.getElementById("searchOverlay").addEventListener("click", () => {

    setSearchActive(false);

});


/*
 * Enter on the home page or the search results page runs the search when
 * there is at least one committed tag, even if the search field is not
 * focused. Album pages are left alone.
 */
document.addEventListener("keydown", e => {

    if (
        e.key !== "Enter" ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey
    ) {
        return;
    }

    if (searchBox.contains(e.target))
        return;

    if (
        e.target?.closest?.(
            "input, textarea, select, button, a, [contenteditable]"
        )
    ) {
        return;
    }

    if (currentAlbum)
        return;

    if (searchQueryTagCount() === 0)
        return;

    e.preventDefault();

    searchAlbumsByTags();

});


async function searchAlbumsByTags() {

    /*
     * Pressing the search button with a partial tag typed commits it
     * first, so the results row always reflects the whole query.
     */
    const partial =
        searchInput.value.trim();

    if (partial)
        commitSearchTag(partial);

    const query =
        [...new Set(
            committedSearchTags.map(normalizeTagForMatch)
        )].filter(Boolean);

    const negative =
        [...new Set(
            negatedSearchTags.map(normalizeTagForMatch)
        )].filter(Boolean);

    if (!query.length && !negative.length)
        return;

    const serial =
        ++searchRequestSerial;

    /*
     * Close the expanded search panel before showing the results; the
     * query chips are repeated at the top of the results page.
     */
    setSearchActive(false);
    searchInput.blur();

    /*
     * With a fresh D1 index the server answers the query (the path a
     * paginated gallery will use). Anything that makes the index unsafe
     * -- offline, stale, saved albums, keys that do not resolve -- makes
     * searchAlbumsThroughIndex return null and the local scan below
     * answers instead, exactly as before.
     */
    let results =
        typeof searchAlbumsThroughIndex === "function"
            ? await searchAlbumsThroughIndex(query, negative)
            : null;

    if (serial !== searchRequestSerial)
        return;

    if (results === null) {

        results = albums.filter(album =>
            albumMatchesSearchQuery(
                album,
                query,
                negative
            )
        );

    }

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
    showingSearchResults = true;

    document.getElementById("backButton").style.display = "";
    document.getElementById("saveButton").style.display = "none";

    /*
     * The album page's edit-name button is injected into the nav and is
     * not torn down by leaving the album, so remove it here too or it
     * lingers over the search results.
     */
    const editNameButton =
        document.getElementById("EditNameButton");

    if (editNameButton)
        editNameButton.remove();

    document.getElementById("regenerateAlbum").style.display = "none";

    const manifestButton =
        document.getElementById("generateManifest");

    if (manifestButton)
        manifestButton.style.display = "none";

    /*
     * The query chips at the top of the page replace the old heading;
     * the nav shows how many albums matched.
     */
    const resultLabel =
        `${results.length} result${results.length === 1 ? "" : "s"}`;

    document.getElementById("pageName").textContent = resultLabel;
    document.title = resultLabel;

    const tagContainer =
        document.getElementById("tagBar");

    if (tagContainer) {

        tagContainer.style.display = "none";

        document.getElementById("tagToggle").style.display = "none";

    }

    updateSearchResultsTagsVisibility();

    const gallery =
        document.getElementById("gallery");

    gallery.innerHTML = "";

    if (!results.length) {

        gallery.textContent =
            "No albums found.";

        gallery.style.height = "auto";

        return;

    }

    results.forEach(album => {

        const images =
            buildImagesArray(album);

        if (!album || !images.length)
            return;

        const cover =
            images[
                Math.floor(
                    Math.random() *
                    images.length
                )
            ];

        const card =
            document.createElement("div");

        card.className =
            "album";

        card.dataset.albumId =
            String(album.id);

        const img =
            document.createElement("img");

        img.alt =
            (album.tags || []).join(",");

        const coverWrap =
            document.createElement("div");

        coverWrap.className =
            "album-cover";

        coverWrap.appendChild(img);

        const title =
            document.createElement("div");

        title.textContent =
            album.name;

        card.appendChild(coverWrap);
        card.appendChild(title);

        card.onclick =
            () => loadAlbum(album);

        gallery.appendChild(card);

        const coverURL =
            getBestGuessImageURL(album, cover, "thumb");

        if (coverURL)
            img.src = coverURL;

        enhanceHomeCoverVideo(
            album,
            img,
            { image: cover }
        );

    });

    /*
     * The search results are rendered after the gallery has been cleared,
     * so lay them out explicitly; the ResizeObserver only reacts to width
     * changes and would leave the cards unpositioned (overlapping).
     */
    applyGalleryLayout(false);

    startGalleryResizeTracking();

}


clearSearch.addEventListener("click", () => {

    /*
     * Collapsed, this control is a "+" that opens the search box; only
     * the expanded state's "×" clears the query.
     */
    if (!searchBox.classList.contains("active")) {

        searchInput.focus();
        setSearchActive(true);
        renderSuggestions(searchInput.value);

        return;

    }

    const wasShowingResults =
        showingSearchResults;

    committedSearchTags = [];
    negatedSearchTags = [];

    searchInput.value = "";

    renderSearchTags();
    updateSearchResultsTagsVisibility();
    updateSearchControls();

    if (wasShowingResults) {

        setSearchActive(false);
        showAlbums();

    } else {

        searchInput.focus();

    }

});


searchButton.addEventListener("mousedown", () => {

    searchButtonMousedown = true;

});

searchButton.addEventListener("click", () => {

    searchButtonMousedown = false;

    searchAlbumsByTags();

});

/*
 * If the press turns into a drag/cancel there is no click; clear the flag
 * so a later blur closes the panel normally.
 */
document.addEventListener("mouseup", () => {

    setTimeout(() => {

        searchButtonMousedown = false;

    }, 0);

});


/* Initial collapsed state: "search tags...", + to open, no magnifier. */
updateSearchControls();


//generate new album token mean for album.txt, so set storage to false.
async function generateAlbumRecord(albumOverride = null) {

    const recordAlbum =
        albumOverride ||
        currentAlbum;

    if (!recordAlbum)
        return false;

    const existingManifestUrl =
        resolveAlbumManifestUrl(recordAlbum) ||
        recordAlbum._manifestUrl ||
        "";

    const canUpload =
        typeof isAlbumLibraryUploadAvailable === "function" &&
        isAlbumLibraryUploadAvailable();

    let manifestUrl;
    let action = "copy";

    if (
        canUpload &&
        typeof showAlbumRecordActionDialog === "function"
    ) {

        const choice =
            await showAlbumRecordActionDialog(
                existingManifestUrl
            );

        if (!choice)
            return false;

        manifestUrl =
            choice.manifestUrl;

        action =
            choice.action || "copy";

    } else {

        manifestUrl =
            await showInWindowPrompt({
                title: "Album Manifest URL",
                message:
                    "Optional: paste the URL where this album's manifest is hosted. " +
                    "The site will only use it if it is present here.",
                value: existingManifestUrl,
                okLabel: "Generate"
            });

        if (manifestUrl === null)
            return false;

    }

    const trimmedManifest =
        manifestUrl.trim();

    const setManifest = album => {

        if (!album)
            return;

        if (trimmedManifest) {

            const automaticUrl =
                resolveAlbumManifestUrl(album) ||
                album._manifestUrl ||
                "";

            const keepLocator =
                automaticUrl === trimmedManifest &&
                album.manifest &&
                typeof album.manifest === "object" &&
                typeof album.manifest.provider === "string" &&
                album.manifest.fields;

            album.manifest = {
                ...(keepLocator
                    ? album.manifest
                    : {}),
                url: trimmedManifest
            };

        } else {

            delete album.manifest;

        }

    };

    setManifest(recordAlbum);

    /*
     * An edit-mode caller passes a live view for the record while the
     * real album stays the persistence target.
     */
    if (
        currentAlbum &&
        currentAlbum !== recordAlbum
    ) {
        setManifest(currentAlbum);
    }

    /*
     * Keep the URL on the saved/temporary album so the prompt is
     * prefilled next time.
     */
    if (
        currentAlbum?.storage &&
        typeof saveAlbumEdits === "function"
    ) {
        await saveAlbumEdits(currentAlbum);
    } else if (
        currentAlbum?.temporary &&
        typeof saveTemporaryAlbum === "function"
    ) {
        await saveTemporaryAlbum(currentAlbum);
    }

    const originAlbum =
        currentAlbum || recordAlbum;

    const localOrigin =
        originAlbum
            ? {

                id:
                    originAlbum.id,

                isLocal:
                    typeof isLocalAlbumCopy === "function"
                        ? isLocalAlbumCopy(
                            originAlbum
                        )
                        : (
                            originAlbum.storage === true ||
                            originAlbum.temporary === true ||
                            originAlbum.localEdited === true ||
                            originAlbum.savedEdited === true
                        ),

                storage:
                    originAlbum.storage === true,

                temporary:
                    originAlbum.temporary === true,

                localEdited:
                    originAlbum.localEdited === true

            }
            : null;

    const newID = generateAlbumID(
            recordAlbum.name,
            recordAlbum.id);

    recordAlbum.id =
        newID;

    recordAlbum.storage =
        false;

    if (
        currentAlbum &&
        currentAlbum !== recordAlbum
    ) {
        currentAlbum.id =
            newID;

        currentAlbum.storage =
            false;
    }

    history.replaceState(
        null,
        "",
        "?$" + encodeURIComponent(newID));

    const line =
        await buildAlbumTxtRecord(recordAlbum);

    /*
     * Publishing makes this record the new source of truth. Do not
     * create a published edit base here: removed tags are no longer
     * edits relative to the previous record, so they should disappear
     * from the tag bar rather than remain as history.
     */
    if (
        action === "upload" &&
        typeof uploadAlbumRecordToLibrary === "function"
    ) {

        try {

            const result =
                await uploadAlbumRecordToLibrary(
                    recordAlbum,
                    line,
                    localOrigin,
                    null,
                    { skipConfirm: true }
                );

            if (result?.cancelled)
                return false;

            if (!result?.ok)
                throw new Error(
                    "The album library write was not completed."
                );

            /*
             * The action dialog already confirmed the upload. Keep the
             * result out of a modal alert so publishing stays a
             * one-dialog operation.
             */
            console.log(
                result.replaced
                    ? "[ALBUM LIBRARY] Album entry replaced."
                    : "[ALBUM LIBRARY] Album entry added."
            );

            return true;

        } catch (error) {

            alert(
                "Could not upload the album entry:\n\n" +
                (error?.message || String(error))
            );

            showInWindowCopy(
                "Copy this into album.txt:",
                line
            );

            return false;

        }

    }

    navigator.clipboard.writeText(line)
    .then(() => {
        alert("Regenerated the album ID and copied a line for album.txt!");
    })
    .catch(() => {
        showInWindowCopy(
            "Copy this into album.txt:",
            line
        );
    });

    return true;

}

const regenerateAlbumButton =
    document.getElementById("regenerateAlbum");

if (regenerateAlbumButton) {

    regenerateAlbumButton.onclick =
        () => generateAlbumRecord();

}
