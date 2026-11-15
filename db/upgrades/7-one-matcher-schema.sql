-- THE OPEN DATABASE MATCHES NO TEXT BY AN ANALYZER OF ITS OWN: the keyword index is the one matcher, so the analyzer's
-- column on passages and revisions, the triggers that filled it, their functions, their indexes and the analyzer
-- functions themselves leave; then (Fred) the indexes, checks, columns and functions no open code reads or writes: an
-- application's event-log bookkeeping and outcome values, the version trigger's branch for a kind the engine never writes, the series function,
-- the next embedding space and the context vector. Applied by `./engine reindex` to a database made by an earlier
-- release, in one transaction that rolls back unless the result has exactly this release's schema. Idempotent: every
-- drop names what it drops and passes over what is already gone. No document, passage or revision is deleted.
drop trigger if exists passage_terms_fill on passage;
drop trigger if exists source_revision_terms_fill on source_revision;
drop function if exists passage_terms_fill();
drop function if exists source_revision_terms_fill();
drop index if exists passage_org_terms_idx;
drop index if exists source_revision_org_terms_idx;
alter table passage drop column if exists terms;
alter table source_revision drop column if exists terms;
drop function if exists search_query(text);
drop function if exists search_keys(text);
drop function if exists search_terms(text);
drop function if exists search_delimited(text);
drop function if exists search_fold(text);

-- The open build's schema keeps what the open engine reads and writes: the indexes only a read outside the engine used, the outcome
-- values it never writes and that branch of the version trigger leave; and the series function no open SQL calls,
-- and the next embedding space.
drop index if exists event_log_calendar_uid_idx;
drop index if exists event_log_channel_turns_idx;
drop index if exists event_log_conn_parents_idx;
drop index if exists event_log_connection_container;
drop index if exists event_log_conversation_idx;
drop index if exists event_log_correspondence_idx;
drop index if exists event_log_drained_idx;
drop index if exists event_log_file_latest_idx;
drop index if exists event_log_index_bytes_idx;
drop index if exists event_log_index_lease_idx;
drop index if exists event_log_indexed_drain_idx;
drop index if exists event_log_invite_file_idx;
drop index if exists event_log_membership_sync_idx;
drop index if exists event_log_ocr_candidate_idx;
drop index if exists event_log_outstanding_org_idx;
drop index if exists event_log_record_latest_idx;
drop index if exists event_log_sender_mail_idx;
drop index if exists event_log_unprocessed_idx;
drop index if exists source_revision_meeting_idx;
alter table event_log drop constraint if exists event_log_outcome_check;
alter table event_log add constraint event_log_outcome_check CHECK ((outcome = ANY (ARRAY['pending'::text, 'quarantined'::text])));

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

drop function if exists source_series_key(jsonb);

-- The next embedding space is an application's: its passage vectors, their indexes and the trigger that clears them,
-- and the workspace's record of the space being moved to.
drop trigger if exists passage_next_vectors_follow on passage;
drop function if exists passage_next_vectors_follow();
drop index if exists passage_embedding_t_idx;
drop index if exists passage_embedding_ctx_t_idx;
drop index if exists passage_next_bare_fallback_idx;
drop index if exists passage_next_pending_idx;
alter table passage drop column if exists embedding_t, drop column if exists embedding_ctx_t;
alter table embedding_space drop column if exists next_fingerprint, drop column if exists next_detail,
  drop column if exists next_complete_at;

-- The event log's queue and extraction columns are an application's: the open ingest has no queue, and writes and
-- reads none of them. Their indexes and checks go with them; the index states keep the three the open build uses.
alter table event_log
  drop column if exists processed_at, drop column if exists claim_count, drop column if exists extract_status,
  drop column if exists extraction_hint, drop column if exists index_worker_id, drop column if exists index_lease_until,
  drop column if exists index_next_attempt_at, drop column if exists index_error,
  drop column if exists index_unreachable_since, drop column if exists index_failure_kind,
  drop column if exists index_failure_surface, drop column if exists structured, drop column if exists index_bytes;
alter table event_log drop constraint if exists event_log_index_status_check;
alter table event_log add constraint event_log_index_status_check CHECK ((index_status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text]))) NOT VALID;

-- A passage's context vector is an application's: the open build embeds a passage's own text alone.
drop index if exists passage_bare_fallback_idx;
alter table passage drop column if exists embedding_ctx;
