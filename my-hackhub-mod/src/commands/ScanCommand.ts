import { Command, RegisterCommand, CommandTools, Network } from "@hotbunny/hackhub-content-sdk";

@RegisterCommand
export class ScanCommand extends Command {

    CommandName = "mscan";
    Description = "Scan a target IP for open ports (my-hackhub-mod)";

    Autocomplete = [
        { label: "mscan", type: "STRING" as const },
        { label: "<target-ip>", type: "IP" as const },
    ];

    async Run(tools: CommandTools) {
        const args = tools.getArgs();
        const { flags } = tools.parseFlags();

        if (args.length === 0 || flags["help"] || flags["h"]) {
            tools.println("Usage: mscan <target-ip> [--verbose]");
            tools.newLine();
            tools.println("Options:");
            tools.println("  --verbose, -v    Show service versions");
            tools.println("  --help, -h       Show this help message");
            return;
        }

        const targetIp = args[0];
        const verbose = !!flags["verbose"] || !!flags["v"];

        tools.printInfo(`Scanning ${targetIp}...`);
        tools.newLine();

        await tools.sleep(600);

        const subnet = Network.getSubnet(targetIp);

        if (!subnet) {
            tools.printError(`Host ${targetIp} not found or unreachable.`);
            return;
        }

        if (Network.isRequestBlocked(targetIp, 0)) {
            tools.printWarning(`Target ${targetIp} is behind a firewall.`);
        }

        const activePorts = subnet.ports.filter(p => p.active);
        const inactivePorts = subnet.ports.filter(p => !p.active);

        if (activePorts.length === 0) {
            tools.printWarning("No open ports found on target.");
            return;
        }

        if (verbose) {
            tools.printTable(
                ["PORT", "SERVICE", "STATE", "VERSION"],
                activePorts.map(p => [
                    String(p.port),
                    p.service || "unknown",
                    "open",
                    p.version || "-",
                ]),
            );
        } else {
            tools.printTable(
                ["PORT", "SERVICE", "STATE"],
                activePorts.map(p => [
                    String(p.port),
                    p.service || "unknown",
                    "open",
                ]),
            );
        }

        tools.newLine();
        tools.printSuccess(
            `Scan complete: ${activePorts.length} open, ${inactivePorts.length} closed.`,
        );
    }
}
