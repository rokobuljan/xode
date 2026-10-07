import hljs from "highlight.js/lib/core";
import html from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";

hljs.registerLanguage("xml", html);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);

export default hljs;
