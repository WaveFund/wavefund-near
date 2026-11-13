export type GuideRound = { stack: { id: string }; roundId: string; slug: string };
export type RoleGuide = { id: string; title: string; line: string; steps: Array<{ title: string; line: string; button: string; href: string }> };
export declare function roleGuides(rounds?: GuideRound[]): RoleGuide[];
export declare function guideFor(role: string, rounds?: GuideRound[]): RoleGuide | null;
export declare const ROUND_STEPS: readonly string[];
