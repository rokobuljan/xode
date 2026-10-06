export function normalizeTabWidth(value) {
    const width = Number(value);
    return Number.isInteger(width) && width > 0 ? width : 4;
}

export function getAutoIndentEdit(value, selectionStart, selectionEnd, tabWidth) {
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const currentLine = value.substring(lineStart, selectionStart);
    const indent = currentLine.match(/^\s*/)[0] || "";
    const previousChar = selectionStart > 0 ? value[selectionStart - 1] : "";
    const extraIndent = ["{", "[", "("].includes(previousChar) ? " ".repeat(tabWidth) : "";
    const innerIndent = indent + extraIndent;
    const matchingDelimiter = { "{": "}", "[": "]", "(": ")" }[previousChar];
    const isBetweenPair = selectionStart === selectionEnd && matchingDelimiter === value[selectionStart];
    const text = isBetweenPair ? `\n${innerIndent}\n${indent}` : `\n${innerIndent}`;

    return {
        text,
        caretOffset: 1 + innerIndent.length,
    };
}
