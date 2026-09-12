/*
 * 17-add-image-editor.js
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
