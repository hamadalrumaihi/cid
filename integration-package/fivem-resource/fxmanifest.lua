-- cid-integration-client — SERVER-SIDE FiveM resource skeleton.
--
-- SECURITY MODEL (non-negotiable):
--   * This resource has NO client_scripts on purpose. Client scripts are
--     downloadable by every player; they must NEVER hold the integration
--     secret, the integration-service URL, or any backend credential.
--   * The in-game CID app (NUI) talks to server/main.lua via events; only
--     the server side talks to the CID Integration Service.
--   * Configuration comes from server convars (see server/main.lua), never
--     from files shipped inside this resource.

fx_version 'cerulean'
game 'gta5'

name 'cid-integration-client'
description 'CID Portal integration — server-side relay skeleton (dormant contract; see integration-package/contract/)'
version '0.0.1-skeleton'

server_scripts {
  'server/main.lua',
}

-- Deliberately absent:
--   client_scripts { ... }  -- nothing credential-adjacent may run client-side
--   ui_page / files         -- the NUI app is a separate resource; it holds no secrets
