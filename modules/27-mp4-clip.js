/*
 * 27-mp4-clip.js
 *
 * Cuts a short section out of a (possibly multi-GB) MP4/MOV WITHOUT
 * reading the whole file: only the movie's index (the "moov" box) is
 * read into memory; the media bytes for the wanted time range are
 * referenced lazily with Blob.slice() and stitched behind a freshly
 * written, minimal index. The result is a small, valid MP4 holding the
 * first video track and first audio track for that range, starting on a
 * video keyframe.
 *
 *   const clip = await extractMp4Clip(file, startSeconds, durationSeconds);
 *   clip.file           the small MP4
 *   clip.relativeStart  where startSeconds falls inside clip.file
 *                       (clip.file begins on the keyframe at or before it)
 *
 * Throws for anything it can't handle (not an MP4/MOV, fragmented MP4,
 * compact sample sizes, no video track); callers should fall back to
 * another method.
 */

/* ---------- small helpers ---------- */

function mp4Fourcc(view, offset) {

    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );

}


function mp4Concat(parts) {

    let length = 0;

    for (const part of parts)
        length += part.length;

    const out = new Uint8Array(length);

    let offset = 0;

    for (const part of parts) {

        out.set(part, offset);

        offset += part.length;

    }

    return out;

}


function mp4Box(type, ...parts) {

    const body = mp4Concat(parts);

    const out = new Uint8Array(8 + body.length);

    new DataView(out.buffer).setUint32(0, out.length);

    for (let i = 0; i < 4; i++)
        out[4 + i] = type.charCodeAt(i);

    out.set(body, 8);

    return out;

}


function mp4U32s(values) {

    const out = new Uint8Array(values.length * 4);

    const view = new DataView(out.buffer);

    for (let i = 0; i < values.length; i++)
        view.setUint32(i * 4, values[i] >>> 0);

    return out;

}


function mp4ParseChildren(view, start, end) {

    const boxes = [];

    let position = start;

    while (position + 8 <= end) {

        let size = view.getUint32(position);

        const type = mp4Fourcc(view, position + 4);

        let header = 8;

        if (size === 1) {

            size =
                view.getUint32(position + 8) * 4294967296 +
                view.getUint32(position + 12);

            header = 16;

        } else if (size === 0) {

            size = end - position;

        }

        if (size < header || position + size > end)
            break;

        boxes.push({
            type,
            start: position,
            end: position + size,
            data: position + header
        });

        position += size;

    }

    return boxes;

}


function mp4Child(list, type) {

    return list.find(box => box.type === type) || null;

}


async function mp4ReadTopLevelBoxes(file) {

    const boxes = [];

    let position = 0;

    while (position < file.size) {

        const head =
            new DataView(
                await file
                    .slice(position, Math.min(position + 16, file.size))
                    .arrayBuffer()
            );

        if (head.byteLength < 8)
            break;

        let size = head.getUint32(0);

        const type = mp4Fourcc(head, 4);

        let headerSize = 8;

        if (size === 1) {

            if (head.byteLength < 16)
                break;

            size = head.getUint32(8) * 4294967296 + head.getUint32(12);

            headerSize = 16;

        } else if (size === 0) {

            size = file.size - position;

        }

        if (size < headerSize)
            break;

        boxes.push({ type, start: position, size, headerSize });

        position += size;

    }

    return boxes;

}


/* ---------- track parsing ---------- */

function mp4ParseTrack(view, bytes, trak) {

    const trakChildren = mp4ParseChildren(view, trak.data, trak.end);

    const tkhd = mp4Child(trakChildren, "tkhd");
    const mdia = mp4Child(trakChildren, "mdia");

    if (!tkhd || !mdia)
        return null;

    const mdiaChildren = mp4ParseChildren(view, mdia.data, mdia.end);

    const mdhd = mp4Child(mdiaChildren, "mdhd");
    const hdlr = mp4Child(mdiaChildren, "hdlr");
    const minf = mp4Child(mdiaChildren, "minf");

    if (!mdhd || !hdlr || !minf)
        return null;

    const handler = mp4Fourcc(view, hdlr.data + 8);

    const minfChildren = mp4ParseChildren(view, minf.data, minf.end);

    const stbl = mp4Child(minfChildren, "stbl");

    if (!stbl)
        return null;

    const tables = mp4ParseChildren(view, stbl.data, stbl.end);

    const need = type => {

        const box = mp4Child(tables, type);

        if (!box)
            throw new Error(`MP4 track is missing '${type}'.`);

        return box;

    };

    if (mp4Child(tables, "stz2"))
        throw new Error("Compact sample sizes (stz2) are not supported.");

    const mdhdVersion = view.getUint8(mdhd.data);

    const timescale =
        view.getUint32(mdhd.data + (mdhdVersion === 1 ? 20 : 12));

    const stsd = need("stsd");
    const stts = need("stts");
    const stsc = need("stsc");
    const stsz = need("stsz");

    const stco = mp4Child(tables, "stco");
    const co64 = mp4Child(tables, "co64");

    if (!stco && !co64)
        throw new Error("MP4 track has no chunk offsets.");

    const ctts = mp4Child(tables, "ctts");
    const stss = mp4Child(tables, "stss");

    /* sample sizes */
    const uniformSize = view.getUint32(stsz.data + 4);
    const sampleCount = view.getUint32(stsz.data + 8);

    const sizes = new Uint32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {

        sizes[i] =
            uniformSize ||
            view.getUint32(stsz.data + 12 + i * 4);

    }

    /* decode-time deltas */
    const deltas = new Uint32Array(sampleCount);

    {
        const entries = view.getUint32(stts.data + 4);

        let sample = 0;

        let lastDelta = 0;

        for (let e = 0; e < entries && sample < sampleCount; e++) {

            const count = view.getUint32(stts.data + 8 + e * 8);
            const delta = view.getUint32(stts.data + 12 + e * 8);

            lastDelta = delta;

            for (let k = 0; k < count && sample < sampleCount; k++)
                deltas[sample++] = delta;

        }

        while (sample < sampleCount)
            deltas[sample++] = lastDelta;
    }

    const dts = new Float64Array(sampleCount);

    {
        let time = 0;

        for (let i = 0; i < sampleCount; i++) {

            dts[i] = time;

            time += deltas[i];

        }
    }

    /* composition offsets (optional) */
    let cttsOffsets = null;

    let cttsVersion = 0;

    if (ctts) {

        cttsVersion = view.getUint8(ctts.data);

        cttsOffsets = new Int32Array(sampleCount);

        const entries = view.getUint32(ctts.data + 4);

        let sample = 0;

        for (let e = 0; e < entries && sample < sampleCount; e++) {

            const count = view.getUint32(ctts.data + 8 + e * 8);
            const offset = view.getInt32(ctts.data + 12 + e * 8);

            for (let k = 0; k < count && sample < sampleCount; k++)
                cttsOffsets[sample++] = offset;

        }

    }

    /* sync samples (optional; absent = every sample is a keyframe) */
    const sync = new Uint8Array(sampleCount);

    if (stss) {

        const entries = view.getUint32(stss.data + 4);

        for (let e = 0; e < entries; e++) {

            const number = view.getUint32(stss.data + 8 + e * 4);

            if (number >= 1 && number <= sampleCount)
                sync[number - 1] = 1;

        }

    } else {

        sync.fill(1);

    }

    /* chunk offsets */
    let chunkOffsets;

    if (stco) {

        const entries = view.getUint32(stco.data + 4);

        chunkOffsets = new Float64Array(entries);

        for (let i = 0; i < entries; i++)
            chunkOffsets[i] = view.getUint32(stco.data + 8 + i * 4);

    } else {

        const entries = view.getUint32(co64.data + 4);

        chunkOffsets = new Float64Array(entries);

        for (let i = 0; i < entries; i++) {

            chunkOffsets[i] =
                view.getUint32(co64.data + 8 + i * 8) * 4294967296 +
                view.getUint32(co64.data + 12 + i * 8);

        }

    }

    /* sample -> absolute file offset, via the sample-to-chunk table */
    const stscEntries = view.getUint32(stsc.data + 4);

    const runs = [];

    for (let e = 0; e < stscEntries; e++) {

        runs.push({
            first: view.getUint32(stsc.data + 8 + e * 12),
            perChunk: view.getUint32(stsc.data + 12 + e * 12)
        });

    }

    const offsets = new Float64Array(sampleCount);

    {
        let sample = 0;

        let run = 0;

        for (let c = 0; c < chunkOffsets.length && sample < sampleCount; c++) {

            while (run + 1 < runs.length && runs[run + 1].first <= c + 1)
                run++;

            let offset = chunkOffsets[c];

            for (let k = 0; k < runs[run].perChunk && sample < sampleCount; k++) {

                offsets[sample] = offset;

                offset += sizes[sample];

                sample++;

            }

        }

        if (sample < sampleCount)
            throw new Error("MP4 sample tables are inconsistent.");
    }

    return {
        handler,
        timescale,
        sampleCount,
        sizes,
        deltas,
        dts,
        cttsOffsets,
        cttsVersion,
        sync,
        offsets,
        raw: {
            tkhd,
            mdhd,
            hdlr,
            stsd,
            vmhdOrSmhd:
                mp4Child(minfChildren, "vmhd") ||
                mp4Child(minfChildren, "smhd") ||
                null,
            dinf: mp4Child(minfChildren, "dinf")
        }
    };

}


/* first index whose value is >= target (or length if none) */
function mp4LowerBound(values, count, target) {

    let low = 0;

    let high = count;

    while (low < high) {

        const middle = (low + high) >> 1;

        if (values[middle] < target)
            low = middle + 1;
        else
            high = middle;

    }

    return low;

}


/* ---------- writing ---------- */

function mp4BuildStbl(track, stsdBytes, from, to, chunkOffset, ctts, cttsVersion) {

    const count = to - from;

    /* stts: run-length encoded deltas */
    const sttsPairs = [];

    for (let i = from; i < to; ) {

        let j = i + 1;

        while (j < to && track.deltas[j] === track.deltas[i])
            j++;

        sttsPairs.push(j - i, track.deltas[i]);

        i = j;

    }

    const parts = [
        stsdBytes,
        mp4Box("stts", mp4U32s([0, sttsPairs.length / 2, ...sttsPairs]))
    ];

    if (ctts) {

        const pairs = [];

        for (let i = 0; i < count; ) {

            let j = i + 1;

            while (j < count && ctts[j] === ctts[i])
                j++;

            pairs.push(j - i, ctts[i]);

            i = j;

        }

        parts.push(
            mp4Box(
                "ctts",
                mp4U32s([
                    cttsVersion << 24,
                    pairs.length / 2,
                    ...pairs
                ])
            )
        );

    }

    const syncNumbers = [];

    let allSync = true;

    for (let i = from; i < to; i++) {

        if (track.sync[i])
            syncNumbers.push(i - from + 1);
        else
            allSync = false;

    }

    if (!allSync) {

        parts.push(
            mp4Box("stss", mp4U32s([0, syncNumbers.length, ...syncNumbers]))
        );

    }

    /* every selected sample goes into one chunk */
    parts.push(mp4Box("stsc", mp4U32s([0, 1, 1, count, 1])));

    const sizeEntries = new Uint32Array(count);

    for (let i = 0; i < count; i++)
        sizeEntries[i] = track.sizes[from + i];

    parts.push(
        mp4Box(
            "stsz",
            mp4U32s([0, 0, count]),
            mp4U32s(sizeEntries)
        )
    );

    parts.push(mp4Box("stco", mp4U32s([0, 1, chunkOffset])));

    return mp4Box("stbl", ...parts);

}


function mp4PatchDuration(raw, base, kind, ticks) {

    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    const version = raw[base];

    const offset =
        kind === "tkhd"
            ? (version === 1 ? 28 : 20)
            : (version === 1 ? 24 : 16);

    if (version === 1) {

        view.setUint32(base + offset, Math.floor(ticks / 4294967296));
        view.setUint32(base + offset + 4, ticks >>> 0);

    } else {

        view.setUint32(base + offset, ticks >>> 0);

    }

}


/* ---------- main entry point ---------- */

async function extractMp4Clip(file, startSeconds, durationSeconds) {

    const MAX_CLIP_BYTES = 1.5e9;

    const topLevel =
        await mp4ReadTopLevelBoxes(file);

    if (!topLevel.some(box => box.type === "ftyp"))
        throw new Error("Not an MP4/MOV file.");

    if (topLevel.some(box => box.type === "moof"))
        throw new Error("Fragmented MP4 files are not supported.");

    const moovInfo =
        topLevel.find(box => box.type === "moov");

    if (!moovInfo)
        throw new Error("No movie index (moov) found.");

    if (moovInfo.size > 512 * 1024 * 1024)
        throw new Error("The movie index is too large.");

    const moovBytes =
        new Uint8Array(
            await file
                .slice(moovInfo.start, moovInfo.start + moovInfo.size)
                .arrayBuffer()
        );

    const view =
        new DataView(moovBytes.buffer);

    const moovChildren =
        mp4ParseChildren(view, moovInfo.headerSize, moovBytes.length);

    const mvhd =
        mp4Child(moovChildren, "mvhd");

    if (!mvhd)
        throw new Error("No movie header (mvhd) found.");

    const mvhdVersion =
        view.getUint8(mvhd.data);

    const movieTimescale =
        view.getUint32(mvhd.data + (mvhdVersion === 1 ? 20 : 12));

    const tracks =
        moovChildren
            .filter(box => box.type === "trak")
            .map(trak => mp4ParseTrack(view, moovBytes, trak))
            .filter(Boolean);

    const video =
        tracks.find(track => track.handler === "vide");

    const audio =
        tracks.find(track => track.handler === "soun") || null;

    if (!video || !video.sampleCount)
        throw new Error("No video track found.");

    /* ---- pick the sample ranges ---- */

    const endSeconds =
        startSeconds + durationSeconds + 1;

    const startTicks =
        startSeconds * video.timescale;

    // last video sample at or before the start, then back to a keyframe
    let videoFrom =
        mp4LowerBound(video.dts, video.sampleCount, startTicks + 0.5) - 1;

    if (videoFrom < 0)
        videoFrom = 0;

    while (videoFrom > 0 && !video.sync[videoFrom])
        videoFrom--;

    const videoTo =
        Math.max(
            videoFrom + 1,
            mp4LowerBound(
                video.dts,
                video.sampleCount,
                endSeconds * video.timescale
            )
        );

    const clipStart =
        video.dts[videoFrom] / video.timescale;

    let audioFrom = 0;
    let audioTo = 0;

    if (audio && audio.sampleCount) {

        audioFrom =
            mp4LowerBound(
                audio.dts,
                audio.sampleCount,
                clipStart * audio.timescale
            );

        audioTo =
            mp4LowerBound(
                audio.dts,
                audio.sampleCount,
                endSeconds * audio.timescale
            );

    }

    const selections = [
        { track: video, from: videoFrom, to: videoTo }
    ];

    if (audio && audioTo > audioFrom)
        selections.push({ track: audio, from: audioFrom, to: audioTo });

    /*
     * The original index usually carries an edit list that hides the
     * video's B-frame delay. It isn't copied, so the same delay is
     * removed from the composition offsets instead: the earliest frame
     * shown starts at 0, in step with the audio.
     */
    for (const selection of selections) {

        const { track, from, to } = selection;

        selection.ctts = null;

        selection.cttsVersion = track.cttsVersion;

        if (!track.cttsOffsets)
            continue;

        const base = track.dts[from];

        let earliest = Infinity;

        for (let i = from; i < to; i++) {

            earliest =
                Math.min(
                    earliest,
                    track.dts[i] - base + track.cttsOffsets[i]
                );

        }

        const shifted = new Int32Array(to - from);

        for (let i = from; i < to; i++) {

            shifted[i - from] = track.cttsOffsets[i] - earliest;

            if (shifted[i - from] < 0)
                selection.cttsVersion = 1;

        }

        selection.ctts = shifted;

    }

    /* ---- the media bytes: merge adjacent samples into runs ---- */

    const dataParts = [];

    let totalBytes = 0;

    for (const selection of selections) {

        const { track, from, to } = selection;

        selection.bytes = 0;

        let runStart = track.offsets[from];

        let runEnd = runStart;

        for (let i = from; i < to; i++) {

            const offset = track.offsets[i];

            if (offset !== runEnd) {

                dataParts.push(file.slice(runStart, runEnd));

                runStart = offset;

                runEnd = offset;

            }

            runEnd += track.sizes[i];

            selection.bytes += track.sizes[i];

        }

        dataParts.push(file.slice(runStart, runEnd));

        totalBytes += selection.bytes;

    }

    if (totalBytes > MAX_CLIP_BYTES)
        throw new Error("The requested section is too large to extract.");

    /* ---- the new index ---- */

    const ftyp =
        mp4Box(
            "ftyp",
            new TextEncoder().encode("isom"),
            mp4U32s([512]),
            new TextEncoder().encode("isomiso2avc1mp41")
        );

    const buildMoov = dataStart => {

        let chunkOffset = dataStart;

        const traks = [];

        let movieDuration = 0;

        for (const selection of selections) {

            const { track, from, to } = selection;

            let ticks = 0;

            for (let i = from; i < to; i++)
                ticks += track.deltas[i];

            const durationInMovieUnits =
                Math.round(ticks / track.timescale * movieTimescale);

            movieDuration =
                Math.max(movieDuration, durationInMovieUnits);

            const copy = box =>
                moovBytes.slice(box.start, box.end);

            const tkhd = copy(track.raw.tkhd);

            mp4PatchDuration(
                tkhd,
                track.raw.tkhd.data - track.raw.tkhd.start,
                "tkhd",
                durationInMovieUnits
            );

            const mdhd = copy(track.raw.mdhd);

            mp4PatchDuration(
                mdhd,
                track.raw.mdhd.data - track.raw.mdhd.start,
                "mdhd",
                ticks
            );

            const minfParts = [];

            if (track.raw.vmhdOrSmhd)
                minfParts.push(copy(track.raw.vmhdOrSmhd));

            if (track.raw.dinf)
                minfParts.push(copy(track.raw.dinf));

            minfParts.push(
                mp4BuildStbl(
                    track,
                    copy(track.raw.stsd),
                    from,
                    to,
                    chunkOffset,
                    selection.ctts,
                    selection.cttsVersion
                )
            );

            chunkOffset += selection.bytes;

            traks.push(
                mp4Box(
                    "trak",
                    tkhd,
                    mp4Box(
                        "mdia",
                        mdhd,
                        copy(track.raw.hdlr),
                        mp4Box("minf", ...minfParts)
                    )
                )
            );

        }

        const mvhdCopy =
            moovBytes.slice(mvhd.start, mvhd.end);

        mp4PatchDuration(
            mvhdCopy,
            mvhd.data - mvhd.start,
            "mvhd",
            movieDuration
        );

        return mp4Box("moov", mvhdCopy, ...traks);

    };

    // offsets are fixed-size fields, so the first pass gives the real size
    const firstPass =
        buildMoov(0);

    const moov =
        buildMoov(ftyp.length + firstPass.length + 8);

    if (moov.length !== firstPass.length)
        throw new Error("Internal error building the clip index.");

    if (ftyp.length + moov.length + 8 + totalBytes > 4294967295)
        throw new Error("The extracted section is too large.");

    const mdatHeader =
        new Uint8Array(8);

    new DataView(mdatHeader.buffer).setUint32(0, totalBytes + 8);

    mdatHeader.set(new TextEncoder().encode("mdat"), 4);

    const baseName =
        (file.name || "video").replace(/\.[^.]+$/, "") || "video";

    const clipFile =
        new File(
            [ftyp, moov, mdatHeader, ...dataParts],
            `${baseName}.clip.mp4`,
            {
                type: "video/mp4",
                lastModified: Date.now()
            }
        );

    return {
        file: clipFile,
        clipStart,
        relativeStart: Math.max(0, startSeconds - clipStart),
        bytes: totalBytes
    };

}
