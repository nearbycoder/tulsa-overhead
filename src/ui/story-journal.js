// Pause-menu journal. MissionManager remains the authority for chapter and contact availability.
export function storyJournal(ui) {
  const g = ui.game, manager = g.missions;
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = '<section class="menu story-journal"><header><h1>STORY</h1><button class="btn">Back</button></header></section>';
  const panel = screen.firstChild;
  const back = () => { ui.click(); ui.pop(); };
  panel.querySelector('button').onclick = back;
  screen.addEventListener('keydown', e => {
    if (e.code === 'Escape') { e.stopPropagation(); back(); }
  });

  function append(parent, tag, text, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }
  function action(parent, label, run) {
    const button = append(parent, 'button', label, 'btn');
    button.onclick = () => {
      ui.click(); ui.closeAll(); g.paused = false; run();
    };
  }

  const chapters = manager.story.CHAPTERS;
  const current = manager.chapterDef();
  if (current) {
    append(panel, 'div', 'Chapter ' + current.n + ' · ' + current.area, 'hint');
    append(panel, 'h2', current.title);
    append(panel, 'p', current.blurb);
  } else if (manager.finished) {
    append(panel, 'h2', 'Story complete');
  }
  const active = manager.active?.def;
  if (active) {
    const row = append(panel, 'section', '', 'journal-active');
    append(row, 'small', active.odd ? 'Current job' : 'Current mission');
    append(row, 'h3', active.title);
    if (g.hud.objText) append(row, 'p', '').dataset.g = g.hud.objText;
    const lines = manager.active.transcript;
    if (lines?.length) {
      const details = append(row, 'details', '', 'journal-transcript');
      append(details, 'summary', 'Conversation (' + lines.length + ')').dataset.nav = '';
      const transcript = append(details, 'dl', '');
      for (const line of lines) {
        append(transcript, 'dt', line.who);
        append(transcript, 'dd', line.text);
      }
    }
  }
  if (current) {
    const available = new Set(manager.available().map(m => m.id));
    for (const m of manager.missionsOf(current.n)) {
      if (active?.id === m.id) continue;
      const row = append(panel, 'div', '', 'journal-mission');
      const info = append(row, 'div', '');
      append(info, 'strong', m.title);
      if (manager.done.has(m.id)) {
        append(info, 'small', 'Completed');
      } else if (available.has(m.id)) {
        const place = manager.place(m.start);
        append(info, 'small', [manager.castName(m.giver), place.name].filter(Boolean).join(' · '));
        if (!active) {
          if (manager.canRetry && manager.retryOffer.def.id === m.id) {
            action(row, 'Retry mission', () => manager.retry());
          } else {
            action(row, 'Route to contact', () => {
              g.setWaypoint([place.x, place.y], m.title);
              g.hud.message('Meet ' + manager.castName(m.giver) + ' at ' + place.name, 5);
            });
          }
        }
      } else {
        const prerequisites = (m.requires || []).filter(id => !manager.done.has(id));
        append(info, 'small', 'After ' + prerequisites.map(id => manager.story.MISSIONS[id].title).join(' and '));
      }
    }
  }
  append(panel, 'h2', 'Chapters');
  const list = append(panel, 'div', '', 'chapter-list');
  for (const chapter of chapters) {
    const done = chapter.n < manager.chapter, open = chapter.n <= manager.chapter;
    const row = append(list, 'div', '', 'ch' + (done ? ' done' : open ? ' cur' : ''));
    append(row, 'b', 'Chapter ' + chapter.n + (open ? ' · ' + chapter.title : ''));
    if (!open) { append(row, 'small', 'Locked'); continue; }
    const missions = manager.missionsOf(chapter.n);
    const count = missions.filter(m => manager.done.has(m.id)).length;
    append(row, 'small', chapter.area + ' · ' + count + '/' + missions.length + ' missions');
    if (done) append(row, 'small', chapter.blurb);
  }
  return ui.push(screen);
}
