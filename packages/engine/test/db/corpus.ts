/**
 * The golden corpus: the papers of an invented company, in five collections. Every name, figure and date is made up.
 *
 * It is written so each thing a search can do is exercised by something here:
 * - near-duplicates: the two expenses policies differ by a year and a figure;
 * - found by meaning alone: "Using your own car for work" never says "automobile" or "vehicle", which the stand-in
 *   embedder treats as the same word (`stand-ins.ts`);
 * - found by exact words alone: the purchase order PO-4471 and the "Q4" forecast;
 * - dated: every document has a date, from January 2024 to October 2025;
 * - a collection some readers cannot read: `board`, whose only mention of "Heron" is its own;
 * - long documents of several passages: the code of conduct, the failover report, the audit plan and the
 *   architecture notes;
 * - a document revised in place: the remote working policy, two days a week and then three;
 * - reranked away from the fused order: short, dense notes against long, diffuse ones on the same words;
 * - identifiers: titles that open with a key (FIN-2207, and BRD-118, which only the board holds), and a handbook
 *   page that mentions FIN-2207 without being it;
 * - a collection inside a hidden one: `board-shared`, filed under `board` and read by staff, who do not read `board`;
 *
 * `key` is the document's path in its collection: the collection, a slash, its name. A test names a document by it.
 */
export type CorpusDocument = { key: string; title: string; date: string; text: string };

/** A later text for a document already in the corpus: the same key, a new date. */
export type Revision = { key: string; date: string; text: string };

export const COLLECTIONS = [
  "handbook",
  "finance",
  "engineering",
  "board",
  "board-shared",
  "support",
] as const;

/** A collection filed inside another: the child, and the collection it sits in. */
export const NESTED = { "board-shared": "board" } as const;

const handbook: CorpusDocument[] = [
  {
    key: "handbook/annual-leave",
    title: "Annual leave",
    date: "2024-01-15",
    text: "Everyone has twenty-five days of annual leave a year, plus public holidays. Book leave in the people system at least two weeks ahead. Up to five unused days carry over into the next year.",
  },
  {
    key: "handbook/parental-leave",
    title: "Parental leave",
    date: "2024-02-01",
    text: "Parents receive twenty-six weeks of parental leave on full pay, which can be shared between both parents. Tell your manager twelve weeks before the expected date.",
  },
  {
    key: "handbook/expenses-2024",
    title: "Expenses policy 2024",
    date: "2024-03-01",
    text: "Claim expenses within thirty days with a receipt. Meals while travelling are covered up to forty pounds a day. Your manager approves each claim before finance pays it.",
  },
  {
    key: "handbook/expenses-2025",
    title: "Expenses policy 2025",
    date: "2025-03-01",
    text: "Claim expenses within thirty days with a receipt. Meals while travelling are covered up to forty-five pounds a day. Your manager approves each claim before finance pays it.",
  },
  {
    key: "handbook/own-car",
    title: "Using your own car for work",
    date: "2024-05-20",
    text: "If you drive your own car on company business, claim mileage at forty-five pence a mile. Your insurance must cover business use. Parking fines are never refunded.",
  },
  {
    key: "handbook/remote-working",
    title: "Remote working",
    date: "2024-04-02",
    text: "Staff may work from home two days a week. Agree the days with your team so that someone is in the office on each weekday.",
  },
  {
    key: "handbook/code-of-conduct",
    title: "Code of conduct",
    date: "2024-01-08",
    text: [
      "This code describes how we treat one another, our customers and the communities around our offices. It applies to everyone who works with us, including contractors and temporary staff, and it applies in the office, at events, in shared channels and anywhere else you represent the company. Read it when you join and again whenever it changes; your manager will tell you when it does.",
      "Treat colleagues with courtesy. Disagree with ideas, never with people, and do it in a way that leaves room for the other person to change their mind. Harassment of any kind is not tolerated, whether in person, in writing or in jokes made at someone's expense. If you see behaviour that worries you, you may raise it with your manager, with the people team, or anonymously through the confidential line, and nobody who raises a concern in good faith will suffer for it.",
      "Gifts and hospitality from suppliers must be declared when they are worth more than fifty pounds, and cash gifts must always be refused. Conflicts of interest, such as a relative applying for a role in your team or a side business that sells to our customers, must be declared before they affect a decision. When in doubt, declare it: a declared conflict is easy to manage, and an undeclared one is a disciplinary matter.",
      "Protect what customers trust us with. Never take customer records home, never share passwords, and lock your screen when you step away. Report a lost laptop or phone to the service desk within the hour, even out of hours, so that it can be wiped before anyone can read it.",
    ].join("\n\n"),
  },
  {
    key: "handbook/security-basics",
    title: "Security basics",
    date: "2024-06-11",
    text: "Use the password manager for every account and turn on two-step sign-in. Report suspicious email with the report button rather than forwarding it.",
  },
  {
    key: "handbook/onboarding",
    title: "Onboarding checklist",
    date: "2025-01-06",
    text: "In your first week: collect your laptop, set up the password manager, read the code of conduct, book a coffee with your buddy and meet the people team.",
  },
];

const finance: CorpusDocument[] = [
  {
    key: "finance/q3-budget-review",
    title: "Q3 budget review",
    date: "2024-10-04",
    text: "The third quarter closed two percent under budget. Travel spending fell while software licences rose. The budget for the final quarter is unchanged.",
  },
  {
    key: "finance/q4-forecast",
    title: "Forecast for the final quarter",
    date: "2024-11-12",
    text: "Q4 revenue is forecast at one point two million, with the largest risk in delayed renewals from two enterprise customers.",
  },
  {
    key: "finance/po-4471",
    title: "Supplier invoice approval",
    date: "2025-02-17",
    text: "Purchase order PO-4471 covers the replacement desks for the second floor. The supplier invoice matches the order and is approved for payment.",
  },
  {
    key: "finance/payroll-calendar",
    title: "Payroll calendar 2025",
    date: "2025-01-02",
    text: "Salaries are paid on the last working day of each month. Changes must reach payroll by the fifteenth to be included in that month's run.",
  },
  {
    key: "finance/petty-cash",
    title: "Petty cash",
    date: "2024-07-30",
    text: "Each office keeps a small float of petty cash for postage and refreshments. Count it every Friday and record every withdrawal in the petty cash book.",
  },
  {
    key: "finance/audit-plan",
    title: "Year-end audit plan",
    date: "2025-09-15",
    text: [
      "The external auditors arrive on the third of November and stay for three weeks. Before they arrive, every team that holds a budget must reconcile its spending against the ledger and explain any line that differs from the approved budget by more than five percent. Finance will send each budget holder a short template for this in the first week of October.",
      "The auditors will sample purchase orders, supplier invoices and expense claims from across the year. For each sampled item they will ask for the approval trail, the receipt and evidence that the goods or services were received. Keep these together in the shared finance folder so that nobody has to search for them while the auditors wait.",
      "Fixed assets are counted in the second week. The service desk will walk each floor with the asset register and tag any laptop, monitor or desk that is missing a label. Anything found that is not on the register is added at its estimated value and flagged for the auditors.",
      "The audit closes with a meeting between the auditors, the finance director and the chair of the audit committee. Any findings are written up with an owner and a date, and the board reviews them at its next meeting.",
    ].join("\n\n"),
  },
  {
    key: "finance/travel-budget",
    title: "Travel budget guidance",
    date: "2025-05-08",
    text: "Each team's travel budget is set in January. Book trains rather than flights for journeys under four hours, and ask finance before committing more than half of the budget to one trip.",
  },
];

const engineering: CorpusDocument[] = [
  {
    key: "engineering/failover-incident",
    title: "Incident report: database failover",
    date: "2025-06-03",
    text: [
      "At 02:14 on the second of June the primary database stopped accepting writes after its disk filled with write-ahead log. The replica was promoted automatically after ninety seconds, but the application kept its connections to the old primary and returned errors to customers for eleven minutes.",
      "The disk filled because a long-running report held a replication slot open and the log could not be recycled. The slot had been created for a migration in March and never removed. Monitoring alerted on disk usage at ninety percent, but the alert went to a channel that nobody watches at night.",
      "The application did not follow the failover because its connection pool resolved the database address once at start-up. Restarting the application servers at 02:25 restored service. No data was lost: every write that was acknowledged before the failover was present on the promoted replica.",
      "Actions: remove unused replication slots and alert when one is idle for a day; send disk alerts to the on-call phone; make the connection pool resolve the address on every new connection; and rehearse a failover each quarter.",
    ].join("\n\n"),
  },
  {
    key: "engineering/deploy-runbook",
    title: "Deploy runbook",
    date: "2025-04-14",
    text: "Deploys go out from the main branch after the checks pass. Watch the error rate for ten minutes after each deploy, and roll back if it doubles.",
  },
  {
    key: "engineering/on-call",
    title: "On-call rota",
    date: "2025-07-01",
    text: "Two engineers are on call each week, a primary and a secondary. The primary answers a page within fifteen minutes; the secondary takes over if the primary has not acknowledged it in thirty.",
  },
  {
    key: "engineering/architecture-notes",
    title: "Architecture notes",
    date: "2024-09-09",
    text: [
      "The product is a web application in front of one relational database and a queue. Requests are served by stateless application servers behind a load balancer, so any server can be replaced at any time. Background work, such as sending email and building reports, goes through the queue and is done by separate workers.",
      "The database is the only place state lives. Every table has an owner team, and a change to a table's shape goes through a reviewed migration that can run while the old code is still serving. Reports read from a replica so that a slow report never delays a customer's request.",
      "Caches are allowed only where a stale answer is harmless and the cache can be rebuilt from the database. Each cache entry carries the time it was built, and nothing that decides who may see what is ever cached.",
      "Third-party services are called through one client per service, with a timeout, a retry budget and a circuit breaker, so that a slow supplier slows only the feature that needs it.",
    ].join("\n\n"),
  },
  {
    key: "engineering/release-notes",
    title: "Release notes 2.4",
    date: "2025-08-21",
    text: "Version 2.4 adds exports to spreadsheet, a dark theme and faster search. It removes the old reports page, which was replaced in 2.2.",
  },
  {
    key: "engineering/laptop-refresh",
    title: "Laptop refresh",
    date: "2025-03-10",
    text: "Laptops are replaced every four years. Return the old one to the service desk within a week of receiving the new one so that it can be wiped.",
  },
];

const board: CorpusDocument[] = [
  {
    key: "board/minutes-march",
    title: "Board minutes, March",
    date: "2025-03-27",
    text: "The board approved the budget for the coming year and asked for a review of the Heron acquisition by June. The chair noted the strong second half.",
  },
  {
    key: "board/heron-acquisition",
    title: "Project Heron: acquisition proposal",
    date: "2025-04-30",
    text: "Heron is a small analytics company with nineteen staff. The proposal is to acquire it for four million, paid half in cash and half in shares, closing in the autumn.",
  },
  {
    key: "board/executive-pay",
    title: "Executive pay review",
    date: "2025-05-15",
    text: "The remuneration committee recommends a three percent rise for the executive team and no change to the bonus scheme.",
  },
  {
    key: "board/minutes-june",
    title: "Board minutes, June",
    date: "2025-06-26",
    text: "The board reviewed the Heron acquisition and approved the budget to complete due diligence. The audit committee will report in November.",
  },
];

const identifiers: CorpusDocument[] = [
  {
    key: "finance/fin-2207",
    title: "FIN-2207 Supplier contract renewal",
    date: "2025-07-14",
    text: "The cleaning contract renews in September for two more years at the same rate. Legal has reviewed the terms.",
  },
  {
    key: "handbook/procurement",
    title: "Buying things",
    date: "2025-07-21",
    text: "Contracts over ten thousand pounds go through finance; the cleaning renewal, FIN-2207, is an example of one.",
  },
  {
    key: "board/brd-118",
    title: "BRD-118 Heron term sheet",
    date: "2025-05-02",
    text: "The term sheet sets the price, the escrow and the date by which the Heron founders must accept.",
  },
  {
    key: "board-shared/office-move",
    title: "Office move notice",
    date: "2025-08-04",
    text: "The board has agreed that the team moves to the third floor in October; staff will hear the details soon.",
  },
];

const support: CorpusDocument[] = [
  {
    key: "support/customer-faq",
    title: "Customer questions",
    date: "2024-08-19",
    text: "Customers most often ask how to reset a password, how to export their data and how to add a colleague to their account.",
  },
  {
    key: "support/refund-policy",
    title: "Refund policy",
    date: "2024-09-30",
    text: "A customer may ask for a refund within thirty days of paying. Refunds go back to the card that paid, and take up to ten working days to arrive.",
  },
  {
    key: "support/escalation",
    title: "Escalation guide",
    date: "2025-02-03",
    text: "Escalate to engineering when a customer reports lost data or an outage. Everything else stays with support until it has been open for three days.",
  },
  {
    key: "support/known-issues",
    title: "Known issues",
    date: "2025-08-25",
    text: "Exports to spreadsheet can time out for accounts with more than a million rows. Search may miss documents uploaded in the last minute.",
  },
  {
    key: "support/clinic-partner",
    title: "Partner clinic",
    date: "2025-10-01",
    text: "Our healthcare customers include a physician practice in Leeds that books appointments through the product. Treat their tickets as urgent during surgery hours.",
  },
];

export const CORPUS: readonly CorpusDocument[] = [
  ...handbook,
  ...finance,
  ...engineering,
  ...board,
  ...support,
  ...identifiers,
];

export const REVISIONS: readonly Revision[] = [
  {
    key: "handbook/remote-working",
    date: "2025-09-01",
    text: "Staff may work from home three days a week. Agree the days with your team so that someone is in the office on each weekday.",
  },
];

/**
 * Who reads what. The open build's own reader reads everything it loaded; these two read part of it, through the same
 * projection the loader writes.
 */
export const READERS = {
  staff: ["handbook", "engineering", "support", "board-shared"],
  finance: ["handbook", "finance"],
} as const satisfies Record<string, readonly (typeof COLLECTIONS)[number][]>;
