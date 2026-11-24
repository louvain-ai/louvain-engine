-- The Louvain Engine's database schema. Generated; do not edit by hand.
-- Load it into an empty database before the first start:
--   psql -v ON_ERROR_STOP=1 -1 -f baseline.sql <database url>

set check_function_bodies = false;
set client_min_messages = warning;

-- Extensions
create extension if not exists vector;

-- Functions
CREATE OR REPLACE FUNCTION event_log_mark_older_versions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  k record;
  older text[];
begin
  for k in
    select distinct org_id, connector, workspace, record_key from arrived
    where record_key is not null and kind in ('message', 'file')
  loop
    select array_agg(v.id) into older from (
      select e.id from event_log e
      where e.record_key = k.record_key and e.kind in ('message', 'file')
        and e.org_id::text = k.org_id::text and e.connector || '' = k.connector
        and e.workspace || '' = k.workspace
      order by coalesce(e.version_rank, e.occurred_at) desc, e.id desc
      offset 1) v;
    if older is not null then
      update event_log set has_newer = true where id = any(older) and not has_newer;
    end if;
  end loop;
  return null;
end $function$;
CREATE OR REPLACE FUNCTION source_revision_org_fill()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.org_id is null then
    new.org_id := (select e.org_id from event_log e where e.id = new.event_id);
  end if;
  return new;
end
$function$;

-- Tables
create table container_parent (
  org_id uuid not null,
  child text not null,
  parent text not null
);
create table embedding_space (
  org_id uuid not null,
  fingerprint text not null,
  detail jsonb not null,
  mixed boolean default false not null,
  recorded_at timestamp with time zone default now() not null,
  changed_at timestamp with time zone default now() not null
);
create table event_log (
  id text not null,
  idempotency_key text not null,
  connector text not null,
  workspace text not null,
  container text not null,
  kind text not null,
  occurred_at timestamp with time zone not null,
  observed_at timestamp with time zone not null,
  actor_id text not null,
  actor_email text,
  body jsonb not null,
  visibility text not null,
  outcome text,
  error text,
  org_id uuid not null,
  connection_id uuid,
  actor_relays boolean default false not null,
  record_key text,
  index_status text default 'done'::text not null,
  indexed_at timestamp with time zone,
  keyword_indexed_at timestamp with time zone,
  actor_display_name text,
  parent_ids text[],
  has_newer boolean default false not null,
  occurred_precision text,
  first_indexed_at timestamp with time zone,
  version_rank timestamp with time zone
);
create table ingest_collection (
  org_id uuid not null,
  collection text not null,
  source text not null,
  origin text not null,
  lists text not null,
  holder text,
  held_until timestamp with time zone
);
create table ingest_retired (
  org_id uuid not null,
  collection text not null,
  item_key text not null,
  revision text not null,
  stated_at timestamp with time zone,
  retired_at timestamp with time zone default now() not null
);
create table injection_flag (
  event_id text not null,
  org_id uuid not null,
  marker text not null
);
create table org (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null
);
create table passage (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  event_id text not null,
  workspace text not null,
  container text not null,
  author text,
  seq integer default 0 not null,
  text text not null,
  embedding vector(768),
  occurred_at timestamp with time zone not null,
  recorded_at timestamp with time zone default now() not null,
  relayed boolean default false not null,
  context text,
  context_key text,
  reading text,
  page integer,
  record_has_newer boolean default false not null,
  vector_dropped_at timestamp with time zone,
  superseded_valid_from timestamp with time zone,
  superseded_known_from timestamp with time zone,
  instruction_marker text
) with (autovacuum_analyze_scale_factor=0.02);
create table readable_container (
  principal_id text not null,
  container text not null,
  org_id uuid not null
);
create table readable_container_empty (
  org_id uuid not null,
  principal_id text not null,
  checked_at timestamp with time zone default now() not null
);
create table source_document (
  id text not null,
  org_id uuid not null,
  connector text not null,
  workspace text not null,
  native_id text not null,
  current_event_id text,
  current_modified_at timestamp with time zone not null,
  origin_key text,
  series_key text,
  revisionless_since timestamp with time zone
);
create table source_revision (
  event_id text not null,
  source_id text not null,
  title text not null,
  kind text not null,
  author text,
  location text,
  url text,
  modified_at timestamp with time zone not null,
  indexed_at timestamp with time zone default now() not null,
  metadata_status text not null,
  content text not null,
  content_hash text not null,
  content_truncated boolean default false not null,
  presentation jsonb,
  org_id uuid,
  container text
);

-- Constraints
alter table container_parent add constraint container_parent_child_check CHECK ((char_length(child) <= 512));
alter table container_parent add constraint container_parent_parent_check CHECK ((char_length(parent) <= 512));
alter table container_parent add constraint container_parent_pkey PRIMARY KEY (org_id, child);
alter table embedding_space add constraint embedding_space_pkey PRIMARY KEY (org_id);
alter table event_log add constraint event_log_index_status_check CHECK ((index_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text]))) NOT VALID;
alter table event_log add constraint event_log_occurred_precision_check CHECK (((occurred_precision IS NULL) OR (occurred_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text]))));
alter table event_log add constraint event_log_outcome_check CHECK ((outcome = ANY (ARRAY['pending'::text, 'quarantined'::text])));
alter table event_log add constraint event_log_pkey PRIMARY KEY (id);
alter table ingest_collection add constraint ingest_collection_lists_check CHECK ((lists = ANY (ARRAY['all'::text, 'some'::text])));
alter table ingest_collection add constraint ingest_collection_pkey PRIMARY KEY (org_id, collection);
alter table ingest_retired add constraint ingest_retired_pkey PRIMARY KEY (org_id, collection, item_key, revision);
alter table injection_flag add constraint injection_flag_pkey PRIMARY KEY (event_id);
alter table org add constraint org_pkey PRIMARY KEY (id);
alter table org add constraint org_slug_key UNIQUE (slug);
alter table passage add constraint passage_pkey PRIMARY KEY (id);
alter table readable_container add constraint readable_container_pkey PRIMARY KEY (org_id, principal_id, container);
alter table readable_container_empty add constraint readable_container_empty_pkey PRIMARY KEY (org_id, principal_id);
alter table source_document add constraint source_document_org_id_connector_workspace_native_id_key UNIQUE (org_id, connector, workspace, native_id);
alter table source_document add constraint source_document_pkey PRIMARY KEY (id);
alter table source_revision add constraint source_revision_metadata_status_check CHECK ((metadata_status = ANY (ARRAY['native'::text, 'legacy'::text])));
alter table source_revision add constraint source_revision_pkey PRIMARY KEY (event_id);

-- Foreign keys
alter table container_parent add constraint container_parent_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table embedding_space add constraint embedding_space_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table event_log add constraint event_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table ingest_collection add constraint ingest_collection_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table ingest_retired add constraint ingest_retired_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table injection_flag add constraint injection_flag_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_log(id) ON DELETE CASCADE;
alter table injection_flag add constraint injection_flag_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table passage add constraint passage_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_log(id) ON DELETE CASCADE;
alter table passage add constraint passage_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table readable_container add constraint readable_container_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table readable_container_empty add constraint readable_container_empty_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table source_document add constraint source_document_current_event_id_fkey FOREIGN KEY (current_event_id) REFERENCES event_log(id) ON DELETE SET NULL;
alter table source_document add constraint source_document_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE;
alter table source_revision add constraint source_revision_event_id_fkey FOREIGN KEY (event_id) REFERENCES event_log(id) ON DELETE CASCADE;
alter table source_revision add constraint source_revision_source_id_fkey FOREIGN KEY (source_id) REFERENCES source_document(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX container_parent_by_parent ON container_parent USING btree (org_id, parent);
CREATE INDEX event_log_actor_email_idx ON event_log USING btree (org_id, container, lower(actor_email), occurred_at DESC) WHERE (kind = 'message'::text);
CREATE INDEX event_log_actor_recent_idx ON event_log USING btree (org_id, lower(actor_id), occurred_at DESC) WHERE (kind = 'message'::text);
CREATE UNIQUE INDEX event_log_feed_idempotency_idx ON event_log USING btree (org_id, connector, workspace, idempotency_key);
CREATE INDEX event_log_org_container_idx ON event_log USING btree (org_id, container);
CREATE INDEX event_log_org_occurred_idx ON event_log USING btree (org_id, occurred_at DESC, id DESC);
CREATE INDEX event_log_record_key_idx ON event_log USING btree (org_id, connector, workspace, record_key) WHERE (record_key IS NOT NULL);
CREATE INDEX event_log_record_versions_idx ON event_log USING btree (record_key) WHERE ((record_key IS NOT NULL) AND (kind = ANY (ARRAY['message'::text, 'file'::text])));
CREATE INDEX passage_container_order_idx ON passage USING btree (org_id, container, occurred_at, event_id) WHERE (seq = 0);
CREATE INDEX passage_embedding_idx ON passage USING hnsw (embedding vector_cosine_ops);
CREATE UNIQUE INDEX passage_event_seq_idx ON passage USING btree (event_id, seq);
CREATE INDEX passage_occurred_idx ON passage USING btree (org_id, occurred_at DESC);
CREATE INDEX passage_org_container_idx ON passage USING btree (org_id, container);
CREATE INDEX passage_relayed_idx ON passage USING btree (org_id, container) WHERE relayed;
CREATE INDEX passage_vector_dropped_idx ON passage USING btree (org_id, superseded_valid_from) WHERE (vector_dropped_at IS NOT NULL);
CREATE INDEX passage_vector_recheck_idx ON passage USING btree (org_id) WHERE ((vector_dropped_at IS NOT NULL) AND (superseded_valid_from = 'infinity'::timestamp with time zone));
CREATE INDEX readable_container_org_container_idx ON readable_container USING btree (org_id, container);
CREATE INDEX source_document_connector_recent_idx ON source_document USING btree (org_id, connector, current_modified_at DESC, id DESC);
CREATE INDEX source_document_current_event_idx ON source_document USING btree (current_event_id);
CREATE INDEX source_document_native_prefix_idx ON source_document USING btree (org_id, connector, workspace, native_id COLLATE "C");
CREATE INDEX source_document_org_idx ON source_document USING btree (org_id, connector);
CREATE INDEX source_document_org_modified_idx ON source_document USING btree (org_id, current_modified_at DESC, id);
CREATE INDEX source_document_origin_idx ON source_document USING btree (org_id, origin_key) WHERE (origin_key IS NOT NULL);
CREATE INDEX source_document_revisionless_idx ON source_document USING btree (revisionless_since) WHERE (revisionless_since IS NOT NULL);
CREATE INDEX source_document_series_idx ON source_document USING btree (org_id, series_key, current_modified_at, id) WHERE (series_key IS NOT NULL);
CREATE INDEX source_revision_item_idx ON source_revision USING btree (source_id);
CREATE INDEX source_revision_org_indexed_idx ON source_revision USING btree (org_id, indexed_at, event_id);
CREATE INDEX source_revision_org_title_key_idx ON source_revision USING btree (org_id, lower("left"(title, 200)));
CREATE INDEX source_revision_org_url_key_idx ON source_revision USING btree (org_id, md5(url)) WHERE (url IS NOT NULL);

-- Triggers
CREATE TRIGGER event_log_mark_older_versions AFTER INSERT ON event_log REFERENCING NEW TABLE AS arrived FOR EACH STATEMENT EXECUTE FUNCTION event_log_mark_older_versions();
CREATE TRIGGER source_revision_org_fill BEFORE INSERT ON source_revision FOR EACH ROW EXECUTE FUNCTION source_revision_org_fill();

-- The one workspace the open engine reads and writes as.
insert into org (slug, name) values ('default', 'default') on conflict (slug) do nothing;
