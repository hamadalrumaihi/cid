// packet.render — case packet PDF (pdf-lib renderer shared with the runner).
// Stirling is deliberately NOT used here: the packet is an evidentiary
// document whose bytes are hashed into export_manifests, so both tiers must
// produce it the same way. Stirling only serves the ad-hoc pdf.tool jobs.
import { packetRender, type KindHandler } from '../jobCore.ts';

export const kind = 'packet.render';
export const queue = 'pdf';
export const handler: KindHandler = packetRender;
