-- CID General "Drive" — documents library constraints (NO seed data).
-- Per product spec the Drive ships empty: folders are presentation config in the
-- client (FOLDER_META) and every file is a user-created `documents` row. The app
-- shows empty-state "Create first document" CTAs and supports CSV/JSON import.
-- (This migration originally seeded 26 demo templates; those were removed so no
-- sample content is baked into source.)

-- One document per (folder, name): lets the client upsert/replace safely.
alter table public.documents
  add constraint documents_folder_name_key unique (folder, name);
