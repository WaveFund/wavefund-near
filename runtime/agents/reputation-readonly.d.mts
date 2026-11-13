export function createReputationReader(options: { client: unknown; manifest: unknown; clock?: () => number; maxAgeSeconds?: number }): { read(agent: string): Promise<unknown> };
