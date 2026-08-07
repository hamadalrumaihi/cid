import { Quest, RegisterQuest, UI, Mail } from "@hotbunny/hackhub-content-sdk";

interface InvestigationData {
    scannedTarget: boolean;
    connected: boolean;
}

@RegisterQuest
export class InvestigationQuest extends Quest<InvestigationData> {

    Name = "MyHackhubModInvestigation";
    Title = "Network Investigation";
    Description = "Investigate a suspicious server. Scan it with nmap, then gain remote access.";

    Rewards = {
        xp: 500,
        money: 2500,
    };

    Mails = [
        {
            title: "Job Offer: Network Investigation",
            content: "I need someone to investigate a suspicious server at 45.33.32.156. Scan it with nmap, then SSH into it. Payment on completion.\n\n— Anonymous",
        },
    ];

    Objectives = [
        {
            name: "scan_target",
            description: "Scan the target — run nmap on 45.33.32.156",
        },
        {
            name: "connect",
            description: "Gain remote access — connect to 45.33.32.156 via SSH, FTP, or any remote service",
            unlocksAfter: ["scan_target"],
        },
    ];

    CreateData(): InvestigationData {
        return {
            scannedTarget: false,
            connected: false,
        };
    }

    // Runs ONCE, when the quest is first claimed. Use it for one-time setup
    // (announcements, building networks, sending mail). It is NOT called again
    // when the game is reloaded.
    OnStart() {
        UI.toast("New quest: Network Investigation", "info");
        // Send the first mail from the Mails array (defaults to the employer as sender).
        this.sendMail(0);
    }

    // Runs once on claim AND again every time the game starts (reload).
    // Register event listeners here — they live in memory and are lost on
    // reload, so OnStart() can't re-create them.
    OnObjectivesStart() {
        this.Events.on("Terminal.NmapScan", (event) => {
            if (event.ip === "45.33.32.156") {
                this.SetData("scannedTarget", true);
                this.completeObjective("scan_target");
                UI.toast("Target scanned successfully!", "success");
            }
        });

        this.Events.on("RemoteConnection.Established", (event) => {
            if (event.ip === "45.33.32.156") {
                this.SetData("connected", true);
                this.completeObjective("connect");
            }
        });
    }

    OnComplete() {
        UI.toast("Quest completed! Rewards received.", "success");

        Mail.send({
            from: "anonymous@darkmail.net",
            subject: "Payment Sent",
            content: "Good work. Payment has been transferred to your account. Don't contact me again.\n\n— Anonymous",
        });
    }
}
