"""Real browser acceptance. Run against an already running local server.
XIANGQI_URL=http://127.0.0.1:5175 python tests/browser_smoke.py
Requires Python Playwright and a Chromium installation.
"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('XIANGQI_URL', 'http://127.0.0.1:5175')
OUTPUT = Path('test-results')
OUTPUT.mkdir(exist_ok=True)
errors = []
results = []

def ready(page):
    page.goto(URL, wait_until='domcontentloaded')
    expect(page.get_by_role('button', name='开始对弈', exact=True)).to_be_visible()
    page.on('pageerror', lambda error: errors.append(str(error)))

def click_square(page, x, y):
    page.locator(f'button[data-x="{x}"][data-y="{y}"]').click()

def pvp(page, nickname):
    ready(page)
    page.get_by_role('button', name='好友对弈', exact=True).click()
    page.get_by_label('你的称呼', exact=True).fill(nickname)

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH')
    browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1,
                                  record_video_dir=str(OUTPUT / 'videos'), record_video_size={'width': 1440, 'height': 1000})
    page = context.new_page()
    ready(page)
    expect(page.locator('.chess-piece')).to_have_count(32)
    page.screenshot(path=str(OUTPUT / 'desktop.png'), full_page=True)
    page.get_by_role('button', name='对弈设置', exact=True).click()
    competition = page.get_by_role('switch', name='比赛棋例', exact=True)
    expect(competition).to_be_checked()
    expect(page.get_by_label('连续无吃子判和', exact=True)).to_have_value('100')
    competition.click()
    expect(competition).not_to_be_checked()
    expect(page.locator('#repetition-description')).to_contain_text('简化练习')
    competition.click()
    page.screenshot(path=str(OUTPUT / 'rules-settings.png'))
    page.get_by_role('button', name='关闭', exact=True).click()
    results.append('Rule switch: WXF on/off; confirmed default 50 rounds / 100 plies')
    page.get_by_role('button', name='开始对弈', exact=True).click()
    expect(page.get_by_role('button', name='认输', exact=True)).to_be_visible()
    click_square(page, 1, 7)
    expect(page.locator('.chess-piece.selected')).to_have_count(1)
    expect(page.locator('button[data-x="1"][data-y="0"]')).to_have_class(re.compile('capturable'))
    click_square(page, 1, 0)
    page.wait_for_selector('[data-testid="capture-liquid"]', timeout=1500)
    page.wait_for_function("Number(document.querySelector('[data-testid=capture-liquid]')?.dataset.progress) > 0.52", timeout=1500)
    page.screenshot(path=str(OUTPUT / 'capture-fusion.png'))
    page.wait_for_function("document.querySelector('.record-tabs button')?.textContent.includes('02')", timeout=10000)
    page.locator('[data-testid="capture-liquid"]').wait_for(state='hidden', timeout=4000)
    expect(page.locator('.chess-piece')).to_have_count(30)
    page.screenshot(path=str(OUTPUT / 'after-capture.png'))
    page.get_by_role('button', name='悔棋', exact=True).click()
    expect(page.locator('.chess-piece')).to_have_count(32)
    expect(page.locator('.record-tabs button').first).to_contain_text('00')
    page.get_by_role('button', name='认输', exact=True).click()
    page.get_by_role('button', name='确认认输', exact=True).click()
    expect(page.locator('.result-card')).to_contain_text('黑方获胜')
    results.append('Desktop PVE: start, legal cannon screen capture, liquid animation, AI recapture, undo, resign')

    for personality, side in [('谨慎', '黑方 后行'), ('激进', '红方 先行')]:
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('button', name=re.compile('^' + personality + ' ')).click()
        page.get_by_role('button', name=side, exact=True).click()
        page.get_by_role('button', name='开始对弈', exact=True).click()
        if personality == '谨慎':
            page.wait_for_function("document.querySelector('.record-tabs button')?.textContent.includes('01')", timeout=10000)
            red_y = page.locator('.chess-piece[data-side="red"][data-kind="king"]').evaluate('(el) => el.getBoundingClientRect().y')
            black_y = page.locator('.chess-piece[data-side="black"][data-kind="king"]').evaluate('(el) => el.getBoundingClientRect().y')
            assert red_y < black_y, 'Black player must see black pieces at the bottom'
        else:
            click_square(page, 4, 6)
            click_square(page, 4, 5)
            page.wait_for_function("document.querySelector('.record-tabs button')?.textContent.includes('02')", timeout=10000)
        results.append(f'PVE {personality}: legal AI response and chosen color')

    a, b, c = [context.new_page() for _ in range(3)]
    pvp(a, '红方验收')
    a.get_by_role('button', name='创建房间', exact=True).click()
    expect(a.locator('.room-code-card strong')).to_be_visible()
    code = a.locator('.room-code-card strong').inner_text()
    for tab, nickname in [(b, '黑方验收'), (c, '旁观验收')]:
        pvp(tab, nickname)
        tab.get_by_label('房间码', exact=True).fill(code)
        tab.get_by_role('button', name='加入房间', exact=True).click()
        expect(tab.locator('.room-code-card strong')).to_have_text(code)
        expect(tab.locator('.room-rules')).to_contain_text('比赛棋例 · 50 回合')
    expect(c.locator('.spectator-count')).to_contain_text('你在旁观席')
    a.get_by_role('button', name='准备对弈', exact=True).click()
    b.get_by_role('button', name='准备对弈', exact=True).click()
    expect(a.get_by_role('button', name='认输', exact=True)).to_be_visible()
    click_square(c, 0, 6)
    expect(c.locator('.chess-piece.selected')).to_have_count(0)
    click_square(a, 0, 6)
    click_square(a, 0, 5)
    expect(b.locator('.record-tabs button').first).to_contain_text('01')
    expect(c.locator('.record-tabs button').first).to_contain_text('01')
    a.screenshot(path=str(OUTPUT / 'pvp-room.png'), full_page=True)
    b.get_by_role('button', name='离开房间', exact=True).click()
    b.get_by_role('button', name='结束并离开', exact=True).click()
    expect(a.locator('.result-card')).to_contain_text('红方获胜')
    c.get_by_role('button', name='入座', exact=True).click()
    expect(c.get_by_role('button', name='准备对弈', exact=True)).to_be_visible()
    c.get_by_role('button', name='站起，转为旁观', exact=True).click()
    expect(c.locator('.spectator-count')).to_contain_text('你在旁观席')
    c.get_by_role('button', name='入座', exact=True).click()
    c.get_by_role('button', name='准备对弈', exact=True).click()
    a.get_by_role('button', name='准备对弈', exact=True).click()
    expect(a.get_by_role('button', name='认输', exact=True)).to_be_visible()
    expect(a.locator('.chess-piece')).to_have_count(32)
    a.get_by_role('button', name='求和', exact=True).click()
    c.get_by_role('button', name='接受', exact=True).click()
    expect(a.locator('.result-card')).to_contain_text('和棋')
    results.append('Three browser PVP: room code, spectator lock, move sync, leave ends match, stand/sit, replacement rematch, agreed draw')

    for width in [390, 320]:
        mobile = browser.new_context(viewport={'width': width, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        m = mobile.new_page()
        ready(m)
        m.screenshot(path=str(OUTPUT / f'mobile-{width}.png'), full_page=True)
        assert m.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow'
        m.get_by_role('button', name='开始对弈', exact=True).tap()
        expect(m.get_by_role('button', name='认输', exact=True)).to_be_visible()
        m.locator('button[data-x="4"][data-y="6"]').tap()
        expect(m.locator('.chess-piece.selected')).to_have_count(1)
        m.locator('button[data-x="4"][data-y="6"]').tap()
        expect(m.locator('.chess-piece.selected')).to_have_count(0)
        m.locator('button[data-x="4"][data-y="6"]').tap()
        m.locator('button[data-x="4"][data-y="5"]').tap()
        m.wait_for_function("document.querySelector('.record-tabs button')?.textContent.includes('02')", timeout=10000)
        assert m.evaluate('window.scrollY') < 300, 'Move history scrolled the mobile player away from board'
        m.screenshot(path=str(OUTPUT / f'mobile-{width}-playing.png'))
        m.get_by_role('button', name='对弈设置', exact=True).click()
        expect(m.get_by_role('dialog')).to_be_visible()
        m.get_by_role('button', name='关闭', exact=True).click()
        results.append(f'{width}px touch: no overflow, select/cancel, human and AI move, no scroll jump, settings dialog')
        mobile.close()
    assert not errors, errors
    results.append('No uncaught browser errors')
    context.close()
    browser.close()
    (OUTPUT / 'acceptance.json').write_text(json.dumps({'checks': results, 'errors': errors}, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': results, 'errors': errors}, ensure_ascii=False, indent=2))
