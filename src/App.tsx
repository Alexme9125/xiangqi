import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ArrowRight, BookOpen, Check, CircleHelp, Copy, Eye, Flag, Handshake, LogOut, RotateCcw, Settings2, Shield, Sparkles, Users, Volume2, VolumeX, Waves, X, Zap } from 'lucide-react';
import Board from './Board';
import { applyMove, createGame, opposite, pieceLabel } from '../shared/engine';
import { DEFAULT_RULES, type GameState, type Move, type Personality, type RuleConfig, type Side } from '../shared/types';
import { useRoom } from './useRoom';
import { playMoveSound } from './sound';

const personalities = [
  { id: 'cautious' as const, name: '谨慎', title: '守中有谋', description: '稳固阵形，重视子力与防守。', icon: Shield, character: '静' },
  { id: 'balanced' as const, name: '平衡', title: '进退有度', description: '兼顾攻守，随局势从容应变。', icon: Waves, character: '衡' },
  { id: 'aggressive' as const, name: '激进', title: '以攻为守', description: '主动争先，寻找将军与攻势。', icon: Zap, character: '锐' },
];
type Modal = 'rules' | 'settings' | null;
type Confirmation = { title: string; description: string; action: () => void; label: string };

function timeLabel(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }
function resultTitle(game: GameState) { return game.winner === 'draw' ? '和棋，意犹未尽' : `${game.winner === 'red' ? '红方' : '黑方'}获胜`; }
function reasonLabel(reason: string | null, noCaptureLimit = DEFAULT_RULES.noCaptureLimit) {
  const labels: Record<string, string> = { checkmate: '将死，对方无法应将', stalemate: '困毙，对方无合法着法', repetition: '循环局面，依本局规则判和', 'perpetual-check': '连续长将未变着，判长将方负', 'perpetual-chase': '连续长捉未变着，判长捉方负', 'no-capture': `连续 ${noCaptureLimit / 2} 回合未吃子，双方和棋` };
  return reason ? labels[reason] ?? reason : '';
}
function ruleLabel(config: RuleConfig) {
  return `${config.repetition === 'wxf' ? '比赛棋例' : config.repetition === 'check-loss' ? '简化练习' : '友好练习'} · ${config.noCaptureLimit ? `${config.noCaptureLimit / 2} 回合无吃子判和` : '不限无吃子回合'}`;
}
function ModalShell({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const elements = [...(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className="modal-scrim" onClick={event => { if (event.target === event.currentTarget) close(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={container}><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><X size={19}/></button></div>{children}</div></div>;
}

function PlayerBar({ side, name, subtitle, active, thinking, captured, seconds, isYou }: { side: Side; name: string; subtitle: string; active: boolean; thinking?: boolean; captured: string[]; seconds?: number; isYou?: boolean }) {
  return <div className={`player-bar ${active ? 'active' : ''}`}>
    <div className={`player-avatar ${side}`}><span>{side === 'red' ? '帥' : '將'}</span>{active && <i/>}</div>
    <div className="player-info"><div className="player-name">{name}{isYou && <span className="you-badge">你</span>}</div><div className="player-subtitle">{thinking ? <span className="thinking-label">正在思考<span>···</span></span> : subtitle}</div></div>
    <div className="player-end">{captured.length > 0 && <div className="captured-pieces" aria-label={`已吃 ${captured.length} 子`}>{captured.slice(-7).map((p, i) => <span key={i} className={side === 'red' ? 'black' : 'red'}>{p}</span>)}{captured.length > 7 && <small>+{captured.length - 7}</small>}</div>}{seconds !== undefined && <span className="player-time">{timeLabel(seconds)}</span>}</div>
  </div>;
}

export default function App() {
  const [mode, setMode] = useState<'pve' | 'pvp'>('pve');
  const [personality, setPersonality] = useState<Personality>('balanced');
  const [humanSide, setHumanSide] = useState<Side>('red');
  const [localGame, setLocalGame] = useState<GameState>(() => createGame());
  const [started, setStarted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [flip, setFlip] = useState(false);
  const [hints, setHints] = useState(true);
  const [sound, setSound] = useState(true);
  const [rules, setRules] = useState<RuleConfig>(DEFAULT_RULES);
  const [modal, setModal] = useState<Modal>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [toast, setToast] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('yijing-name') || '闲云'; } catch { return '闲云'; } });
  const [code, setCode] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [aiError, setAiError] = useState(false);
  const [aiRetry, setAiRetry] = useState(0);
  const [moveTab, setMoveTab] = useState<'moves' | 'about'>('moves');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyEnd = useRef<HTMLDivElement>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);
  const roomApi = useRoom(notify);
  const { room, playerId, connection, send } = roomApi;
  const me = room?.members.find(p => p.id === playerId);
  const game = mode === 'pvp' ? room?.game ?? localGame : localGame;
  const active = mode === 'pve' ? started && game.status === 'playing' : !!room?.game && game.status === 'playing';
  const mySide = mode === 'pve' ? humanSide : me?.seat ?? null;
  const canMove = active && game.turn === mySide && !thinking && !animating;
  const flipped = (mySide === 'black') !== flip;
  const persona = personalities.find(p => p.id === personality)!;
  const bottomSide = flipped ? 'black' : 'red';
  const topSide = opposite(bottomSide);
  const finished = mode === 'pve' ? started && game.status === 'finished' : !!room?.game && game.status === 'finished';
  const closeModal = useCallback(() => setModal(null), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const localTurn = game.turn === humanSide;
  const round = Math.floor(game.history.length / 2) + 1;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed(v => v + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => { if (game.history.length === 0) setElapsed(0); }, [game]);
  useEffect(() => { const list = historyEnd.current?.parentElement; if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); }, [game.history.length, moveTab]);
  useEffect(() => { if (active && window.innerWidth <= 760) document.querySelector('.board-column')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [active]);
  useEffect(() => {
    if (mode !== 'pve' || !started || localGame.status !== 'playing' || localGame.turn === humanSide || animating) return;
    setThinking(true); setAiError(false);
    const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    let cancelled = false;
    const fail = () => { if (!cancelled) { setThinking(false); setAiError(true); notify('棋友思考被中断，可以重试或悔棋。'); } };
    worker.onmessage = event => {
      if (cancelled) return;
      if (event.data.error || !event.data.result?.move) { fail(); return; }
      try {
        const next = applyMove(localGame, event.data.result.move);
        setLocalGame(next);
        if (sound) playMoveSound(!!next.history.at(-1)?.captured);
        setThinking(false);
      } catch { fail(); }
    };
    worker.onerror = fail;
    const wait = setTimeout(() => worker.postMessage({ state: localGame, personality }), 340);
    return () => { cancelled = true; clearTimeout(wait); worker.terminate(); setThinking(false); };
  }, [mode, started, localGame, humanSide, personality, animating, sound, notify, aiRetry]);

  const previousRoomPly = useRef(0);
  useEffect(() => {
    if (mode === 'pvp' && room?.game) {
      if (room.game.history.length > previousRoomPly.current && sound) playMoveSound(!!room.game.history.at(-1)?.captured);
      previousRoomPly.current = room.game.history.length;
    }
  }, [mode, room, sound]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (mode === 'pvp' && active && mySide) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [mode, active, mySide]);

  function makeMove(move: Move) {
    if (!canMove) return;
    if (mode === 'pvp') { send({ type: 'move', move }); return; }
    try { const next = applyMove(localGame, move); setLocalGame(next); if (sound) playMoveSound(!!next.history.at(-1)?.captured); }
    catch (error) { notify(error instanceof Error ? error.message : '此处不能落子'); }
  }
  function startGame() { setLocalGame(createGame(rules)); setStarted(true); setElapsed(0); setAiError(false); setAnimating(false); }
  function changeMode(next: 'pve' | 'pvp') {
    if (mode === next) return;
    const action = () => { if (room) send({ type: 'leave' }); setMode(next); setStarted(false); setLocalGame(createGame(rules)); setAnimating(false); setFlip(false); };
    if (active && (mode === 'pve' || mySide)) setConfirm({ title: '结束当前对弈？', description: mode === 'pvp' ? '切换模式会退出房间，对手将获胜。' : '当前棋局将结束，你可以在新模式中开始对弈。', action, label: '结束并切换' });
    else action();
  }
  function undo() {
    const count = localGame.history.length;
    if (!count) return;
    const remove = game.turn === humanSide ? 2 : 1;
    const remaining = Math.max(0, count - remove);
    let next = createGame(localGame.rules);
    for (const move of localGame.history.slice(0, remaining)) next = applyMove(next, move);
    setLocalGame(next); setAnimating(false); setAiError(false); notify('已回到上一次落子前');
  }
  function resign() {
    setConfirm({ title: '认输并结束本局？', description: '棋局与走子记录会保留在页面中，随时可以再来一局。', label: '确认认输', action: () => {
      if (mode === 'pvp') send({ type: 'resign' });
      else setLocalGame(g => ({ ...g, status: 'finished', winner: opposite(humanSide), reason: '主动认输' }));
    } });
  }
  function leaveRoom() {
    const action = () => { send({ type: 'leave' }); setLocalGame(createGame(rules)); setAnimating(false); };
    if (active && mySide) setConfirm({ title: '离开房间？', description: '对弈中离开会立即结束本局，并判对手获胜。', label: '结束并离开', action });
    else action();
  }
  function prepareName() { const nickname = name.trim() || '棋友'; setName(nickname); try { localStorage.setItem('yijing-name', nickname); } catch { /* Storage optional. */ } return nickname; }
  function playerInfo(side: Side) {
    if (mode === 'pvp') {
      const player = room?.seats[side];
      return { name: player?.name ?? '等待棋友入座', subtitle: player ? `${side === 'red' ? '红方' : '黑方'} · ${active ? (game.turn === side ? '落子中' : '等待落子') : player.ready ? '已准备' : '未准备'}` : `${side === 'red' ? '红方' : '黑方'}空座`, isYou: player?.id === playerId };
    }
    return side === humanSide ? { name: '你', subtitle: `${side === 'red' ? '执红 · 先行' : '执黑 · 后行'}${active ? ' · 自在落子' : ''}`, isYou: false } : { name: `弈境棋友 · ${persona.name}`, subtitle: `${side === 'red' ? '执红' : '执黑'} · ${persona.title}`, isYou: false };
  }
  const captures = (side: Side) => game.history.filter(m => m.piece.side === side && m.captured).map(m => pieceLabel(m.captured!));

  return <div className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="app-header">
      <a className="brand" href="/" aria-label="弈境首页" onClick={event => { event.preventDefault(); changeMode('pve'); }}><span className="brand-mark"><span>弈</span><i/></span><span className="brand-type">弈境<small>LIQUID XIANGQI</small></span></a>
      <nav className="mode-switch" aria-label="对弈模式"><button className={mode === 'pve' ? 'active' : ''} onClick={() => changeMode('pve')}><Sparkles size={15}/>人机练棋</button><button className={mode === 'pvp' ? 'active' : ''} onClick={() => changeMode('pvp')}><Users size={16}/>好友对弈</button></nav>
      <div className="header-actions"><button className="icon-button sound-toggle" title={sound ? '关闭声音' : '开启声音'} aria-label={sound ? '关闭声音' : '开启声音'} onClick={() => setSound(!sound)}>{sound ? <Volume2 size={19}/> : <VolumeX size={19}/>}</button><button className="icon-button" title="象棋规则" aria-label="象棋规则" onClick={() => setModal('rules')}><BookOpen size={19}/></button><span className="header-divider"/><button className="icon-button" title="对弈设置" aria-label="对弈设置" onClick={() => setModal('settings')}><Settings2 size={19}/></button></div>
    </header>

    <main className={`workspace ${mode === 'pvp' && !room ? 'pvp-lobby' : ''}`}>
      <section className="board-column" aria-label="对弈区">
        <div className="board-heading"><div className="session-title"><span className={`live-dot ${active ? 'playing' : ''}`}/><span>{mode === 'pve' ? '人机对弈' : room ? `房间 ${room.code}` : '好友对弈'}</span><small>{mode === 'pve' ? '静心落子，从容入局' : room && !mySide ? '你正在旁观' : '以棋会友，隔空相逢'}</small></div><span className="round-label">{active || finished ? `第 ${round} 回合` : '新的一局'}</span></div>
        {mode === 'pve' && !active && <div className="mobile-start-bar"><button onClick={() => document.querySelector('.setup-panel')?.scrollIntoView({ behavior: 'smooth' })}>{persona.name}棋友 · 执{humanSide === 'red' ? '红' : '黑'}<Settings2 size={13}/></button><button onClick={startGame}>{finished ? '再练一局' : '开始练棋'}<ArrowRight size={14}/></button></div>}
        <PlayerBar side={topSide} {...playerInfo(topSide)} active={active && game.turn === topSide} thinking={mode === 'pve' && thinking && topSide !== humanSide} captured={captures(topSide)}/>
        <div className="board-wrap"><Board key={`${mode}-${room?.code ?? 'local'}`} game={game} playerSide={mySide} interactive={canMove} flipped={flipped} showHints={hints} onMove={makeMove} onAnimation={setAnimating}/>
          {game.check && active && <span className="check-announcement" role="status">将军 · 请应将</span>}
        </div>
        <PlayerBar side={bottomSide} {...playerInfo(bottomSide)} active={active && game.turn === bottomSide} thinking={mode === 'pve' && thinking && bottomSide !== humanSide} captured={captures(bottomSide)} seconds={active || finished ? elapsed : undefined}/>
        {active && game.repetitionWarning && <div className="repetition-notice" role="status"><Shield size={15}/><span>{game.repetitionWarning.side === 'red' ? '红方' : '黑方'}连续{game.repetitionWarning.kind === 'check' ? '长将' : '长捉'}，请变着。继续同样循环将判负。</span></div>}
        <div className="board-footer"><span><span className="tiny-dot"/>{finished ? reasonLabel(game.reason, game.rules.noCaptureLimit) : active ? (mySide ? canMove ? '轮到你了，选择一枚棋子' : thinking ? '棋友正在思考' : '等待对方落子' : '旁观中 · 静观棋局') : '红方先行 · 点击棋子，再点击落点'}</span><div><button className="text-icon" onClick={() => setFlip(!flip)} aria-label="翻转棋盘" title="翻转棋盘"><ArrowDownUp size={14}/><span>翻转</span></button><button className={`text-icon ${hints ? 'enabled' : ''}`} onClick={() => setHints(!hints)} aria-label={hints ? '隐藏落点提示' : '显示落点提示'} title={hints ? '隐藏落点提示' : '显示落点提示'}><Eye size={15}/><span>提示</span></button></div></div>
      </section>

      <aside className="side-panel">
        {mode === 'pve' ? <section className="setup-panel glass-panel">
          <div className="panel-eyebrow"><span>YOUR NEXT MOVE</span><span className="small-star">✧</span></div>
          <h1>遇见你的棋友<span>一盘棋，三种性情。</span></h1>
          <div className="field-heading"><span>选择棋友人格</span><span>不分难度，只分棋风</span></div>
          <div className="personality-options">{personalities.map(p => <button key={p.id} className={`personality-option ${personality === p.id ? 'selected' : ''}`} onClick={() => setPersonality(p.id)} disabled={active} aria-pressed={personality === p.id}><span className={`personality-symbol ${p.id}`}><p.icon size={20} strokeWidth={1.5}/></span><span className="personality-copy"><strong>{p.name}<small>{p.title}</small></strong><span>{p.description}</span></span><span className="radio-indicator">{personality === p.id && <span/>}</span></button>)}</div>
          <div className="side-selection"><span>我的执子</span><div className="color-segments"><button className={humanSide === 'red' ? 'selected' : ''} disabled={active} onClick={() => { setHumanSide('red'); setFlip(false); }}><i className="red-dot"/>红方<small>先行</small></button><button className={humanSide === 'black' ? 'selected' : ''} disabled={active} onClick={() => { setHumanSide('black'); setFlip(false); }}><i className="black-dot"/>黑方<small>后行</small></button></div></div>
          <button className="rules-summary" onClick={() => setModal('settings')}><Shield size={12}/><span>{ruleLabel(active || finished ? game.rules : rules)}</span><Settings2 size={12}/></button>
          {!active && <button className="primary-button" onClick={startGame}>{finished ? '再来一局' : '开始对弈'}<ArrowRight size={17}/></button>}
          {active && <div className="active-controls"><button onClick={undo} disabled={!game.history.length || animating}><RotateCcw size={16}/>悔棋</button><button onClick={resign}><Flag size={16}/>认输</button></div>}
          {aiError && <button className="retry-button" onClick={() => setAiRetry(v => v + 1)}>重新请棋友落子</button>}
          <p className="setup-footnote"><span className="tiny-dot"/>{active ? (localTurn ? '不计时限，按自己的节奏思考' : '棋友正在观察棋局') : '不设难度，让每一局都成为练习'}</p>
        </section> : <section className="setup-panel room-panel glass-panel">
          <div className="panel-eyebrow"><span>ACROSS THE BOARD</span><Users size={16}/></div>
          <h1>{room ? '棋逢知己' : '邀一位棋友'}<span>{room ? '方寸之间，共享一局。' : '相隔千里，也能手谈。'}</span></h1>
          {!room ? <><label className="input-label" htmlFor="nickname">你的称呼</label><input id="nickname" value={name} maxLength={16} onChange={e => setName(e.target.value)} placeholder="输入你的称呼" autoComplete="nickname"/><button className="primary-button" disabled={connection === 'connecting'} onClick={() => send({ type: 'create', name: prepareName(), rules })}>{connection === 'connecting' ? '正在连接…' : '创建房间'}<ArrowRight size={17}/></button><div className="or-divider"><span/>或加入棋友的房间<span/></div><form onSubmit={e => { e.preventDefault(); if (code.trim()) send({ type: 'join', code: code.trim().toUpperCase(), name: prepareName() }); }}><label className="input-label" htmlFor="room-code">房间码</label><div className="join-field"><input id="room-code" value={code} maxLength={6} onChange={e => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} placeholder="6 位房间码" autoComplete="off"/><button type="submit" aria-label="加入房间" disabled={code.length !== 6 || connection === 'connecting'}><ArrowRight size={18}/></button></div></form><p className="room-explanation"><Eye size={16}/>座位已满时自动旁观，有空座即可入座。</p></> : <>
            <div className="room-code-card"><div><span>分享房间码</span><strong>{room.code}</strong></div><button className="icon-button" aria-label="复制房间码" onClick={async () => { try { await navigator.clipboard.writeText(room.code); notify('房间码已复制，发给棋友即可加入'); } catch { notify(`房间码：${room.code}`); } }}><Copy size={18}/></button></div>
            <div className="rules-summary room-rules"><Shield size={12}/><span>{ruleLabel(room.rules)}</span></div>
            <div className="room-seats">{(['red', 'black'] as const).map(side => <div className={`room-seat ${side}`} key={side}><span className={`seat-stone ${side}`}>{side === 'red' ? '帥' : '將'}</span><div><strong>{room.seats[side]?.name ?? '空座以待'}{room.seats[side]?.id === playerId && <small>你</small>}</strong><span>{room.seats[side] ? active ? `${side === 'red' ? '红' : '黑'}方 · 对弈中` : room.seats[side]?.ready ? '已准备' : '等待准备' : `${side === 'red' ? '红' : '黑'}方空座`}</span></div>{!room.seats[side] && !active && !mySide && <button className="seat-button" onClick={() => send({ type: 'sit', side })}>入座</button>}{room.seats[side]?.ready && !active && <Check size={16}/>}</div>)}</div>
            <div className="spectator-count"><Eye size={14}/>{room.members.filter(p => !p.seat).length} 位旁观{!mySide && <span>你在旁观席</span>}</div>
            {mySide && !active && <><button className="primary-button" onClick={() => send({ type: 'ready', ready: !me?.ready })}>{me?.ready ? '取消准备' : '准备对弈'}{me?.ready ? <Check size={17}/> : <ArrowRight size={17}/>}</button><button className="subtle-button" onClick={() => send({ type: 'stand' })}>站起，转为旁观</button></>}
            {active && mySide && <div className="active-controls"><button disabled={!!room.drawOffer} onClick={() => send({ type: 'drawOffer' })}><Handshake size={16}/>{room.drawOffer === mySide ? '等待回应' : '求和'}</button><button onClick={resign}><Flag size={16}/>认输</button></div>}
            {room.drawOffer && room.drawOffer !== mySide && mySide && <div className="draw-offer" role="status"><p>对方提议和棋</p><button onClick={() => send({ type: 'drawRespond', accept: true })}>接受</button><button onClick={() => send({ type: 'drawRespond', accept: false })}>继续对弈</button></div>}
            <button className="leave-button" onClick={leaveRoom}><LogOut size={14}/>离开房间</button><p className="setup-footnote">双方准备后开局 · 对弈中退出即结束</p>
          </>}
        </section>}

        {finished && <section className="result-card" role="status"><span className="result-seal">{game.winner === 'draw' ? '和' : '胜'}</span><div><strong>{resultTitle(game)}</strong><p>{reasonLabel(game.reason, game.rules.noCaptureLimit)}</p></div></section>}
        <section className="record-panel glass-panel"><div className="record-tabs"><button className={moveTab === 'moves' ? 'selected' : ''} onClick={() => setMoveTab('moves')}>对局记录<span>{game.history.length.toString().padStart(2, '0')}</span></button><button className={moveTab === 'about' ? 'selected' : ''} onClick={() => setMoveTab('about')}>行棋须知</button></div>
          {moveTab === 'moves' ? <div className="move-history">{game.history.length === 0 ? <div className="empty-history"><div className="empty-board-icon"><span/><span/><span/><i/></div><p>棋局未启，万象皆新</p><span>落下第一子，故事从这里开始</span></div> : <><div className="history-column-labels"><span>回合</span><span><i className="red-dot"/>红方</span><span><i className="black-dot"/>黑方</span></div><div className="history-scroll">{Array.from({ length: Math.ceil(game.history.length / 2) }, (_, i) => <div className="history-row" key={i}><span>{String(i + 1).padStart(2, '0')}</span>{[game.history[i * 2], game.history[i * 2 + 1]].map((m, j) => <span key={j} className={`${j === 0 ? 'red-text' : ''} ${m?.ply === game.history.at(-1)?.ply ? 'latest' : ''}`}>{m?.notation ?? '…'}{m?.captured && <i title={`吃${pieceLabel(m.captured)}`}/>}</span>)}</div>)}<div ref={historyEnd}/></div></>}</div> : <div className="quick-rules"><p><strong>红先黑后，交替落子</strong>选中棋子后，圆点即为可走位置。</p><p><strong>将死、困毙均判负</strong>将军时必须应将，不可让将帅照面。</p><button onClick={() => setModal('rules')}>查看完整行棋说明<ArrowRight size={13}/></button></div>}
        </section>
        <div className="material-note"><span className="material-orb"/><div><strong>落子如水，心境如常。</strong><span>液态云母棋子 · 通透玻璃棋盘</span></div></div>
      </aside>
    </main>
    <footer className="page-footer"><span>弈境 <i/> 让思考慢下来</span><button onClick={() => setModal('rules')}><CircleHelp size={13}/>规则与说明</button><span className="footer-label">九路纵横 · 楚河汉界</span></footer>

    {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast('')} aria-label="关闭提示"><X size={14}/></button></div>}
    {modal && <ModalShell title={modal === 'rules' ? '行棋有章，从容入局' : '对弈设置'} close={closeModal}>
      {modal === 'rules' ? <div className="rules-content">
        <p className="modal-intro">红先黑后。将死对方或令对方无合法着法，即获得胜利。</p>
        <div className="piece-rules">{[
          ['帥 / 將', '九宫内直走一格，双方不可直接照面。'],
          ['仕 / 士', '九宫内斜走一格。'],
          ['相 / 象', '斜走两格，不可过河，象眼被占则不能走。'],
          ['傌 / 馬', '走日字，先直后斜，直行相邻点被占则蹩马腿。'],
          ['俥 / 車', '横直走任意格，途中不能越子。'],
          ['炮 / 砲', '不吃子时同车；吃子时必须隔且仅隔一枚棋子。'],
          ['兵 / 卒', '过河前只能向前一格，过河后可横走，始终不能后退。'],
        ].map(([label, text]) => <div key={label}><strong>{label}</strong><p>{text}</p></div>)}</div>
        <div className="rule-note"><strong>比赛棋例，可在设置中开关</strong>
          <p>开启时按世象联棋例区分长将、长捉和允许的循环，考虑真根、假根、同类子互兑与将捉交替。单方犯例三轮循环后提示变着，继续循环则判负；无单方犯例时四轮循环判和。</p>
          <p>关闭后使用简化练习规则：同一局面第三次出现，单方长将判负，其余重复判和。</p>
          <p>默认连续 50 回合（100 步）不吃子判和，也可选 60 回合或不限回合。兵卒移动不重置计数，吃子后重新计数。</p>
        </div>
        <a className="source-link" href="https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_Xiangqi_Rules_Chinese_2018.pdf" target="_blank" rel="noreferrer">参考：世界象棋联合会《世界象棋规则》<ArrowRight size={14}/></a>
        <p className="input-tip">支持键盘：方向键移动焦点，Enter 选择或落子，Esc 取消选择。</p>
      </div> : <div className="settings-content">
        <div className="setting-row"><div><strong>落点提示</strong><p>选中棋子时显示合法落点</p></div><button className={`toggle ${hints ? 'on' : ''}`} role="switch" aria-checked={hints} aria-label="落点提示" onClick={() => setHints(!hints)}><span/></button></div>
        <div className="setting-row"><div><strong>落子音效</strong><p>轻柔的落子与融合声音</p></div><button className={`toggle ${sound ? 'on' : ''}`} role="switch" aria-checked={sound} aria-label="落子音效" onClick={() => setSound(!sound)}><span/></button></div>
        <div className="settings-divider"/>
        <div className="setting-row competition-setting">
          <div><strong>比赛棋例</strong><p>长将、长捉与循环责任裁定</p></div>
          <button className={`toggle ${rules.repetition === 'wxf' ? 'on' : ''}`} role="switch" aria-checked={rules.repetition === 'wxf'} aria-label="比赛棋例" aria-describedby="repetition-description" onClick={() => setRules(r => ({ ...r, repetition: r.repetition === 'wxf' ? 'check-loss' : 'wxf' }))}><span/></button>
        </div>
        <p id="repetition-description" className="rule-setting-note">{rules.repetition === 'wxf' ? '已开启：依世象联棋例区分长将与长捉。三轮循环后提示变着，继续循环判负；无单方犯例时四轮循环判和。' : '已关闭：使用简化练习规则。单方长将判负，其余三次重复判和。'}</p>
        <label className="input-label limit-label" htmlFor="no-capture-limit">连续无吃子判和</label>
        <select id="no-capture-limit" value={rules.noCaptureLimit} onChange={e => setRules(r => ({ ...r, noCaptureLimit: Number(e.target.value) }))}>
          <option value={100}>50 回合 / 100 步（世象联限着数）</option>
          <option value={120}>60 回合 / 120 步（较长练习）</option>
          <option value={0}>不限回合</option>
        </select>
        <p className="rule-setting-note">规则设置用于下一局人机对弈或新建房间。已建立房间的规则保持一致，双方共用。</p>
        {room && <p className="current-room-rules">当前房间：{ruleLabel(room.rules)}</p>}
        {mode === 'pve' && active && <p className="current-room-rules">当前棋局：{ruleLabel(game.rules)}</p>}
        <p className="input-tip">系统开启“减少动态效果”时，会自动简化棋子动画。</p>
      </div>}
    </ModalShell>}
    {confirm && <ModalShell title={confirm.title} close={closeConfirm}><p className="confirmation-copy">{confirm.description}</p><div className="confirmation-actions"><button className="secondary-button" onClick={closeConfirm}>继续对弈</button><button className="primary-button" onClick={() => { confirm.action(); setConfirm(null); }}>{confirm.label}</button></div></ModalShell>}
  </div>;
}
