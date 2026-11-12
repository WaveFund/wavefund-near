// Type declarations for fixtures.mjs. FIXTURE DATA ONLY.
export type FixtureScenario = { id: string; group: 'Progress' | 'Outcomes' | 'Problems'; label: string; description: string; record: unknown };
export declare const FIXTURE_LABEL: string;
export declare function fixtureConfig(now: number): unknown;
export declare function fixturePreview(config: { routes: Array<{ routeId: string | null }>; destination: { safe: string }; refundRecipient: string }, routeId: string, amountIn: string, now: number): unknown;
export declare function fixtureScenarios(now: number): FixtureScenario[];
