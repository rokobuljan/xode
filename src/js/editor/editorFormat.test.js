/* global describe, expect, it */

import { formatCode } from "./editorFormat.js";

describe("on-demand editor formatting", () => {
    it.each([
        ["js", 'if(true){console.log("Xode")}', "if (true) {\n  console.log('Xode');\n}\n"],
        ["css", ".app{color:red}", ".app {\n  color: red;\n}\n"],
        ["html", "<main  class='app'><h1>Xode</h1></main>", '<main class="app"><h1>Xode</h1></main>\n'],
    ])("loads the %s parser and preserves formatting options", async (language, code, expected) => {
        expect(await formatCode(code, language, 2)).toBe(expected);
    });

    it("applies the user's indentation width", async () => {
        expect(await formatCode("if(true){run()}", "js", 4)).toBe("if (true) {\n    run();\n}\n");
    });

    it("rejects invalid syntax for the editor's existing error handler", async () => {
        await expect(formatCode("const =", "js", 4)).rejects.toThrow();
    });
});
