import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getLegalMoves, pieceLabel } from '../shared/engine';
import type { GameState, Move, MoveRecord, Point, Side } from '../shared/types';

const WIDTH = 620;
const HEIGHT = 680;
const GAP = 64;
function xy(point: Point, flipped: boolean) {
  return { x: 54 + (flipped ? 8 - point.x : point.x) * GAP, y: 52 + (flipped ? 9 - point.y : point.y) * GAP };
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };

function CaptureLiquid({ move, flipped, done }: { move: MoveRecord; flipped: boolean; done: () => void }) {
  const [progress, setProgress] = useState(0);
  const finish = useRef(done);
  finish.current = done;
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / 1120);
      setProgress(t);
      if (t < 1) frame = requestAnimationFrame(animate);
      else finish.current();
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);
  const from = xy(move.from, flipped);
  const to = xy(move.to, flipped);
  const travel = smooth(progress / .67);
  const at = { x: from.x + (to.x - from.x) * travel, y: from.y + (to.y - from.y) * travel };
  const distance = Math.hypot(to.x - at.x, to.y - at.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  const fusion = smooth((progress - .4) / .34);
  const victimRadius = 26 * (1 - fusion);
  const pulse = Math.sin(clamp((progress - .46) / .54) * Math.PI);
  const radius = 26 + pulse * 5;
  const stretch = 1 + Math.sin(clamp(progress / .7) * Math.PI) * .12;
  const neck = clamp((89 - distance) / 60) * (1 - smooth((progress - .64) / .12));
  const ripple = smooth((progress - .59) / .41);
  const red = move.piece.side === 'red';
  const victimRed = move.captured?.side === 'red';
  return <svg className="capture-liquid" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" data-testid="capture-liquid" data-progress={progress.toFixed(3)}>
    <defs>
      <radialGradient id="liquid-red" cx="30%" cy="20%" r="85%"><stop stopColor="#fffefa"/><stop offset=".52" stopColor="#f2dcd8"/><stop offset=".8" stopColor="#d9a29e"/><stop offset="1" stopColor="#bc7778"/></radialGradient>
      <radialGradient id="liquid-black" cx="28%" cy="15%" r="85%"><stop stopColor="#fffefa"/><stop offset=".42" stopColor="#e3e7e5"/><stop offset=".8" stopColor="#aabdc2"/><stop offset="1" stopColor="#708a94"/></radialGradient>
      <linearGradient id="liquid-bridge"><stop stopColor={red ? '#eac5bf' : '#c2d1d4'}/><stop offset="1" stopColor={victimRed ? '#eac5bf' : '#c2d1d4'}/></linearGradient>
      <filter id="fluid-union" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur"/><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop"/></filter>
      <filter id="fluid-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#4d6469" floodOpacity=".22"/></filter>
    </defs>
    <g fill="none" stroke={red ? '#af6261' : '#6c8995'}>
      <circle cx={to.x} cy={to.y} r={29 + ripple * 37} opacity={(1 - ripple) * (ripple > 0 ? .4 : 0)} strokeWidth="1.3"/>
      <circle cx={to.x} cy={to.y} r={27 + ripple * 23} opacity={(1 - ripple) * (ripple > 0 ? .3 : 0)} strokeWidth=".7"/>
    </g>
    <g filter="url(#fluid-shadow)"><g filter="url(#fluid-union)">
      {neck > 0 && <g transform={`translate(${at.x} ${at.y}) rotate(${angle})`}><path d={`M 0 -18 C ${distance * .45} -${neck * 19}, ${distance * .55} -${neck * 19}, ${distance} -${victimRadius * .68} L ${distance} ${victimRadius * .68} C ${distance * .55} ${neck * 19}, ${distance * .45} ${neck * 19}, 0 18 Z`} fill="url(#liquid-bridge)"/></g>}
      <ellipse cx={to.x - (to.x - at.x) * fusion * .36} cy={to.y - (to.y - at.y) * fusion * .36} rx={victimRadius * (1 + fusion * .25)} ry={victimRadius} fill={`url(#liquid-${victimRed ? 'red' : 'black'})`}/>
      <ellipse cx={at.x} cy={at.y} rx={radius * stretch} ry={radius / stretch} transform={`rotate(${angle} ${at.x} ${at.y})`} fill={`url(#liquid-${red ? 'red' : 'black'})`}/>
      {progress > .57 && progress < .92 && [0, 1, 2, 3, 4].map(i => {
        const t = clamp((progress - .57) / .35);
        const a = (i * 1.256) + .4;
        const d = 26 + Math.sin(t * Math.PI) * (12 + i * 2);
        return <circle key={i} cx={to.x + Math.cos(a) * d} cy={to.y + Math.sin(a) * d} r={Math.sin(t * Math.PI) * (3.2 - i * .2)} fill={`url(#liquid-${red ? 'red' : 'black'})`}/>;
      })}
    </g></g>
    <ellipse cx={at.x - 7} cy={at.y - 16} rx={13 + pulse * 3} ry="4" fill="white" opacity=".67" transform={`rotate(-20 ${at.x - 7} ${at.y - 16})`}/>
    <circle cx={at.x} cy={at.y} r={radius - 5} stroke={red ? '#b36660' : '#68828a'} strokeWidth=".8" opacity={1 - pulse * .7} fill="none"/>
    <text x={to.x} y={to.y + 10} textAnchor="middle" className={`fluid-character ${victimRed ? 'red' : 'black'}`} opacity={1 - smooth((progress - .33) / .28)}>{move.captured && pieceLabel(move.captured)}</text>
    <text x={at.x} y={at.y + 10} textAnchor="middle" className={`fluid-character ${red ? 'red' : 'black'}`}>{pieceLabel(move.piece)}</text>
  </svg>;
}

interface BoardProps {
  game: GameState;
  playerSide: Side | null;
  interactive: boolean;
  flipped: boolean;
  showHints: boolean;
  onMove: (move: Move) => void;
  onAnimation: (active: boolean) => void;
}
export default function Board({ game, playerSide, interactive, flipped, showHints, onMove, onAnimation }: BoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [capture, setCapture] = useState<MoveRecord | null>(null);
  const lastHistory = useRef(game.history.length);
  const [focused, setFocused] = useState<Point>({ x: 4, y: 6 });
  const boardRef = useRef<HTMLDivElement>(null);
  const lastMove = game.history.at(-1);
  const legal = useMemo(() => selected && interactive ? getLegalMoves(game, selected) : [], [game, selected, interactive]);

  useLayoutEffect(() => {
    setSelected(null);
    if (game.history.length > lastHistory.current && lastMove?.captured && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCapture(lastMove); onAnimation(true);
    } else if (!game.history.length) { setCapture(null); onAnimation(false); }
    lastHistory.current = game.history.length;
  }, [game, lastMove, onAnimation]);

  useEffect(() => { if (!interactive) setSelected(null); }, [interactive]);

  function select(point: Point) {
    if (!interactive || capture) return;
    const move = legal.find(m => m.to.x === point.x && m.to.y === point.y);
    if (move) { onMove(move); setSelected(null); return; }
    const piece = game.pieces.find(p => p.x === point.x && p.y === point.y);
    if (piece?.side === playerSide && piece.side === game.turn) setSelected(selected === piece.id ? null : piece.id);
    else setSelected(null);
  }
  function keyMove(event: React.KeyboardEvent) {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === 'Escape') { setSelected(null); return; }
    if (!directions[event.key]) return;
    event.preventDefault();
    const [dx, dy] = directions[event.key];
    const p = { x: Math.max(0, Math.min(8, focused.x + dx * (flipped ? -1 : 1))), y: Math.max(0, Math.min(9, focused.y + dy * (flipped ? -1 : 1))) };
    setFocused(p);
    boardRef.current?.querySelector<HTMLButtonElement>(`button[data-x="${p.x}"][data-y="${p.y}"]`)?.focus();
  }

  return <div className={`board-glass ${game.check ? 'in-check' : ''}`} ref={boardRef} onKeyDown={keyMove} role="group" aria-label="中国象棋棋盘，使用方向键移动，回车选择棋子或落点">
    <svg className="board-lines" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <rect x="46" y="44" width="528" height="592" rx="1" className="outer-line"/>
      <g className="grid-lines">
        {Array.from({ length: 10 }, (_, y) => <path key={`h${y}`} d={`M54 ${52 + y * 64} H566`}/>)}
        {[0, 8].map(x => <path key={`edge${x}`} d={`M${54 + x * 64} 52 V628`}/>)}
        {[1, 2, 3, 4, 5, 6, 7].map(x => <path key={`v${x}`} d={`M${54 + x * 64} 52 V308 M${54 + x * 64} 372 V628`}/>)}
        <path d="M246 52 L374 180 M374 52 L246 180 M246 500 L374 628 M374 500 L246 628"/>
      </g>
      <g className="position-marks">{[[1, 2], [7, 2], [1, 7], [7, 7], ...[0, 2, 4, 6, 8].flatMap(x => [[x, 3], [x, 6]])].map(([x, y]) => <g key={`${x}${y}`} transform={`translate(${54 + x * 64} ${52 + y * 64})`}>
        {x > 0 && <path d="M-7 -15 V-7 H-15 M-7 15 V7 H-15"/>}{x < 8 && <path d="M7 -15 V-7 H15 M7 15 V7 H15"/>}
      </g>)}</g>
      <text className="river-label" x="172" y="349" textAnchor="middle">楚 河</text><text className="river-label" x="449" y="349" textAnchor="middle">汉 界</text>
      <path className="river-current" d="M276 339 Q287 333 299 339 T322 339 T345 339 M280 345 Q290 340 301 345 T324 345 T341 345"/>
      {Array.from({ length: 9 }, (_, x) => <g key={x} className="board-coordinate"><text x={54 + x * 64} y="24" textAnchor="middle">{flipped ? '一二三四五六七八九'[x] : x + 1}</text><text x={54 + x * 64} y="661" textAnchor="middle">{flipped ? 9 - x : '九八七六五四三二一'[x]}</text></g>)}
    </svg>
    {lastMove && <><span className="previous-point" style={{ left: `${xy(lastMove.from, flipped).x / WIDTH * 100}%`, top: `${xy(lastMove.from, flipped).y / HEIGHT * 100}%` }}/><span className="last-move-ring" style={{ left: `${xy(lastMove.to, flipped).x / WIDTH * 100}%`, top: `${xy(lastMove.to, flipped).y / HEIGHT * 100}%` }}/></>}
    {Array.from({ length: 90 }, (_, i) => {
      const point = { x: i % 9, y: Math.floor(i / 9) };
      if (game.pieces.some(p => p.x === point.x && p.y === point.y)) return null;
      const pos = xy(point, flipped);
      const isLegal = legal.some(m => m.to.x === point.x && m.to.y === point.y);
      return <button type="button" key={i} className={`intersection ${isLegal && showHints ? 'legal-point' : ''}`} style={{ left: `${pos.x / WIDTH * 100}%`, top: `${pos.y / HEIGHT * 100}%` }} onClick={() => select(point)} data-x={point.x} data-y={point.y} onFocus={() => setFocused(point)} tabIndex={focused.x === point.x && focused.y === point.y ? 0 : -1} aria-label={`${point.x + 1}列${point.y + 1}行${isLegal ? '，可落子' : '，空位'}`}><span/></button>;
    })}
    {game.pieces.map(piece => {
      const pos = xy(piece, flipped);
      const isSelected = selected === piece.id;
      const capturable = legal.some(m => m.to.x === piece.x && m.to.y === piece.y);
      const moving = capture?.piece.id === piece.id;
      return <button type="button" key={piece.id} className={`chess-piece ${piece.side} ${isSelected ? 'selected' : ''} ${capturable && showHints ? 'capturable' : ''} ${piece.kind === 'king' && game.check === piece.side ? 'checked' : ''} ${moving ? 'fusing' : ''}`} data-x={piece.x} data-y={piece.y} data-piece-id={piece.id} data-side={piece.side} data-kind={piece.kind} style={{ left: `${pos.x / WIDTH * 100}%`, top: `${pos.y / HEIGHT * 100}%` }} aria-label={`${piece.side === 'red' ? '红' : '黑'}${pieceLabel(piece)}，${piece.x + 1}列${piece.y + 1}行`} aria-pressed={isSelected} onClick={() => select(piece)} onFocus={() => setFocused(piece)} tabIndex={piece.x === focused.x && piece.y === focused.y ? 0 : -1}>
        <span className="piece-disc"><span className="piece-rim"/><span className="piece-character">{pieceLabel(piece)}</span><span className="piece-glint"/></span>
      </button>;
    })}
    {capture && <CaptureLiquid key={capture.ply} move={capture} flipped={flipped} done={() => { setCapture(null); onAnimation(false); }}/>}
  </div>;
}
