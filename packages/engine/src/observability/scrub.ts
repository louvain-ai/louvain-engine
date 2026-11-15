/**
 * What of a message may leave the deployment in a log line. A message is where a driver puts the value it choked on,
 * so only its static shape is kept: from the first line, anything quoted, `Key (…)=(…)`, whatever follows the first
 * `: `, URLs past their host, addresses, ids and long digit runs are removed. A heuristic, said as one: the rule stays
 * that indexed text never goes in an error message.
 */

const MAX_MESSAGE = 200;
const ELIDED = "…";

export function scrubMessage(message: string): string {
  let s = (message.split("\n")[0] ?? "").trim();
  // Postgres detail shape, when a driver folds it into the message.
  s = s.replace(/Key \([^)]*\)=\([^)]*\)/g, `Key (${ELIDED})=(${ELIDED})`);
  // Quoted runs, including one left open at the end of a truncated message.
  s = s.replace(/"(?:[^"\\]|\\.)*(?:"|$)/g, `"${ELIDED}"`);
  s = s.replace(/'(?:[^'\\]|\\.)*(?:'|$)/g, `'${ELIDED}'`);
  s = s.replace(/`(?:[^`\\]|\\.)*(?:`|$)/g, `\`${ELIDED}\``);
  // URLs keep scheme and host (which dependency failed); a path or query is where an identifier travels.
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s?#@]*@)?([^/\s?#]+)[^\s]*/gi, `$1$3/${ELIDED}`);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>");
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>");
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, "<hex>");
  s = s.replace(/\d{5,}/g, "<n>");
  // The operand after the first ": ", unless the rules above already reduced all of it to placeholders.
  const colon = s.indexOf(": ");
  if (colon >= 0) {
    const rest = s.slice(colon + 2).trim();
    const reduced = rest.replace(/["'`]…["'`]|<(?:email|uuid|hex|n)>|[\s,;.]/g, "");
    if (reduced !== "") s = `${s.slice(0, colon)}: ${ELIDED}`;
  }
  if (s.length > MAX_MESSAGE) s = `${s.slice(0, MAX_MESSAGE)}${ELIDED}`;
  return s;
}
