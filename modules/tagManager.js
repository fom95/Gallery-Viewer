/**
 * Tag Management Module
 * Handles tag filtering, searching, suggestions, and UI interactions
 */

const TagManager = (() => {
    const selectedTags = new Set();
    const excludedTags = new Set();
    let filterMode = "any"; // "any" or "all"

    const searchInput = document.getElementById("tagSearch");
    const suggestionBox = document.getElementById("tagSuggestions");
    const clearButton = document.getElementById("clearTags");

    let suggestions = [];
    let selectedSuggestionIndex = -1;
    let activeTagIndex = 0;
    let previousTagIndex = 0;
    let previousSearchValue = "";

    /**
     * Get all tags from albums
     */
    function getAllTags(albums = []) {
        const tags = new Set();
        albums.forEach(album => {
            (album.tags || []).forEach(tag => {
                tags.add(tag.toLowerCase());
            });
        });
        return [...tags];
    }

    /**
     * Check if a tag exists in the tag list
     */
    function isValidTag(tag, albums = []) {
        const lower = tag.trim().toLowerCase();
        if (!lower) return false;
        return getAllTags(albums).some(existing =>
            existing.trim().toLowerCase() === lower
        );
    }

    /**
     * Get tag parts from search input
     */
    function getTagParts() {
        return searchInput.value.split(",");
    }

    /**
     * Get current tag index based on cursor position
     */
    function getCurrentTagIndex() {
        const value = searchInput.value;
        const cursor = searchInput.selectionStart;
        return value.slice(0, cursor).split(",").length - 1;
    }

    /**
     * Remove tag at specific index
     */
    function removeTagAt(index) {
        const parts = getTagParts();
        if (index < 0 || index >= parts.length) return;

        let start = 0;
        for (let i = 0; i < index; i++) {
            start += parts[i].length + 1;
        }

        parts.splice(index, 1);
        searchInput.value = parts
            .map(part => part.trim())
            .filter(Boolean)
            .join(", ");

        const newPosition = Math.min(start, searchInput.value.length);
        searchInput.setSelectionRange(newPosition, newPosition);
    }

    /**
     * Validate and remove invalid previous tag
     */
    function validatePreviousTag(albums = []) {
        const parts = getTagParts();
        if (previousTagIndex < 0 || previousTagIndex >= parts.length) return;

        const tag = parts[previousTagIndex].trim();
        if (!tag) return;
        if (isValidTag(tag, albums)) return;

        removeTagAt(previousTagIndex);
    }

    /**
     * Remove partial tag being edited
     */
    function removeCurrentPartialTag() {
        const value = searchInput.value;
        if (value.endsWith(", ")) return;

        const cursor = searchInput.selectionStart;
        const beforeCursor = value.slice(0, cursor);
        const start = beforeCursor.lastIndexOf(",") + 1;
        const afterCursor = value.indexOf(",", cursor);
        const end = afterCursor === -1 ? value.length : afterCursor;

        const before = value.slice(0, start);
        const after = value.slice(end);

        let newValue = before + after;
        newValue = newValue
            .replace(/,\s*,/g, ", ")
            .replace(/^,\s*/, "")
            .replace(/\s+,/g, ",")
            .replace(/,\s*$/, ", ");

        if (newValue && !newValue.endsWith(", ")) {
            newValue = newValue.replace(/,\s*$/, ", ");
        }

        searchInput.value = newValue;
        selectedSuggestionIndex = -1;
        suggestionBox.innerHTML = "";
        previousSearchValue = searchInput.value;
    }

    /**
     * Get sorted tag matches
     */
    function getSortedMatches(text, excludedTags = [], albums = []) {
        const lowerText = text.toLowerCase();
        const excluded = new Set(
            excludedTags.map(tag => tag.trim().toLowerCase())
        );

        return getAllTags(albums)
            .filter(tag => {
                const lowerTag = tag.trim().toLowerCase();
                return lowerTag.includes(lowerText) && !excluded.has(lowerTag);
            })
            .sort((a, b) => {
                const aLower = a.trim().toLowerCase();
                const bLower = b.trim().toLowerCase();
                const aStarts = aLower.startsWith(lowerText);
                const bStarts = bLower.startsWith(lowerText);

                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return aLower.localeCompare(bLower);
            });
    }

    /**
     * Update suggestion highlight
     */
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
            selectedSuggestionIndex < suggestions.length
        ) {
            suggestions[selectedSuggestionIndex].scrollIntoView({
                block: "nearest"
            });
        }
    }

    /**
     * Build tag list UI
     */
    function buildTagList(tags) {
        const tagContainer = document.getElementById("tagList");
        if (!tagContainer) return;

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
                        (selectedTags.size || excludedTags.size) ? "" : "none";

                    updateFilterDisplay();
                };

                btn.oncontextmenu = (e) => {
                    e.preventDefault();

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
                        (selectedTags.size || excludedTags.size) ? "" : "none";

                    updateFilterDisplay();
                };

                tagContainer.appendChild(btn);
            });
    }

    /**
     * Toggle filter mode
     */
    function toggleFilterMode() {
        filterMode = filterMode === "any" ? "all" : "any";
        const modeBtn = document.getElementById("filterMode");
        if (modeBtn) {
            modeBtn.textContent = filterMode === "any" ? "Any" : "All";
        }
        updateFilterDisplay();
    }

    /**
     * Clear all tag filters
     */
    function clearAllTags() {
        selectedTags.clear();
        excludedTags.clear();

        document.querySelectorAll("#tagList .tag").forEach(btn => {
            btn.classList.remove("selected");
            btn.classList.remove("excluded");
        });

        clearButton.style.display = "none";
        updateFilterDisplay();
    }

    /**
     * Apply tag filter to gallery items
     * Callback function - parent should implement filtering logic
     */
    function applyTagFilter(filterCallback) {
        if (filterCallback) {
            filterCallback({
                selectedTags: new Set(selectedTags),
                excludedTags: new Set(excludedTags),
                filterMode
            });
        }
    }

    /**
     * Placeholder for filter update (to be connected to parent)
     */
    function updateFilterDisplay() {
        // This will be overridden by the main script
    }

    /**
     * Initialize search input event listeners
     */
    function initSearchListeners(albums = []) {
        if (!searchInput) return;

        searchInput.addEventListener("input", () => {
            const value = searchInput.value;
            const currentIndex = getCurrentTagIndex();

            if (currentIndex !== activeTagIndex) {
                previousTagIndex = activeTagIndex;
                validatePreviousTag(albums);
                activeTagIndex = getCurrentTagIndex();
            } else {
                activeTagIndex = currentIndex;
            }

            selectedSuggestionIndex = -1;
            suggestionBox.innerHTML = "";
            suggestions.length = 0;

            const parts = searchInput.value.split(",");
            const currentTag = (parts[activeTagIndex] || "").trim();
            const text = currentTag.toLowerCase();

            const enteredTags = parts
                .map((tag, index) => ({ tag: tag.trim(), index }))
                .filter(item => item.tag && item.index !== activeTagIndex)
                .map(item => item.tag.toLowerCase());

            if (text) {
                getSortedMatches(text, enteredTags, albums).forEach(tag => {
                    const div = document.createElement("div");
                    div.className = "suggestion";
                    div.textContent = tag;

                    div.onclick = () => {
                        const parts = searchInput.value.split(",");
                        parts[activeTagIndex] = tag;
                        searchInput.value = parts
                            .map(part => part.trim())
                            .join(", ");

                        if (activeTagIndex === parts.length - 1) {
                            searchInput.value += ", ";
                        }

                        suggestionBox.innerHTML = "";
                        suggestions.length = 0;
                        selectedSuggestionIndex = -1;

                        searchInput.focus();
                        const newPosition = searchInput.value.length;
                        searchInput.setSelectionRange(newPosition, newPosition);
                    };

                    suggestionBox.appendChild(div);
                    suggestions.push(div);
                });
            }

            previousSearchValue = searchInput.value;
        });

        searchInput.addEventListener("click", () => {
            const newIndex = getCurrentTagIndex();
            if (newIndex !== activeTagIndex) {
                previousTagIndex = activeTagIndex;
                validatePreviousTag(albums);
                activeTagIndex = getCurrentTagIndex();
            }
        });

        searchInput.addEventListener("keydown", e => {
            if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();

                const parts = searchInput.value.split(",");
                const partial = (parts[activeTagIndex] || "").trim();
                if (!partial) return;

                const enteredTags = parts
                    .map((tag, index) => ({ tag: tag.trim(), index }))
                    .filter(item => item.tag && item.index !== activeTagIndex)
                    .map(item => item.tag);

                const matches = getSortedMatches(partial, enteredTags, albums);
                if (matches.length) {
                    parts[activeTagIndex] = matches[0];
                    searchInput.value = parts.map(part => part.trim()).join(", ");

                    const nextIndex = activeTagIndex + 1;
                    if (nextIndex >= parts.length) {
                        searchInput.value += ", ";
                    }

                    let cursorPosition = 0;
                    for (let i = 0; i <= activeTagIndex; i++) {
                        cursorPosition += parts[i].trim().length;
                        if (i < activeTagIndex) cursorPosition += 2;
                    }
                    cursorPosition += 2;

                    activeTagIndex = Math.min(
                        nextIndex,
                        searchInput.value.split(",").length - 1
                    );

                    suggestionBox.innerHTML = "";
                    suggestions.length = 0;
                    selectedSuggestionIndex = -1;

                    searchInput.focus();
                    searchInput.setSelectionRange(cursorPosition, cursorPosition);
                }
                return;
            }

            if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();

                const parts = searchInput.value.split(",");
                const current = (parts[activeTagIndex] || "").trim();
                let removeIndex = current ? activeTagIndex : parts.length - 2;

                if (removeIndex < 0 || removeIndex >= parts.length) return;

                parts.splice(removeIndex, 1);
                searchInput.value = parts
                    .map(part => part.trim())
                    .filter(Boolean)
                    .join(", ");

                if (searchInput.value) searchInput.value += ", ";

                suggestionBox.innerHTML = "";
                suggestions.length = 0;
                selectedSuggestionIndex = -1;

                activeTagIndex = Math.max(
                    0,
                    Math.min(removeIndex, searchInput.value.split(",").length - 1)
                );

                searchInput.focus();
                const position = searchInput.value.length;
                searchInput.setSelectionRange(position, position);
                return;
            }

            if (e.key === "ArrowDown") {
                if (!suggestions.length) return;
                e.preventDefault();
                e.stopImmediatePropagation();

                selectedSuggestionIndex++;
                if (selectedSuggestionIndex >= suggestions.length) {
                    selectedSuggestionIndex = 0;
                }
                updateSelectedSuggestion();
                return;
            }

            if (e.key === "ArrowUp") {
                if (!suggestions.length) return;
                e.preventDefault();
                e.stopImmediatePropagation();

                selectedSuggestionIndex--;
                if (selectedSuggestionIndex < 0) {
                    selectedSuggestionIndex = suggestions.length - 1;
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
                suggestions.length
            ) {
                e.preventDefault();
                e.stopImmediatePropagation();
                suggestions[selectedSuggestionIndex].click();
                return;
            }
        }, true);

        if (clearButton) {
            clearButton.onclick = () => clearAllTags();
        }
    }

    /**
     * Save tag bar state to localStorage
     */
    function saveTagBarState() {
        const tagBar = document.getElementById("tagBar");
        if (!tagBar) return;

        if (!tagBar.classList.contains("hidden")) {
            tagBar.style.visibility = "visible";
        }
        localStorage.setItem("tagBarHidden", tagBar.classList.contains("hidden"));
    }

    /**
     * Load tag bar state from localStorage
     */
    function loadTagBarState() {
        const tagBar = document.getElementById("tagBar");
        if (!tagBar) return;

        const hidden = localStorage.getItem("tagBarHidden") === "true";
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

    /**
     * Initialize tag toggle
     */
    function initTagToggle() {
        const tagToggle = document.getElementById("tagToggle");
        const tagBar = document.getElementById("tagBar");

        if (tagToggle && tagBar) {
            tagToggle.addEventListener("click", () => {
                tagBar.classList.toggle("hidden");
                saveTagBarState();

                const startTime = performance.now();

                function animateTagGallery(time) {
                    const elapsed = time - startTime;
                    updateFilterDisplay();

                    if (elapsed < 500) {
                        requestAnimationFrame(animateTagGallery);
                    }
                }

                requestAnimationFrame(animateTagGallery);
            });
        }
    }

    // Public API
    return {
        // State accessors
        getSelectedTags: () => new Set(selectedTags),
        getExcludedTags: () => new Set(excludedTags),
        getFilterMode: () => filterMode,

        // Tag operations
        getAllTags,
        isValidTag,
        buildTagList,
        toggleFilterMode,
        clearAllTags,
        applyTagFilter,
        setUpdateCallback: (callback) => { updateFilterDisplay = callback; },

        // Search operations
        getSortedMatches,
        getTagParts,
        getCurrentTagIndex,
        removeTagAt,
        removeCurrentPartialTag,

        // State persistence
        saveTagBarState,
        loadTagBarState,

        // Initialization
        initSearchListeners,
        initTagToggle
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TagManager;
}
