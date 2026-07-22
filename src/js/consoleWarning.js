// CONSOLE WARNING - ANTI-PHISHING
const lsName = "xode-isDeveloper";
const showWarning = () => {
    console.log(`%c⚠️ SECURITY WARNING`, `
    font-size: 1.8rem;
    font-weight: bold;
    color: #f00;
    text-shadow: 0 0 20px rgba(255,0,0,0.3);`);
    console.log(`%cSTOP WHAT YOU'RE DOING!
Pasting anything into the console could compromise you.
XODE (this app) will NEVER ask you to paste code here. This is a phishing scam tactic.
Only use the console if you're a developer and understand what you're doing.
If someone directed you here, they're trying to steal your data.

To hide this warning, run: i_am_a_xode_developer()`, `
    border-left: 0.5rem solid #f00;
    font-size: 1rem;
    padding: 0rem 1rem;`);

    document.body.classList.add("consoleWarning");
};

globalThis.i_am_a_xode_developer = function () {
    localStorage.setItem(lsName, true);
    document.body.classList.remove("consoleWarning");
    console.clear();
};

if (!localStorage.getItem(lsName)) {
    showWarning();
}

