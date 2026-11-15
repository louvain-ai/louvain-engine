/** The one key a page row is known by: its tier and id. */
export const rowKey = (e: { tier: string; id: string }): string => `${e.tier}:${e.id}`;
