/*
 * 14-xmp-metadata.js
 *
 * Reads XMP metadata (tags) out of raw image file bytes.
 */

const XMP = {

    getData: function (img, callback) {

        fetch(img.src)
        .then(r => r.arrayBuffer())
        .then(buffer => {

            const xmpString = findXMP(buffer);

            if (!xmpString) {
                callback.call(img, null);
                return;
            }

            img.xmpraw = xmpString;
            img.xmp = parseXMP(xmpString);
            img.xmptags = createXMPShortcuts(img.xmp);

            callback.call(img, img.xmp);

        });

    }

};


function findXMP(buffer) {

    const bytes = new Uint8Array(buffer);

    const text = new TextDecoder("utf-8")
        .decode(bytes);

    const start = text.indexOf("<x:xmpmeta");

    if (start === -1)
        return null;

    const end = text.indexOf("</x:xmpmeta>", start);

    if (end === -1)
        return null;

    return text.substring(
        start,
        end + "</x:xmpmeta>".length);

}


function parseXMP(xmpString) {

    const xml = new DOMParser()
        .parseFromString(xmpString, "application/xml");

    function cleanName(name) {

        return name.includes(":")
         ? name.split(":")[1]
         : name;

    }

    function addChild(obj, key, value) {

        if (obj[key] === undefined)
            obj[key] = value;
        else if (Array.isArray(obj[key]))
            obj[key].push(value);
        else
            obj[key] = [obj[key], value];

    }

    function parseNode(node) {

        const obj = {};

        for (const attr of node.attributes || []) {

            obj[cleanName(attr.name)] =
                attr.value;

        }

        if (node.children.length === 0) {

            const text = node.textContent.trim();

            return text || obj;

        }

        for (const child of node.children) {

            addChild(
                obj,
                cleanName(child.nodeName),
                parseNode(child));

        }

        return obj;

    }

	return parseNode(xml.documentElement);

}


function createXMPShortcuts(xmp) {
    const rawDescriptions =
        xmp.RDF?.Description || {};

    const descriptions =
        Array.isArray(rawDescriptions)
            ? rawDescriptions
            : [rawDescriptions];

    let subject = [];
    let dimensions = null;
    let faces = [];

    for (const desc of descriptions) {

        if (!desc || typeof desc !== "object")
            continue;

        /*
         * dc:subject
         */
        const rawSubject =
            desc.subject?.Bag?.li;

        if (rawSubject !== undefined) {

            const values =
                Array.isArray(rawSubject)
                    ? rawSubject
                    : [rawSubject];

            for (const value of values) {

                if (typeof value !== "string")
                    continue;

                const clean =
                    value.trim();

                if (
                    clean &&
                    !subject.includes(clean)
                ) {
                    subject.push(clean);
                }
            }
        }

        /*
         * Regions / dimensions
         */
        if (
            desc.Regions?.AppliedToDimensions &&
            !dimensions
        ) {
            dimensions =
                desc.Regions.AppliedToDimensions;
        }

        /*
         * Faces
         */
        const rawFaces =
            desc.Regions?.RegionList?.Bag?.li;

        if (rawFaces !== undefined) {

            const list =
                Array.isArray(rawFaces)
                    ? rawFaces
                    : [rawFaces];

            for (const f of list) {

                const d =
                    f?.Description || f;

                if (!d || typeof d !== "object")
                    continue;

                faces.push({
                    name: d.Name,
                    type: d.Type,
                    area: d.Area
                });
            }
        }
    }

    return {
        subject,
        dimensions,
        faces
    };
}

function getAllTags() {

    const tags = new Set();

    albums.forEach(album => {

        (album.tags || []).forEach(tag => {
            tags.add(tag.toLowerCase());
        });

    });

    return [...tags];

}


async function getTelegramXMPMetadata(
    buffer
) {

    const xmpString =
        findXMP(
            buffer
        );

    if (!xmpString) {

        return {
            xmp: null,
            xmptags: {
                subject: [],
                dimensions: null,
                faces: []
            }
        };

    }

    const xmp =
        parseXMP(
            xmpString
        );

    const xmptags =
        createXMPShortcuts(
            xmp
        );

    return {
        xmp,
        xmptags
    };

}