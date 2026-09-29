import { chooseMove } from '../shared/ai';
import type { GameState, Personality } from '../shared/types';

self.onmessage = (event: MessageEvent<{ state: GameState; personality: Personality }>) => {
  try {
    self.postMessage({ result: chooseMove(event.data.state, event.data.personality, 1100) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '棋友暂时无法落子' });
  }
};
