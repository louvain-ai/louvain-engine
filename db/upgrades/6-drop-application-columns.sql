-- THE COLUMNS NO OPEN CODE READS OR WRITES: an application's queue and extraction bookkeeping on the event log, a
-- document's copy key, a revision's subject key, held time, calendar start and stored app (with the trigger that
-- stamped it, its connector map and its function), and the timestamps nothing open reads. Applied by
-- `./engine reindex` to a database made by an earlier release, in one transaction that rolls back unless the result has
-- exactly this release's schema. Idempotent: every drop names what it drops and passes over what is already gone. No
-- row of a table the engine keeps is changed; each column's indexes and constraints go with it.

-- The triggers that stamped a dropped column, before their columns go.
drop trigger if exists source_revision_app_fill on source_revision;
drop trigger if exists source_revision_calendar_fill on source_revision;

alter table event_log
  drop column if exists received_at,
  drop column if exists extract_attempts,
  drop column if exists next_attempt_at,
  drop column if exists claimed_at,
  drop column if exists episode_id,
  drop column if exists episode_lineage,
  drop column if exists priority,
  drop column if exists lease_until,
  drop column if exists worker_id,
  drop column if exists enqueued_at,
  drop column if exists lease_expiries,
  drop column if exists throttle_deferrals,
  drop column if exists relocated_events,
  drop column if exists relocation_pending,
  drop column if exists withdrawn_events,
  drop column if exists withdrawal_pending,
  drop column if exists index_attempts,
  drop column if exists index_lease_expiries,
  drop column if exists index_enqueued_at,
  drop column if exists index_failed_at,
  drop column if exists index_recovery_count,
  drop column if exists unreachable_since,
  drop column if exists failure_kind,
  drop column if exists failure_surface,
  drop column if exists failed_at,
  drop column if exists recovery_count,
  drop column if exists first_processed_at,
  drop column if exists last_claimed_at;

alter table source_document drop column if exists copy_key;
alter table source_revision
  drop column if exists subject_key,
  drop column if exists held_at,
  drop column if exists calendar_start_at,
  drop column if exists app;
alter table document_embedding drop column if exists written_at;
alter table injection_flag drop column if exists flagged_at;
alter table readable_container drop column if exists updated_at;
alter table org drop column if exists created_at;

drop table if exists source_app_map;

drop function if exists source_revision_app_fill();
drop function if exists source_display_app(text, text, jsonb);
drop function if exists source_revision_calendar_fill();
drop function if exists source_revision_calendar_start(jsonb);
