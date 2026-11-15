-- THE TABLES THE ENGINE NO LONGER READS: the statement core's tables, the workspace settings no open code reads, and
-- the triggers and functions that served them. Applied by `./engine reindex` to a database made by the release before
-- it, in one transaction that rolls back unless the result has exactly this release's schema. Idempotent: every drop
-- names what it drops and passes over what is already gone. No row of a table the engine keeps is changed.

-- The version trigger marks versions only: their statements are no table of this release.
create or replace function event_log_mark_older_versions() returns trigger
language plpgsql as $function$
declare
  k record;
  c record;
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
  for k in
    select distinct org_id, connection_id, record_key from arrived
    where record_key is not null and connection_id is not null and kind = 'record.change'
  loop
    continue when not exists (
      select 1 from event_log m
      where m.connection_id = k.connection_id and m.record_key = k.record_key and m.kind = 'record.change'
        and m.org_id = k.org_id
        and jsonb_exists_any(m.body -> 'presentation', array['meeting', 'transcript', 'notes', 'whole']));
    -- Each arriving version with a chosen time, in id order, ranks just above what its record holds: every version
    -- already stored, and this statement's arrivals before it.
    for c in
      select a.id, a.container from arrived a
      where a.connection_id = k.connection_id and a.record_key = k.record_key and a.kind = 'record.change'
        and a.org_id = k.org_id and coalesce((a.body -> 'presentation' -> 'calendar') ? 'saidAt', false)
      order by a.id
    loop
      update event_log set version_rank = coalesce((
          select max(coalesce(e.version_rank, e.occurred_at)) + interval '1 microsecond' from event_log e
          where e.connection_id = k.connection_id and e.record_key = k.record_key and e.kind = 'record.change'
            and e.org_id = k.org_id and e.container = c.container and e.id <> c.id
            and (e.id < c.id or not exists (select 1 from arrived x where x.id = e.id))),
        'epoch')
      where id = c.id and version_rank is null;
    end loop;
    select array_agg(v.id) into older from (
      select e.id from event_log e
      where e.connection_id = k.connection_id and e.record_key = k.record_key and e.kind = 'record.change'
        and e.org_id = k.org_id
      order by coalesce(e.version_rank, e.occurred_at) desc, e.id desc
      offset 1) v;
    if older is not null then
      update event_log set has_newer = true where id = any(older) and not has_newer;
    end if;
  end loop;
  return null;
end $function$;

-- A trigger that fires on a column this release does not keep.
drop trigger if exists org_read_mark on org;

-- Foreign keys from the tables this release keeps into the ones it drops.
alter table if exists kg_record_label drop constraint if exists kg_record_label_run_id_fkey;
alter table if exists kg_identifier_source drop constraint if exists kg_identifier_source_identifier_id_fkey;

-- The tables, together, so the keys between them need no order; anything else depending on one stops the upgrade.
drop table if exists audit_log, event_move, memory, kg_derivation, kg_entity, kg_entity_label,
  kg_entity_label_source, kg_identifier, kg_kind_decision, kg_link, kg_link_pair, kg_link_retraction, kg_link_source,
  kg_mention_binding, kg_mention_key, kg_mention_key_fill, kg_read_mark, kg_read_withdrawal, kg_retraction,
  kg_statement, kg_statement_mention, kg_step_reply, kg_step_run, kg_verdict;

drop function if exists kg_arg_mentions(jsonb);
drop function if exists kg_entity_label_refuse_update();
drop function if exists kg_label_name(text);
drop function if exists kg_label_words(text);
drop function if exists kg_link_pair_is_own();
drop function if exists kg_link_refuse_update_but_bookkeeping();
drop function if exists kg_read_mark_bump();
drop function if exists kg_read_note_withdrawal();
drop function if exists kg_refuse_update();
drop function if exists kg_run_in_force(uuid);
drop function if exists kg_run_in_force_at(uuid, timestamp with time zone);
drop function if exists kg_statement_next_vector_follows();
drop function if exists kg_statement_record_has_newer();
drop function if exists kg_statement_refuse_update();
drop function if exists kg_statement_search_fill();

-- The workspace keeps its id, slug, name, creation time and passage-context mode; each other column is a setting no
-- open code reads, and its checks go with it.
alter table org
  drop column if exists sso_default_role,
  drop column if exists sso_enforced,
  drop column if exists templates,
  drop column if exists ontology_version,
  drop column if exists ontology_autopilot,
  drop column if exists steward_events_seen,
  drop column if exists extraction_mode,
  drop column if exists deleting_at,
  drop column if exists web_egress,
  drop column if exists agent_connections_enabled,
  drop column if exists kg_pipelines,
  drop column if exists classifier,
  drop column if exists identity_name_match,
  drop column if exists identity_name_match_at,
  drop column if exists directory_offboarding,
  drop column if exists agent_writes_enabled,
  drop column if exists html_pages,
  drop column if exists source_edits,
  drop column if exists email_names,
  drop column if exists speaker_name_match,
  drop column if exists notification_senders,
  drop column if exists notification_exceptions,
  drop column if exists kind,
  drop column if exists first_ingest_at,
  drop column if exists first_answer_at,
  drop column if exists meeting_followups,
  drop column if exists followup_channel,
  drop column if exists followup_chat_max,
  drop column if exists followup_max_people,
  drop column if exists plate_delegation,
  drop column if exists client_picker,
  drop column if exists brand_space_id,
  drop column if exists company_mirrors,
  drop column if exists unchecked_answers,
  drop column if exists recording_audio_days,
  drop column if exists public_links_enabled,
  drop column if exists strict_checking,
  drop column if exists history_more_requested_at,
  drop column if exists google_sign_in,
  drop column if exists public_link_default_days,
  drop column if exists require_zdr,
  drop column if exists directory_offboarding_connection,
  drop column if exists directory_offboarding_connection_set_at,
  drop column if exists directory_offboarding_bound_only,
  drop column if exists nav_layout;
