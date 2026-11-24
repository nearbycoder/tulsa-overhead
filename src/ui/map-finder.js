import { categories, destinationIndex, findDestinations } from './destinations.js';
import { settings } from '../engine/settings.js';

export function mapDistance(metres) {
  if (settings.get('speedUnits') === 'kmh')
    return metres < 1000 ? Math.round(metres) + ' m' : (metres / 1000).toFixed(1) + ' km';
  return metres < 161 ? Math.round(metres * 3.28084) + ' ft' : (metres / 1609.344).toFixed(1) + ' mi';
}

export class MapFinder {
  constructor(view) {
    this.view = view;
    this.category = 0;
    this.pageSize = 5;
    const panel = document.createElement('section');
    panel.className = 'map-panel';
    panel.setAttribute('aria-label', 'Map destinations');
    panel.innerHTML = `<h1>Tulsa Overhead</h1>
      <div class="map-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Find a destination" placeholder="Find a destination" autocomplete="off" spellcheck="false"><kbd data-gkb="/" data-gpad="{findPlace}"></kbd><button data-dismiss-search type="button" aria-label="Close search">×</button></div>
      <section class="map-results" hidden>
        <div class="map-filters" aria-label="Destination categories"></div>
        <ul class="map-matches" role="listbox" id="map-matches" aria-label="Destinations"></ul>
        <div class="map-paging"><button type="button" data-prev aria-label="Previous results">‹</button><span aria-live="polite"></span><button type="button" data-next aria-label="Next results">›</button></div>
      </section>
      <div class="map-route" hidden><div><strong></strong><small aria-live="polite"></small></div>
        <button type="button" data-fit>Show route</button><button type="button" data-clear aria-label="Clear waypoint" title="Clear waypoint">×</button></div>`;
    view.el.append(panel);
    this.panel = panel;
    this.input = panel.querySelector('input');
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-controls', 'map-matches');
    this.input.setAttribute('aria-expanded', 'false');
    this.list = panel.querySelector('ul');
    this.results = panel.querySelector('.map-results');
    this.route = panel.querySelector('.map-route');
    this.filters = panel.querySelector('.map-filters');
    this.pages = panel.querySelector('.map-paging');
    categories.forEach((name, i) => {
      const button = document.createElement('button');
      button.textContent = name;
      button.onclick = () => this.filter(i);
      this.filters.append(button);
    });
    panel.querySelector('[data-dismiss-search]').onclick = () => this.close();
    this.input.onfocus = () => this.open();
    this.input.oninput = () => this.search();
    this.pages.querySelector('[data-prev]').onclick = () => this.move(-this.pageSize);
    this.pages.querySelector('[data-next]').onclick = () => this.move(this.pageSize);
    this.route.querySelector('[data-fit]').onclick = () => {
      view.toggleRouteView();
      view.el.focus();
    };
    this.route.querySelector('[data-clear]').onclick = () => {
      view.g.setWaypoint(null);
      view.ui.click();
      view.el.focus();
    };
  }
  get expanded() {
    return !this.results.hidden;
  }
  focusSearch() {
    this.open();
    this.input.focus({ preventScroll: true });
    this.input.select();
  }
  open() {
    if (this.expanded) return;
    this.index ??= destinationIndex(this.view.g);
    this.results.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.search();
  }
  close() {
    this.results.hidden = true;
    this.input.value = '';
    this.category = 0;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.view.el.focus();
  }
  filter(i) {
    this.category = (i + categories.length) % categories.length;
    this.search();
  }
  search() {
    const player = this.view.g.player;
    this.matches = findDestinations(
      this.index,
      this.input.value,
      categories[this.category],
      player.x,
      player.y
    );
    this.selected = 0;
    this.render();
  }
  move(delta) {
    this.selected = Math.max(0, Math.min(this.matches.length - 1, this.selected + delta));
    this.render();
  }
  choose(i) {
    const place = this.matches[i]?.place;
    if (!place) return;
    this.view.g.setWaypoint([place.x, place.y], place.name);
    this.close();
    this.view.fitRoute(true);
    this.view.ui.click();
  }
  render() {
    const n = this.matches.length,
      start = Math.floor(this.selected / this.pageSize) * this.pageSize;
    this.list.replaceChildren();
    [...this.filters.children].forEach((b, i) => b.setAttribute('aria-pressed', i === this.category));
    this.pages.querySelector('[data-prev]').disabled = !start;
    this.pages.querySelector('[data-next]').disabled = start + this.pageSize >= n;
    this.pages.querySelector('span').textContent = n
      ? start + 1 + '–' + Math.min(n, start + this.pageSize) + ' of ' + n
      : 'No matching destinations';
    for (let i = start; i < Math.min(n, start + this.pageSize); i++) {
      const { place, distance } = this.matches[i],
        li = document.createElement('li');
      li.id = 'map-place-' + i;
      li.title = 'Route to ' + place.name;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === this.selected);
      li.onclick = () => this.choose(i);
      const name = document.createElement('strong'),
        context = document.createElement('small'),
        dist = document.createElement('span');
      name.textContent = place.name;
      context.textContent = [place.group === 'Story' ? 'Story · ' + place.kind : place.kind, place.area]
        .filter(Boolean)
        .join(' · ');
      dist.textContent = mapDistance(distance);
      li.append(name, context, dist);
      this.list.append(li);
    }
    if (n) {
      const active = this.list.children[this.selected - start];
      this.input.setAttribute('aria-activedescendant', active.id);
      this.list.scrollTop = Math.max(
        active.offsetTop + active.offsetHeight - this.list.clientHeight,
        Math.min(this.list.scrollTop, active.offsetTop)
      );
    } else this.input.removeAttribute('aria-activedescendant');
  }
  refreshRoute() {
    const { g } = this.view,
      gps = g.gps;
    this.route.hidden = this.expanded || !gps?.target;
    if (this.route.hidden) return;
    const manual = gps.source === g.waypoint;
    const title = manual ? g.waypointLabel || 'Dropped pin' : gps.source.label || 'Mission objective';
    const status = gps.status || (gps.mode === 'walk' ? 'Walking route' : 'Driving route');
    const detail = [status, gps.remaining != null ? mapDistance(gps.remaining) : '']
      .filter(Boolean)
      .join(' · ');
    const set = (element, text) => {
      if (element.textContent !== text) element.textContent = text;
    };
    const fit = this.route.querySelector('[data-fit]');
    set(fit, this.view.framing === 'route' ? 'Zoom to pin' : 'Show route');
    fit.title = 'Switch route view (R or right stick press)';
    set(this.route.querySelector('strong'), title);
    set(this.route.querySelector('small'), detail);
    this.route.querySelector('[data-clear]').hidden = !g.waypoint;
  }
}
