# 弈境 implementation contract

React + TypeScript + Vite frontend; Node/Express/ws authoritative room server.
Coordinates: x 0..8 left to right from red view; y 0..9 black to red. Red starts.

Engine exports from shared/engine.ts:
- createGame(rules?: Partial<RuleConfig>): GameState
- getLegalMoves(state: GameState, pieceId?: string): Move[]
- applyMove(state: GameState, move: Move): GameState (immutable, throws on invalid)
- isInCheck(pieces: Piece[], side: Side): boolean
- pieceLabel(piece: Pick<Piece,'kind'|'side'>): string
- opposite(side: Side): Side

AI exports from shared/ai.ts:
- chooseMove(state, personality, budgetMs = 1000): { move: Move | null; depth: number; nodes: number; score: number }
All personalities share search budget; evaluation style only differs.

Room protocol shared/protocol.ts. WS /ws; API /api/health; port 3001.
Create auto-seats creator red; join fills black then spectators. Both ready starts match.
Seat changes allowed only outside active games. Seated disconnect/leave immediately ends active match.
Server validates all commands, turns, and moves. Spectators never mutate a match.
After game players can ready again, stand, or spectators can fill vacant seat.

Visual owner: root. Mist blue-gray, pearl glass, deep ink and cinnabar mica tokens.
Signature: capture stretches two fluid bodies into a connecting neck, consumes target and settles with ripples.
No background imagery required; procedural materials are part of the interactive board.

User-confirmed rules: provide a WXF competition / simplified practice switch; default no-capture limit is 100 plies (50 rounds, WXF 2018 printed page 10). Settings also offer 120 plies or 0 to disable. Default repetition policy is wxf, switch off selects check-loss; friendly remains a protocol-compatible all-threefold-draw policy.

shared/wxf.ts independently classifies checks, chases, protected pieces, exchanges and response-based evasions. Three full cycles prompt the responsible side to vary play; continued repetition loses. Equal responsibility draws after four cycles. GameState.repetitionWarning carries the visible prompt. The initial board is occurrence one, not a completed cycle.

Published fixture data contains 173 legal move sequences and 170 repeatable final-position rulings, with original source attribution and explicit coverage exclusions in docs/RULES.md.
