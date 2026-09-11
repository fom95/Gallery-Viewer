/**
 * Gallery Layout Module
 * Handles responsive grid calculations and layout positioning
 */

const GalleryLayout = (() => {
    // Configuration constants
    const galleryGap = 1;
    const minColumns = 2;
    const maxColumns = 5;
    const minThumbWidth = 180;
    const homeMinColumns = 2;
    const homeMaxColumns = 5;
    const homeMinThumbWidth = 180;
    const homeHeightMultiplier = 1.12;

    let galleryResizeCheck = null;
    let lastMeasuredGalleryWidth = null;
    let stableChecks = 0;

    /**
     * Clamp a value between min and max
     */
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    /**
     * Calculate the optimal column count for given width
     */
    function getGalleryColumnCount(
        width,
        minColumnsToUse = minColumns,
        maxColumnsToUse = maxColumns,
        minWidthToUse = minThumbWidth
    ) {
        const gap = window.innerWidth * (galleryGap / 100);
        const columns = Math.floor((width + gap) / (minWidthToUse + gap));
        return Math.max(minColumnsToUse, Math.min(maxColumnsToUse, columns));
    }

    /**
     * Calculate the full layout with positions and dimensions
     */
    function calculateGalleryLayout(isHomePage = false) {
        const gallery = document.getElementById("gallery");
        if (!gallery) return null;

        const items = isHomePage
            ? [...gallery.querySelectorAll(".album")].filter(
                element => getComputedStyle(element).display !== "none"
            )
            : [...gallery.querySelectorAll(".thumbnail-slot")].filter(
                element => getComputedStyle(element).display !== "none"
            );

        const minColumnsToUse = isHomePage ? homeMinColumns : minColumns;
        const maxColumnsToUse = isHomePage ? homeMaxColumns : maxColumns;
        const minWidthToUse = isHomePage ? homeMinThumbWidth : minThumbWidth;

        const style = getComputedStyle(gallery);
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const paddingRight = parseFloat(style.paddingRight) || 0;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;

        const galleryRect = gallery.getBoundingClientRect();
        const galleryWidth = galleryRect.width - paddingLeft - paddingRight;

        const columns = getGalleryColumnCount(
            galleryWidth,
            minColumnsToUse,
            maxColumnsToUse,
            minWidthToUse
        );

        const gap = window.innerWidth * (galleryGap / 100);
        const itemWidth = (galleryWidth - gap * (columns - 1)) / columns;
        const itemHeight = isHomePage ? itemWidth * homeHeightMultiplier : itemWidth;

        const positions = [];

        items.forEach((item, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);

            const left = paddingLeft + column * (itemWidth + gap);
            const top = paddingTop + row * (itemHeight + gap);

            positions.push({
                element: item,
                left: left,
                top: top,
                width: itemWidth,
                height: itemHeight
            });
        });

        const rows = items.length > 0 ? Math.ceil(items.length / columns) : 0;
        const imageAreaHeight = rows > 0 ? rows * itemHeight + (rows - 1) * gap : 0;
        const requiredHeight = paddingTop + imageAreaHeight + paddingBottom;

        return {
            positions,
            height: requiredHeight,
            columns
        };
    }

    /**
     * Apply calculated layout to DOM
     */
    function applyGalleryLayout(animate = true, isHomePage = false) {
        const gallery = document.getElementById("gallery");
        if (!gallery) return null;

        const layout = calculateGalleryLayout(isHomePage);
        if (!layout) return null;

        gallery.style.height = layout.height + "px";

        layout.positions.forEach(info => {
            const item = info.element;

            if (!animate) {
                item.style.transition = "none";
            }

            item.style.position = "absolute";
            item.style.left = info.left + "px";
            item.style.top = info.top + "px";
            item.style.width = info.width + "px";
            item.style.height = info.height + "px";

            if (!animate) {
                item.offsetWidth;
                item.style.transition = "";
            }
        });

        return layout;
    }

    /**
     * Update gallery layout
     */
    function updateGalleryLayout(animate = true, isHomePage = false) {
        applyGalleryLayout(animate, isHomePage);
    }

    /**
     * Start tracking gallery resize with debouncing
     */
    function startGalleryResizeTracking(isHomePage = false) {
        clearInterval(galleryResizeCheck);
        stableChecks = 0;
        lastMeasuredGalleryWidth = null;

        galleryResizeCheck = setInterval(() => {
            const gallery = document.getElementById("gallery");

            if (!gallery) {
                clearInterval(galleryResizeCheck);
                galleryResizeCheck = null;
                return;
            }

            const width = gallery.getBoundingClientRect().width;

            if (
                lastMeasuredGalleryWidth !== null &&
                Math.abs(width - lastMeasuredGalleryWidth) < 0.01
            ) {
                stableChecks++;
            } else {
                stableChecks = 0;
            }

            lastMeasuredGalleryWidth = width;
            updateGalleryLayout(true, isHomePage);

            if (stableChecks >= 3) {
                clearInterval(galleryResizeCheck);
                galleryResizeCheck = null;
            }
        }, 75);
    }

    /**
     * Stop tracking gallery resize
     */
    function stopGalleryResizeTracking() {
        if (galleryResizeCheck) {
            clearInterval(galleryResizeCheck);
            galleryResizeCheck = null;
        }
    }

    // Auto-track on window resize
    window.addEventListener("resize", () => {
        startGalleryResizeTracking();
    });

    // Public API
    return {
        clamp,
        getGalleryColumnCount,
        calculateGalleryLayout,
        applyGalleryLayout,
        updateGalleryLayout,
        startGalleryResizeTracking,
        stopGalleryResizeTracking,
        // Configuration accessors
        getConfig: () => ({
            galleryGap,
            minColumns,
            maxColumns,
            minThumbWidth,
            homeMinColumns,
            homeMaxColumns,
            homeMinThumbWidth,
            homeHeightMultiplier
        })
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GalleryLayout;
}
