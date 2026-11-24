-- 0.1.0 to the next release: a passage may carry the marker of an instruction its page states about itself, which a
-- search reports as `instructionLike`. Added empty, so every passage loaded before reads as carrying none.
alter table passage add column if not exists instruction_marker text;
