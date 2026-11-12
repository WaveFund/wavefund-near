import type { ReputationBoard, TestnetRound } from './model.mjs';

export type AgentRow = {
  name: string; address: string | null; code: string | null; available: boolean;
  score: string | null; samples: string | null; positive: string | null; negative: string | null; flat: string | null; blockNumber: string | null;
};
export type AttributableRound = { slug: string; roundId: string; allocationBps: number; returnX18: string | null; delta: string | null };
export declare function rankAgents(board: ReputationBoard | null | undefined): AgentRow[];
export declare function attributableRounds(rounds: TestnetRound[] | null | undefined, stackId: 'original' | 'tidepool', agentName: string): AttributableRound[];
