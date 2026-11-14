import type { TestnetRound, RoundForecaster, RoundPayout } from './record/model.mjs';
export declare function homeRoundView(rounds?: TestnetRound[]): { latest: TestnetRound | null; completed: number; attestedExample: TestnetRound | null; trades: RoundForecaster[]; abstentions: RoundForecaster[]; humans: RoundPayout[] };
