const formatters = {
    js: {
        parser: "babel",
        plugins: () => Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
    },
    html: {
        parser: "html",
        plugins: async () => [await import("prettier/plugins/html")],
    },
    css: {
        parser: "css",
        plugins: async () => [await import("prettier/plugins/postcss")],
    },
};

export const formatCode = async (code, language, tabWidth) => {
    const formatter = formatters[language];
    if (!formatter) throw new Error(`Unsupported formatting language: ${language}`);

    // Fetch only the current pane's parser; module imports are cached after first use.
    const [prettier, plugins] = await Promise.all([import("prettier/standalone"), formatter.plugins()]);
    return prettier.format(code, {
        parser: formatter.parser,
        plugins: plugins.map((plugin) => plugin.default),
        semi: true,
        singleQuote: true,
        tabWidth,
        htmlWhitespaceSensitivity: "ignore",
        bracketSameLine: true,
    });
};
