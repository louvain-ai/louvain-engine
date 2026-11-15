import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PLAN_CACHE_MODE,
  DEFAULT_PLAN_CACHE_SCOPE,
  jitPolicy,
  jitSetting,
  mayBePooled,
  planCacheModeSetting,
  planCachePolicy,
  planCacheScopeSetting,
} from "../src/db-settings.js";

/**
 * WHERE `plan_cache_mode` IS APPLIED. A prepared statement switched
 * to a generic plan on its sixth execution per connection and the Search
 * listing went from ~160 ms to ~8.5 s. The fix is a `set local` in every bounded
 * read, and — only when connection scope is asked for — a startup parameter on a
 * direct connection: forced custom plans on every statement slowed the queue's
 * drain proof past its CI budget, and the startup parameter is the one thing a
 * transaction pooler can refuse at connect, which would fail every query. These
 * are the rules that keep it off the queue by default and off a pooled endpoint.
 * `plan-cache-db.test.ts` proves what Postgres does with each.
 */

const DIRECT = "postgres://engine:engine@localhost:5434/engine";
const HOSTED_POOLED = "postgres://u:p@ep-cool-fog-123-pooler.region.db.example.com/engine";

test("LOUVAIN_DB_PLAN_CACHE_MODE: blank is the default, off is off, a typo is the default loudly", () => {
  const warned: string[] = [];
  const warn = (m: string) => warned.push(m);
  assert.equal(planCacheModeSetting(undefined, warn), "force_custom_plan");
  assert.equal(DEFAULT_PLAN_CACHE_MODE, "force_custom_plan");
  assert.equal(
    planCacheModeSetting("", warn),
    "force_custom_plan",
    "compose writes an unset optional as an empty string; that must not switch the fix off",
  );
  assert.equal(planCacheModeSetting("   ", warn), "force_custom_plan");
  assert.equal(warned.length, 0);

  assert.equal(planCacheModeSetting("off", warn), null);
  assert.equal(planCacheModeSetting(" OFF ", warn), null);
  assert.equal(planCacheModeSetting("auto", warn), "auto");
  assert.equal(planCacheModeSetting("force_generic_plan", warn), "force_generic_plan");
  assert.equal(planCacheModeSetting("Force_Custom_Plan", warn), "force_custom_plan");
  assert.equal(warned.length, 0);

  assert.equal(planCacheModeSetting("custom", warn), "force_custom_plan");
  assert.equal(planCacheModeSetting("false", warn), "force_custom_plan");
  assert.equal(warned.length, 2);
  assert.match(warned[0] ?? "", /LOUVAIN_DB_PLAN_CACHE_MODE="custom"/);
});

test("LOUVAIN_DB_PLAN_CACHE_SCOPE: blank is bounded reads, connection is connection, a typo is the default loudly", () => {
  const warned: string[] = [];
  const warn = (m: string) => warned.push(m);
  assert.equal(DEFAULT_PLAN_CACHE_SCOPE, "reads");
  assert.equal(planCacheScopeSetting(undefined, warn), "reads");
  assert.equal(planCacheScopeSetting("", warn), "reads");
  assert.equal(planCacheScopeSetting(" Connection ", warn), "connection");
  assert.equal(planCacheScopeSetting("reads", warn), "reads");
  assert.equal(warned.length, 0);
  assert.equal(planCacheScopeSetting("all", warn), "reads");
  assert.equal(warned.length, 1);
  assert.match(warned[0] ?? "", /LOUVAIN_DB_PLAN_CACHE_SCOPE="all"/);
});

test("the default scope on a direct endpoint: set in every bounded read, NEVER at connect — the queue keeps its plans", () => {
  const policy = planCachePolicy({
    prepare: true,
    mode: "force_custom_plan",
    scope: "reads",
    url: DIRECT,
  });
  assert.equal(policy.startup, null);
  assert.equal(policy.perTransaction, "force_custom_plan");
  assert.match(policy.summary, /bounded reads only/);
  assert.doesNotMatch(policy.summary, /engine:engine|localhost/, "the boot line carries no URL");
});

test("connection scope, prepared statements on, direct endpoint: sent at connect AND set in every bounded read", () => {
  const policy = planCachePolicy({
    prepare: true,
    mode: "force_custom_plan",
    scope: "connection",
    url: DIRECT,
  });
  assert.equal(policy.startup, "force_custom_plan");
  assert.equal(policy.perTransaction, "force_custom_plan");
  assert.match(policy.summary, /on every connection/);
  assert.doesNotMatch(policy.summary, /engine:engine|localhost/, "the boot line carries no URL");
});

test("prepared statements off: nothing is sent and nothing is set — there is no generic plan cache", () => {
  for (const url of [DIRECT, HOSTED_POOLED]) {
    const policy = planCachePolicy({
      prepare: false,
      mode: "force_custom_plan",
      scope: "connection",
      url,
    });
    assert.equal(policy.startup, null);
    assert.equal(policy.perTransaction, null);
    assert.match(policy.summary, /LOUVAIN_DB_PREPARE=false/);
  }
});

test("the setting switched off: nothing is sent and nothing is set", () => {
  const policy = planCachePolicy({ prepare: true, mode: null, scope: "connection", url: DIRECT });
  assert.equal(policy.startup, null);
  assert.equal(policy.perTransaction, null);
  assert.match(policy.summary, /LOUVAIN_DB_PLAN_CACHE_MODE=off/);
});

test("connection scope through a pooler: NEVER a startup parameter, still set per transaction", () => {
  for (const url of [
    HOSTED_POOLED,
    "postgres://u:p@db.abcdefgh.supabase.co:6543/postgres",
    "postgres://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    "postgres://u:p@engine.proxy-abc123.us-east-1.rds.amazonaws.com/engine",
    "postgres://u:p@pgbouncer:5432/engine",
    "postgres://u:p@db.internal:6432/engine",
    "not a url",
  ]) {
    const policy = planCachePolicy({
      prepare: true,
      mode: "force_custom_plan",
      scope: "connection",
      url,
    });
    assert.equal(policy.startup, null, `${url} must not get a startup parameter`);
    assert.equal(policy.perTransaction, "force_custom_plan", url);
    assert.match(policy.summary, /bounded reads only/);
  }
});

test("mayBePooled is broader than the queue's check, and still lets a direct endpoint through", () => {
  assert.equal(mayBePooled(HOSTED_POOLED), true);
  assert.equal(mayBePooled("postgres://u:p@db.internal:6432/engine"), true);
  assert.equal(mayBePooled("postgres://u:p@my-PgBouncer.internal/engine"), true);
  assert.equal(mayBePooled(DIRECT), false);
  assert.equal(mayBePooled("postgres://u:p@ep-cool-fog-123.region.db.example.com/engine"), false);
  assert.equal(mayBePooled("postgres://u:p@postgres:5432/engine"), false);
  assert.equal(
    mayBePooled("postgres://engine@127.0.0.1:5434/engine?options=-csearch_path%3Dx,public"),
    false,
  );
});

test("LOUVAIN_DB_JIT: blank is off, server is server, a typo is off loudly", () => {
  const said: string[] = [];
  assert.equal(jitSetting(undefined), "off");
  assert.equal(jitSetting("  "), "off");
  assert.equal(jitSetting("SERVER"), "server");
  assert.equal(
    jitSetting("on", (m) => said.push(m)),
    "off",
  );
  assert.equal(said.length, 1);
});

test("jit=off goes in the startup packet on a direct endpoint, apart from the plan cache mode; never through a pooler", () => {
  assert.deepEqual(jitPolicy({ setting: "off", url: DIRECT }).startup, true);
  assert.equal(jitPolicy({ setting: "off", url: HOSTED_POOLED }).startup, false);
  assert.equal(jitPolicy({ setting: "server", url: DIRECT }).startup, false);
  // Prepared statements off and the plan cache mode off send nothing of theirs; JIT is decided apart from both.
  assert.equal(
    planCachePolicy({ prepare: false, mode: null, scope: "reads", url: DIRECT }).startup,
    null,
  );
});
