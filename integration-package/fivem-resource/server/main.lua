--[[
  cid-integration-client / server/main.lua — SERVER-SIDE relay skeleton.

  What this file is: the shape of the city-side relay between the in-game CID
  app (NUI, a separate resource with NO secrets) and the city-hosted CID
  Integration Service (contract/API-CONTRACT.md). Every value below is a
  PLACEHOLDER; nothing here works until the CID lane is activated portal-side.

  CONFIGURATION — server convars only, set in server.cfg (never committed,
  never inside any resource a client can download):

    # server.cfg (example — placeholders, not real values)
    set cid_integration_url    "https://cid-integration.example.invalid"
    set cid_integration_secret "SET_ME"
    set cid_integration_source "fivem-main"

  SECURITY RULES (from the contract — do not relax):
    * The secret and URL live ONLY in server.cfg / the server environment.
    * NEVER TriggerClientEvent with the secret, the URL, or raw envelopes.
    * All requests carry the acting officer's EXTERNAL id — the portal maps
      it to a real portal identity; there is no shared "server" identity for
      casework.
    * Mutations must send a stable externalRequestId (contract/IDEMPOTENCY.md).
]]

local CFG = {
  url    = GetConvar('cid_integration_url', ''),     -- integration SERVICE, never the portal backend
  secret = GetConvar('cid_integration_secret', ''),  -- shared secret; server-side only
  source = GetConvar('cid_integration_source', 'fivem-main'),
}

--- Relay one operation envelope to the integration service.
--- @param officerId string  external officer id of the acting officer
--- @param op string         operation name (contract/API-CONTRACT.md catalog)
--- @param payload table     operation payload
--- @param externalRequestId string|nil  REQUIRED for mutations; stable across retries
--- @param cb fun(status: integer, body: table)
local function callIntegration(officerId, op, payload, externalRequestId, cb)
  if CFG.url == '' or CFG.secret == '' or CFG.secret == 'SET_ME' then
    -- Unconfigured = dormant. Fail closed and loud; never fall back to a
    -- baked-in default host or secret.
    return cb(501, { error = 'not_activated', message = 'cid integration is not configured on this server' })
  end
  PerformHttpRequest(CFG.url, function(status, body)
    local ok, decoded = pcall(json.decode, body or '')
    cb(status, ok and decoded or { error = 'internal', message = 'undecodable response' })
  end, 'POST', json.encode({
    op = op,
    source = CFG.source,
    officerId = officerId,
    externalRequestId = externalRequestId,
    payload = payload,
  }), {
    ['Content-Type'] = 'application/json',
    -- The shared secret authenticates THIS SERVER to the integration
    -- service. It never appears in any client-reachable code path.
    ['X-Integration-Secret'] = CFG.secret,
  })
end

--- Resolve the EXTERNAL officer id for a connected player.
--- PLACEHOLDER: wire to your framework's on-duty officer identity (job check
--- + character id). Return nil for anyone who is not an on-duty CID officer —
--- unmapped officers get `forbidden` portal-side anyway; check here too so
--- the NUI can degrade before a round trip.
local function officerIdFor(src)
  return nil -- SET_ME: e.g. your framework's citizenid for on-duty CID
end

-- One server event per catalog operation the NUI needs. Example:
RegisterNetEvent('cid:case.create', function(requestId, payload)
  local src = source
  local officerId = officerIdFor(src)
  if not officerId then
    return TriggerClientEvent('cid:response', src, requestId, { error = 'forbidden', message = 'not an on-duty CID officer' })
  end
  -- externalRequestId: deterministic per logical action (IDEMPOTENCY.md) —
  -- here the NUI supplies requestId, minted once per user action, reused on retry.
  callIntegration(officerId, 'case.create', payload, requestId, function(_status, body)
    TriggerClientEvent('cid:response', src, requestId, body)
  end)
end)

-- Repeat the pattern for the rest of the catalog (citizens.search,
-- vehicles.search, case.addPerson, report.create, storage.attach,
-- media.attach, legal.create, ...). Keep every handler server-side; the NUI
-- only ever sees operation results, never configuration.
