import { test, expect, event } from './fixtures.mjs';
function duke(id, home=false, neutral=false, date='2026-09-05T23:30:00Z'){
 const g=event(id,{acc:true,date});g.competitions[0].neutralSite=neutral;
 const t=g.competitions[0].competitors[home?1:0].team;t.id='150';t.shortDisplayName='Duke';t.abbreviation='DUKE';return g;
}
test('Duke reveal is per-game, persisted, shared with Guide and never bypassed by focus',async({page,harness})=>{
 harness.state.events=[duke('duke-away'),event('ordinary',{acc:true})];
 await harness.open({path:'/?date=2026-09-05#game-duke-away'});
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true}).click();
 await expect(page.getByRole('alertdialog')).toContainText('Show this game only?');
 await page.getByRole('button',{name:'Keep hidden',exact:true}).click();
 await expect(page.locator('#game-duke-away')).toHaveCount(0);
 await page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true}).click();
 await page.getByRole('button',{name:'Show this game only',exact:true}).click();
 await expect(page.locator('#game-duke-away')).toBeVisible();
 await page.reload();await expect(page.locator('#game-duke-away')).toBeVisible();
 await page.getByRole('link',{name:'Guide',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toBeVisible();
 await page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('radio',{name:'Always show',exact:true}).check();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toContainText('Always off, even when you show a game.');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('.guide-game[data-game="duke-away"]')).toHaveCount(0);
 await page.reload();await expect(page.getByRole('button',{name:'Show Duke game on Sep 5',exact:true})).toBeVisible();
});
test('home visible, neutral hidden, weekly controls identify separate events and phone header fits',async({page,harness})=>{
 harness.state.events=[duke('duke-home',true),duke('duke-neutral',true,true,'2026-09-06T20:00:00Z')];
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toBeVisible();
 await page.getByRole('button',{name:'Hide Duke game on Sep 5',exact:true}).click();
 await expect(page.locator('#game-duke-home')).toHaveCount(0);
 await page.getByRole('tab',{name:/^ACC/}).click();
 await expect(page.getByRole('button',{name:'Show Duke game on Sep 6',exact:true})).toBeVisible();
 await expect(page.locator('#game-duke-neutral')).toHaveCount(0);
 await page.setViewportSize({width:320,height:740});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('damaged saved preferences explain the safe fallback',async({page,harness})=>{
 harness.state.events=[duke('duke-home',true)];
 await page.addInitScript(()=>localStorage.setItem('ss:duke-visibility:v1','broken'));
 await harness.open({path:'/?date=2026-09-05'});
 await expect(page.locator('#game-duke-home')).toHaveCount(0);
 await expect(page.getByRole('alert')).toContainText('Saved Duke preferences were damaged');
});
