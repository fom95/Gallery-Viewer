/*
 * 15-tag-search-and-suggestions.js
 *
 * The tag search box: autocomplete suggestions, keyboard navigation of
 * results, and searching albums by tag.
 */

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

        if (
            !album ||
            !Array.isArray(album.images) ||
            !album.images.length
        ) {
            return;
        }

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

        const title =
            document.createElement("div");

        title.textContent =
            album.name;

        card.appendChild(img);
        card.appendChild(title);

        card.onclick =
            () => loadAlbum(album);

        gallery.appendChild(card);

        if (cover.source === "telegram") {

            resolveImageAsset(
                {
                    image: cover,
                    index: -1,
                    source: "telegram"
                },
                "thumb",
                () => true
            )
            .then(url => {

                if (url)
                    img.src = url;

            })
            .catch(error => {

                console.warn(
                    "Failed to load Telegram search-result cover:",
                    error
                );

            });

        } else {

            img.src =
                cover.thumb?.url ||
                cover.medium?.url ||
                cover.image?.url ||
                "";

        }

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
