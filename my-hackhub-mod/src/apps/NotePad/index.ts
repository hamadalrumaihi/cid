import { App, RegisterApp } from "@hotbunny/hackhub-content-sdk";
import appHTML from "./app.html";

@RegisterApp
export class NotePad extends App {

    AppName = "MyHackhubModNotePad";
    Title = "NotePad";
    Icon = "";
    HTML = appHTML;

    DefaultSize = { width: 480, height: 400 };
    MinSize = { width: 320, height: 250 };

    Unlocked = true;

    Store = {
        title: "NotePad",
        ratings: 4.5,
        description: "A simple note-taking app. Save and load your notes.",
    };

    Exports = {
        appVersion: "1.0.0",
        formatDate: (timestamp: number) => {
            const d = new Date(timestamp);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        },
    };
}
