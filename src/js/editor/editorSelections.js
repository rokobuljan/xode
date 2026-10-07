import { getAutoIndentEdit } from "./editorIndent.js";

export const selectionBounds = ({ anchor, head }) => ({ start: Math.min(anchor, head), end: Math.max(anchor, head) });

// Keep the first (primary) selection first, merging duplicates and overlaps.
export function normalizeSelections(value, selections) {
    const clamp = (position) => Math.max(0, Math.min(value.length, position));
    const ordered = selections
        .map((selection, index) => {
            const range = { ...selection, anchor: clamp(selection.anchor), head: clamp(selection.head) };
            return { ...selectionBounds(range), index, range };
        })
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const entry of ordered) {
        const previous = merged.at(-1);
        const touchesCaret = previous && entry.start === previous.end && (entry.start === entry.end || previous.start === previous.end);
        if (previous && (entry.start < previous.end || touchesCaret)) {
            const direction = entry.index < previous.index ? entry.range : previous.range;
            previous.end = Math.max(previous.end, entry.end);
            previous.index = Math.min(previous.index, entry.index);
            previous.range = direction.anchor > direction.head ? { anchor: previous.end, head: previous.start } : { anchor: previous.start, head: previous.end };
        } else merged.push(entry);
    }
    return merged.sort((a, b) => a.index - b.index).map((entry) => entry.range);
}

export function applySelectionEdits(value, selections, makeEdit) {
    const ranges = normalizeSelections(value, selections);
    const ordered = ranges.map((selection, index) => ({ ...makeEdit(selectionBounds(selection), index), index })).sort((a, b) => a.start - b.start || a.end - b.end);
    const edits = [];
    for (const edit of ordered) {
        const previous = edits.at(-1);
        if (previous && edit.start < previous.end && !previous.text && !edit.text) {
            previous.end = Math.max(previous.end, edit.end);
            previous.index = Math.min(previous.index, edit.index);
        } else edits.push(edit);
    }
    let result = "",
        position = 0;
    const updated = [];
    for (const edit of edits) {
        result += value.slice(position, edit.start);
        const head = result.length + (edit.caretOffset ?? edit.text.length);
        result += edit.text;
        position = edit.end;
        updated.push({ index: edit.index, anchor: head, head });
    }
    result += value.slice(position);
    return {
        value: result,
        selections: normalizeSelections(
            result,
            updated.sort((a, b) => a.index - b.index).map(({ anchor, head }) => ({ anchor, head })),
        ),
    };
}

export function lineBounds(value, position) {
    const start = position ? value.lastIndexOf("\n", position - 1) + 1 : 0;
    const next = value.indexOf("\n", position);
    return { start, end: next < 0 ? value.length : next };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function characterBoundary(value, position, direction) {
    let previous = 0;
    for (const { index, segment } of segmenter.segment(value)) {
        if (direction > 0 && index + segment.length > position) return index + segment.length;
        if (direction < 0 && index >= position) return previous;
        previous = index;
    }
    return direction > 0 ? value.length : previous;
}

const isWord = (character) => /[\p{L}\p{N}_$]/u.test(character || "");
export function wordBoundary(value, position, direction) {
    let cursor = position;
    const character = () => value[direction < 0 ? cursor - 1 : cursor];
    while ((direction < 0 ? cursor > 0 : cursor < value.length) && /\s/.test(character() || "")) cursor += direction;
    const word = isWord(character());
    while (cursor >= 0 && cursor <= value.length && character() && !/\s/.test(character()) && isWord(character()) === word) cursor += direction;
    return Math.max(0, Math.min(value.length, cursor));
}

export function verticalSelection(value, selection, direction, tabWidth = 4) {
    const { start, end } = lineBounds(value, selection.head);
    if ((direction < 0 && !start) || (direction > 0 && end === value.length)) return null;
    let column = 0;
    for (const character of value.slice(start, selection.head)) column += character === "\t" ? tabWidth - (column % tabWidth) : 1;
    const goalColumn = selection.goalColumn ?? column;
    const target = lineBounds(value, direction < 0 ? start - 1 : end + 1);
    let head = target.start,
        width = 0;
    for (const character of value.slice(target.start, target.end)) {
        const next = width + (character === "\t" ? tabWidth - (width % tabWidth) : 1);
        if (next > goalColumn) break;
        width = next;
        head += character.length;
    }
    return { anchor: head, head, goalColumn };
}

export function editSelections(value, selections, type, text = "", tabWidth = 4) {
    const ranges = normalizeSelections(value, selections);
    const spatial = ranges.map((selection, index) => ({ ...selectionBounds(selection), index })).sort((a, b) => a.start - b.start);
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (ranges.length > 1 && lines.length === ranges.length + 1 && lines.at(-1) === "") lines.pop();
    const pasted = new Map(spatial.map(({ index }, rank) => [index, lines[rank]]));
    return applySelectionEdits(value, ranges, ({ start, end }, index) => {
        if (type === "newline") return { start, end, ...getAutoIndentEdit(value, start, end, tabWidth) };
        if (type === "text" || type === "paste") return { start, end, text: type === "paste" && lines.length === ranges.length ? pasted.get(index) : text.replace(/\r\n?/g, "\n") };
        if (start !== end) return { start, end, text: "" };
        if (type === "backspace") {
            const prefix = value.slice(lineBounds(value, start).start, start);
            const indent = /^ +$/.test(prefix) ? prefix.length % tabWidth || tabWidth : 0;
            start = indent ? start - indent : characterBoundary(value, start, -1);
        } else if (type === "delete") end = characterBoundary(value, end, 1);
        else if (type === "wordBackspace") start = wordBoundary(value, start, -1);
        else if (type === "wordDelete") end = wordBoundary(value, end, 1);
        else if (type === "lineBackspace") start = lineBounds(value, start).start;
        else if (type === "lineDelete") end = lineBounds(value, end).end;
        return { start, end, text: "" };
    });
}

export function indentSelections(value, selections, tabWidth, outdent = false) {
    const starts = new Set();
    for (const selection of selections) {
        const { start, end } = selectionBounds(selection);
        let position = lineBounds(value, start).start;
        do {
            starts.add(position);
            const next = value.indexOf("\n", position);
            if (next < 0 || next + 1 >= end) break;
            position = next + 1;
        } while (position <= end);
    }
    const edits = [...starts]
        .sort((a, b) => a - b)
        .map((start) => {
            const indent = value.slice(start).match(new RegExp(`^(?: {1,${tabWidth}}|\\t)`))?.[0] || "";
            return { start, end: start + (outdent ? indent.length : 0), text: outdent ? "" : " ".repeat(tabWidth) };
        });
    let result = value;
    for (const edit of edits.toReversed()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    const map = (position) => {
        let offset = 0;
        for (const edit of edits) {
            if (position < edit.start) break;
            if (position < edit.end) return edit.start + offset;
            offset += edit.text.length - (edit.end - edit.start);
        }
        return position + offset;
    };
    return {
        value: result,
        selections: normalizeSelections(
            result,
            selections.map(({ anchor, head }) => ({ anchor: map(anchor), head: map(head) })),
        ),
    };
}

export function selectOccurrence(value, selections, all = false) {
    const first = selectionBounds(selections[0]);
    if (first.start === first.end) {
        let start = first.start,
            end = first.end;
        while (start > 0 && isWord(value[start - 1])) start--;
        while (end < value.length && isWord(value[end])) end++;
        if (start === end) return selections;
        selections = [{ anchor: start, head: end }, ...selections.slice(1)];
        if (!all) return normalizeSelections(value, selections);
    }
    const { start, end } = selectionBounds(selections[0]);
    const needle = value.slice(start, end);
    if (!needle) return selections;
    const candidates = [];
    for (let position = value.indexOf(needle); position >= 0; position = value.indexOf(needle, position + needle.length)) candidates.push({ anchor: position, head: position + needle.length });
    if (all) return normalizeSelections(value, [selections[0], ...candidates]);
    const available = candidates.filter(
        (candidate) =>
            !selections.some((selection) => {
                const bounds = selectionBounds(selection);
                return candidate.anchor < bounds.end && candidate.head > bounds.start;
            }),
    );
    const next = available.find((candidate) => candidate.anchor >= end) || available[0];
    return next ? normalizeSelections(value, [next, ...selections]) : selections;
}

// Replay a browser-managed edit (for example an IME composition) at every cursor.
export function replayNativeEdit(before, after, selections) {
    if (before === after) return { value: before, selections };
    const primary = selectionBounds(selections[0]);
    let start = primary.start,
        end = primary.end;
    const suffix = before.slice(end);
    if (!after.startsWith(before.slice(0, start)) || !after.endsWith(suffix) || after.length < start + suffix.length) {
        start = 0;
        while (start < primary.start && before[start] === after[start]) start++;
        let tail = 0;
        while (tail < before.length - primary.end && tail < after.length - start && before[before.length - tail - 1] === after[after.length - tail - 1]) tail++;
        end = before.length - tail;
    }
    const text = after.slice(start, after.length - (before.length - end));
    return applySelectionEdits(before, selections, (bounds) => ({
        start: Math.max(0, bounds.start + start - primary.start),
        end: Math.min(before.length, bounds.end + end - primary.end),
        text,
    }));
}
