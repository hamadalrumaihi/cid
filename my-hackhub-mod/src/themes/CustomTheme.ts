import { Theme } from "@hotbunny/hackhub-content-sdk";

Theme.register("my-hackhub-mod", {
    name: "my-hackhub-mod",

    colors: {
        taskbarBg: "#0f0f23",
        controlBarBg: "#1a1a2e",
        windowTitlebar: "#16213e",
        windowBg: "#0f0f23",
        accentColor: "#e94560",
        desktopIconText: "#eee",
        startMenuBg: "#1a1a2e",
        startMenuText: "#eee",
        windowControlsColor: "#eee",
        terminalBg: "#0a0a0a",
    },

    taskbar: {
        position: "floating",
        height: "52px",
        width: "auto",
        borderRadius: "14px",
        blur: true,
        transparency: 0.85,
        showSearch: true,
        showAppNames: false,
        gap: "4px",
        padding: "4px 8px",
    },

    controlBar: {
        height: "28px",
        blur: true,
        transparency: 0.9,
        hasStartMenu: true,
    },

    windows: {
        titlebarHeight: "36px",
        controlsPosition: "right",
        controlsStyle: "default",
        showControlsOnHover: false,
        borderRadius: "10px",
        blur: true,
    },

    desktop: {
        iconSize: "56px",
        iconGap: "8px",
    },

    startMenu: {
        host: "taskbar",
        borderRadius: "12px",
        offset: 8,
    },
});

Theme.setActive("my-hackhub-mod");

Theme.injectCSS(`
    body {
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    }
`);
