/*
 * 01-dialogs.js
 *
 * window.prompt() is not available in the desktop browser this app is
 * opened in -- calling it throws "prompt() is not supported" -- so
 * anything that needs a typed answer (Telegram login, renaming an
 * album, showing a line the clipboard refused) uses these in-window
 * dialogs instead. alert() and confirm() still work and are untouched.
 */

function removeExistingInWindowDialog() {

    const existing =
        document.getElementById(
            "inWindowDialogOverlay"
        );

    if (existing)
        existing.remove();

}


function createInWindowDialog(titleText) {

    removeExistingInWindowDialog();

    const overlay =
        document.createElement("div");

    overlay.id =
        "inWindowDialogOverlay";

    overlay.className =
        "app-dialog-overlay";

    const box =
        document.createElement("div");

    box.className =
        "app-dialog";

    if (titleText) {

        const title =
            document.createElement("div");

        title.className =
            "app-dialog-title";

        title.textContent =
            titleText;

        box.appendChild(title);

    }

    overlay.appendChild(box);

    document.body.appendChild(overlay);

    return {
        overlay,
        box
    };

}


function addInWindowDialogMessage(box, message) {

    if (!message)
        return;

    const text =
        document.createElement("div");

    text.className =
        "app-dialog-message";

    text.textContent =
        message;

    box.appendChild(text);

}


function createInWindowDialogButtons(box) {

    const row =
        document.createElement("div");

    row.className =
        "app-dialog-actions";

    box.appendChild(row);

    return row;

}


function createInWindowDialogButton(row, label, primary) {

    const button =
        document.createElement("button");

    button.type =
        "button";

    button.className =
        primary
            ? "app-button app-button-primary"
            : "app-button";

    button.textContent =
        label;

    row.appendChild(button);

    return button;

}


/*
 * Same contract as window.prompt(): resolves to the entered string, or
 * null when cancelled (Cancel, Escape or a click on the backdrop).
 * Always async, so callers must await it.
 */
function showInWindowPrompt({
    title = "Enter a value",
    message = "",
    value = "",
    placeholder = "",
    okLabel = "OK",
    cancelLabel = "Cancel",
    password = false,
    multiline = false
} = {}) {

    return new Promise(resolve => {

        const {
            overlay,
            box
        } = createInWindowDialog(title);

        addInWindowDialogMessage(box, message);

        let field;

        if (multiline) {

            field =
                document.createElement("textarea");

            field.rows =
                5;

        } else {

            field =
                document.createElement("input");

            field.type =
                password ? "password" : "text";

        }

        field.value =
            value;

        if (!multiline)
            field.placeholder = placeholder;

        field.className =
            multiline
                ? "app-field app-field-multiline"
                : "app-field";

        box.appendChild(field);

        const buttons =
            createInWindowDialogButtons(box);

        let finished =
            false;

        const finish = result => {

            if (finished)
                return;

            finished =
                true;

            document.removeEventListener(
                "keydown",
                onKeydown,
                true
            );

            overlay.remove();

            resolve(result);

        };

        const cancelButton =
            createInWindowDialogButton(
                buttons,
                cancelLabel,
                false
            );

        cancelButton.onclick =
            () => finish(null);

        const okButton =
            createInWindowDialogButton(
                buttons,
                okLabel,
                true
            );

        okButton.onclick =
            () => finish(field.value);

        const onKeydown = e => {

            if (e.key === "Escape") {

                e.preventDefault();
                e.stopPropagation();

                finish(null);

                return;

            }

            if (
                e.key === "Enter" &&
                !multiline
            ) {

                e.preventDefault();
                e.stopPropagation();

                finish(field.value);

            }

        };

        document.addEventListener(
            "keydown",
            onKeydown,
            true
        );

        overlay.onclick =
            e => {

                if (e.target === overlay)
                    finish(null);

            };

        field.focus();

        if (!multiline)
            field.select();

    });

}


/*
 * Read-only counterpart to prompt(): shows text the user can copy when
 * navigator.clipboard was unavailable (e.g. a file:// page) and a plain
 * prompt() would have been used as the fallback.
 */
function showInWindowCopy(title, text) {

    const {
        overlay,
        box
    } = createInWindowDialog(title || "Copy");

    const textarea =
        document.createElement("textarea");

    textarea.readOnly =
        true;

    textarea.rows =
        6;

    textarea.value =
        text;

    textarea.className =
        "app-field app-field-multiline";

    box.appendChild(textarea);

    const buttons =
        createInWindowDialogButtons(box);

    const copyButton =
        createInWindowDialogButton(
            buttons,
            "Copy",
            true
        );

    copyButton.onclick =
        async () => {

            try {

                await navigator.clipboard.writeText(text);

                copyButton.textContent =
                    "Copied";

            } catch {

                textarea.focus();
                textarea.select();

            }

        };

    const closeButton =
        createInWindowDialogButton(
            buttons,
            "Close",
            false
        );

    closeButton.onclick =
        () => overlay.remove();

    const onKeydown = e => {

        if (e.key === "Escape") {

            e.preventDefault();
            e.stopPropagation();

            document.removeEventListener(
                "keydown",
                onKeydown,
                true
            );

            overlay.remove();

        }

    };

    document.addEventListener(
        "keydown",
        onKeydown,
        true
    );

    overlay.onclick =
        e => {

            if (e.target === overlay)
                overlay.remove();

        };

    textarea.focus();
    textarea.select();

}
