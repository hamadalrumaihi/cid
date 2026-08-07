import { Website, RegisterWebsite, WebsitePageDefinition } from "@hotbunny/hackhub-content-sdk";
import homePage from "./pages/home.html";
import aboutPage from "./pages/about.html";

@RegisterWebsite
export class ExampleSite extends Website {

    SiteName = "my-hackhub-mod";
    Host = "my-hackhub-mod.mod";
    Icon = "";

    Popular = true;

    Pages: WebsitePageDefinition[] = [
        {
            path: "/",
            title: "my-hackhub-mod - Home",
            description: "Welcome to my-hackhub-mod. A mod-powered website.",
            html: homePage,
            seo: true,
            search: ["my-hackhub-mod", "mod", "example"],
        },
        {
            path: "/about",
            title: "my-hackhub-mod - About",
            description: "Learn more about my-hackhub-mod and its features.",
            html: aboutPage,
            seo: true,
        },
    ];

    Exports = {
        siteVersion: "1.0.0",
        siteName: "my-hackhub-mod",
        formatText: (text: string) => text.toUpperCase(),
    };
}
